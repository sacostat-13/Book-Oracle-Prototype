-- Cache the raw subject tags each book's sources returned.
--
-- WHY
--
-- Genre inference reads subject/tag lists from Hardcover, Open Library and
-- Google Books, maps them onto the canonical taxonomy with a keyword table, and
-- then throws the subjects away. That was fine when the rule table had 15
-- targets and never changed. It has 136 now, and it is going to be edited
-- repeatedly as the shelves fill out and the gaps become obvious.
--
-- Without a cache, every edit to that table means re-fetching the whole
-- catalogue: 3,260 books × three HTTP sources × a politeness delay, which is
-- hours, and hours is long enough that nobody iterates. The rules stop
-- improving because improving them is expensive.
--
-- Cached, the loop becomes: change a rule, re-run the inference against stored
-- subjects, see the result in seconds, with no network at all. That is the
-- difference between a taxonomy that gets tuned and one that gets abandoned.
--
-- The subjects are also the honest audit trail. When a book lands in a
-- surprising genre, the evidence that put it there is on the row rather than
-- gone — which is the thing that made "Old Man and the Sea → East Asian
-- Literary Fiction" so hard to explain the first time.

alter table public.books
  add column if not exists source_subjects   text[],
  add column if not exists subjects_fetched_at timestamptz;

comment on column public.books.source_subjects is
  'Raw subject/tag strings as returned by Hardcover, Open Library and Google '
  'Books, concatenated in that order. Input to genre inference — NOT canonical '
  'genres. Written by batch-scripts; see _shared/genreRules.mjs for how they '
  'are interpreted.';

comment on column public.books.subjects_fetched_at is
  'When source_subjects was last populated. NULL means never fetched. An empty '
  'array with a timestamp means the sources were asked and returned nothing, '
  'which is a different fact and must not trigger a re-fetch.';

-- The re-genre pass selects on "subjects not yet fetched", over the whole
-- catalogue. Partial index because the rows worth finding are the unfetched
-- ones, and that set shrinks to nothing as the backfill completes.
create index if not exists books_subjects_unfetched_idx
  on public.books (created_at)
  where subjects_fetched_at is null;

-- ── Revert ──────────────────────────────────────────────────────────────────
-- drop index if exists public.books_subjects_unfetched_idx;
-- alter table public.books
--   drop column if exists source_subjects,
--   drop column if exists subjects_fetched_at;
