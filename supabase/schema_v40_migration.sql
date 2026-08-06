-- schema_v40: reset ISBNs corrupted by the over-eager title matcher.
--
-- WHY
-- ---
-- isbnBackfill.mjs ran with a title matcher that stripped everything after a colon and
-- then accepted any prefix match. For "Series: Title" naming — endemic in comics — that
-- reduced every volume to the series name:
--
--   X-Men: The Dark Phoenix Saga  ─┐
--   X-Men: Inferno                 │
--   X-Men: Days of Future Past     ├─ all matched "X-Men" → all got 9780785122135
--   X-Men: X-Tinction Agenda       │
--   X-Men: The Fall of the Mutants ─┘
--
--   X-Men: X-Cutioner's Song  ─┬─ both got 9780785118749
--   X-Men: Fatal Attractions  ─┘
--
-- The matcher is fixed (src/lib/titleMatch.js — compares title variants instead of one
-- destructively-stripped form, and bounds prefix matches). This migration clears the rows
-- it got wrong so the corrected backfill can re-derive them.
--
-- HOW THE DAMAGED ROWS ARE IDENTIFIED
-- -----------------------------------
-- One ISBN shared across genuinely DIFFERENT titles. That is the precise signature of
-- this bug and nothing else: legitimate duplicate rows (you have two "1984" and two
-- "A Certain Hunger") share a title as well as an ISBN, so they are correctly left alone.
--
-- Note this nulls EVERY row in an affected group, including the one whose ISBN was
-- actually right — "X-Men: The Dark Phoenix Saga" really is 9780785122135. SQL cannot
-- tell which member of the group was correct, and re-deriving a right answer is cheap
-- while keeping a wrong one is not.
--
-- HOW TO RUN — RLS stays ENABLED
-- ------------------------------
-- Supabase SQL editor, which connects as postgres (BYPASSRLS). public.books has a SELECT
-- policy and deliberately no UPDATE policy, so running this through anything holding the
-- anon or authenticated key updates 0 rows and reports success. Compare the row count the
-- editor reports against the preview count below.

-- ===========================================================================
-- STEP 1 — PREVIEW. Run this alone first and read the output.
-- ===========================================================================
with dupes as (
  select isbn
  from public.books
  where isbn is not null
  group by isbn
  having count(distinct lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g'))) > 1
)
select b.isbn, count(*) as rows_sharing, string_agg(b.title, ' | ' order by b.title) as titles
from public.books b
join dupes d on d.isbn = b.isbn
group by b.isbn
order by rows_sharing desc, b.isbn;

-- Total rows that STEP 3 will clear:
--
-- with dupes as (
--   select isbn from public.books where isbn is not null
--   group by isbn
--   having count(distinct lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g'))) > 1
-- )
-- select count(*) from public.books b join dupes d on d.isbn = b.isbn;


-- ===========================================================================
-- STEP 2 + 3 — BACKUP, THEN CLEAR. Run as one block.
-- ===========================================================================
begin;

create table if not exists public.books_isbn_backup_v40 (
  book_id    uuid primary key,
  isbn       text,
  title      text,
  backed_up  timestamptz not null default now()
);

-- New public-schema tables are exposed through PostgREST. RLS on with no policies =
-- postgres and service_role only. Same reasoning as books_isbn_backup_v38.
alter table public.books_isbn_backup_v40 enable row level security;

with dupes as (
  select isbn
  from public.books
  where isbn is not null
  group by isbn
  having count(distinct lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g'))) > 1
)
insert into public.books_isbn_backup_v40 (book_id, isbn, title)
select b.id, b.isbn, b.title
from public.books b
join dupes d on d.isbn = b.isbn
on conflict (book_id) do nothing;

-- Clear exactly the rows just backed up. Driving the UPDATE off the backup table rather
-- than re-evaluating the CTE guarantees the two sets are identical even if something
-- changed between statements.
update public.books b
set isbn = null
from public.books_isbn_backup_v40 k
where b.id = k.book_id
  and b.isbn is not null;

commit;


-- ===========================================================================
-- STEP 4 — VERIFY
-- ===========================================================================
-- Should return 0 rows: no ISBN is shared across different titles any more.
--
-- with dupes as (
--   select isbn from public.books where isbn is not null
--   group by isbn
--   having count(distinct lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g'))) > 1
-- )
-- select count(*) from dupes;
--
-- How many rows now need re-deriving (feeds the next backfill run):
--   select count(*) from public.books where isbn is null;
--
-- RLS must still be on for both tables:
--   select relname, relrowsecurity from pg_class
--   where relname in ('books', 'books_isbn_backup_v40');


-- ===========================================================================
-- STEP 5 — then, on your machine:
--   node batch-scripts/isbnBackfill.mjs --dry-run --limit 25 --verbose
--   node batch-scripts/isbnBackfill.mjs
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ROLLBACK (restores the wrong ISBNs — only if the corrected matcher proves worse):
--
--   update public.books b
--   set isbn = k.isbn
--   from public.books_isbn_backup_v40 k
--   where b.id = k.book_id and b.isbn is null;
--
-- Once satisfied:
--   drop table public.books_isbn_backup_v40;
-- ---------------------------------------------------------------------------
