-- ungenred-books-triage.sql
--
-- "Why are 440 books still missing a genre?"
--
-- stacks-genre-coverage.sql reports "(no genre)" as the single largest bucket
-- in the catalogue -- 440 books, 368 of them otherwise fully eligible for The
-- Stacks. That is not one problem. It is at least three, and they need
-- different fixes, so counting them separately is the first move.
--
-- Reading books.genre, the scalar column, because that is what The Stacks
-- filters on -- NOT the book_genres join. regenreCatalog --apply writes both
-- (book_genres links, plus books.genre = the top pick), so a book with links
-- and a null scalar means an --apply that did not finish.

SELECT
  CASE
    -- 1. NEVER ASKED. regenreCatalog --fetch has not reached these yet; there
    --    are no stored subjects for the rules to read. Fix: run --fetch.
    WHEN b.subjects_fetched_at IS NULL
      THEN '1. never fetched'

    -- 2. ASKED, AND THE ANSWER WAS USELESS. Subjects were fetched, but the
    --    providers returned something too generic for genreRules.mjs to place.
    --    In batch-scripts/output/regenre-unmatched.csv this is 181 of 278 rows
    --    carrying the single subject "Fiction". No rule edit fixes that,
    --    because there is no signal in the input -- this is the residue the
    --    regenreCatalog header calls "the input to a Claude pass".
    WHEN COALESCE(ARRAY_LENGTH(b.source_subjects, 1), 0) = 0
      THEN '2. fetched, no subjects returned'
    WHEN LOWER(ARRAY_TO_STRING(b.source_subjects, '|')) IN
         ('fiction', 'fiction, general', 'literature', 'fiction|general')
      THEN '3. fetched, subjects too generic to place'

    -- 4. THE RULES HAVE SOMETHING AND STILL DID NOT PLACE IT. Real subjects,
    --    no genre. These are worth reading by hand -- each one is either a
    --    missing rule or a genre the taxonomy does not have yet, and they are
    --    the cheapest wins in the list.
    WHEN NOT EXISTS (
      SELECT 1 FROM public.book_genres bg WHERE bg.book_id = b.id
    ) THEN '4. has subjects, rules found no match'

    -- 5. LINKED BUT NOT LABELLED. book_genres has rows; books.genre is still
    --    null. The join was written and the scalar was not, so the book is
    --    correctly categorised everywhere EXCEPT The Stacks. Fix is a backfill,
    --    not a re-fetch -- see the statement at the bottom.
    ELSE '5. has book_genres links, scalar genre missing'
  END AS cause,

  COUNT(*) AS books,
  COUNT(*) FILTER (
    WHERE b.cover_url IS NOT NULL AND b.description IS NOT NULL
  ) AS would_show_in_stacks

FROM public.books b
WHERE b.status <> 'flagged'
  AND (b.genre IS NULL OR TRIM(b.genre) = '')
GROUP BY cause
ORDER BY cause;


-- == Bucket 4, listed ========================================================
-- The hand-readable one. Each row is a missing rule or a missing genre.
--
-- SELECT b.id, b.title, b.author, b.source_subjects
--   FROM public.books b
--  WHERE b.status <> 'flagged'
--    AND (b.genre IS NULL OR TRIM(b.genre) = '')
--    AND b.subjects_fetched_at IS NOT NULL
--    AND COALESCE(ARRAY_LENGTH(b.source_subjects, 1), 0) > 0
--    AND LOWER(ARRAY_TO_STRING(b.source_subjects, '|')) NOT IN
--        ('fiction', 'fiction, general', 'literature', 'fiction|general')
--    AND NOT EXISTS (SELECT 1 FROM public.book_genres bg WHERE bg.book_id = b.id)
--  ORDER BY b.title;


-- == Bucket 5, fixed =========================================================
-- Backfills books.genre from the book_genres links that already exist, using
-- the same rule the app uses when it has to choose one genre from several:
-- the MOST SPECIFIC one, i.e. lowest global usage_count. See pickGenre() in
-- src/lib/bookHelpers.js -- if you change one, change the other, or a book is
-- filed under one genre in the browser and another on the wall.
--
-- Ties break alphabetically, matching the client, so the result is stable.
--
-- update public.books b
--    set genre = pick.name
--   from (
--     select distinct on (bg.book_id)
--            bg.book_id,
--            g.name
--       from public.book_genres bg
--       join public.genres g on g.id = bg.genre_id
--      order by bg.book_id, g.usage_count asc, g.name asc
--   ) pick
--  where b.id = pick.book_id
--    and (b.genre is null or trim(b.genre) = '')
--    and b.status <> 'flagged';


-- == The thing this does not fix =============================================
--
-- Buckets 2 and 3 are an upstream data problem, not a rules problem: three
-- providers were asked and all three said "Fiction". Options, roughly in order
-- of cost:
--
--   * Send title + author + description to the Oracle for the ~180 books that
--     have a description but no usable subject. The description is the signal
--     the subject fields are missing, and it is already on the row.
--   * Accept the gap and make sure the genre filter degrades honestly -- an
--     "Unfiled" chip is more useful than a book that no filter can reach.
--
-- Whichever way that goes, the number to watch is `would_show_in_stacks`:
-- those are the books a genre filter would make UNREACHABLE the day it ships,
-- because they are eligible for the wall and match no chip.
