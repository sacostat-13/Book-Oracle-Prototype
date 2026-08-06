-- schema_v18_migration.sql
-- Pre-launch: grant all existing users an active subscription.
--
-- Context: v0.32 ships the subscription system publicly. Before going live,
-- we want every user who already has an account (test users, early testers)
-- to start on the 'active' tier so they aren't immediately hit with a
-- paywall on features they've been using freely during development.
--
-- This is a one-time migration. New users after this point get the 'free'
-- default (defined in schema_v15) and go through Stripe to upgrade.
--
-- After running this, you can manually flip specific users back to 'free'
-- if you want to test the upgrade flow:
--   UPDATE public.profiles SET subscription_status = 'free' WHERE id = '<uuid>';
--
-- To check who has active status after running:
--   SELECT id, subscription_status, created_at
--   FROM public.profiles
--   ORDER BY created_at;

UPDATE public.profiles
SET subscription_status = 'active'
WHERE subscription_status = 'free';

-- Confirm how many were updated:
SELECT
  subscription_status,
  count(*) AS user_count
FROM public.profiles
GROUP BY subscription_status
ORDER BY subscription_status;
