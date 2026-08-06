-- ============================================================
-- schema_v44_migration.sql — Oracle call history: a ledger the user can read
--
-- ── The complaint ────────────────────────────────────────────────────────────
-- "I used my free calls up pretty quickly and I'm not actually fully sure how."
--
-- Until now the only record of an Oracle call was a counter. `oracle_calls_
-- this_month = 4` tells a user how much is gone and nothing about where it
-- went, which makes a five-call budget feel arbitrary and, when it empties
-- unexpectedly, faintly dishonest. A counter cannot be audited. A ledger can.
--
-- ── Why a table and not jsonb on profiles ────────────────────────────────────
-- `profiles` is read on nearly every page load. Hanging an append-only array
-- off it means every one of those reads drags the whole history across the
-- wire, and the row rewrites on each Oracle call. A separate table is read
-- only when the History panel is opened, paginates, and can be aggregated.
-- It also mirrors what `oracle_call_runs` (schema_v37) already established:
-- quota bookkeeping lives in its own tables, written only by SECURITY DEFINER
-- functions.
--
-- ── What is recorded ─────────────────────────────────────────────────────────
-- Surface, timestamp, whether it was charged, and which period it counted
-- against. Deliberately NO user content: not the question asked, not the book
-- looked up, not the plan goal. "Ask the Oracle · Jul 29, 14:02" answers the
-- question the user is actually asking without turning the quota page into a
-- log of what they read and wondered about.
--
-- ── Uncharged calls are logged too ───────────────────────────────────────────
-- A curator's categorization run and batches 2..n of an already-paid run cost
-- the user nothing, but they are still Oracle activity. Logging them with
-- charged = false lets the History panel show the whole picture and — more
-- usefully — lets it prove a negative: "this run of 40 books cost you one
-- call, not eight." Quota REFUSALS are not logged: nothing happened.
--
-- ── The first-use disclosure ─────────────────────────────────────────────────
-- `profiles.oracle_intro_seen_at` backs a one-time dialog explaining that
-- anything labelled "Oracle" spends a call. An empty history is not a usable
-- trigger for it: every existing account has one, and a user who cancels the
-- dialog would be shown it forever. An explicit acknowledgement column says
-- what it means.
-- ============================================================

begin;

-- ── One-time disclosure ──────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists oracle_intro_seen_at timestamptz;

comment on column public.profiles.oracle_intro_seen_at is
  'When the user acknowledged the one-time "Oracle calls are metered" dialog. '
  'NULL means it has not been shown/accepted yet. Set from the client on '
  'confirm, not on dismiss — dismissing is not consent to spend a call.';

-- ── The ledger ───────────────────────────────────────────────────────────────
create table if not exists public.oracle_call_log (
  id         bigserial   primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  source     text        not null default 'unknown',
  charged    boolean     not null default true,
  period     text,       -- 'month' | 'day' | 'exempt' | 'run'
  run_id     uuid,       -- groups the batches of a multi-batch run
  created_at timestamptz not null default now()
);

comment on table public.oracle_call_log is
  'Append-only record of every Oracle call that actually reached Anthropic. '
  'Written exclusively by consume_oracle_call(). Stores no user content — '
  'surface and timestamp only.';

comment on column public.oracle_call_log.source is
  'Which surface spent the call: spark | ask | similar | categories | plan | '
  'categorization | club_poll | club_discussion | unknown. Allowlisted in '
  'netlify/functions/claude.js so a client cannot write arbitrary text here.';

comment on column public.oracle_call_log.charged is
  'false for calls that ran without spending quota: curator categorization '
  '(period = exempt) and batches 2..n of an already-paid run (period = run).';

-- The only access pattern: "this user's calls, newest first".
create index if not exists oracle_call_log_user_created_idx
  on public.oracle_call_log(user_id, created_at desc);

alter table public.oracle_call_log enable row level security;

-- Read-only to the owner. There is deliberately no insert/update/delete policy:
-- writes come from consume_oracle_call (SECURITY DEFINER, bypasses RLS), and a
-- ledger the subject can edit is not a ledger.
drop policy if exists "oracle_call_log_select_own" on public.oracle_call_log;
create policy "oracle_call_log_select_own"
  on public.oracle_call_log for select
  using (auth.uid() = user_id);

