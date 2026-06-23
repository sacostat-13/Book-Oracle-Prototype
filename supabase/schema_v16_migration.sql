-- schema_v16_migration.sql
-- Grants public SELECT access on the genres table.
--
-- The genres table was created in v7 with RLS enabled but no read policy,
-- meaning direct .select() queries from authenticated or anon clients
-- return empty results. Only the RPC functions (search_genres, etc.) had
-- grants, which is why the OracleCategories temperament dropdown worked
-- (it uses a function) but PlanCreate's direct .from('genres').select()
-- returned nothing.
--
-- Fix: add a simple read-all policy. Genres are global, non-sensitive,
-- and intentionally public — they're the canonical taxonomy shown to
-- all users in dropdowns and genre browsers.

alter table public.genres enable row level security;

drop policy if exists "Genres are publicly readable" on public.genres;
create policy "Genres are publicly readable"
  on public.genres
  for select
  using (true);

-- Also ensure anon can read (for guest/unauthenticated views)
grant select on public.genres to anon, authenticated;
