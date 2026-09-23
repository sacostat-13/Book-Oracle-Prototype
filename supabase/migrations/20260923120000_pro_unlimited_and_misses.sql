-- v0.71 "Unlimited" — Pro becomes unlimited, Free keeps 5/month with a
-- welcome month, and the Oracle can be told it missed. 2026-09-23.
-- Spec: claude/pro-tier-v1-spec.md (Book Oracle project) · docs/pro-tier-v1-spec.md
--
-- This migration:
--   1. Guards the privileged profile columns. The "own safe profile fields"
--      policy never restricted columns, so any signed-in reader could set
--      subscription_status = 'active' from the console. An unlimited Pro makes
--      that worth doing; it closes here, before Pro changes.
--   2. Revokes consume_oracle_call from clients and scopes get_oracle_quota to
--      the caller. Both took p_user_id from whoever called them.
--   3. Rewrites the two quota functions:
--        Free  — 5 per calendar month; 10 during the first 30 days (welcome).
--        Pro   — unlimited, with a silent fair-use ceiling of 30 per day.
--   4. Adds oracle_misses and report_oracle_miss(): "None of these call to me".
--      Every miss is recorded; a charged free draw is refunded, 2 per month.
--
-- Idempotent: every statement is create-or-replace / if-not-exists / drop-if.

-- ── 1. Privileged profile columns ─────────────────────────────────────────────
-- current_user is the session role for a plain (non-definer) trigger function:
-- 'authenticated' / 'anon' for PostgREST clients, 'service_role' for the
-- webhook, 'postgres' inside SECURITY DEFINER RPCs and the SQL editor. Only the
-- first two are clients; everything else is trusted to write billing state.
create or replace function public.profiles_guard_privileged()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A client-side insert never gets to choose its own tier or counters.
    new.subscription_status       := 'free';
    new.is_curator                := false;
    new.oracle_calls_this_month   := 0;
    new.oracle_calls_today        := 0;
    new.oracle_calls_exempt_total := 0;
    return new;
  end if;

  if new.subscription_status       is distinct from old.subscription_status
  or new.is_curator                is distinct from old.is_curator
  or new.oracle_calls_this_month   is distinct from old.oracle_calls_this_month
  or new.oracle_calls_month_start  is distinct from old.oracle_calls_month_start
  or new.oracle_calls_today        is distinct from old.oracle_calls_today
  or new.oracle_calls_day_start    is distinct from old.oracle_calls_day_start
  or new.oracle_calls_exempt_total is distinct from old.oracle_calls_exempt_total
  then
    raise exception 'profiles: subscription and quota fields are server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_privileged();

-- ── 2. Who may call the quota functions ───────────────────────────────────────
-- consume_oracle_call is claude.js's job alone (service role).
revoke execute on function public.consume_oracle_call(uuid, uuid, text, text) from public, anon, authenticated;
grant  execute on function public.consume_oracle_call(uuid, uuid, text, text) to service_role;

-- get_oracle_quota: the client reads its own; the body refuses anyone else's.
revoke execute on function public.get_oracle_quota(uuid, uuid, text) from public, anon;
grant  execute on function public.get_oracle_quota(uuid, uuid, text) to authenticated, service_role;

-- ── 3. Quota ──────────────────────────────────────────────────────────────────
-- One place for the numbers, so the two functions below cannot disagree.
create or replace function public.oracle_free_limit(p_created_at timestamptz)
returns integer
language sql
stable
as $$
  -- Welcome month: the first 30 days after signup, whichever calendar months
  -- they straddle. Existing accounts are past it and see 5.
  select case when p_created_at > now() - interval '30 days' then 10 else 5 end;
$$;

