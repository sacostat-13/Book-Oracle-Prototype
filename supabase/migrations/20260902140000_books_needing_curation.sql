-- Selection by need, not by proxy.
--
-- Both curation drains chose their work from columns that only correlate with
-- needing work:
--
--   oracleBatch      status in (unreviewed, incomplete) — so a `verified` book
--                    with zero genre links was ineligible forever. Nothing in
--                    the predicate asked whether the book had genres.
--   metadataBackfill fetched LIMIT*4 rows ordered by metadata_checked_at and
--                    decided need in memory afterwards. With 3,674 books never
--                    checked, the 800-row window never reached the ones that
--                    needed anything, and the run printed "0 book(s) to
--                    process".
--
-- PostgREST cannot express "books with no related rows" as a filter on the
-- parent table, which is why both scripts reached for a proxy. This view does
-- the anti-join once, in the database, and exposes the answer as ordinary
-- boolean columns that PostgREST can filter on.
--
-- Columns are listed explicitly rather than `b.*`: Postgres expands `*` at
-- creation time, so a `*` view silently stops carrying columns added to `books`
-- later.
--
-- needs_description uses 40 chars to match MIN_DESCRIPTION_CHARS in
-- metadataBackfill.mjs. If that constant moves, move this with it.

create or replace view public.books_needing_curation
with (security_invoker = on) as
select
  b.id,
  b.created_at,
  b.status,
  b.title,
  b.author,
  b.description,
  b.pages,
  b.genre,
  b.cover_url,
  b.complexity,
  b.depth,
  b.author_gender_source,
  b.original_language,
  b.series_id,
  b.position_in_series,
  b.metadata_checked_at,
  b.metadata_attempts,
  b.subjects_fetched_at,
  (not exists (select 1 from public.book_genres g where g.book_id = b.id))
    as needs_genres,
  (b.description is null or length(btrim(b.description)) < 40)
    as needs_description,
  (b.complexity is null or b.depth is null)
    as needs_depth
from public.books b
where b.status <> 'flagged'
  and (
    -- no genre links at all: what the app actually means by Uncategorized
    not exists (select 1 from public.book_genres g where g.book_id = b.id)
    -- or the scalar is missing or a placeholder, which metadataBackfill repairs
    or b.genre is null
    or b.genre in ('Imported', 'Uncategorized')
    -- or it wants a description
    or b.description is null
    or length(btrim(b.description)) < 40
    -- or it predates complexity/depth
    or b.complexity is null
    or b.depth is null
  );

comment on view public.books_needing_curation is
  'Books that need curation work, with the reason as boolean columns. Selection '
  'for both curation drains must come from here — never from a status proxy.';

-- The anti-join runs once per book; make sure the child side is indexed.
create index if not exists book_genres_book_id_idx on public.book_genres (book_id);

grant select on public.books_needing_curation to anon, authenticated, service_role;
