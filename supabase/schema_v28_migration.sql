-- schema_v28_migration.sql
-- v0.39: Security hardening (audit findings C3, H1-adjacent, + Supabase
-- SECURITY DEFINER view warnings).
--
-- Run once in Supabase SQL Editor. Safe to re-run.
--
-- Changes:
--   1. Views → SECURITY INVOKER (fixes the three Supabase linter warnings
--      AND two real leaks: friend_pairs exposed the entire social graph,
--      book_categories_view exposed every user's private category tags).
--   2. profiles: public read policy restricted to authenticated users.
--   3. Billing IDs (ls_customer_id / ls_subscription_id) move off the
--      readable profiles row into profile_billing — service-role only.
--
-- Deploy together with the updated Netlify functions
-- (lemon-squeezy-webhook.js and manage-subscription.js read/write
-- profile_billing after this migration).

-- ── 1. SECURITY INVOKER on views ──────────────────────────────────────────────
-- Postgres views default to definer semantics: they bypass the querying
-- user's RLS. All three views sit on tables that already carry correct RLS
-- (books/genres/categories: public read; user_book_categories/friendships:
-- owner-scoped), and every client query already filters by the current user,
-- so flipping to invoker changes no legitimate result set — it only closes
-- the cross-user reads.

alter view public.book_categories_view set (security_invoker = true);
alter view public.book_genres_view     set (security_invoker = true);
alter view public.friend_pairs         set (security_invoker = true);

-- friend_pairs is only meaningful for signed-in users; anon has no business
-- selecting from it at all.
revoke select on public.friend_pairs from anon;

-- Note: the read_books RLS policy from v20 subqueries friend_pairs. With
-- invoker semantics the subquery sees friendships through the querying
-- user's own-rows policy, which still contains every pair where
-- user_a = auth.uid() — so friend library visibility keeps working.

-- ── 2. profiles: no unauthenticated reads ─────────────────────────────────────
-- v20's "public profile read" used using(true) with no role restriction:
-- anyone holding the anon key could dump every profile row. Friend views
-- only ever run signed-in.

drop policy if exists "public profile read" on public.profiles;
create policy "public profile read" on public.profiles
  for select to authenticated using (true);

-- ── 3. profile_billing: billing IDs off the readable row ─────────────────────
-- profiles remains readable by all authenticated users (needed for friend
-- search/display), so payment-provider identifiers must not live there.
-- profile_billing has RLS enabled and NO policies: every client role is
-- denied; only the service role (Netlify functions) can touch it.

create table if not exists public.profile_billing (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  ls_customer_id     text,
  ls_subscription_id text,
  updated_at         timestamptz not null default now()
);

alter table public.profile_billing enable row level security;
revoke all on public.profile_billing from anon, authenticated;

-- Backfill from profiles, then drop the exposed columns.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'ls_customer_id'
  ) then
    insert into public.profile_billing (user_id, ls_customer_id, ls_subscription_id)
    select id, ls_customer_id, ls_subscription_id
      from public.profiles
     where ls_customer_id is not null or ls_subscription_id is not null
    on conflict (user_id) do update
      set ls_customer_id     = excluded.ls_customer_id,
          ls_subscription_id = excluded.ls_subscription_id,
          updated_at         = now();

    alter table public.profiles drop column if exists ls_customer_id;
    alter table public.profiles drop column if exists ls_subscription_id;
  end if;
end $$;

-- ── Verification (run manually) ───────────────────────────────────────────────
-- Views should show security_invoker=true:
--   select viewname, coalesce(
--     (select option_value from pg_options_to_table(c.reloptions)
--       where option_name = 'security_invoker'), 'false') as invoker
--   from pg_views v join pg_class c on c.relname = v.viewname
--   where schemaname = 'public'
--     and viewname in ('book_categories_view','book_genres_view','friend_pairs');
--
-- profiles should no longer have billing columns:
--   select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name like 'ls_%';
--
-- profile_billing should be populated for existing subscribers:
--   select count(*) from public.profile_billing;
