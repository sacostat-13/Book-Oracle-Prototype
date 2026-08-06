-- billing_diagnostic.sql — read-only. Run in the Supabase SQL editor.
--
-- Answers "why does Manage Subscription 502 on an account with no
-- subscription?" — because a 502 is NOT what "no subscription" produces.
--
-- manage-subscription.js has three distinct outcomes, and which one you get
-- tells you exactly where the problem is:
--
--   404 {code: 'no_subscription'}   profile_billing has no ls_subscription_id.
--                                   This is the honest "you never subscribed"
--                                   path. The client toasts subscription.noSubToast.
--
--   502 {code: 'portal_unavailable'} An ls_subscription_id IS on file, and the
--                                   Lemon Squeezy API refused it. Almost always
--                                   a TEST/LIVE MODE MISMATCH: a live-mode
--                                   LEMONSQUEEZY_API_KEY cannot see a
--                                   subscription created in test mode, and
--                                   returns 404 — which we translate to 502.
--                                   Also fires if the subscription was deleted
--                                   LS-side.
--
--   502 with no JSON body           The function itself crashed or timed out;
--                                   that 502 comes from Netlify's proxy, not
--                                   from our code. Check the function log.
--
-- Getting a 502 therefore means there IS a row — most likely written by a
-- test-mode checkout whose webhook fired and set subscription_status = 'active'
-- for free. That also explains an active tier with no real payment.

\set target_email 'simont@mozillafoundation.org'

-- ── 1. Tier vs. billing record ───────────────────────────────────────────────
-- The interesting case is subscription_status = 'active' with
-- has_subscription_id = false (comped/manual Pro), or = true pointing at an
-- id Lemon Squeezy will not honour (test-mode leftover).
select
  p.id,
  u.email,
  p.subscription_status,
  p.is_curator,
  (b.user_id is not null)             as has_billing_row,
  (b.ls_customer_id is not null)      as has_customer_id,
  (b.ls_subscription_id is not null)  as has_subscription_id,
  b.ls_subscription_id,
  b.updated_at                        as billing_updated_at
from public.profiles p
join auth.users u on u.id = p.id
left join public.profile_billing b on b.user_id = p.id
where u.email = :'target_email';

-- ── 2. Everyone whose tier and billing disagree ──────────────────────────────
-- Two shapes of drift, both worth knowing about before launch:
--   active + no subscription id   → comped account, or a webhook that set the
--                                   status but never stored the id
--   free + a subscription id      → a cancellation that updated billing but
--                                   not the tier, or vice versa
select
  u.email,
  p.subscription_status,
  (b.ls_subscription_id is not null) as has_subscription_id,
  b.updated_at as billing_updated_at
from public.profiles p
join auth.users u on u.id = p.id
left join public.profile_billing b on b.user_id = p.id
where (p.subscription_status = 'active' and b.ls_subscription_id is null)
   or (p.subscription_status <> 'active' and b.ls_subscription_id is not null)
order by p.subscription_status, u.email;

-- ============================================================
-- Fixes, depending on what section 1 shows
-- ============================================================
--
-- A. has_subscription_id = true, but the id is a TEST-MODE leftover.
--    Clear it. The account keeps Pro; Manage Subscription then returns the
--    honest 404 'no_subscription' instead of a 502, because there genuinely
--    is no live subscription to manage.
--
--      update public.profile_billing
--      set ls_subscription_id = null, ls_customer_id = null, updated_at = now()
--      where user_id = (select id from auth.users where email = 'you@example.com');
--
--    Do NOT do this to an account with a real paying subscription — the id is
--    the only handle the portal has, and the webhook will not resend it.
--
-- B. has_subscription_id = false and you want to keep the comped Pro tier.
--    Nothing to fix in the data; the 404 path is correct. What is wrong is the
--    UI offering "Manage subscription" to an account that has nothing to
--    manage. See profiles.is_comped / the Profile subscription tab.
--
-- C. You want the account back on the free tier entirely:
--
--      update public.profiles set subscription_status = 'free'
--      where id = (select id from auth.users where email = 'you@example.com');
--
--    Note this drops you from 5 calls/day to 5 calls/month.
-- ============================================================
