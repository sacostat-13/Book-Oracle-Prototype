-- ============================================================
-- schema_v37_migration.sql — Oracle quota: per-feature curator exemption,
--                            per-run metering, honest column names
--
-- ── 1. The "2026-07-01" confusion ───────────────────────────────────────────
-- `oracle_calls_reset_at` has never held a reset time. Every write to it since
-- schema_v22_migration.sql sets it to `v_month_start`, i.e. the START of the
-- current period. Reading 2026-07-01 on July 22nd means "the monthly counter
-- has been current since July 1st" — correct data under a name that says the
-- opposite. Same for `oracle_calls_day_reset_at`. The real reset instant is
-- computed at read time and returned as `reset_at`; it is never stored.
--
-- A Pro account is NOT secretly on a monthly reset: the daily cycle is driven
-- by `oracle_calls_day_reset_at`, a separate column. Renaming both to
-- `_period_start`. No behaviour change from the rename itself.
--
-- ── 2. Curator exemption is per-FEATURE, not blanket ────────────────────────
-- schema_v36 made curators unmetered for every Oracle call. That is wider than
-- intended. A curator's *categorization* run enriches the shared catalog —
-- books, genres, series — so it earns its exemption. Their Spark, Ask,
-- Similar and Plan calls are ordinary personal use and should be metered like
-- anyone else's.
--
-- So the exemption now keys on p_feature = 'categorization' AND is_curator,
-- not on is_curator alone.
--
-- ── 3. Exempt calls must not eat the metered budget ─────────────────────────
-- v36 still ticked oracle_calls_today / _this_month for curators ("cost
-- visibility"). Harmless when nothing was enforced. Now that curators ARE
-- metered for everything else, an exempt categorization run would spend the
-- very budget it is exempt from — one afternoon of catalog work and the
-- curator can't use Spark. Exempt calls therefore increment a separate
-- counter, oracle_calls_exempt_total, and leave the metered ones alone.
--
-- ── 4. Categorization is metered per RUN, not per batch ─────────────────────
-- oracleCategorizationService.js uses BATCH_SIZE = 5 and every batch was
-- charged separately. Against a 5-call budget that is 25 books per month on
-- Free and 25 per day on Pro — a new user with a normal shelf is walled on
-- their first run. The client now mints one run id per run; the first batch to
-- present it is charged and the rest ride free. Implemented as an idempotency
-- key in a ledger rather than a client-side "don't charge me" flag, because
-- the client must not be the thing that decides whether it pays.
-- ============================================================

begin;

-- ── Column renames ───────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'oracle_calls_reset_at') then
    alter table public.profiles rename column oracle_calls_reset_at to oracle_calls_month_start;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'oracle_calls_day_reset_at') then
    alter table public.profiles rename column oracle_calls_day_reset_at to oracle_calls_day_start;
  end if;
end $$;

comment on column public.profiles.oracle_calls_month_start is
  'START of the monthly quota period (date_trunc(month)), NOT a reset time. '
  'The reset instant is month_start + 1 month, computed at read time.';

comment on column public.profiles.oracle_calls_day_start is
  'START of the daily quota period (date_trunc(day)), NOT a reset time. '
  'Drives the Pro daily cycle. Reset instant is day_start + 1 day.';

-- ── Exempt-call counter (cost visibility, never enforced) ────────────────────
alter table public.profiles
  add column if not exists oracle_calls_exempt_total integer not null default 0;

comment on column public.profiles.oracle_calls_exempt_total is
  'Lifetime count of Oracle calls that bypassed the quota (curator '
  'categorization). Tracked for cost visibility only — never enforced, never '
  'reset. Deliberately separate from the metered counters so exempt catalog '
  'work cannot consume the user''s personal budget.';

-- ── Idempotency ledger for multi-batch runs ──────────────────────────────────
create table if not exists public.oracle_call_runs (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  run_id      uuid        not null,
  charged_at  timestamptz not null default now(),
  primary key (user_id, run_id)
);

create index if not exists oracle_call_runs_charged_at_idx
  on public.oracle_call_runs(charged_at);

-- No policies: touched exclusively by the SECURITY DEFINER functions below,
-- which bypass RLS. RLS on with zero policies denies all direct client access.
alter table public.oracle_call_runs enable row level security;

-- ── consume_oracle_call ──────────────────────────────────────────────────────
-- Dropped rather than replaced: a defaulted extra parameter alongside the
-- existing signature would leave two candidates for a 1-arg call, which
-- Postgres rejects as ambiguous.
drop function if exists public.consume_oracle_call(uuid);
drop function if exists public.consume_oracle_call(uuid, uuid);
drop function if exists public.consume_oracle_call(uuid, uuid, text);

