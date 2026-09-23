-- v0.72 — Pro gates. 2026-09-24.
-- Spec: docs/pro-tier-v1-spec.md §5 · Depends on 20260923120000 (the guard
-- trigger that stops a reader writing their own subscription_status — without
-- it every gate below is one console line from open).
--
-- Free may CREATE up to:   1 book club · 3 Anthologies · 1 Passage.
-- Joining clubs, sharing Anthologies and following are never gated.
-- Existing rows are grandfathered: only the insert past the limit is refused,
-- and a downgrade never touches what a reader already has.
--
-- Club Oracle features (poll suggestions, discussion prompts) are gated in
-- claude.js, which already reads subscription_status on every call.
--
-- Idempotent.

-- ── Who counts as Pro ─────────────────────────────────────────────────────────
-- Curators too: they build the Vault's Anthologies and must never meet a gate.
create or replace function public.is_pro(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select subscription_status = 'active' or is_curator from public.profiles where id = p_uid),
    false
  );
$$;

revoke execute on function public.is_pro(uuid) from public, anon;
grant  execute on function public.is_pro(uuid) to authenticated, service_role;

-- Mirrored in src/lib/proGates.js FREE_LIMITS.
create or replace function public.pro_free_limit(p_kind text)
returns integer
language sql
immutable
as $$
  select case p_kind
    when 'clubs' then 1
    when 'lists' then 3
    when 'plans' then 1
  end;
$$;

-- ── The gate ──────────────────────────────────────────────────────────────────
-- Only a reader's own request is gated. That is decided by the JWT role
-- PostgREST sets per request, not by current_user: this function is a
-- SECURITY DEFINER (it must count rows the reader's RLS may not show, e.g. a
-- club they created but left), so current_user inside it is always the owner.
-- The service role (batch scripts, curator CI) and the SQL editor carry no
-- client claim and pass straight through.
--
-- (The v0.71 profiles guard deliberately does the opposite — it tests
-- current_user — because there a definer RPC acting for the reader, such as
-- report_oracle_miss, must be allowed through. Here it must not: a club
-- created through any RPC is still the reader creating a club.)
--
-- The error message starts with 'pro_required:<kind>' so the client can tell a
-- gate from a real failure (isProRequiredError in src/lib/proGates.js).
create or replace function public.request_is_client()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) in ('anon', 'authenticated');
$$;

create or replace function public.enforce_free_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind   text := tg_argv[0];
  v_owner  uuid;
  v_count  integer;
  v_limit  integer := public.pro_free_limit(tg_argv[0]);
begin
  if not public.request_is_client() then
    return new;
  end if;

  v_owner := case v_kind
    when 'clubs' then (to_jsonb(new) ->> 'created_by')::uuid
    else              (to_jsonb(new) ->> 'user_id')::uuid
  end;

  if v_owner is null or public.is_pro(v_owner) then
    return new;
  end if;

  -- Serialise concurrent creates by the same reader, so two tabs cannot both
  -- slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('pro_gate:' || v_kind || ':' || v_owner::text, 0));

  execute case v_kind
    when 'clubs' then 'select count(*) from public.book_clubs where created_by = $1'
    when 'lists' then 'select count(*) from public.lists where user_id = $1'
    when 'plans' then 'select count(*) from public.plans where user_id = $1'
  end
  into v_count using v_owner;

  if v_count >= v_limit then
    raise exception 'pro_required:%', v_kind
      using errcode = 'P0001',
            detail  = format('Free readers can create %s. This one is part of Pro.', v_limit),
            hint    = 'upgrade';
  end if;

  return new;
end;
$$;

drop trigger if exists book_clubs_free_limit on public.book_clubs;
create trigger book_clubs_free_limit
  before insert on public.book_clubs
  for each row execute function public.enforce_free_limit('clubs');

drop trigger if exists lists_free_limit on public.lists;
create trigger lists_free_limit
  before insert on public.lists
  for each row execute function public.enforce_free_limit('lists');

drop trigger if exists plans_free_limit on public.plans;
create trigger plans_free_limit
  before insert on public.plans
  for each row execute function public.enforce_free_limit('plans');

-- ── The Pro mark ──────────────────────────────────────────────────────────────
-- A generated column rather than a lookup: profile reads already select a
-- column list (useFollows PROFILE_COLS), a generated column cannot be written
-- by anyone, and it exposes one boolean rather than the billing status.
alter table public.profiles
  add column if not exists pro_mark boolean
  generated always as (subscription_status = 'active') stored;

comment on column public.profiles.pro_mark is
  'v0.72: the public "Adept" mark. Derived from subscription_status; never written directly.';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'plans_free_limit') then
    raise exception 'v0.72: gate triggers missing';
  end if;
  raise notice 'v0.72: Free creates up to 1 club / 3 Anthologies / 1 Passage; Pro mark live.';
end $$;
