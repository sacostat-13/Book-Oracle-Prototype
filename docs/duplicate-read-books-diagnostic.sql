-- duplicate-read-books-diagnostic.sql
--
-- "I corrected a book's read date and the old date came back."
--
-- Companion to docs/duplicate-books-diagnostic.sql, which finds duplicate rows
-- in the CATALOGUE. This one finds what those duplicates do to a reader's
-- shelf: two `read_books` rows for one book, because the reader finished the
-- work under one catalogue row and The Stacks later served them the other.
--
-- Why it looks like a date bug rather than a duplicate bug:
--
--   * The client patches local state by bookKey, so an edit visibly fixes
--     every copy at once -- the modal closes and the number looks right.
--   * Before v0.65.2 the server write matched a single book_id and fixed one
--     row. On the next load the untouched row came back with the old date.
--   * Every stat on the Profile counts rows, so the book is also being
--     double-counted in the challenge, the pace chart and the streak --
--     whether or not anyone ever edits its date.
--
-- v0.65.2 makes the client update every row for the work, so new edits hold.
-- It does NOT merge the rows. This query finds the ones already there.
--
-- Grouping key mirrors bookKey() in src/lib/bookHelpers.js exactly:
-- lowercase, strip everything but a-z0-9, plus the first 10 such characters of
-- the author. If you change one, change the other.

WITH keyed AS (
  SELECT
    rb.user_id,
    rb.book_id,
    rb.read_at,
    rb.rating,
    rb.source,
    b.title,
    b.author,
    b.isbn,
    regexp_replace(lower(b.title), '[^a-z0-9]', '', 'g')
      || '|' ||
      LEFT(regexp_replace(lower(COALESCE(b.author, '')), '[^a-z0-9]', '', 'g'), 10)
      AS book_key
  FROM public.read_books rb
  JOIN public.books b ON b.id = rb.book_id
)
SELECT
  k.book_key,
  COUNT(*)                              AS shelf_rows,
  ARRAY_AGG(DISTINCT k.title)           AS titles,
  ARRAY_AGG(DISTINCT k.author)          AS authors,
  ARRAY_AGG(k.book_id)                  AS book_ids,
  ARRAY_AGG(k.read_at ORDER BY k.read_at NULLS LAST) AS read_dates,
  ARRAY_AGG(DISTINCT k.source)          AS sources,

  -- The tell. Two rows that disagree about when the book was finished is the
  -- exact shape of "I edited the date and it came back": one row was updated,
  -- the other was not.
  (COUNT(DISTINCT k.read_at) > 1)       AS dates_disagree

FROM keyed k
-- Scope to one reader. Comment out for a catalogue-wide count of how many
-- shelves are affected.
WHERE k.user_id = '<YOUR-USER-UUID>'
GROUP BY k.user_id, k.book_key
HAVING COUNT(*) > 1
ORDER BY dates_disagree DESC, shelf_rows DESC;


-- == How many readers are affected, across the whole instance ================
--
-- SELECT
--   COUNT(*)                        AS duplicated_shelf_entries,
--   COUNT(DISTINCT user_id)         AS readers_affected
-- FROM (
--   SELECT rb.user_id,
--          regexp_replace(lower(b.title), '[^a-z0-9]', '', 'g')
--            || '|' ||
--            LEFT(regexp_replace(lower(COALESCE(b.author, '')), '[^a-z0-9]', '', 'g'), 10) AS book_key
--   FROM public.read_books rb
--   JOIN public.books b ON b.id = rb.book_id
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1
-- ) dupes;


-- == Cleanup ==================================================================
--
-- NOT run automatically, and deliberately not written as a single DELETE.
--
-- Keeping "the oldest row" is the wrong rule: the row worth keeping is the one
-- pointing at the catalogue book the reader would recognise -- the one with the
-- cover, the description and the right author. Merging shelf rows without
-- merging the catalogue rows underneath them means the same pair can re-form
-- the next time The Stacks serves the other copy.
--
-- So: run docs/duplicate-books-diagnostic.sql first, decide which catalogue row
-- survives for each pair, and repoint the shelf rows at it. Something like,
-- per pair, inside a transaction:
--
--   UPDATE public.read_books
--      SET book_id = '<KEEPER-BOOK-ID>'
--    WHERE user_id = '<USER>'
--      AND book_id = '<LOSER-BOOK-ID>'
--      AND NOT EXISTS (
--        SELECT 1 FROM public.read_books x
--         WHERE x.user_id = read_books.user_id
--           AND x.book_id = '<KEEPER-BOOK-ID>'
--      );
--
--   DELETE FROM public.read_books
--    WHERE user_id = '<USER>' AND book_id = '<LOSER-BOOK-ID>';
--
-- The NOT EXISTS matters: read_books has a UNIQUE (user_id, book_id), so a
-- reader who has BOTH rows cannot have one repointed onto the other. For those,
-- pick the row with the read date worth keeping, delete the other, and let the
-- keeper stand.
