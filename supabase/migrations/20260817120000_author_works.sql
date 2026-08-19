-- 20260817120000_author_works.sql
--
-- "MORE BY THIS AUTHOR" — LOOKING A BOOK UP BY ITS AUTHOR.
--
-- WHAT THIS IS FOR
--
-- BookPage gains a section listing the author's other books, so a reader who
-- has just finished one can jump straight to the next without leaving for
-- Goodreads. Deliberately a SECTION and not an author page: an author page is
-- a whole surface (bio, photo, bibliography, sourcing, disambiguation of two
-- people with one name) and Goodreads already has it. What is missing here is
-- only the hop.
--
-- WHY IT NEEDS SQL AT ALL
--
-- The obvious client query is `.eq('author', name)`, and it is wrong often
-- enough to matter, because `books.author` is free text assembled from four
-- different upstreams (Hardcover, OpenLibrary, PRH, Google Books) plus manual
-- entry. The same person arrives as:
--
--   "J.R.R. Tolkien"   "J. R. R. Tolkien"   "JRR Tolkien"
--   "Gabriel García Márquez"                "Gabriel Garcia Marquez"
--
-- An equality match splits one bibliography into three, and each fragment
-- looks like a complete answer, which is the failure mode you cannot see from
-- the page. `.ilike()` fixes case and nothing else.
--
-- public.client_author_key() (migration 20260813120000) already collapses the
-- punctuation and case drift — it is the author half of the share key, and it
-- strips every non-alphanumeric character. Reusing it means author identity has
-- ONE definition here, not a second one invented for this feature.
--
-- Note it is deliberately not accent-aware, for the reason recorded in that
-- migration: the browser cannot unaccent, so both sides must agree on
-- "gabrielgarciamrquez". That is fine for grouping, since every row for one
-- person drifts the same way.
--
-- WHY NOT A REAL AUTHORS TABLE
--
-- Because that is a different, larger change: an `authors` table with
-- book_authors join rows would also have to handle co-authors, translators,
-- editors, and the two-people-one-name case, and every write path in the app
-- currently sets a single author string. This gives the section a correct,
-- indexed answer today without pretending the data model is something it is
-- not. If an authors table does arrive later, this function is the seam to
-- swap — the client calls the RPC, not the column.

-- ── The index ───────────────────────────────────────────────────────────────
-- Functional index matching the expression in the lookup below. Without it this
-- is a sequential scan on every book page view; the table is small (~3.3k rows
-- as of the previous migration) so the scan would work, but this section fires
-- on every book page, which is the app's most-visited surface.
--
-- CONCURRENTLY is not used, for the same reason as books_client_title_key_idx:
-- it cannot run inside a transaction block and the migration runner wraps this
-- file in one.

create index if not exists books_client_author_key_idx
  on public.books (public.client_author_key(author));

-- ── The lookup ──────────────────────────────────────────────────────────────
-- Every other book by the same author, best-presented first.
--
-- `_exclude_title` takes the title of the book being viewed rather than its id,
-- because the caller may be looking at a book that has no row of its own yet —
-- an Oracle recommendation, a shared snapshot, a search hit mid-enrichment. It
-- is compared through client_title_key so a duplicate row for the same work
-- (the catalog has some — see the v0.63.2 dedupe work) is also excluded rather
-- than showing up as "more by this author".
--
-- Ordering is about what the section looks like, not about ranking quality:
--   1. a cover first, because this renders as a strip of covers and a row of
--      grey placeholders reads as broken rather than as sparse;
--   2. then reviewed/verified rows over unreviewed ones, so the section
--      prefers catalog entries somebody has actually looked at;
--   3. then title, so the order is stable between two loads of the same page.
--
-- STABLE and not SECURITY DEFINER: `books` already carries "Anyone can read
-- books" FOR SELECT USING (true), so this reaches nothing an anonymous client
-- could not select directly.

create or replace function public.find_books_by_author(
  _author        text,
  _exclude_title text default null,
  _limit         int  default 12
)
returns setof public.books
language sql
stable
parallel safe
as $$
  select b.*
  from public.books b
  where public.client_author_key(_author) <> ''
    and public.client_author_key(b.author) = public.client_author_key(_author)
    and (
      _exclude_title is null
      or public.client_title_key(b.title) <> public.client_title_key(_exclude_title)
    )
  order by
    (b.cover_url is not null) desc,
    (b.status = 'unreviewed') asc,
    b.title asc
  limit greatest(1, least(coalesce(_limit, 12), 50));
$$;

comment on function public.find_books_by_author(text, text, int) is
  'Other books by the same author, for the "More by this author" section on BookPage. Groups by client_author_key so punctuation/case drift in the free-text author column does not split one bibliography into several.';

grant execute on function public.find_books_by_author(text, text, int)
  to anon, authenticated, service_role;

-- ── Verification ────────────────────────────────────────────────────────────
-- Run after applying.
--
-- 1. The section returns something for a well-represented author:
--
--      select title, status, cover_url is not null as has_cover
--        from public.find_books_by_author('Ursula K. Le Guin');
--
-- 2. Punctuation drift really is collapsed — this should be 1 row per person,
--    and any row with n > 1 is an author whose bibliography WAS split before
--    this migration:
--
--      select public.client_author_key(author) as akey,
--             count(distinct author) as n,
--             array_agg(distinct author) as spellings
--        from public.books
--       where author is not null
--       group by 1
--      having count(distinct author) > 1
--       order by n desc
--       limit 20;
--
-- 3. The index is actually used (expect an Index Scan, not a Seq Scan):
--
--      explain analyze
--      select * from public.find_books_by_author('Ursula K. Le Guin');
