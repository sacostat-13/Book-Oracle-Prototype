-- schema_v21_migration.sql
-- Rename Stripe-specific columns to Paddle.
-- Payment processor switched from Stripe to Paddle (Stripe doesn't
-- support Costa Rica; Paddle acts as Merchant of Record and does).

alter table public.profiles
  rename column stripe_customer_id to paddle_customer_id;

alter table public.profiles
  rename column stripe_subscription_id to paddle_subscription_id;

drop index if exists profiles_stripe_customer_idx;
create index if not exists profiles_paddle_customer_idx
  on public.profiles(paddle_customer_id)
  where paddle_customer_id is not null;
