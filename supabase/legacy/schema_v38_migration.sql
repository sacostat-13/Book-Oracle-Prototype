-- schema_v38: reset stored ISBNs so the corrected edition picker can repopulate them.
--
-- WHY
-- ---
-- Until v0.56, hardcoverService.normalize() took `editions(limit: 3)` and returned the
-- first entry carrying any ISBN — no ordering, no filtering. That meant a book's stored
-- ISBN could be a boxed set, an audiobook, a foreign printing or a library binding,
-- entirely at the mercy of Hardcover's default row order.
--
-- This was invisible until v0.56 started building direct /dp/ and /a/ purchase links
-- from that ISBN. Fourth Wing, for example, had stored 9781637991022 — the Empyrean #1-2
-- boxed set (Entangled Ltd, 1168pp), which amazon.com and bookshop.org don't stock.
-- Both purchase links 404'd.
--
-- The picker is fixed, but that alone does NOT repair existing rows, because upsert_book
-- treats the stored ISBN as sticky:
--
--     isbn = coalesce(_existing.isbn, _isbn)
--
-- Existing wins. A correct ISBN arriving from a later lookup is discarded. So every book
-- already carrying a bad ISBN keeps it forever unless we clear it first. Setting it to
-- NULL makes the coalesce fall through to the incoming value on the next lookup.
--
-- SCOPE / RISK
-- ------------
-- `isbn` on public.books feeds purchase links and the OpenLibrary cover fallback. It is
-- not a key, nothing joins on it, and no user data references it — books are matched on
-- normalized_key.
--
-- !! CORRECTION (was wrong in the first version of this file) !!
-- This migration originally claimed the lookup chain would rebuild the ISBN on next
-- view. It does not. View-time enrichment is enrichBookFromOpenLibrary(), which returns
-- only { series, pages } and has never carried an ISBN. ISBNs are written by
-- upsert_book, which runs when a book is ADDED to a list — not when it is viewed.
--
-- So running this migration ALONE leaves every purchase link degraded to a search until
-- the backfill is run. You must follow it with:
--
--     node batch-scripts/isbnBackfill.mjs --dry-run --limit 25   # sanity check
--     node batch-scripts/isbnBackfill.mjs                        # full run
--
-- That script uses the same pickBestEdition() as the browser path, so backfilled ISBNs
-- match newly-looked-up ones. Budget roughly 1 second per book (Hardcover allows
-- 60 requests/minute).
--
-- HOW TO RUN — RLS stays ENABLED
-- ------------------------------
-- Run this in the Supabase SQL editor. That connects as `postgres`, which is a
-- BYPASSRLS role, so the UPDATE reaches every row without touching any policy.
-- Do NOT `alter table public.books disable row level security` around this. Two reasons:
--
--   1. It's unnecessary — the SQL editor already bypasses RLS.
--   2. If the migration errored midway with RLS disabled, the shared catalog would be
--      left writable by every anon key holder until someone noticed.
--
-- The trap to avoid: public.books has RLS on with a SELECT policy and deliberately NO
-- update policy (writes go through upsert_book, which is SECURITY DEFINER). So if you
-- run this through anything using the anon or authenticated key instead — psql with a
-- pooler URL, a script, the JS client — the UPDATE affects 0 rows and reports success.
-- No error, no rows changed, and you'd conclude the reset didn't help. Check the row
-- count the editor reports against the count from the SELECT below.
--
-- Run the SELECTs first if you want to see the blast radius before committing.

begin;

-- Snapshot before, so this is recoverable if something is wrong with the new picker.
create table if not exists public.books_isbn_backup_v38 (
  book_id    uuid primary key,
  isbn       text,
  backed_up  timestamptz not null default now()
);

-- New tables in the public schema are exposed through PostgREST by default. Without
-- RLS this snapshot would be readable AND writable by any anon key holder. It carries
-- nothing sensitive, but an unprotected writable table is exactly the kind of thing
-- the v0.39 RLS audit is meant to catch, so lock it down on creation instead.
-- RLS enabled with zero policies = no access for anon/authenticated; postgres and
-- service_role still reach it (BYPASSRLS), which is all this table needs.
alter table public.books_isbn_backup_v38 enable row level security;

insert into public.books_isbn_backup_v38 (book_id, isbn)
select id, isbn from public.books where isbn is not null
on conflict (book_id) do nothing;

-- How many rows are affected:
--   select count(*) from public.books where isbn is not null;

update public.books
set isbn = null
where isbn is not null;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (expect 0 for the first, and the second should match the row count the
-- editor reported for the UPDATE):
--
--   select count(*) from public.books where isbn is not null;
--   select count(*) from public.books_isbn_backup_v38;
--
-- Confirm RLS is still on for both tables — if either says false, stop and fix it:
--
--   select relname, relrowsecurity
--   from pg_class
--   where relname in ('books', 'books_isbn_backup_v38');
--
-- ROLLBACK (if the new picker turns out worse than what it replaced):
--
--   update public.books b
--   set isbn = k.isbn
--   from public.books_isbn_backup_v38 k
--   where b.id = k.book_id and b.isbn is null;
--
-- Once you're satisfied, drop the snapshot:
--
--   drop table public.books_isbn_backup_v38;
-- ---------------------------------------------------------------------------
