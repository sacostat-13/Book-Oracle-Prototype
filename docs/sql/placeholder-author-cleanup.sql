-- placeholder-author-cleanup.sql
--
-- WHY THIS IS NOW NECESSARY, HAVING PREVIOUSLY BEEN OPTIONAL
--
-- v0.63 stops the client writing 'Unknown author' into books.author. All three
-- callers of upsert_book now pass storableAuthor(), which maps the placeholder
-- spellings to NULL.
--
-- That creates a transitional hazard. compute_book_key(title, author) is the
-- identity of a book, so the SAME book now keys differently before and after
-- the deploy:
--
--   before:  "like water for chocolate|unknown author"
--   after:   "like water for chocolate|"
--
-- The ~29 existing rows still carry the old key. Once the new client ships,
-- anything that touches one of those books — including merely VIEWING it from
-- search, which calls upsertDiscoveredBook — will miss the existing row and
-- INSERT A SECOND ONE. The fix would start manufacturing the exact duplicates
-- it was written to prevent.
--
-- So this is not "repair the data". It is "make the database agree with the
-- code about what these books are called". Run it with the deploy, not later.
--
-- Ordering: run section 1, read it, run 2 only if 1 returns no blockers.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PRE-FLIGHT. Would nulling any of these collide with a row that already
--    has a NULL author and the same title? books_normalized_key_idx is UNIQUE,
--    so a collision makes the UPDATE fail — better to know which rows first.
--    Anything returned here must be merged by hand (see section 3) BEFORE
--    section 2 is run. Zero rows means section 2 is safe.
-- ═══════════════════════════════════════════════════════════════════════════
with placeholders as (
  select id, title, author,
         public.compute_book_key(title, null) as new_key
  from public.books
  where lower(trim(coalesce(author, ''))) in
        ('unknown author', 'unknown', 'author unknown', 'anonymous', 'n/a', '-')
)
select
  p.id            as placeholder_id,
  p.title         as placeholder_title,
  p.author        as placeholder_author,
  b.id            as would_collide_with,
  b.title         as collide_title,
  b.author        as collide_author,
  (select count(*) from public.read_books r      where r.book_id = p.id) as placeholder_reads,
  (select count(*) from public.wishlist_items w  where w.book_id = p.id) as placeholder_wishlists
from placeholders p
join public.books b
  on b.normalized_key = p.new_key
 and b.id <> p.id
order by p.title;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE UPDATE. Null the placeholder and recompute the key in one statement,
--    so the row is never left with an author and key that disagree.
--
--    Wrapped in a transaction with the count echoed: if the number does not
--    match what section 1 led you to expect, ROLLBACK rather than COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
--
-- update public.books
--    set author         = null,
--        normalized_key = public.compute_book_key(title, null),
--        updated_at     = now()
--  where lower(trim(coalesce(author, ''))) in
--        ('unknown author', 'unknown', 'author unknown', 'anonymous', 'n/a', '-');
--
-- -- Expected: ~29. Anything wildly different means the predicate caught
-- -- something it should not have — rollback and look.
-- select count(*) as still_placeholder
--   from public.books
--  where lower(trim(coalesce(author, ''))) in
--        ('unknown author', 'unknown', 'author unknown', 'anonymous', 'n/a', '-');
-- -- must be 0
--
-- commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The reported duplicate. Not part of the cleanup — the placeholder row is
--    a twin of a row that already holds the correct data, so it wants deleting
--    rather than renaming. merge_books snapshots the source row before removing
--    it and repoints any wishlist/library/genre references at the survivor.
--
--    Safe here because the duplicate has 0 reads, 0 wishlists, 0 genre links
--    and no cover; the survivor is the row read_books already points at.
--    Verify that is still true before running.
-- ═══════════════════════════════════════════════════════════════════════════
-- select public.merge_books(
--   'e3ce7290-05c7-42b0-9c43-e370b77759f3',  -- 'Unknown author', status discovered
--   '112ed9d7-bd3a-409c-b808-ed238bab1bcd'   -- 'Laura Esquivel', has the read
-- );
