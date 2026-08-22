-- cover_source — where a cover came from, so a wrong one stays findable.
--
-- docs/isbndb-evaluation.md recommendation 3: before any externally-sourced value is
-- written into a column, that column needs a _source of its own. Until now only
-- books.original_language_source and books.author_gender_source had one.
--
-- Covers are the case where it bites soonest. The Amazon-by-ISBN source added to
-- coverBackfill.mjs on 2026-08-21 constructs its URL from books.isbn, and Amazon
-- returns a valid image for ANY ISBN-10 in its catalog. So the source can never fail
-- loudly: a wrong ISBN yields a real cover for the wrong book, verified and written.
-- A human review of 60 rows found 2 such. Without cover_source those 2 are
-- indistinguishable from the 268 that were right, and can never be re-run selectively.
--
-- Values written by coverBackfill.mjs:
--   openlibrary | openlibrary-isbn | prh | amazon-isbn | google | hardcover | claude
--
-- SECURITY_AUDIT_v0.39.md H2: apply this from the repo as SQL, not from the dashboard.

alter table public.books
  add column if not exists cover_source text;

comment on column public.books.cover_source is
  'Provider that supplied cover_url. Null for rows predating 2026-08-21 or set in-app. '
  'amazon-isbn is derived from books.isbn and inherits its accuracy — a wrong ISBN '
  'produces a plausible cover for the wrong book.';

-- Partial: the only queries that need it are "re-run everything from source X" and
-- "which covers came from a derived source", both of which are cover_url not null.
create index if not exists books_cover_source_idx
  on public.books (cover_source)
  where cover_url is not null;
