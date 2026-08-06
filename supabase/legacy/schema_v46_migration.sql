-- schema_v46 — Goodreads direct import (v0.59)
--
-- Deliberately small. The RSS import reuses the existing CSV ingestion path
-- (importGoodreads → upsertBookOnServer → read_books/wishlist_items), so no
-- new tables, no new RPCs, and no change to how books are matched or stored.
--
-- What's added:
--   1. books.goodreads_id      — a free, exact match key for re-imports
--   2. profiles.goodreads_*    — enables a later "Sync from Goodreads" action
--
-- read_books.rating already exists (numeric(2,1), 1-5, NULL = unrated) and
-- already receives Goodreads ratings on the CSV path. The RSS path writes to
-- the same column with the same 0 → NULL normalization, so imported ratings
-- carry over as ordinary app ratings with no schema change.

-- ---------------------------------------------------------------------------
-- 1. Goodreads work ID on the shared catalog
-- ---------------------------------------------------------------------------
-- The feed's <book_id> is Goodreads' stable work identifier. Recording it
-- makes a second import of the same shelf an exact-match no-op rather than a
-- title-normalization gamble.

alter table public.books add column if not exists goodreads_id bigint;

create unique index if not exists books_goodreads_id_idx
  on public.books (goodreads_id)
  where goodreads_id is not null;

comment on column public.books.goodreads_id is
  'Goodreads work ID from the RSS import. Exact re-import match key. NULL for books from other sources.';

-- ---------------------------------------------------------------------------
-- 2. Remember the reader's Goodreads ID
-- ---------------------------------------------------------------------------
-- Stored so a re-sync can be offered later without asking for the ID again.
-- Not used by the initial import itself.

alter table public.profiles add column if not exists goodreads_user_id text;
alter table public.profiles add column if not exists goodreads_last_import_at timestamptz;

comment on column public.profiles.goodreads_user_id is
  'Numeric Goodreads profile ID, kept for re-sync. Public data; no credential.';

-- ---------------------------------------------------------------------------
-- 3. Enrichment backstop
-- ---------------------------------------------------------------------------
-- Imported books arrive with only title/author/ISBN/cover/pages/year and are
-- promoted through the existing lookup chain afterwards. A book that fails
-- lookup repeatedly must stop being retried forever, or one bad title will
-- occupy the enrichment queue permanently.

alter table public.books add column if not exists enrichment_attempts int not null default 0;

comment on column public.books.enrichment_attempts is
  'Lookup-chain failures. At 3, the book is left as-is and skipped by the enrichment sweep.';

-- ---------------------------------------------------------------------------
-- NOTE — no RLS changes.
-- books is already writable through upsert_book (SECURITY DEFINER); profiles
-- already restricts updates to the owning user. The new columns inherit both.
-- Verify with:
--   select tablename, policyname from pg_policies
--   where tablename in ('books','profiles');
-- ---------------------------------------------------------------------------
