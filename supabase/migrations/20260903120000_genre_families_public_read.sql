-- genre_families must be readable by anon.
--
-- The genre and family pages promise one thing above all: the logged-out render
-- is the complete page. That is what makes the prerender honest and what keeps
-- Search Console from judging a thin page.
--
-- But og-prerender runs with the SERVICE key and the browser runs as `anon`. If
-- those two see different data, a crawler gets a full page while a human
-- following the crawler's link gets an empty one — the worst possible version
-- of this feature, and invisible in testing because a developer is signed in.
--
-- 20260902180000 created genre_families without saying anything about grants or
-- RLS, leaving it to Supabase's schema defaults. Say it explicitly instead: the
-- taxonomy is public reference data, exactly like `genres` (which carries
-- `GRANT ALL ... TO anon` from the base schema) and `book_genres` (policy
-- `book_genres_read ... USING (true)`).

alter table public.genre_families enable row level security;

drop policy if exists genre_families_read on public.genre_families;
create policy genre_families_read on public.genre_families
  for select
  using (true);

grant select on public.genre_families to anon, authenticated, service_role;

-- Writes stay closed: no insert/update/delete policy exists, so only the
-- service role can change a family. Deliberate — the Oracle invents genres
-- nightly and must never be able to invent a shelf.

-- Verify as anon:
--   set role anon;
--   select count(*) from genre_families;   -- expect 16
--   select count(*) from genres where family_id is not null;  -- expect 167
--   reset role;
