-- books_share_key: add the three columns og-prerender.js has been asking for.
--
-- WHY THIS EXISTS
--
-- netlify/edge-functions/og-prerender.js (v0.61.3) builds the series page a
-- crawler sees. After finding the series row it runs:
--
--   books_share_key?select=title,author,share_key,position_in_series,description
--                   &series_id=eq.<id>&order=position_in_series.asc&limit=60
--
-- The view defined in 20260813120000_client_book_key_lookup.sql has none of
-- `series_id`, `position_in_series` or `description`. PostgREST answered 400,
-- `vRes.ok` was false, `volumes` stayed `[]`, and the branch degraded silently
-- to a heading plus a generic sentence.
--
-- AND IT IS NOT ONLY THE SERIES BRANCH. og-prerender.js issues THREE queries
-- against this view, and on 2026-08-24 every one of them 400d:
--
--   line 355  select=title,author,share_key,position_in_series
--             &series_id=eq...            -> series siblings on a BOOK page
--   line 361  select=title,author,share_key&genre=eq...
--                                         -> same-genre neighbours
--   line 405  select=...,position_in_series,description
--             &series_id=eq...            -> the series page volume list
--
-- `genre` is missing from the view too, which is why this migration adds a
-- FOURTH column that has nothing to do with series.
--
-- Those three queries are the ENTIRE internal link graph offered to a
-- crawler. The section they live in is titled "Body content + internal
-- links" and was written to give book pages something to link to. With all
-- three failing, every prerendered page carries exactly one link: <a href="/">.
-- Search Console on 2026-08-24: 3,742 URLs "Discovered - currently not
-- indexed", 22 "Crawled - not indexed", 268 indexed. A site with no internal
-- links is a site with nothing to crawl.
--
-- Confirmed live on 2026-08-24 against /series/Marvel%20Zombies as Googlebot:
--
--   <h1>Marvel Zombies series in reading order</h1>
--   <p>Every book in the Marvel Zombies series, in reading order.</p>
--   {"@context":"https://schema.org","@type":"BookSeries","name":"Marvel Zombies"}
--
-- No <ul>, no <li>, no "All N books" heading, and a BookSeries with no
-- `hasPart`. The description is the hardcoded fallback, which is only reached
-- when `volumes[0]` is undefined -- so the empty array is proven, not inferred.
--
-- Every series page in the sitemap has been indexed as a title with no list
-- under it. The page ranks ~61 for "<series> books in order" because the part
-- that answers the question was never in the HTML.
--
-- THE FAMILIAR SHAPE: a failed request rendering as an empty result. Same root
-- cause as the 2026-08-17 postmortem's #1 (`gql()` returning null for an
-- errored response) and the v0.64 dry run (`getJson` returning MediaWiki's
-- error payload as data). Third occurrence. The edge function is hardened in
-- the same change so a 400 here is loud rather than silent.
--
-- COLUMN ORDER MATTERS. `create or replace view` may only APPEND columns; the
-- existing eight must keep their names, types and positions. The new three go
-- at the end for that reason, not for tidiness.
--
-- No new exposure to `anon`: `get_curated_catalog()` is already granted to anon
-- and already returns `description` and `position_in_series` for every row with
-- status verified/oracle_categorized. This view is not `security_invoker`, and
-- that is deliberately left as it was -- this migration adds columns and
-- changes nothing else.

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
    -- 2026-08-24 additions, appended:
    b.series_id,
    b.position_in_series,
    b.description,
    b.genre
  from public.books b
  left join public.series s on s.id = b.series_id;

comment on view public.books_share_key is
  'books with the shareable /book/:key URL precomputed. Lets sitemap.js emit URLs without carrying its own copy of bookKey(). series_id/position_in_series/description added 2026-08-24 for og-prerender.js series volume list.';

grant select on public.books_share_key to anon, authenticated, service_role;

-- -- Verification ------------------------------------------------------------
-- Run after applying. The first proves the columns resolve; the second is the
-- query og-prerender.js actually issues, and must return rows.
--
--   select series_id, position_in_series, title
--     from public.books_share_key
--    where series_id is not null
--    order by series_id, position_in_series
--    limit 10;
--
--   -- and, from a shell with egress, the end-to-end check:
--   -- curl -s -A "Googlebot/2.1" https://www.thebooksoracle.com/series/Marvel%20Zombies | grep -c "<li>"
--   -- must be > 0.
--
-- Series that are in the sitemap but would still render an empty list -- these
-- are a DATA problem, not a schema one, and this migration does not fix them:
--
--   select s.name, count(b.id) as books,
--          count(b.position_in_series) as positioned
--     from public.series s
--     left join public.books b
--       on b.series_id = s.id
--      and b.status in ('verified', 'oracle_categorized')
--    group by s.name
--   having count(b.id) <= 1
--    order by books, s.name;
