-- ============================================================
-- schema_v36_migration.sql — v0.56 Unlimited Oracle calls for curators
--
-- Context: Oracle Categorization (oracleCategorizationService.js) burns one
-- Claude call per batch of 10 books, same per-user quota as every other
-- Oracle feature (get_oracle_quota / consume_oracle_call from
-- schema_v22_migration.sql — 5/month free, 5/day Pro). Simon's own wishlist
-- alone is ~900 books (~90 batches) — the curator who feeds the Vault and
-- keeps the catalog enriched would burn through the free/Pro quota almost
-- immediately just running the categorization button on his own library.
--
-- Fix: curators (profiles.is_curator = true, schema_v11_migration.sql) skip
-- quota enforcement entirely, in BOTH functions that gate it. This is not
-- about subscription tier — is_curator is independent of subscription_status,
-- so a free-tier curator is still unmetered.
--
-- Both `get_oracle_quota` (read-only check) and `consume_oracle_call`
-- (the actual gate + increment, called from netlify/functions/claude.js)
-- already had an `unlimited` boolean in their return shape — it was always
-- false. This is the first time it's ever set true. netlify/functions/claude.js
-- needs NO changes: it already does `if (!quota.unlimited && calls_remaining
-- <= 0)` before blocking, and already calls consume_oracle_call unconditionally
-- on every successful Anthropic response — consume_oracle_call now just
-- returns 'ok' unconditionally for curators instead of gating.
--
-- Counters (oracle_calls_this_month / oracle_calls_today) are still ticked
-- for curators — cost visibility matters even when nothing is enforced —
-- they're just never checked against a limit.
-- ============================================================

create or replace function public.consume_oracle_call(p_user_id uuid)
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
  v_reset_month_at  timestamptz;
  v_reset_day_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  select subscription_status, is_curator,
         oracle_calls_this_month, oracle_calls_reset_at,
         oracle_calls_today,      oracle_calls_day_reset_at
  into   v_status, v_is_curator,
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

  -- ── Curators: unmetered, always ──────────────────────────────────────────
  if v_is_curator then
    if v_reset_month_at < v_month_start then v_calls_month := 0; end if;
    if v_reset_day_at   < v_day_start   then v_calls_day   := 0; end if;

    update public.profiles
      set oracle_calls_this_month  = v_calls_month + 1,
          oracle_calls_reset_at    = v_month_start,
          oracle_calls_today       = v_calls_day + 1,
          oracle_calls_day_reset_at = v_day_start
      where id = p_user_id;

    return jsonb_build_object(
      'status', 'ok', 'period', 'unlimited',
      'calls_used', v_calls_month + 1, 'calls_limit', null,
      'reset_at', null, 'unlimited', true
    );
  end if;

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

create or replace function public.get_oracle_quota(p_user_id uuid)
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
  v_reset_month_at  timestamptz;
  v_reset_day_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  select subscription_status, is_curator,
         oracle_calls_this_month, oracle_calls_reset_at,
         oracle_calls_today,      oracle_calls_day_reset_at
  into   v_status, v_is_curator,
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

  if v_is_curator then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'unlimited',
      'calls_used',      v_calls_month,
      'calls_limit',     null,
      'calls_remaining', null,
      'reset_at',        null,
      'unlimited',       true
    );
  end if;

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

-- Grants unchanged (CREATE OR REPLACE keeps them; re-stated for clarity/safety).
grant execute on function public.consume_oracle_call(uuid) to authenticated;
grant execute on function public.get_oracle_quota(uuid) to authenticated;

-- ============================================================
-- Verification — run manually after applying
-- ============================================================
-- Make yourself (or another curator) unlimited, if not already:
--   update public.profiles set is_curator = true where id = '<your-user-uuid>';
--
-- Confirm the RPC reports it:
--   select get_oracle_quota('<your-user-uuid>');
--   -- expect: {"unlimited": true, "period": "unlimited", "calls_limit": null, ...}
--
-- Confirm a non-curator is untouched (still gated as before):
--   select get_oracle_quota('<some-other-user-uuid>');
--   -- expect: unlimited: false, same shape as before this migration
