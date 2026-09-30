-- books.first_published_year — the year a WORK was first published.
--
-- WHY
-- ---
-- `dragonlance publication order`, `dragonlance chronology` and `hellboy
-- chronological order` are a real share of the query volume behind the
-- series pages (performance-2026-09-17, series-page-counts-2026-09-15 item 4),
-- and `books` has never had a year column, so those pages could not answer
-- them at any length. Hardcover (`release_year`) and OpenLibrary
-- (`first_publish_year`) both carry the fact; nothing ever stored it.
--
-- FIRST publication, not the edition's. The catalog row is often a reissue
-- (the cover picker prefers whichever edition has art), and a series page that
-- dates A Game of Thrones to 2011 because that is the TV tie-in's year is the
-- kind of checkably-wrong claim those pages cannot afford.
--
-- Filled by batch-scripts/scheduled/publicationYearBackfill.mjs. NULL means
-- "not known yet", never "unpublished"; every reader of this column must
-- omit rather than guess.
--
-- series_volumes gains the column too (appended — create or replace view
-- cannot reorder), as the MINIMUM across collapsed editions.

alter table public.books
  add column if not exists first_published_year smallint;

alter table public.books
  drop constraint if exists books_first_published_year_check;
alter table public.books
  add constraint books_first_published_year_check
  check (first_published_year is null or first_published_year between -800 and 2100);

comment on column public.books.first_published_year is
  'Year the work was first published (not this edition). NULL = unknown. Filled by publicationYearBackfill.mjs from Hardcover release_year / OpenLibrary first_publish_year.';

-- Partial index for the backfill's worklist: series books still missing a year.
create index if not exists books_missing_first_year_idx
  on public.books (series_id)
  where first_published_year is null and series_id is not null;

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
    b.first_published_year,
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
    count(*) over (partition by r.series_id, r.volume_key) as edition_count,
    -- The EARLIEST year across the collapsed editions, not the survivor's own.
    -- The survivor is picked for its cover; a 2019 reissue with a good cover
    -- must not tell a reader that A Game of Thrones is a 2019 book.
    min(r.first_published_year) over (partition by r.series_id, r.volume_key) as volume_first_year
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
  p.edition_count,
  -- Appended 2026-09-30. create or replace view may only add columns at the end.
  p.volume_first_year as first_published_year
from picked p
left join public.series s on s.id = p.series_id
where p.edition_rank = 1;

-- Grants are unchanged by create or replace, restated for clarity.
grant select on public.series_volumes to anon, authenticated, service_role;

-- -- Verification --------------------------------------------------------------
--
--   -- 1. The view still has one row per volume (same check as 20260908120000).
--   select series_id, position_in_series, count(*)
--     from public.series_volumes
--    where position_in_series is not null
--    group by 1, 2 having count(*) > 1;                 -- expect 0 rows
--
--   -- 2. Coverage after the backfill, series books only.
--   select count(*) filter (where first_published_year is not null) as dated,
--          count(*) as total
--     from public.series_volumes;
--
--   -- 3. Publication order disagreeing with reading order — the series whose
--   --    pages will now print a separate publication-order list.
--   select series_name, position_in_series, title, first_published_year
--     from public.series_volumes
--    where series_name ilike 'dragonlance%'
--    order by series_name, first_published_year nulls last;
