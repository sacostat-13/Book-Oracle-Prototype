-- series_volumes: one row per volume of a series, editions collapsed.
--
-- WHY
--
-- Sampled live on 2026-09-08, signed out, on the six series pages carrying the
-- most Search Console impressions:
--
--   Crescent City (75 impressions)  count says 3, lists House of Sky and Breath
--                                   TWICE and neither other volume
--   Dragonlance Chronicles (74)     count says 3, lists 1
--   Wicked (50)                     count says 5, lists 10 -- positions
--                                   1,1,1,1,2,3,3,4,4,5
--   Fablehaven (40)                 correct
--   Red Rising Saga (32)            count says 6, lists 1,2,3,5
--   Theo Cray and Jessica Blackwood count says 2, lists 3
--
-- These pages rank (position ~58) for "crescent city series in order",
-- "dragonlance reading order", "how many books in crescent city series". They
-- are matched to the right query and then answer it with the same book twice.
--
-- Two distinct faults. This view fixes the first:
--
--   1. DUPLICATE EDITIONS share a position_in_series. A single work appears as
--      the paperback, the reissue and the omnibus -- Wicked's four "book 1"
--      rows are Witch, Witch & Curse (Wicked), and Wicked: Witch & Curse.
--   2. MISSING VOLUMES. Red Rising skips 4 and 6. That is catalog completeness
--      and no view can invent the rows; supabase/diagnostics/series_health.sql
--      reports it per series, ordered by impressions.
--
-- WHY IN SQL AND NOT IN EACH CALLER
--
-- Three places list the volumes of a series and all three must agree:
--
--   src/lib/seriesService.js      fetchBooksInSeriesByName -> the human page
--   netlify/edge-functions/og-prerender.js  the series branch -> the crawler
--   netlify/edge-functions/og-prerender.js  book-page series siblings
--
-- This codebase has already paid for the same shape twice: bookKey() lived in
-- three copies until the client's author truncation drifted from the edge
-- function's (v0.63.3, moved into client_title_key/client_author_key here in
-- SQL), and the sitemap/prerender/page status filters had to be brought into
-- line by hand on 2026-08-24. A dedupe rule written three times is the fourth
-- instance waiting to happen, so it is written once, here.
--
-- WHAT IT DOES NOT DO
--
-- No status filter. Callers keep their own -- the sitemap's verified/
-- oracle_categorized bar is a decision about what to ADVERTISE and is not the
-- same decision as what a page DISPLAYS. Conflating them is what leaves the
-- Red Rising page rendering 1,2,3,5. Whether the page should relax its filter
-- is a separate change, and one that wants the diagnostic run first.

create or replace view public.series_volumes as
with ranked as (
  select
    b.id,
    b.title,
    b.author,
    b.status,
    b.cover_url,
    b.description,
    b.pages,
    b.isbn,
    b.genre,
    b.series_id,
    b.position_in_series,
    b.updated_at,
    -- The dedupe key. A numbered volume is identified by its position; an
    -- unnumbered one has no position to be identified by, so it falls back to
    -- the normalised title -- the same expression client_title_key uses for
    -- book URLs, so "Witch & Curse" and "Witch and Curse" collapse together.
    -- The 'p:'/'t:' prefixes keep a position from ever colliding with a title
    -- key that happens to be digits.
    coalesce(
      'p:' || b.position_in_series::text,
      't:' || public.client_title_key(b.title)
    ) as volume_key
  from public.books b
  where b.series_id is not null
),
picked as (
  select
    r.*,
    row_number() over (
      partition by r.series_id, r.volume_key
      order by
        -- A row with no cover renders as a grey box on a page whose whole job
        -- is to be browsed, so a cover outranks everything else.
        (r.cover_url is not null) desc,
        -- Then trust: hand-checked over Oracle-classified over neither.
        (r.status = 'verified') desc,
        (r.status = 'oracle_categorized') desc,
        -- Then substance, which is also what the prerendered body prints.
        length(coalesce(r.description, '')) desc,
        -- A page count distinguishes a real edition from a stub row. An
        -- omnibus outranking a single volume here is acceptable: it only
        -- decides WHICH of two rows at the same position survives, and both
        -- describe the same reading-order slot.
        r.pages desc nulls last,
        -- Deterministic. Without this the survivor can change between two
        -- otherwise identical rows, and the page reshuffles for no reason.
        r.id asc
    ) as edition_rank,
    count(*) over (partition by r.series_id, r.volume_key) as edition_count
  from ranked r
)
select
  p.id,
  p.title,
  p.author,
  p.status,
  p.cover_url,
  p.description,
  p.pages,
  p.isbn,
  p.genre,
  p.series_id,
  p.position_in_series,
  p.updated_at,
  s.name as series_name,
  -- Same expression as books_share_key, so a link built from this view and a
  -- link built from that one are the same string. Both call the SQL functions
  -- rather than restating the algorithm.
  public.client_title_key(p.title)
    || '|' ||
    substr(public.client_author_key(p.author), 1, 10) as share_key,
  -- How many rows this one stands for. Surfaced rather than hidden so the
  -- diagnostic can rank series by how much collapsing was needed, and so a
  -- future "3 editions" affordance does not need another query.
  p.edition_count
from picked p
left join public.series s on s.id = p.series_id
where p.edition_rank = 1;

comment on view public.series_volumes is
  'One row per volume of a series, duplicate editions collapsed by position_in_series (or normalised title when unnumbered). Consumed by seriesService.fetchBooksInSeriesByName and both series list queries in og-prerender.js. Carries no status filter: callers decide. See 20260908120000 for the sampling that prompted it.';

-- Same grants as books_share_key. No new exposure: every column here is
-- already readable through books_share_key or get_curated_catalog().
grant select on public.series_volumes to anon, authenticated, service_role;

-- -- Verification --------------------------------------------------------------
-- Run after applying. Each must return zero rows.
--
--   -- 1. No two volumes of a series share a position.
--   select series_id, position_in_series, count(*)
--     from public.series_volumes
--    where position_in_series is not null
--    group by 1, 2 having count(*) > 1;
--
--   -- 2. Crescent City lists three distinct volumes.
--   select position_in_series, title, edition_count
--     from public.series_volumes
--    where series_id = (select id from public.series
--                        where normalized_name = 'crescentcity')
--    order by position_in_series nulls last;
--
-- And the collapse actually happened:
--
--   select series_name, position_in_series, title, edition_count
--     from public.series_volumes
--    where edition_count > 1
--    order by edition_count desc limit 20;
