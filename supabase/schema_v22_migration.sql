-- schema_v22_migration.sql
-- Two changes:
-- 1. Add Lemon Squeezy customer/subscription ID columns (replacing Paddle/Stripe)
-- 2. Add daily quota counter for Pro users
--    Free = 5 calls/month, Pro = 5 calls/day (≈150/month)
--
-- Run this after schema_v21 (which renamed stripe_ → paddle_ columns).
-- If you haven't run v21 yet and never had Stripe columns, skip v21.

-- ── Lemon Squeezy columns ─────────────────────────────────────────────────────
-- Rename paddle columns if they exist, otherwise add fresh LS columns.
do $$
begin
  -- Rename paddle_customer_id → ls_customer_id if it exists
  if exists (
    select 1 from information_schema.columns
    where table_name = 'profiles' and column_name = 'paddle_customer_id'
  ) then
    alter table public.profiles rename column paddle_customer_id to ls_customer_id;
  else
    alter table public.profiles add column if not exists ls_customer_id text;
  end if;

  -- Rename paddle_subscription_id → ls_subscription_id if it exists
  if exists (
    select 1 from information_schema.columns
    where table_name = 'profiles' and column_name = 'paddle_subscription_id'
  ) then
    alter table public.profiles rename column paddle_subscription_id to ls_subscription_id;
  else
    alter table public.profiles add column if not exists ls_subscription_id text;
  end if;

  -- Also rename stripe columns if somehow they're still there
  if exists (
    select 1 from information_schema.columns
    where table_name = 'profiles' and column_name = 'stripe_customer_id'
  ) then
    alter table public.profiles rename column stripe_customer_id to ls_customer_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_name = 'profiles' and column_name = 'stripe_subscription_id'
  ) then
    alter table public.profiles rename column stripe_subscription_id to ls_subscription_id;
  end if;
end $$;

drop index if exists profiles_paddle_customer_idx;
drop index if exists profiles_stripe_customer_idx;
create index if not exists profiles_ls_customer_idx
  on public.profiles(ls_customer_id)
  where ls_customer_id is not null;

-- ── Daily quota columns for Pro users ────────────────────────────────────────
alter table public.profiles
  add column if not exists oracle_calls_today         integer     not null default 0,
  add column if not exists oracle_calls_day_reset_at  timestamptz not null
    default date_trunc('day', now() at time zone 'utc');

-- ── consume_oracle_call ───────────────────────────────────────────────────────
-- Free:  5 calls per calendar month (UTC)
-- Pro:   5 calls per calendar day   (UTC) — monthly total still tracked for cost monitoring

create or replace function public.consume_oracle_call(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status          text;
  v_calls_month     integer;
  v_calls_day       integer;
  v_reset_month_at  timestamptz;
  v_reset_day_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  select subscription_status,
         oracle_calls_this_month, oracle_calls_reset_at,
         oracle_calls_today,      oracle_calls_day_reset_at
  into   v_status,
         v_calls_month, v_reset_month_at,
         v_calls_day,   v_reset_day_at
  from   public.profiles
  where  id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Profile not found');
  end if;

  v_month_start := date_trunc('month', now() at time zone 'utc');
  v_day_start   := date_trunc('day',   now() at time zone 'utc');

  -- ── Free tier: monthly ───────────────────────────────────────────────────
  if v_status != 'active' then
    if v_reset_month_at < v_month_start then
      v_calls_month := 0;
      update public.profiles
        set oracle_calls_this_month = 0, oracle_calls_reset_at = v_month_start
        where id = p_user_id;
    end if;

    if v_calls_month >= v_free_limit then
      return jsonb_build_object(
        'status', 'quota_exceeded', 'period', 'month',
        'calls_used', v_calls_month, 'calls_limit', v_free_limit,
        'reset_at', v_month_start + interval '1 month', 'unlimited', false
      );
    end if;

    update public.profiles
      set oracle_calls_this_month = v_calls_month + 1
      where id = p_user_id;

    return jsonb_build_object(
      'status', 'ok', 'period', 'month',
      'calls_used', v_calls_month + 1, 'calls_limit', v_free_limit,
      'reset_at', v_month_start + interval '1 month', 'unlimited', false
    );
  end if;

  -- ── Pro tier: daily ──────────────────────────────────────────────────────
  if v_reset_day_at < v_day_start then
    v_calls_day := 0;
    update public.profiles
      set oracle_calls_today = 0, oracle_calls_day_reset_at = v_day_start
      where id = p_user_id;
  end if;

  if v_reset_month_at < v_month_start then
    v_calls_month := 0;
    update public.profiles
      set oracle_calls_this_month = 0, oracle_calls_reset_at = v_month_start
      where id = p_user_id;
  end if;

  if v_calls_day >= v_pro_day_limit then
    return jsonb_build_object(
      'status', 'quota_exceeded', 'period', 'day',
      'calls_used', v_calls_day, 'calls_limit', v_pro_day_limit,
      'reset_at', v_day_start + interval '1 day', 'unlimited', false
    );
  end if;

  update public.profiles
    set oracle_calls_today      = v_calls_day + 1,
        oracle_calls_this_month = v_calls_month + 1
    where id = p_user_id;

  return jsonb_build_object(
    'status', 'ok', 'period', 'day',
    'calls_used', v_calls_day + 1, 'calls_limit', v_pro_day_limit,
    'reset_at', v_day_start + interval '1 day', 'unlimited', false
  );
end;
$$;

-- ── get_oracle_quota ─────────────────────────────────────────────────────────
create or replace function public.get_oracle_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status          text;
  v_calls_month     integer;
  v_calls_day       integer;
  v_reset_month_at  timestamptz;
  v_reset_day_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  select subscription_status,
         oracle_calls_this_month, oracle_calls_reset_at,
         oracle_calls_today,      oracle_calls_day_reset_at
  into   v_status,
         v_calls_month, v_reset_month_at,
         v_calls_day,   v_reset_day_at
  from   public.profiles
  where  id = p_user_id;

  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Profile not found');
  end if;

  v_month_start := date_trunc('month', now() at time zone 'utc');
  v_day_start   := date_trunc('day',   now() at time zone 'utc');

  if v_reset_month_at < v_month_start then v_calls_month := 0; end if;
  if v_reset_day_at   < v_day_start   then v_calls_day   := 0; end if;

  if v_status = 'active' then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'day',
      'calls_used',      v_calls_day,
      'calls_limit',     v_pro_day_limit,
      'calls_remaining', greatest(0, v_pro_day_limit - v_calls_day),
      'reset_at',        v_day_start + interval '1 day',
      'unlimited',       false
    );
  end if;

  return jsonb_build_object(
    'subscription_status', v_status, 'period', 'month',
    'calls_used',      v_calls_month,
    'calls_limit',     v_free_limit,
    'calls_remaining', greatest(0, v_free_limit - v_calls_month),
    'reset_at',        v_month_start + interval '1 month',
    'unlimited',       false
  );
end;
$$;

grant execute on function public.consume_oracle_call(uuid) to authenticated;
grant execute on function public.get_oracle_quota(uuid) to authenticated;
