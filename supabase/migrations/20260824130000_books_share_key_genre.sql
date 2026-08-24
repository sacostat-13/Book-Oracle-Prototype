-- books_share_key: add `genre`.
--
-- WHY A SECOND MIGRATION AND NOT AN EDIT
--
-- 20260824120000 was written, committed (9111a1e), and pushed with THREE new
-- columns: series_id, position_in_series, description. It applied, and Supabase
-- recorded version 20260824120000 in supabase_migrations.schema_migrations.
--
-- `genre` was then found to be missing too — og-prerender.js line 361 filters
-- same-genre neighbours with `genre=eq.<value>`, which 400s against a view that
-- does not expose the column — and was added to that same file. The CLI keys on
-- the VERSION, not the contents, so `supabase db push` correctly reported
-- "database is up to date" and the edit would never have shipped.
--
-- Editing an applied migration is how the repo and the remote drift apart.
-- SECURITY_AUDIT_v0.39.md H2 is the list of places that already happened here.
-- So: a new version, and the full view definition rather than a delta, so a
-- fresh build and an existing database converge on exactly the same object no
-- matter which subset of these files has run.
--
-- `create or replace view` is idempotent. Applying this after 20260824120000
-- (four-column or three-column form) is harmless either way.
--
-- WHAT IT UNBLOCKS
--
-- og-prerender.js queries this view in three places. Before 20260824120000 all
-- three returned 400, so every prerendered page carried exactly one link,
-- <a href="/">, and Search Console showed 3,742 URLs as "Discovered - currently
-- not indexed" against 268 indexed. This is the last of the three:
--
--   line 355  series siblings on a book page   -> fixed by 20260824120000
--   line 405  the series page volume list      -> fixed by 20260824120000
--   line 361  same-genre neighbours (genre=eq) -> THIS ONE
--
-- Line 361 is the only outbound link a STANDALONE book has. Without it, every
-- book not in a series is a dead end for a crawler.
--
-- Column order still matters: `create or replace view` may only append.

create or replace view public.books_share_key as
  select
    b.id,
    b.title,
    b.author,
    b.status,
    b.cover_url,
    b.updated_at,
    s.name as series_name,
    public.client_title_key(b.title)
      || '|' ||
      substr(public.client_author_key(b.author), 1, 10) as share_key,
    b.series_id,
    b.position_in_series,
    b.description,
    b.genre
  from public.books b
  left join public.series s on s.id = b.series_id;

comment on view public.books_share_key is
  'books with the shareable /book/:key URL precomputed. Lets sitemap.js emit URLs without carrying its own copy of bookKey(). series_id/position_in_series/description/genre added 2026-08-24 for og-prerender.js internal-link lists.';

grant select on public.books_share_key to anon, authenticated, service_role;

-- -- Verification ------------------------------------------------------------
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'books_share_key'
--    order by ordinal_position;
--   -- expect 12 columns, ending: series_id, position_in_series, description, genre
--
--   -- the exact query og-prerender.js line 361 issues:
--   select title, author, share_key from public.books_share_key
--    where genre = 'Fantasy' and status in ('verified','oracle_categorized')
--    limit 8;