create or replace function public.consume_oracle_call (
  p_user_id uuid,
  p_run_id  uuid DEFAULT NULL::uuid,
  p_feature text DEFAULT NULL::text,
  p_source  text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_status          text;
  v_is_curator      boolean;
  v_created_at      timestamptz;
  v_calls_month     integer;
  v_calls_day       integer;
  v_month_start_at  timestamptz;
  v_day_start_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_exempt          boolean;
  v_already_charged boolean;
  v_source          text;
  v_free_limit      integer;
  v_pro_ceiling     constant integer := 30;   -- fair use, not a product limit
begin
  v_source := coalesce(nullif(btrim(p_source), ''), 'unknown');

  select subscription_status, is_curator, created_at,
         oracle_calls_this_month, oracle_calls_month_start,
         oracle_calls_today,      oracle_calls_day_start
  into   v_status, v_is_curator, v_created_at,
         v_calls_month, v_month_start_at,
         v_calls_day,   v_day_start_at
  from   public.profiles
  where  id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Profile not found');
  end if;

  v_month_start := date_trunc('month', now() at time zone 'utc');
  v_day_start   := date_trunc('day',   now() at time zone 'utc');
  v_free_limit  := public.oracle_free_limit(v_created_at);

  v_exempt := coalesce(v_is_curator, false) and p_feature = 'categorization';

  if v_exempt then
    update public.profiles
      set oracle_calls_exempt_total = oracle_calls_exempt_total + 1
      where id = p_user_id;
    insert into public.oracle_call_log(user_id, source, charged, period, run_id)
      values (p_user_id, v_source, false, 'exempt', p_run_id);
    return jsonb_build_object(
      'status', 'ok', 'period', 'exempt',
      'calls_used', v_calls_day, 'calls_limit', null,
      'reset_at', null, 'unlimited', true,
      'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  if p_run_id is not null then
    select true into v_already_charged
    from public.oracle_call_runs
    where user_id = p_user_id and run_id = p_run_id;

    if coalesce(v_already_charged, false) then
      insert into public.oracle_call_log(user_id, source, charged, period, run_id)
        values (p_user_id, v_source, false, 'run', p_run_id);
      return jsonb_build_object(
        'status', 'ok', 'period', 'run',
        'calls_used', v_calls_day, 'calls_limit', null,
        'reset_at', null, 'unlimited', false,
        'is_curator', v_is_curator, 'run_charged', true
      );
    end if;
  end if;

  -- Both counters roll over for everyone. Pro still counts the month so a
  -- Pro→Free downgrade mid-month lands on a truthful number.
  if v_month_start_at < v_month_start then
    v_calls_month := 0;
    update public.profiles
      set oracle_calls_this_month = 0, oracle_calls_month_start = v_month_start
      where id = p_user_id;
  end if;
  if v_day_start_at < v_day_start then
    v_calls_day := 0;
    update public.profiles
      set oracle_calls_today = 0, oracle_calls_day_start = v_day_start
      where id = p_user_id;
  end if;

  -- ── Free: monthly ──────────────────────────────────────────────────────────
  if v_status <> 'active' then
    if v_calls_month >= v_free_limit then
      return jsonb_build_object(
        'status', 'quota_exceeded', 'period', 'month',
        'calls_used', v_calls_month, 'calls_limit', v_free_limit,
        'reset_at', v_month_start + interval '1 month',
        'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
      );
    end if;

    update public.profiles
      set oracle_calls_this_month = v_calls_month + 1,
          oracle_calls_today      = v_calls_day + 1
      where id = p_user_id;

    if p_run_id is not null then
      insert into public.oracle_call_runs(user_id, run_id)
        values (p_user_id, p_run_id) on conflict do nothing;
    end if;

    insert into public.oracle_call_log(user_id, source, charged, period, run_id)
      values (p_user_id, v_source, true, 'month', p_run_id);

    return jsonb_build_object(
      'status', 'ok', 'period', 'month',
      'calls_used', v_calls_month + 1, 'calls_limit', v_free_limit,
      'reset_at', v_month_start + interval '1 month',
      'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  -- ── Pro: unlimited, under a fair-use ceiling ───────────────────────────────
  if v_calls_day >= v_pro_ceiling then
    return jsonb_build_object(
      'status', 'quota_exceeded', 'period', 'day',
      'calls_used', v_calls_day, 'calls_limit', v_pro_ceiling,
      'reset_at', v_day_start + interval '1 day',
      'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  update public.profiles
    set oracle_calls_today      = v_calls_day + 1,
        oracle_calls_this_month = v_calls_month + 1
    where id = p_user_id;

  if p_run_id is not null then
    insert into public.oracle_call_runs(user_id, run_id)
      values (p_user_id, p_run_id) on conflict do nothing;
  end if;

  -- period 'pro': charged (it is a real call and belongs in the history), but
  -- against nothing. Distinct from 'day' so old and new Pro rows can be told
  -- apart in the log.
  insert into public.oracle_call_log(user_id, source, charged, period, run_id)
    values (p_user_id, v_source, true, 'pro', p_run_id);

  return jsonb_build_object(
    'status', 'ok', 'period', 'unlimited',
    'calls_used', v_calls_month + 1, 'calls_limit', null,
    'reset_at', null,
    'unlimited', true, 'is_curator', v_is_curator, 'run_charged', false
  );
end;
$function$;

-- CREATE OR REPLACE keeps existing grants, so re-assert the revoke from §2.
revoke execute on function public.consume_oracle_call(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.get_oracle_quota (
  p_user_id uuid,
  p_run_id  uuid DEFAULT NULL::uuid,
  p_feature text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_uid             uuid := auth.uid();
  v_status          text;
  v_is_curator      boolean;
  v_created_at      timestamptz;
  v_calls_month     integer;
  v_calls_day       integer;
  v_exempt_total    integer;
  v_month_start_at  timestamptz;
  v_day_start_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_run_charged     boolean;
  v_free_limit      integer;
  v_pro_ceiling     constant integer := 30;
begin
  -- A signed-in client may only read its own quota. The service role (claude.js)
  -- has no auth.uid() and reads whichever user it verified from the JWT.
  if v_uid is not null and v_uid <> p_user_id then
    return jsonb_build_object('status', 'error', 'message', 'Not your quota');
  end if;

  select subscription_status, is_curator, created_at,
         oracle_calls_this_month, oracle_calls_month_start,
         oracle_calls_today,      oracle_calls_day_start,
         oracle_calls_exempt_total
  into   v_status, v_is_curator, v_created_at,
         v_calls_month, v_month_start_at,
         v_calls_day,   v_day_start_at,
         v_exempt_total
  from   public.profiles
  where  id = p_user_id;

  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Profile not found');
  end if;

  v_month_start := date_trunc('month', now() at time zone 'utc');
  v_day_start   := date_trunc('day',   now() at time zone 'utc');
  v_free_limit  := public.oracle_free_limit(v_created_at);

  if v_month_start_at < v_month_start then v_calls_month := 0; end if;
  if v_day_start_at   < v_day_start   then v_calls_day   := 0; end if;

  if coalesce(v_is_curator, false) and p_feature = 'categorization' then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'exempt',
      'calls_used', v_exempt_total, 'calls_limit', null, 'calls_remaining', null,
      'reset_at', null, 'unlimited', true, 'welcome', false,
      'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  if p_run_id is not null then
    select true into v_run_charged
    from public.oracle_call_runs
    where user_id = p_user_id and run_id = p_run_id;
  end if;

  if v_status = 'active' then
    -- At the ceiling, answer in the shape the existing day-wall already
    -- renders (period 'day', 0 remaining). Below it: unlimited, no numbers.
    if v_calls_day >= v_pro_ceiling then
      return jsonb_build_object(
        'subscription_status', v_status, 'period', 'day',
        'calls_used', v_calls_day, 'calls_limit', v_pro_ceiling, 'calls_remaining', 0,
        'reset_at', v_day_start + interval '1 day',
        'unlimited', false, 'welcome', false,
        'is_curator', v_is_curator, 'run_charged', coalesce(v_run_charged, false)
      );
    end if;
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'unlimited',
      'calls_used', v_calls_month, 'calls_limit', null, 'calls_remaining', null,
      'reset_at', null, 'unlimited', true, 'welcome', false,
      'is_curator', v_is_curator, 'run_charged', coalesce(v_run_charged, false)
    );
  end if;

  return jsonb_build_object(
    'subscription_status', v_status, 'period', 'month',
    'calls_used',      v_calls_month,
    'calls_limit',     v_free_limit,
    'calls_remaining', greatest(0, v_free_limit - v_calls_month),
    'reset_at',        v_month_start + interval '1 month',
    'unlimited',       false,
    'welcome',         v_free_limit > 5,
    'is_curator',      v_is_curator,
    'run_charged',     coalesce(v_run_charged, false)
  );
end;
$function$;

revoke execute on function public.get_oracle_quota(uuid, uuid, text) from public, anon;

-- ── 4. Misses ─────────────────────────────────────────────────────────────────
create table if not exists public.oracle_misses (
  id                 bigint generated by default as identity primary key,
  user_id            uuid        not null references auth.users(id) on delete cascade,
  surface            text        not null,
  recommendation_ids bigint[]    not null,
  reason             text,
  refunded           boolean     not null default false,
  refunded_call_id   bigint,
  created_at         timestamptz not null default now(),
  constraint oracle_misses_reason_check
    check (reason is null or reason in ('not_my_taste', 'already_known', 'off_request', 'other'))
);

comment on table public.oracle_misses is
  'One row per "None of these call to me". Written only by report_oracle_miss(). The recommendation-quality signal first, the refund ledger second. See claude/pro-tier-v1-spec.md §4.';

create index if not exists oracle_misses_user_month_idx
  on public.oracle_misses (user_id, created_at desc);

alter table public.oracle_misses enable row level security;

drop policy if exists "Own misses readable" on public.oracle_misses;
create policy "Own misses readable" on public.oracle_misses
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.oracle_misses from anon;
revoke insert, update, delete on public.oracle_misses from authenticated;
grant select on public.oracle_misses to authenticated;

create or replace function public.report_oracle_miss (
  p_surface            text,
  p_recommendation_ids bigint[],
  p_reason             text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_uid           uuid := auth.uid();
  v_surface       text;
  v_reason        text;
  v_ids           bigint[];
  v_valid         integer;
  v_first_shown   timestamptz;
  v_status        text;
  v_created_at    timestamptz;
  v_calls_month   integer;
  v_month_start_at timestamptz;
  v_month_start   timestamptz := date_trunc('month', now() at time zone 'utc');
  v_refunds_used  integer;
  v_call_id       bigint;
  v_refunded      boolean := false;
  v_free_limit    integer;
  v_refund_cap    constant integer := 2;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'message', 'Not authenticated');
  end if;

  v_surface := case when p_surface in ('spark', 'ask', 'similar', 'categories', 'plan')
                    then p_surface else null end;
  if v_surface is null then
    return jsonb_build_object('status', 'error', 'message', 'Unknown surface');
  end if;

  v_reason := case when p_reason in ('not_my_taste', 'already_known', 'off_request', 'other')
                   then p_reason else null end;

  -- De-duplicate and bound the input; a draw is 3–6 books.
  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_recommendation_ids, array[]::bigint[])) as x
  where x is not null;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 25 then
    return jsonb_build_object('status', 'error', 'message', 'No recommendations');
  end if;

  -- Every id: the caller's, this surface's, recent, unresolved, not already missed.
  select count(*), min(shown_at) into v_valid, v_first_shown
  from public.oracle_recommendations r
  where r.id = any(v_ids)
    and r.user_id = v_uid
    and r.surface = v_surface
    and r.outcome is null
    and r.shown_at > now() - interval '24 hours'
    and not exists (
      select 1 from public.oracle_misses m
      where m.user_id = v_uid and r.id = any(m.recommendation_ids)
    );

  if v_valid <> cardinality(v_ids) then
    return jsonb_build_object('status', 'error', 'message', 'Draw not eligible');
  end if;

  update public.oracle_recommendations
    set outcome = 'dismissed', outcome_at = now()
    where id = any(v_ids) and user_id = v_uid;

  -- ── Refund? ────────────────────────────────────────────────────────────────
  select subscription_status, created_at, oracle_calls_this_month, oracle_calls_month_start
  into   v_status, v_created_at, v_calls_month, v_month_start_at
  from   public.profiles where id = v_uid
  for update;

  select count(*) into v_refunds_used
  from public.oracle_misses
  where user_id = v_uid and refunded and created_at >= v_month_start;

  if v_status <> 'active' and v_refunds_used < v_refund_cap and v_month_start_at >= v_month_start then
    -- The charge that produced this draw. oracle_recommendations.call_id is
    -- never populated, so link by time: claude.js logs the charge before the
    -- response returns, the client logs the recommendations after.
    select l.id into v_call_id
    from public.oracle_call_log l
    where l.user_id = v_uid
      and l.source  = v_surface
      and l.charged
      and l.period  = 'month'
      and l.created_at >= v_month_start
      and l.created_at between v_first_shown - interval '10 minutes' and v_first_shown
    order by l.created_at desc
    limit 1
    for update;

    if v_call_id is not null then
      -- Flip the charge rather than add a credit row: history totals count
      -- charged rows only, so they keep reconciling with the bar untouched.
      update public.oracle_call_log
        set charged = false, period = 'refunded'
        where id = v_call_id;
      update public.profiles
        set oracle_calls_this_month = greatest(0, oracle_calls_this_month - 1)
        where id = v_uid;
      v_calls_month := greatest(0, v_calls_month - 1);
      v_refunded := true;
    end if;
  end if;

  insert into public.oracle_misses (user_id, surface, recommendation_ids, reason, refunded, refunded_call_id)
    values (v_uid, v_surface, v_ids, v_reason, v_refunded, v_call_id);

  v_free_limit := public.oracle_free_limit(v_created_at);

  return jsonb_build_object(
    'status',          'ok',
    'refunded',        v_refunded,
    'refunds_left',    case when v_status = 'active' then null
                            else greatest(0, v_refund_cap - v_refunds_used - (case when v_refunded then 1 else 0 end)) end,
    'calls_remaining', case when v_status = 'active' then null
                            when v_month_start_at < v_month_start then v_free_limit
                            else greatest(0, v_free_limit - v_calls_month) end
  );
end;
$function$;

revoke execute on function public.report_oracle_miss(text, bigint[], text) from public, anon;
grant  execute on function public.report_oracle_miss(text, bigint[], text) to authenticated;

-- ── Check ─────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.consume_oracle_call(uuid,uuid,text,text)', 'execute') then
    raise exception 'v0.71: anon can still execute consume_oracle_call';
  end if;
  if has_function_privilege('authenticated', 'public.consume_oracle_call(uuid,uuid,text,text)', 'execute') then
    raise exception 'v0.71: authenticated can still execute consume_oracle_call';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'profiles_guard_privileged'
                 and tgrelid = 'public.profiles'::regclass) then
    raise exception 'v0.71: profiles guard trigger missing';
  end if;
  raise notice 'v0.71: quota hardened; Pro unlimited (fair use 30/day); misses live.';
end $$;
