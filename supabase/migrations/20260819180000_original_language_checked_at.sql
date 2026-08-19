-- 20260819180000_original_language_checked_at.sql
--
-- WHY THIS EXISTS
--
-- originalLanguageBackfill.mjs went into `scheduled/` and into the weekly
-- catalog-maintenance workflow, on the grounds that it is free and it
-- terminates. The first half is true. The second was not.
--
-- The script's gap filter is `original_language IS NULL`. It resolves about
-- 40% of what it examines, and the other 60% — books Wikidata genuinely does
-- not have — stay NULL and therefore stay eligible. Forever. Every Monday it
-- would walk the same ~2,000 indie novellas, Warhammer tie-ins and single-issue
-- comics, ask Wikidata about each of them three times, and get the same silence.
--
-- That is a slow job, poor manners toward a free service that asks for a
-- contact address in its User-Agent, and — worst — a report that never shrinks.
-- A queue that cannot drain gives no signal about whether anything is working.
--
-- authorGenderBackfill.mjs solved this in v0.62 and its header says why in one
-- line: it "stamps that timestamp even for 'unknown' — so an honest shrug is
-- recorded as asked-and-answered and never re-billed". The same sentence
-- applies here with "re-billed" replaced by "re-asked". This column is that
-- stamp.
--
-- ASKED IS NOT THE SAME AS ANSWERED
--
-- Two columns, deliberately:
--
--   original_language             the answer, or NULL if there isn't one
--   original_language_checked_at  when we last asked
--
-- Four states, all meaningful:
--
--   value + stamp    answered
--   NULL  + stamp    asked, no free source knows. The Oracle's problem now.
--   NULL  + NULL     never asked. This is the queue.
--   value + NULL     written before v0.64.1 (or by upsert_book). Stamped below.
--
-- A FAILED REQUEST MUST NOT STAMP
--
-- The one rule that matters. If Wikidata is unreachable, the row was not asked
-- — it was attempted. Stamping it would convert an outage into a permanent
-- "we checked, there is nothing", which is the 2026-08-17 postmortem's root
-- cause wearing a timestamp: 971 books were declared unfindable by a broken
-- connection, and the only thing that saved them was that nothing recorded the
-- verdict. The script stamps every outcome EXCEPT `search-failed` and
-- `entities-unfetchable`.

alter table public.books
  add column if not exists original_language_checked_at timestamptz;

comment on column public.books.original_language_checked_at is
  'When originalLanguageBackfill.mjs last asked about this row. Stamped even when the answer was "nothing found", so an honest shrug drains the queue instead of being re-asked every week. NEVER stamped when the request itself failed — an outage must not be recorded as a verdict. NULL = never asked.';

-- Partial index on the QUEUE, not on the stamp.
--
-- The only hot query is the script's own gap filter, "rows never asked", and it
-- wants the NULLs. Indexing the populated values would index the 3.4k rows
-- nobody queries by and skip the few hundred that are read on every page of
-- every run.
create index if not exists books_original_language_unchecked_idx
  on public.books (id) where original_language_checked_at is null;

-- ── Retro-stamp what has already been answered ──────────────────────────────
--
-- Any row that already carries an original_language was answered by something —
-- the Oracle pass, or a backfill run made before this migration. Either way it
-- has been asked, and leaving the stamp NULL would put it straight back in the
-- queue on the next run.
--
-- Rows with NO value are deliberately left unstamped: they have either never
-- been asked, or been asked by a run whose outcome this migration cannot
-- reconstruct. Re-asking those once is correct; the first full run drains them.

update public.books
   set original_language_checked_at = coalesce(updated_at, now())
 where original_language is not null
   and original_language_checked_at is null;

-- ── Verification ────────────────────────────────────────────────────────────
--
--   -- the four states, and their sizes
--   select original_language is not null as has_value,
--          original_language_checked_at is not null as asked,
--          count(*)
--     from public.books group by 1, 2 order by 1, 2;
--
--   -- must return 0: an answer that was never asked for is a bug in the stamp
--   select count(*) from public.books
--    where original_language is not null and original_language_checked_at is null;
--
--   -- the queue. This is the number that must SHRINK on every run.
--   select count(*) from public.books where original_language_checked_at is null;
