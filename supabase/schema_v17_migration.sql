-- schema_v17_migration.sql
-- Adds Stripe customer and subscription ID columns to profiles.
-- These are written only by the stripe-webhook Netlify function
-- using the service role key — never by the client.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

-- Index for webhook lookups by customer ID
create index if not exists profiles_stripe_customer_idx
  on public.profiles(stripe_customer_id)
  where stripe_customer_id is not null;