-- ── consume_oracle_call ──────────────────────────────────────────────────────
-- Gains p_source. Dropped rather than replaced for the same reason as v37: a
-- defaulted fourth parameter alongside the existing three-arg signature leaves
-- two candidates for a three-arg call, which Postgres rejects as ambiguous.
--
-- p_source is metadata ONLY. It is written to the log and never consulted by
-- the quota logic — the curator exemption still keys on p_feature, which the
-- Netlify function allowlists separately and much more narrowly. Keeping the
-- label a user sees and the label that grants an exemption as two different
-- parameters means a mislabelled surface can never become a free one.
drop function if exists public.consume_oracle_call(uuid);
drop function if exists public.consume_oracle_call(uuid, uuid);
drop function if exists public.consume_oracle_call(uuid, uuid, text);
drop function if exists public.consume_oracle_call(uuid, uuid, text, text);

create function public.consume_oracle_call(
  p_user_id uuid,
  p_run_id  uuid  default null,
  p_feature text  default null,
  p_source  text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status          text;
  v_is_curator      boolean;
  v_calls_month     integer;
  v_calls_day       integer;
  v_month_start_at  timestamptz;
  v_day_start_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_exempt          boolean;
  v_already_charged boolean;
  v_source          text;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  v_source := coalesce(nullif(btrim(p_source), ''), 'unknown');

  select subscription_status, is_curator,
         oracle_calls_this_month, oracle_calls_month_start,
         oracle_calls_today,      oracle_calls_day_start
  into   v_status, v_is_curator,
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

  -- The exemption: curator AND catalog work. Not curator alone.
  v_exempt := coalesce(v_is_curator, false) and p_feature = 'categorization';

  -- ── Exempt: count for cost visibility, enforce nothing ─────────────────────
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

  -- ── Already paid for this run? ─────────────────────────────────────────────
  -- Checked before the limit tests: a run that has been charged must be
  -- allowed to finish even if it crosses the wall mid-way, otherwise a large
  -- shelf half-categorizes and stops.
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

  -- ── Free tier: monthly ─────────────────────────────────────────────────────
  if v_status != 'active' then
    if v_month_start_at < v_month_start then
      v_calls_month := 0;
      update public.profiles
        set oracle_calls_this_month = 0, oracle_calls_month_start = v_month_start
        where id = p_user_id;
    end if;

    -- Refusals are not logged: no call was made, so there is nothing to
    -- account for. The wall UI already explains itself.
    if v_calls_month >= v_free_limit then
      return jsonb_build_object(
        'status', 'quota_exceeded', 'period', 'month',
        'calls_used', v_calls_month, 'calls_limit', v_free_limit,
        'reset_at', v_month_start + interval '1 month',
        'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
      );
    end if;

    update public.profiles
      set oracle_calls_this_month = v_calls_month + 1
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

  -- ── Pro tier: daily ────────────────────────────────────────────────────────
  if v_day_start_at < v_day_start then
    v_calls_day := 0;
    update public.profiles
      set oracle_calls_today = 0, oracle_calls_day_start = v_day_start
      where id = p_user_id;
  end if;

  if v_month_start_at < v_month_start then
    v_calls_month := 0;
    update public.profiles
      set oracle_calls_this_month = 0, oracle_calls_month_start = v_month_start
      where id = p_user_id;
  end if;

  if v_calls_day >= v_pro_day_limit then
    return jsonb_build_object(
      'status', 'quota_exceeded', 'period', 'day',
      'calls_used', v_calls_day, 'calls_limit', v_pro_day_limit,
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

  insert into public.oracle_call_log(user_id, source, charged, period, run_id)
    values (p_user_id, v_source, true, 'day', p_run_id);

  return jsonb_build_object(
    'status', 'ok', 'period', 'day',
    'calls_used', v_calls_day + 1, 'calls_limit', v_pro_day_limit,
    'reset_at', v_day_start + interval '1 day',
    'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
  );
end;
$$;

grant execute on function public.consume_oracle_call(uuid, uuid, text, text) to authenticated;

-- ── get_oracle_call_history ──────────────────────────────────────────────────
-- The panel needs two things at once: a page of rows, and totals for the
-- CURRENT period so the header can say "4 of your 5 monthly calls, spent
-- here". Doing that as two round trips would let the two halves disagree
-- across a period boundary. p_user_id is not a parameter — auth.uid() is the
-- only account you may read.
--
-- Not SECURITY DEFINER: the select policy above already scopes it correctly,
-- and an invoker-rights function cannot be tricked into reading someone else's
-- rows even if the argument handling is wrong.
create or replace function public.get_oracle_call_history(
  p_limit  integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_uid           uuid := auth.uid();
  v_status        text;
  v_period_start  timestamptz;
  v_limit         integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset        integer := greatest(coalesce(p_offset, 0), 0);
  v_total         integer;
  v_entries       jsonb;
  v_period_totals jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'message', 'Not authenticated');
  end if;

  select subscription_status into v_status
  from public.profiles where id = v_uid;

  -- Pro meters daily, everyone else monthly — the "this period" summary has to
  -- match whichever cycle the user is actually being charged on, or the panel
  -- contradicts the quota bar sitting directly above it.
  v_period_start := case
    when v_status = 'active' then date_trunc('day',   now() at time zone 'utc')
    else                          date_trunc('month', now() at time zone 'utc')
  end;

  select count(*) into v_total
  from public.oracle_call_log where user_id = v_uid;

  select coalesce(jsonb_agg(e order by e_created_at desc), '[]'::jsonb)
  into v_entries
  from (
    select jsonb_build_object(
             'id',         l.id,
             'source',     l.source,
             'charged',    l.charged,
             'period',     l.period,
             'run_id',     l.run_id,
             'created_at', l.created_at
           ) as e,
           l.created_at as e_created_at
    from public.oracle_call_log l
    where l.user_id = v_uid
    order by l.created_at desc, l.id desc
    limit v_limit offset v_offset
  ) page;

  -- Per-surface breakdown of the current period. Only charged rows count:
  -- these numbers must reconcile with the quota bar, and free calls do not
  -- move it.
  select coalesce(jsonb_object_agg(source, n), '{}'::jsonb)
  into v_period_totals
  from (
    select source, count(*)::int as n
    from public.oracle_call_log
    where user_id = v_uid
      and charged
      and created_at >= v_period_start
    group by source
  ) s;

  return jsonb_build_object(
    'status',        'ok',
    'entries',       v_entries,
    'total',         v_total,
    'limit',         v_limit,
    'offset',        v_offset,
    'has_more',      v_offset + v_limit < v_total,
    'period',        case when v_status = 'active' then 'day' else 'month' end,
    'period_start',  v_period_start,
    'period_totals', v_period_totals
  );
end;
$$;

grant execute on function public.get_oracle_call_history(integer, integer) to authenticated;

commit;

-- ============================================================
-- Housekeeping
-- ============================================================
-- The log is the user's receipt, not an audit trail, so it does not need to be
-- kept forever. A year is comfortably longer than anyone will look back:
--   delete from public.oracle_call_log where created_at < now() - interval '1 year';
--
-- Verification
-- ============================================================
-- 1. A charged call lands in the ledger with its surface:
--   select consume_oracle_call('<uuid>', null, null, 'ask');
--   select source, charged, period from public.oracle_call_log
--     where user_id = '<uuid>' order by created_at desc limit 1;
--   -- expect: ask | t | month   (or 'day' on Pro)
--
-- 2. Batches 2..n of a run are logged but not charged:
--   select consume_oracle_call('<uuid>', '11111111-1111-1111-1111-111111111111', null, 'categorization');
--   select consume_oracle_call('<uuid>', '11111111-1111-1111-1111-111111111111', null, 'categorization');
--   select charged, period from public.oracle_call_log
--     where user_id = '<uuid>' order by created_at desc limit 2;
--   -- expect: f | run   then   t | month
--
-- 3. A refusal writes nothing:
--   -- spend the budget, then:
--   select consume_oracle_call('<uuid>', null, null, 'spark');   -- quota_exceeded
--   -- row count in oracle_call_log UNCHANGED.
--
-- 4. The ledger is not writable or readable across accounts (run as an
--    authenticated user, not service_role):
--   insert into public.oracle_call_log(user_id, source) values (auth.uid(), 'fake');
--   -- expect: new row violates row-level security policy
--   select * from public.oracle_call_log where user_id <> auth.uid();
--   -- expect: 0 rows
--
-- 5. The summary matches the quota bar:
--   select get_oracle_call_history(20, 0);
--   -- sum of period_totals values == get_oracle_quota(auth.uid()) -> calls_used
-- ============================================================
