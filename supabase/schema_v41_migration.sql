-- schema_v41: also clear the hardcover_id on rows v40 reset. Run v40 first.
--
-- WHY v40 WASN'T ENOUGH
-- --------------------
-- v40 nulled the ISBNs the broken title matcher produced, on the assumption that a
-- corrected isbnBackfill.mjs would re-derive them. It didn't. The re-run produced the
-- identical wrong answers:
--
--   X-Men: Days of Future Past      → 9780785122135
--   X-Men: Inferno                  → 9780785122135
--   X-Men: The Dark Phoenix Saga    → 9780785122135
--   X-Men: The Fall of the Mutants  → 9780785122135
--   X-Men: X-Tinction Agenda        → 9780785122135
--
-- with byte-identical candidate edition lists, because every one of those rows is still
-- pointing at the same Hardcover record.
--
-- The reason: isbnBackfill.mjs writes back any hardcover_id it learns, and prefers that
-- ID over searching — it's the cheap, unambiguous path. But those IDs were learnt during
-- the run with the broken matcher, so they are exactly as wrong as the ISBNs were. The
-- corrected matcher never got a chance to run: with a hardcover_id present there is no
-- search to correct.
--
-- Nulling the ISBN alone treats the symptom. The stored hardcover_id is the cause.
--
-- COST
-- ----
-- Rows cleared here fall back to title+author search on the next run — two API calls
-- instead of a batched one, and a fresh (correct) match. Some of these rows may have had
-- a good hardcover_id from before the bad run; SQL can't tell which, and re-learning a
-- correct ID is cheap while keeping a wrong one poisons every future pass.
--
-- Run in the Supabase SQL editor as postgres. Same RLS notes as v38/v40.

begin;

-- v40 recorded exactly which rows were damaged. Reuse that set rather than re-deriving
-- it — the shared-ISBN signature is gone now that v40 nulled the ISBNs, so recomputing
-- would find nothing.
alter table public.books_isbn_backup_v40
  add column if not exists hardcover_id bigint;

update public.books_isbn_backup_v40 k
set hardcover_id = b.hardcover_id
from public.books b
where b.id = k.book_id
  and k.hardcover_id is null;

update public.books b
set hardcover_id = null
from public.books_isbn_backup_v40 k
where b.id = k.book_id
  and b.hardcover_id is not null;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- Both should be 0 for the damaged set:
--
--   select count(*) filter (where b.isbn is not null)         as still_has_isbn,
--          count(*) filter (where b.hardcover_id is not null) as still_has_hcid
--   from public.books b
--   join public.books_isbn_backup_v40 k on k.book_id = b.id;
--
-- Then re-run, and expect "hardcover_ids learnt" to be LARGE this time — that number
-- being ~1 was the signal the previous run had nothing to re-resolve:
--
--   node batch-scripts/isbnBackfill.mjs --dry-run --limit 25 --verbose
--   node batch-scripts/isbnBackfill.mjs
--
-- Sanity check afterwards — should return 0 rows:
--
--   with dupes as (
--     select isbn from public.books where isbn is not null
--     group by isbn
--     having count(distinct lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))) > 1
--   ) select count(*) from dupes;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   update public.books b set hardcover_id = k.hardcover_id
--   from public.books_isbn_backup_v40 k
--   where b.id = k.book_id and b.hardcover_id is null;
-- ---------------------------------------------------------------------------
