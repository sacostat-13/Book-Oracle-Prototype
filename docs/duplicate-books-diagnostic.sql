-- duplicate-books-diagnostic.sql — READ ONLY. Nothing here writes.
--
-- CORRECTION (supersedes the first version of this file)
--
-- The first version's queries 3 and 4 were tautological and always returned
-- zero. They grouped rows by
--     dedupe_title_key(title) || '|' || dedupe_author_key(author)
-- on the assumption that this differed from the live normalized_key. It does
-- not. The dump in supabase/dump/schema.sql shows compute_book_key stripping
-- all non-alphanumerics and truncating the author to 10 characters, but the
-- live key returned by query 1 was
--     "like water for chocolate|laura esquivel"
-- — spaces intact, author complete, and exactly equal to the two would_be_*
-- columns beside it. So the schema_v47 rewrite WAS applied in production and
-- the checked-in dump is stale.
--
-- books_normalized_key_idx is UNIQUE. Grouping by an expression equal to that
-- key can never return a group of size > 1. The queries were asking "are there
-- two rows with the same unique value", which has one possible answer.
--
-- WHAT IS ACTUALLY WRONG
--
-- Query 1 found two rows for one novel:
--
--   Laura Esquivel   unreviewed  user_manual  isbn 9780385474016  cover  read 1
--   Unknown author   discovered  hardcover    isbn 9780385474016  none   read 0
--
-- Identical titles. Identical ISBNs. Different authors — and the second one is
-- not an author. 'Unknown author' is a DISPLAY placeholder from bookLookup.js,
-- hardcoverService.js and googleBooksService.js (six call sites) that was being
-- persisted as if it were a name. Since author is half of the identity key, the
-- placeholder forks the work into two catalogue rows.
--
-- So the duplicates are not a subtitle problem and not a normalisation problem.
-- They are a placeholder leaking into a key column. Fixed going forward in
-- DataContext.jsx (storableAuthor); queries 3-5 below find the existing rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Unchanged — rows for one work. Useful for spot checks.
-- ─────────────────────────────────────────────────────────────────────────────
select
  b.id, b.title, b.author, b.status, b.source, b.isbn,
  (b.cover_url is not null) as has_cover,
  b.normalized_key,
  (select count(*) from public.book_genres g where g.book_id = b.id)    as genre_links,
  (select count(*) from public.read_books r where r.book_id = b.id)     as times_read,
  (select count(*) from public.wishlist_items w where w.book_id = b.id) as on_wishlists,
  b.created_at
from public.books b
where public.dedupe_title_key(b.title) like public.dedupe_title_key('Like Water for Chocolate') || '%'
order by b.created_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REPLACES the old query 2, which returned nothing because it filtered
--    auth.users on an email that is not the one on the account. Find the id
--    once, then use it below.
-- ─────────────────────────────────────────────────────────────────────────────
select id, email, created_at from auth.users order by created_at limit 20;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE REAL DUPLICATE SET: rows whose author is a placeholder, where another
--    row exists for the same title with a genuine author. These are the forks.
-- ─────────────────────────────────────────────────────────────────────────────
with tagged as (
  select
    b.*,
    public.dedupe_title_key(b.title) as tkey,
    (lower(trim(coalesce(b.author, ''))) in
       ('unknown author', 'unknown', 'author unknown', 'anonymous', 'n/a', '-')
     or coalesce(trim(b.author), '') = '') as author_is_placeholder
  from public.books b
)
select
  p.tkey,
  p.id            as placeholder_row,
  p.title         as placeholder_title,
  p.author        as placeholder_author,
  p.isbn          as placeholder_isbn,
  r.id            as real_row,
  r.author        as real_author,
  r.isbn          as real_isbn,
  (p.isbn is not distinct from r.isbn) as same_isbn,
  (select count(*) from public.read_books x      where x.book_id = p.id) as placeholder_reads,
  (select count(*) from public.wishlist_items x  where x.book_id = p.id) as placeholder_wishlists,
  (select count(*) from public.book_genres x     where x.book_id = p.id) as placeholder_genres
from tagged p
join tagged r
  on r.tkey = p.tkey
 and r.id <> p.id
 and not r.author_is_placeholder
where p.author_is_placeholder
order by p.tkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE NUMBERS. How much placeholder data is in the catalogue at all, and how
--    much of it is a genuine fork (a real row exists for the same title).
-- ─────────────────────────────────────────────────────────────────────────────
with tagged as (
  select
    b.id,
    public.dedupe_title_key(b.title) as tkey,
    (lower(trim(coalesce(b.author, ''))) in
       ('unknown author', 'unknown', 'author unknown', 'anonymous', 'n/a', '-')
     or coalesce(trim(b.author), '') = '') as author_is_placeholder
  from public.books b
)
select
  (select count(*) from public.books)                                    as books_total,
  (select count(*) from tagged where author_is_placeholder)              as rows_with_placeholder_author,
  (select count(*) from tagged p where p.author_is_placeholder
     and exists (select 1 from tagged r
                 where r.tkey = p.tkey and r.id <> p.id
                   and not r.author_is_placeholder))                     as placeholder_rows_that_are_forks,
  (select count(*) from tagged p where p.author_is_placeholder
     and exists (select 1 from tagged r
                 where r.tkey = p.tkey and r.id <> p.id
                   and not r.author_is_placeholder)
     and (exists (select 1 from public.read_books x     where x.book_id = p.id)
       or exists (select 1 from public.wishlist_items x where x.book_id = p.id)
       or exists (select 1 from public.currently_reading x where x.book_id = p.id)))
                                                                         as forks_with_reader_data;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The other identity signal being ignored. upsert_book matches ONLY on
--    normalized_key, so two rows with the SAME ISBN — which is a far stronger
--    statement of "this is the same edition" than a fuzzy name match — sit
--    side by side quite happily. This is how big that blind spot is.
-- ─────────────────────────────────────────────────────────────────────────────
select
  isbn,
  count(*)                              as row_count,
  array_agg(id order by created_at)     as ids,
  array_agg(title order by created_at)  as titles,
  array_agg(coalesce(author, '(null)') order by created_at) as authors
from public.books
where isbn is not null and trim(isbn) <> ''
group by isbn
having count(*) > 1
order by count(*) desc, isbn
limit 100;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Why a book you have read may not appear on the Library shelf.
--    Library.jsx groups by primary genre, sorts the sections alphabetically and
--    pages them SIX AT A TIME. A book with no genre links falls into
--    "Uncategorized", which sorts near the end — so it is behind several
--    "load more" clicks rather than missing. Confirm with your user id from
--    query 2.
-- ─────────────────────────────────────────────────────────────────────────────
-- select
--   coalesce(
--     (select g.name from public.book_genres bg
--        join public.genres g on g.id = bg.genre_id
--       where bg.book_id = b.id
--       order by g.usage_count nulls last, g.name limit 1),
--     b.genre,
--     'Uncategorized'
--   ) as shelf_section,
--   count(*) as books_on_that_section
-- from public.read_books r
-- join public.books b on b.id = r.book_id
-- where r.user_id = 'PASTE-USER-ID-FROM-QUERY-2'
-- group by 1
-- order by 1;
