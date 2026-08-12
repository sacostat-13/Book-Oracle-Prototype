-- Remember which books the free metadata lookup has already given up on.
--
-- THE BUG
--
-- metadataBackfill.mjs selects books with a cover and a missing description or
-- genre, walks Hardcover → Open Library → Google Books, and moves on. If none
-- of the three has anything, the book is counted as "nothing found" and left
-- exactly as it was — which means the NEXT run selects it again, on identical
-- criteria, and spends the same three HTTP round-trips getting the same nothing.
--
-- The nightly run of 2026-08-12 reported `nothingFound=186`. Every one of those
-- 186 was re-queried the night before and will be re-queried tomorrow. At three
-- requests each with a 400ms inter-source delay, the dead set alone burns most
-- of the run's wall clock, and — worse — it consumes the `--limit 200` budget
-- that should be going to books the sources CAN answer. The queue never drains
-- because the head of it is permanently occupied by books that cannot move.
--
-- Nothing here is billable: these are the free sources. The cost is time, rate
-- limit against Hardcover and Open Library, and starvation of the books that
-- would actually benefit.
--
-- THE FIX
--
-- Record the attempt on the book. Two columns, because "when" and "how often"
-- answer different questions:
--
--   metadata_checked_at  — when the free chain last came back empty for this
--                          book. Lets a run skip anything checked recently
--                          without forgetting it forever.
--   metadata_attempts    — how many times in a row it has come back empty.
--                          Backs off: a book that has failed six times is
--                          almost certainly not in any of the three sources
--                          under the title we hold, and re-checking it monthly
--                          is as pointless as re-checking it nightly.
--
-- Deliberately NOT a "dead" boolean. Sources gain records constantly — Open
-- Library in particular — and a book that has nothing today may have a
-- description in three months. A permanent tombstone would need manual clearing
-- and nobody would ever clear it. Time-based backoff self-heals.
--
-- Cleared, not incremented, on success: the script only bumps these when it
-- writes nothing. A book that gets a description but no genre is not "failed" —
-- it made progress, and its genre is worth trying again on the next pass.

alter table public.books
  add column if not exists metadata_checked_at timestamptz,
  add column if not exists metadata_attempts   smallint not null default 0;

comment on column public.books.metadata_checked_at is
  'Last time the free metadata chain (Hardcover/Open Library/Google Books) ran '
  'for this book and found nothing. NULL = never tried, or last try succeeded. '
  'Written by batch-scripts/scheduled/metadataBackfill.mjs.';

comment on column public.books.metadata_attempts is
  'Consecutive empty results from the free metadata chain. Reset to 0 whenever '
  'a description or genre is written. Drives exponential-ish backoff in '
  'metadataBackfill.mjs; books at or above the cap are skipped entirely.';

-- The backfill query filters on this column on every run, over the whole
-- catalog. Partial index because the rows it needs to FIND are the ones never
-- checked or checked long ago; the exhausted majority should not be in the
-- index at all.
create index if not exists books_metadata_checked_at_idx
  on public.books (metadata_checked_at nulls first)
  where cover_url is not null;

-- ── Revert ──────────────────────────────────────────────────────────────────
-- drop index if exists public.books_metadata_checked_at_idx;
-- alter table public.books
--   drop column if exists metadata_checked_at,
--   drop column if exists metadata_attempts;
