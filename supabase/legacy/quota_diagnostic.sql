-- quota_diagnostic.sql — read-only. Run in the Supabase SQL editor.
--
-- Answers the question "why does my account say 5 of 5 used when I made no
-- calls today?" without changing anything. Replace the email below.
--
-- Background on the two column pairs, because their names mislead:
--   oracle_calls_reset_at      = START of the current MONTH period (e.g. 2026-07-01)
--   oracle_calls_day_reset_at  = START of the current DAY period   (e.g. 2026-07-22)
-- Neither is "the time your quota resets". The RPC computes that separately
-- and returns it as `reset_at` = period start + one interval. So seeing
-- 2026-07-01 in oracle_calls_reset_at on July 22nd is expected, not a bug —
-- it means "the monthly counter has been current since July 1st".

\set target_email 'simont@mozillafoundation.org'

-- ── 1. Raw profile state ─────────────────────────────────────────────────────
select
  p.id,
  p.subscription_status,
  p.is_curator,
  p.oracle_calls_today,
  p.oracle_calls_day_reset_at,
  p.oracle_calls_this_month,
  p.oracle_calls_reset_at,
  date_trunc('day',   now() at time zone 'utc') as day_start_now,
  date_trunc('month', now() at time zone 'utc') as month_start_now,
  -- If this is false, the daily counter is stale and get_oracle_quota will
  -- (correctly) report 0 used regardless of what oracle_calls_today says.
  (p.oracle_calls_day_reset_at >= date_trunc('day', now() at time zone 'utc'))
    as day_counter_is_current
from public.profiles p
where p.id = (select id from auth.users where email = :'target_email');

-- ── 2. What the app actually sees ────────────────────────────────────────────
select public.get_oracle_quota(
  (select id from auth.users where email = :'target_email')
) as quota_as_the_ui_sees_it;

-- ── 3. Is this account being metered when it shouldn't be? ───────────────────
-- schema_v36_migration.sql added unmetered Oracle calls for curators, but
-- setting the flag was left as a MANUAL step in that file's verification
-- notes. If is_curator is false here, every catalog-maintenance run has been
-- spending the normal 5-call budget.
select
  id, is_curator, subscription_status
from public.profiles
where is_curator is true;

-- ── 4. Blast radius: who else is near the wall right now? ────────────────────
-- Useful for judging whether the metering policy (see below) is about to bite
-- real signups, not just this account.
select
  subscription_status,
  count(*) filter (where oracle_calls_today    >= 5) as at_daily_wall,
  count(*) filter (where oracle_calls_this_month >= 5) as at_monthly_wall,
  count(*)                                            as total,
  round(avg(oracle_calls_this_month), 1)              as avg_calls_this_month,
  max(oracle_calls_this_month)                        as max_calls_this_month
from public.profiles
group by subscription_status;

-- ============================================================================
-- If section 1 shows day_counter_is_current = true and a large
-- oracle_calls_today, the counter is NOT corrupt — those calls really were
-- consumed. The likely spender is the Oracle categorization run:
-- oracleCategorizationService.js uses BATCH_SIZE = 5 and spends ONE quota
-- call per batch, so 32 calls today == roughly 160 books categorized.
--
-- Against a 5-call budget that means:
--   Free (5/month): 25 books per MONTH
--   Pro  (5/day):   25 books per DAY
-- ============================================================================