create function public.consume_oracle_call(
  p_user_id uuid,
  p_run_id  uuid default null,
  p_feature text default null
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
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
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

  return jsonb_build_object(
    'status', 'ok', 'period', 'day',
    'calls_used', v_calls_day + 1, 'calls_limit', v_pro_day_limit,
    'reset_at', v_day_start + interval '1 day',
    'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
  );
end;
$$;

-- ── get_oracle_quota ─────────────────────────────────────────────────────────
-- Takes the same run id and feature, because netlify/functions/claude.js gates
-- on this BEFORE calling Anthropic. Without them, an exempt categorization
-- batch (or batch 2 of a paid run) would be turned away at the door by a spent
-- quota that does not apply to it.
--
-- Called with NO feature — as OracleQuotaContext does — it reports the user's
-- ordinary metered quota, including for curators. That is the number the
-- dashboard should show them. `is_curator` rides along so the UI can add the
-- "categorization is unlimited" note without a second query.
drop function if exists public.get_oracle_quota(uuid);
drop function if exists public.get_oracle_quota(uuid, uuid);
drop function if exists public.get_oracle_quota(uuid, uuid, text);

create function public.get_oracle_quota(
  p_user_id uuid,
  p_run_id  uuid default null,
  p_feature text default null
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
  v_exempt_total    integer;
  v_month_start_at  timestamptz;
  v_day_start_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_run_charged     boolean;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  select subscription_status, is_curator,
         oracle_calls_this_month, oracle_calls_month_start,
         oracle_calls_today,      oracle_calls_day_start,
         oracle_calls_exempt_total
  into   v_status, v_is_curator,
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

  -- Zeroed in memory only; persisting is consume_oracle_call's job.
  if v_month_start_at < v_month_start then v_calls_month := 0; end if;
  if v_day_start_at   < v_day_start   then v_calls_day   := 0; end if;

  -- Exempt: curator doing catalog work.
  if coalesce(v_is_curator, false) and p_feature = 'categorization' then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'exempt',
      'calls_used',      v_exempt_total,
      'calls_limit',     null,
      'calls_remaining', null,
      'reset_at',        null,
      'unlimited',       true,
      'is_curator',      v_is_curator,
      'run_charged',     false
    );
  end if;

  if p_run_id is not null then
    select true into v_run_charged
    from public.oracle_call_runs
    where user_id = p_user_id and run_id = p_run_id;
  end if;

  if v_status = 'active' then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'day',
      'calls_used',      v_calls_day,
      'calls_limit',     v_pro_day_limit,
      'calls_remaining', greatest(0, v_pro_day_limit - v_calls_day),
      'reset_at',        v_day_start + interval '1 day',
      'unlimited',       false,
      'is_curator',      v_is_curator,
      'run_charged',     coalesce(v_run_charged, false)
    );
  end if;

  return jsonb_build_object(
    'subscription_status', v_status, 'period', 'month',
    'calls_used',      v_calls_month,
    'calls_limit',     v_free_limit,
    'calls_remaining', greatest(0, v_free_limit - v_calls_month),
    'reset_at',        v_month_start + interval '1 month',
    'unlimited',       false,
    'is_curator',      v_is_curator,
    'run_charged',     coalesce(v_run_charged, false)
  );
end;
$$;

grant execute on function public.consume_oracle_call(uuid, uuid, text) to authenticated;
grant execute on function public.get_oracle_quota(uuid, uuid, text)    to authenticated;

-- ── One-time correction ──────────────────────────────────────────────────────
-- Under v36 every curator categorization call ticked the METERED counters.
-- Those calls were exempt in spirit but are now sitting in the budget this
-- migration starts enforcing, so a curator would open the app already walled
-- through no fault of their own. Move them across.
update public.profiles
  set oracle_calls_exempt_total = oracle_calls_exempt_total
                                  + greatest(oracle_calls_today, 0),
      oracle_calls_today        = 0,
      oracle_calls_this_month   = 0
  where is_curator is true;

commit;

-- ============================================================
-- Housekeeping — the ledger only needs to outlive a run (minutes):
--   delete from public.oracle_call_runs where charged_at < now() - interval '7 days';
--
-- Verification
-- ============================================================
-- 1. Names say what they mean now:
--   select oracle_calls_month_start, oracle_calls_day_start from public.profiles
--   where id = '<uuid>';   -- both are period STARTS, not reset times.
--
-- 2. Curator: exempt for catalog work, metered for everything else.
--   select get_oracle_quota('<curator-uuid>', null, 'categorization');
--   -- expect unlimited: true,  period: 'exempt'
--   select get_oracle_quota('<curator-uuid>');
--   -- expect unlimited: false, period: 'day', calls_limit: 5, is_curator: true
--
-- 3. A run is charged exactly once:
--   select consume_oracle_call('<uuid>', '11111111-1111-1111-1111-111111111111');
--   -- run_charged: false, calls_used +1
--   select consume_oracle_call('<uuid>', '11111111-1111-1111-1111-111111111111');
--   -- run_charged: true,  calls_used UNCHANGED
--
-- 4. Exempt calls never touch the metered counters:
--   select consume_oracle_call('<curator-uuid>', null, 'categorization');
--   select oracle_calls_today, oracle_calls_exempt_total from public.profiles
--   where id = '<curator-uuid>';   -- today unchanged, exempt_total +1
