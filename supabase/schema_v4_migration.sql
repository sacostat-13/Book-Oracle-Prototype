-- ============================================================================
-- Schema v4 migration: notes on read_books
-- ============================================================================
--
-- Adds a `notes` column to read_books so users can capture short personal
-- thoughts when they mark a book as read (alongside the existing rating).
--
-- Notes are user-private — they live on the per-user read_books row, NOT on
-- the shared books catalog. They never feed into the verified/admin layer.
--
-- The `rating` column already exists (added in v0.3 with the read_books table)
-- so v0.9 only needs the notes column. No data migration required; existing
-- rows get NULL notes and behave unchanged.
--
-- Safe to run multiple times; uses IF NOT EXISTS.
-- ============================================================================

ALTER TABLE read_books
  ADD COLUMN IF NOT EXISTS notes text;

-- Length sanity check. 4000 chars matches Supabase's default text editor
-- comfort zone and is plenty for "what did I think of this book." Users
-- writing essays should put them elsewhere.
ALTER TABLE read_books
  DROP CONSTRAINT IF EXISTS read_books_notes_length_check;
ALTER TABLE read_books
  ADD CONSTRAINT read_books_notes_length_check
  CHECK (notes IS NULL OR char_length(notes) <= 4000);

-- Rating column comment (rating was added in v0.3 but never documented here).
-- Range is 1-5, NULL means unrated. We don't enforce the range in SQL because
-- the Goodreads import path occasionally writes legitimate values outside it
-- (their CSV uses 0 for "no rating") — the client normalizes 0 → NULL before
-- writing.
COMMENT ON COLUMN read_books.rating IS '1-5 user rating; NULL means unrated';
COMMENT ON COLUMN read_books.notes  IS 'User-private notes about this book; max 4000 chars';
