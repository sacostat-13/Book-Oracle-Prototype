-- 2026-09-10 — The Dresden Files, by hand.
--
-- Five fixes the backfill cannot make safely, each traced to a row in the query
-- of 2026-09-10. Every id below is quoted from that output; nothing here
-- searches by title, because a title match is what got this series into trouble
-- in the first place.
--
-- Run it as one transaction. It touches 6 rows across 2 tables and every change
-- is reversible by putting the old value back — nothing is deleted.
--
-- NOTE: the books trigger from migration 20260910120000 will mark both series
-- volumes_stale, so they re-enter the --stale queue on the next pass. That is
-- correct and wanted: after this runs, the catalog has changed and the series
-- deserve another look.

begin;

-- 1. PROVEN GUILTY LIVES IN THE WRONG SERIES ROW ------------------------------
--
-- The book exists and has since the original import. It is attached to
-- 0c626a59, the Dresden Files row whose normalized_name is "thedresdenfiles" —
-- one of the 38 rows keyed under the older rule, which the app's own lookup
-- (normalizeSeriesName strips a leading "the") can never reach.
--
-- So position 8 looked empty, the backfill kept proposing an insert, and
-- approving it would have created a SECOND Proven Guilty. This moves the one we
-- have instead. First measurable cost of the split-identity problem, and the
-- fix is one field.
update public.books
   set series_id = '50c0f577-ccfe-4dfa-aa16-abd2246c649e'
 where id = '3245ef42-d880-4866-8dc8-c7d36a7fbd76'
   and series_id = '0c626a59-194b-477d-873f-39a0eee79e01';   -- no-op if already moved

-- 2. TWO DUPLICATES CREDITED TO THE WRONG PEOPLE ------------------------------
--
--   ec760b50  "Death Masks"  by James Marsters   created 2026-09-02  position 5
--   0dd12f7a  "White Night"  by Chris McGrath    created 2026-08-28  position 9
--
-- Marsters narrates the Dresden audiobooks. McGrath paints the covers. Both sit
-- on positions the real volume already holds, hidden by series_volumes picking
-- one row per position — which is why nothing noticed until now.
--
-- FLAGGED, NOT DELETED. `flagged` is outside ('verified','oracle_categorized'),
-- so the page, the sitemap and seriesService all stop listing them, while any
-- user shelf still pointing at these rows keeps working. Deleting is available
-- once you have checked nothing references them; the query for that is at the
-- foot of this file.
--
-- The position goes too. An unnumbered row still renders (series_volumes sorts
-- the unnumbered to the end), so leaving it numbered-or-not is not the control
-- here — status is.
update public.books
   set status = 'flagged', position_in_series = null
 where id in (
   'ec760b50-87ad-4f8e-9216-47d67258ba6a',   -- Death Masks / James Marsters
   '0dd12f7a-c237-4153-aed6-1589ca330d49'    -- White Night / Chris McGrath
 );

-- 3. SIDE JOBS, TWICE ---------------------------------------------------------
--
-- "Side Jobs (The Dresden Files, #12.5)" (eba00af8, the original import) and
-- "Side Jobs: Stories from The Dresden Files" (9692766c, created 2026-09-02)
-- are the same collection. Keep the numbered one.
update public.books
   set status = 'flagged'
 where id = '9692766c-b72d-4e2e-9db9-a975eb93c9ea';

-- 4. BACKUP HAS A PLACE IN THE ORDER ------------------------------------------
--
-- A novella that sits between Small Favor (10) and Turn Coat (11). Unnumbered
-- it trails the whole list, which reads as "we do not know where this goes".
update public.books
   set position_in_series = 10.4
 where id = '04abe61c-478c-4f6f-b529-a74504acc87a';

-- 5. TWO SERIES THAT KNOW HOW LONG THEY ARE -----------------------------------
--
-- total_books is the only thing standing between a shared catalog and whatever
-- upstream decides to staple to a series. Both of these are currently NULL, so
-- the structural guard has nothing to compare against and the "unbounded" note
-- fires instead of a veto.
--
-- The Dresden Files: 18 novels, Storm Front through Twelve Months. The novellas
-- at 0.5 / 10.4 / 11.5 / 12.5 sit between them and are not counted — which is
-- also why `held` will read higher than total_books here, and why the composer
-- drops a total it already exceeds rather than contradicting itself.
update public.series
   set total_books = 18
 where id = '50c0f577-ccfe-4dfa-aa16-abd2246c649e'
   and total_books is null;

-- Dungeon Crawler Carl: EIGHT, not seven.
--
-- I recommended 7 twice and that was wrong. A Parade of Horribles is book 8
-- (Goodreads and the DCC wiki both place it there, and Hardcover puts it at 8
-- too — which is what the position-4 mismatch on our row was telling us).
-- Setting 7 would have blocked a real volume.
--
-- What it DOES block is position 9, where Hardcover files "The Beautiful
-- Place" — Dinniman's standalone horror novel, not a DCC book. That row has
-- been pre-approving at confidence 100 in every run because nothing bounded the
-- series. After this, the structural guard refuses it without anyone reading
-- the CSV.
update public.series
   set total_books = 8
 where id = '9c8f967d-2e94-4d7d-a7a0-6d9e9705e78f'
   and total_books is null;

commit;

-- -- Verification --------------------------------------------------------------
--
--   -- 1. The Dresden Files, as the page will now render it. Expect 1..18 with
--   --    no gaps, novellas at 0.5/10.4/11.5/12.5, and nothing flagged showing.
--   select position_in_series, title, author, status
--     from public.series_volumes
--    where series_id = '50c0f577-ccfe-4dfa-aa16-abd2246c649e'
--      and status in ('verified','oracle_categorized')
--    order by position_in_series nulls last;
--
--   -- 2. Nothing left behind in the shadow row.
--   select count(*) from public.books
--    where series_id = '0c626a59-194b-477d-873f-39a0eee79e01';
--
--   -- 3. Both series are due another look, because their books changed.
--   select name, held, held_live, total_books, volumes_owed, missing_positions,
--          volumes_stale
--     from public.series_completeness
--    where series_id in ('50c0f577-ccfe-4dfa-aa16-abd2246c649e',
--                        '9c8f967d-2e94-4d7d-a7a0-6d9e9705e78f');
--
--   -- 4. BEFORE deleting the three flagged rows rather than keeping them:
--   --    find out who points at them. Adjust the table list to whatever
--   --    actually references books(id) in this schema.
--   -- select conrelid::regclass as referencing_table, conname
--   --   from pg_constraint
--   --  where confrelid = 'public.books'::regclass and contype = 'f';
