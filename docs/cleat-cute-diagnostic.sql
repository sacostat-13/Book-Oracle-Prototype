-- Why does one book show no genres? Read-only.
--
-- The Book Page resolves genres in this order (src/lib/genreDisplay.js):
--   1. book_genres links, IF the book is on one of your shelves
--   2. the books.genre scalar, otherwise
--   3. nothing
--
-- genresByBookId is only hydrated for wishlist + library + readNext ids, so a
-- book you have NOT added — anything opened from The Stacks — never reaches
-- step 1 and is showing you the SCALAR alone. Zero chips therefore means
-- books.genre is null, regardless of how many links the book has.

select
  b.id,
  b.title,
  b.author,
  b.genre                          as scalar_genre,   -- what a Stacks book shows
  b.status,
  b.source,
  b.subjects_fetched_at,
  b.source_subjects,                                   -- what the rules had to work with
  coalesce(array_length(b.source_subjects, 1), 0)      as subject_count,
  (select array_agg(g.name order by g.name)
     from public.book_genres bg
     join public.genres g on g.id = bg.genre_id
    where bg.book_id = b.id)       as linked_genres,   -- what a shelved book would show
  (select count(*) from public.book_genres bg where bg.book_id = b.id) as link_count
from public.books b
where b.title ilike '%cleat cute%';

-- How to read the result:
--
--   scalar null + links present   -> the book is fine, the Book Page just
--                                    cannot see the links because the book is
--                                    not on a shelf. Fix is in the app, not
--                                    the data: hydrate genres for the book
--                                    being viewed.
--
--   scalar null + no links        -> the rules placed nothing. Check
--                                    subject_count and where the sapphic-ish
--                                    term sits in source_subjects: past
--                                    position 15 it scored 2 against a
--                                    MIN_GENRE_SCORE of 3 before the v0.63.2b
--                                    weight fix.
--
--   subjects_fetched_at null      -> --apply never considered this book at all;
--                                    it only loads rows where that is set.
--
--   scalar set                    -> the empty display is NOT this data, and
--                                    the next place to look is the client.
