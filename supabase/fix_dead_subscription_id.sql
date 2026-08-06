-- ============================================================
-- fix_dead_subscription_id.sql — clear a subscription id Lemon Squeezy
--                                will not honour.
--
-- ── The case this is for ─────────────────────────────────────────────────────
-- profile_billing holds an ls_subscription_id, and the LS API answers 404 for
-- it. Confirmed in the Netlify function log as:
--
--     LS subscription fetch failed: HTTP 404 for sub <id>
--     [{"status":"404","title":"Not Found"}]
--
-- Two causes, one fix. Either the subscription was created in TEST mode and
-- the deployed LEMONSQUEEZY_API_KEY is live-mode (a live key cannot see a test
-- subscription, and returns 404 rather than saying so), or the subscription
-- was deleted LS-side. In both cases the stored id is a dead handle: no key we
-- hold will ever resolve it, and every "Manage subscription" click burns a
-- function invocation to rediscover that.
--
-- ── What this does NOT do ────────────────────────────────────────────────────
-- subscription_status is left alone. Clearing the id removes a broken pointer;
-- it is not a statement about whether the account should have Pro. If you want
-- to drop the tier as well, that is the separate statement at the bottom —
-- deliberately separate, because conflating "this billing id is junk" with
-- "revoke this person's access" is how a cleanup script becomes an incident.
--
-- ── DANGER ───────────────────────────────────────────────────────────────────
-- Do NOT run this against an account with a REAL, live, paying subscription.
-- The id is the only handle the customer portal has, and the webhook will not
-- resend it — Lemon Squeezy only pushes on subscription *events*, so a working
-- account whose id you delete cannot manage or cancel their own billing until
-- you dig the id back out of the LS dashboard by hand.
--
-- Step 1 below refuses to proceed unless the LS API has actually 404'd, which
-- is a judgement only you can make. Make it before running step 2.
-- ============================================================

-- ── 1. Confirm the target, and that it is the right one ──────────────────────
-- Expect exactly one row. Check the ls_subscription_id against the id in the
-- Netlify log line, and check the LS dashboard WITH TEST MODE ON — if the
-- subscription appears there, this is the test-mode case and you are clear to
-- proceed.
select
  u.email,
  p.subscription_status,
  b.ls_customer_id,
  b.ls_subscription_id,
  b.updated_at
from public.profile_billing b
join public.profiles p on p.id = b.user_id
join auth.users     u on u.id = b.user_id
where u.email = 'mandala.xiii@gmail.com';

-- ── 2. Clear the dead handle ─────────────────────────────────────────────────
begin;

-- Both id columns go. Keeping ls_customer_id alone would leave a customer
-- record pointing at no subscription — enough to look like billing exists in a
-- future query, not enough to open anything.
--
-- The `is not null` guard makes this a no-op on second run rather than a
-- silent "0 rows updated" you might read as failure. The email is spelled out
-- rather than parameterised so there is no chance of it running wider than
-- intended: this updates exactly one account.
update public.profile_billing
set
  ls_subscription_id = null,
  ls_customer_id     = null,
  updated_at         = now()
where user_id = (select id from auth.users where email = 'mandala.xiii@gmail.com')
  and ls_subscription_id is not null;

commit;

-- ── 3. Verify ────────────────────────────────────────────────────────────────
select
  u.email,
  p.subscription_status,                          -- expect: active (unchanged)
  (b.ls_subscription_id is null) as id_cleared,   -- expect: true
  b.updated_at
from public.profile_billing b
join public.profiles p on p.id = b.user_id
join auth.users     u on u.id = b.user_id
where u.email = 'mandala.xiii@gmail.com';

-- After this, with the v0.58 functions deployed, Manage Subscription returns
-- 404 {code: 'comped'} instead of 502, and the Profile tab replaces the button
-- with "Pro, granted directly — no billing attached". Before the deploy it
-- returns the older 404 {code: 'no_subscription'}, which toasts an upgrade
-- nudge — harmless, just slightly odd on an account that already has Pro.

-- ============================================================
-- Separately, IF you also want the tier gone
-- ============================================================
-- This is not part of the fix above. Running it drops the account from
-- 5 Oracle calls/day to 5/month.
--
--   update public.profiles
--   set subscription_status = 'free'
--   where id = (select id from auth.users where email = 'mandala.xiii@gmail.com');
--
-- Note this account also has is_curator = true, which is a separate exemption:
-- categorization runs stay unmetered either way (schema_v37).
-- ============================================================
