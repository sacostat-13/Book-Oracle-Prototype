-- ============================================================
-- reset_oracle_quota_v058.sql — one-time, run ONCE after schema_v44.
--
-- Gives every account its full Oracle budget back, and re-arms the one-time
-- disclosure so existing users see it too.
--
-- ── Why a clean slate ────────────────────────────────────────────────────────
-- Until v0.58 a bulk import charged a metered Oracle call for every row it
-- could not resolve (BulkImport.claudeBookFallback ran with no `feature`, so
-- it never reached the free search tier). Some accounts therefore spent their
-- month on book identification they never asked for and were never told about.
-- Those counters are not a record of Oracle use; they are a record of a bug.
-- Carrying them forward would mean the first thing users see after a
-- transparency release is a balance they still can't account for.
--
-- ── Why oracle_intro_seen_at is cleared ──────────────────────────────────────
-- The column is NULL for everyone today, so this is belt-and-braces — but if
-- the app ships before this script runs, early users will have acknowledged
-- the dialog already. They are precisely the people the disclosure is for.
-- Clearing it costs one extra dialog and guarantees nobody is skipped.
--
-- ── What is NOT touched ──────────────────────────────────────────────────────
--   oracle_calls_exempt_total — curator cost visibility, never enforced.
--     Zeroing it would destroy history and refund nothing.
--   oracle_call_log           — empty before v0.58 by construction. If you
--     deploy first and reset later it will hold a handful of real rows, and
--     deleting them would contradict the ledger's whole purpose.
--   oracle_call_runs          — idempotency keys with a lifetime of minutes.
--   subscription_status       — billing is not ours to reset.
-- ============================================================

-- ── 0. Sanity: the columns this script writes ────────────────────────────────
-- Expect 5 rows. Two of these (subscription_status, oracle_calls_this_month)
-- are read and written by schema_v22/v36/v37 but have no CREATE/ALTER anywhere
-- in supabase/ — they were added outside the migration files, so this repo
-- cannot rebuild the database from scratch. Worth backfilling a migration for
-- them at some point; for now, confirm they are really there before writing.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in (
    'subscription_status', 'oracle_calls_today', 'oracle_calls_this_month',
    'oracle_calls_day_start', 'oracle_calls_month_start', 'oracle_intro_seen_at'
  )
order by column_name;
-- 6 rows expected. If oracle_intro_seen_at is missing, schema_v44 has not run.
-- If oracle_calls_day_start is missing but oracle_calls_day_reset_at exists,
-- schema_v37 has not run — stop, do not edit this script to use the old names.

-- ── 1. BEFORE: what you are about to change ──────────────────────────────────
-- Read this first. If at_monthly_wall is zero across the board, the reset is
-- a no-op and you can skip it.
select
  subscription_status,
  count(*)                                              as accounts,
  count(*) filter (where oracle_calls_today      >= 5)   as at_daily_wall,
  count(*) filter (where oracle_calls_this_month >= 5)   as at_monthly_wall,
  sum(oracle_calls_this_month)                          as calls_to_be_refunded,
  max(oracle_calls_this_month)                          as worst_case_account
from public.profiles
group by subscription_status
order by subscription_status;

-- ── 2. The reset ─────────────────────────────────────────────────────────────
begin;

-- The period-start columns are restamped to the CURRENT period, not left
-- behind. Leaving a stale start would make consume_oracle_call zero the
-- counter again on the next call — harmless, but it means the reset you
-- verified in step 3 is not the reset that ends up being applied.
--
-- Deliberately unfiltered: every account gets the same clean slate, including
-- Pro. A Pro user whose day was eaten by an import is owed the same refund,
-- and their counter reverts to normal at the next UTC midnight regardless.
update public.profiles
set
  oracle_calls_today       = 0,
  oracle_calls_this_month  = 0,
  oracle_calls_day_start   = date_trunc('day',   now() at time zone 'utc'),
  oracle_calls_month_start = date_trunc('month', now() at time zone 'utc'),
  -- Re-arm the one-time "Oracle calls are metered" dialog for everyone.
  oracle_intro_seen_at     = null;

commit;

-- ── 3. AFTER: prove it ───────────────────────────────────────────────────────
select
  count(*)                                                as accounts,
  count(*) filter (where oracle_calls_today      <> 0)     as still_nonzero_day,
  count(*) filter (where oracle_calls_this_month <> 0)     as still_nonzero_month,
  count(*) filter (where oracle_intro_seen_at is not null) as still_acknowledged,
  count(*) filter (
    where oracle_calls_month_start = date_trunc('month', now() at time zone 'utc')
  )                                                       as month_start_current
from public.profiles;
-- Expect: still_nonzero_day = 0, still_nonzero_month = 0,
--         still_acknowledged = 0, month_start_current = accounts.

-- Spot-check one account end to end — this is what the UI will render:
--   select public.get_oracle_quota(
--     (select id from auth.users where email = 'simont@mozillafoundation.org')
--   );
--   -- expect calls_used: 0, calls_remaining: 5

-- ============================================================
-- Run order
-- ============================================================
--   1. supabase/schema_v44_migration.sql   (adds oracle_intro_seen_at — this
--                                           script will not parse without it)
--   2. deploy the v0.58 frontend + functions
--   3. THIS FILE
--   4. supabase/announce_v058.sql          (tells people what changed)
--
-- 3 after 2 rather than before: resetting while the old build is still live
-- would hand back calls that the old BulkImport could immediately spend again
-- on the same unresolved rows.
-- ============================================================
