-- 2026-09-13 — Undo two rows applied in error, by hand.
--
-- The 2026-09-12 run pre-approved two rows that the review flagged and the
-- apply-safe CSV excluded. The reviewed CSV was applied instead — it keeps the
-- original `approve` column, and --apply reads `approve`, not `review` — so both
-- are now in the catalog:
--
--   The Legend of Drizzt #4   The Icewind Dale Trilogy (1,040 pp omnibus of
--                             books 4-6)          should be The Crystal Shard
--   Oz #3                     أوزما أميرة أوز (the Arabic edition)
--                                                 should be Ozma of Oz
--
-- WHY THIS CANNOT WAIT FOR THE NEXT PROPOSE RUN. A wrong book at a position
-- makes the position read as satisfied, so the right one stops being offered.
-- "The Crystal Shard" appears NOWHERE in the 3,209 rows of the 2026-09-13 file;
-- on 2026-09-12 it sat at Drizzt #4 as an unapproved alternative. "Ozma of Oz"
-- survives today only as text inside rejected collection titles. Neither will
-- come back on its own.
--
-- Every id below is quoted from the 2026-09-13 CSV. The two hardcover_ids are
-- quoted from the 2026-09-12 CSV, where both correct books were candidates.
--
-- Run as one transaction. It unnumbers 2 rows and creates (or finds) 2 books.
-- Nothing is deleted and every step is reversible by putting the old value back.
--
-- NOTE: the books trigger from 20260910120000 marks both series volumes_stale,
-- so they re-enter the --stale queue on the next pass. That is wanted.


-- ---------------------------------------------------------------------------
-- PRE-FLIGHT — run this FIRST, on its own, and read the output.
-- ---------------------------------------------------------------------------
--
-- 1. Confirm the two rows are still what this script expects to change.
--
--   select id, title, author, position_in_series, status, series_id
--     from public.books
--    where id in ('12f1167b-7f5a-46c0-a711-ad4b97e4992b',   -- Icewind Dale Trilogy
--                 '58aeaf9b-c8a9-4f2d-88ba-2febb24952e2');  -- أوزما أميرة أوز
--
-- 2. Do the correct books already exist somewhere in the catalog? upsert_book
--    matches on normalized_key = compute_book_key(title, author), so ask the
--    same question it will ask, and also ask by hardcover_id, which is the
--    surer identifier:
--
--   select id, title, author, series_id, position_in_series, status
--     from public.books
--    where normalized_key in (
--            public.compute_book_key('The Crystal Shard', 'R. A. Salvatore'),
--            public.compute_book_key('Ozma of Oz',        'L. Frank Baum')
--          )
--       or hardcover_id in (28782, 166210);
--
--    IF EITHER ALREADY EXISTS AND IS ATTACHED TO ANOTHER SERIES, stop and read
--    section 5 at the foot. upsert_book will NOT move it — it coalesces onto the
--    existing series_id — so this script would silently do nothing for that book
--    and the position would stay empty.


begin;

-- 1. DRIZZT #4 IS AN OMNIBUS ---------------------------------------------------
--
-- The Icewind Dale Trilogy collects books 4-6. It is a real book and a real
-- edition of this series, so it is not flagged and not deleted — it loses the
-- position it should never have had. series_volumes sorts the unnumbered to the
-- end, so it still renders on the page, just not as volume 4.
--
-- (If you would rather omnibuses not appear on series pages at all, the
-- alternative is `status = 'flagged'` as well — see section 6.)
update public.books
   set position_in_series = null
 where id = '12f1167b-7f5a-46c0-a711-ad4b97e4992b'
   and position_in_series = 4;             -- no-op if already moved

-- 2. OZ #3 IS THE ARABIC EDITION ----------------------------------------------
--
-- أوزما أميرة أوز is Ozma of Oz in Arabic. It reached position 3 because the
-- series name normalises to `oz`, two characters, which is a substring of every
-- English volume in the series — so the "not titled after the series" tiebreak
-- excluded all of them and left this one standing. Fixed in seriesCandidates.mjs
-- on 2026-09-12 (the exclusion now needs a 4+ character name); this is the row
-- that got through before it was.
update public.books
   set position_in_series = null
 where id = '58aeaf9b-c8a9-4f2d-88ba-2febb24952e2'
   and position_in_series = 3;             -- no-op if already moved

-- 3. PUT THE CRYSTAL SHARD AT DRIZZT #4 ---------------------------------------
--
-- hardcover_id 28782, 333 pages. Hardcover credits it "Larry Elmore / R. A.
-- Salvatore" — Elmore is the cover artist and is listed first. The author below
-- is the correct one, which means compute_book_key here is
-- `thecrystalshard|rasalvator`, NOT the `thecrystalshard|larryelmor` a propose
-- run would compute from the first credit. That is deliberate: the catalog
-- should say Salvatore. It cannot create a duplicate later either — the next
-- run matches held TITLES as well as keys, so it will report `this title is
-- already in the series` and skip.
--
-- Status stays 'unreviewed', which the series page does NOT list, because that
-- is what the pipeline expects for a new row with no genre, description or
-- complexity. Section 4 below makes them visible.
select public.upsert_book(
  _title        => 'The Crystal Shard',
  _author       => 'R. A. Salvatore',
  _hardcover_id => 28782,
  _series_id    => '369728f5-7300-45b2-a7c6-a76e561c8d6b',   -- The Legend of Drizzt
  _series_position => 4,
  _pages        => 333,
  _cover_url    => 'https://assets.hardcover.app/external_data/33705042/0365b5b46a54cacada76303a18fc71b768ceb4d3.jpeg',
  _source       => 'hardcover',
  _status       => 'unreviewed'
);

-- 4. PUT OZMA OF OZ AT OZ #3 --------------------------------------------------
--
-- hardcover_id 166210, 170 pages. Credited "L. Frank Baum / John R. Neill";
-- Neill is the illustrator. Same reasoning as above.
select public.upsert_book(
  _title        => 'Ozma of Oz',
  _author       => 'L. Frank Baum',
  _hardcover_id => 166210,
  _series_id    => '6c0dbbf7-b11f-41b1-bd01-760bcc654215',   -- Oz
  _series_position => 3,
  _pages        => 170,
  _source       => 'hardcover',
  _status       => 'unreviewed'
);

commit;


-- ---------------------------------------------------------------------------
-- AFTER — in order.
-- ---------------------------------------------------------------------------
--
-- 1. VERIFY THE TWO POSITIONS. Expect Drizzt 4 = The Crystal Shard and Oz 3 =
--    Ozma of Oz, both 'unreviewed', and the two displaced rows unnumbered.
--
--   select s.name, b.position_in_series, b.title, b.author, b.status
--     from public.books b
--     join public.series s on s.id = b.series_id
--    where b.series_id in ('369728f5-7300-45b2-a7c6-a76e561c8d6b',
--                          '6c0dbbf7-b11f-41b1-bd01-760bcc654215')
--      and (b.position_in_series in (3, 4) or b.position_in_series is null)
--    order by s.name, b.position_in_series nulls last;
--
-- 2. CONFIRM upsert_book CREATED rather than found. If either returned the id of
--    a book that already lived in another series, its position is still empty —
--    see section 5.
--
--   select id, title, author, series_id, position_in_series, created_at
--     from public.books
--    where hardcover_id in (28782, 166210);
--
-- 3. MAKE THEM VISIBLE. 'unreviewed' does not render. Either run the normal
--    enrichment pass, which is the documented path —
--
--      node batch-scripts/manual/oracleBatch.mjs
--
--    — or, to show them immediately as human-verified rows without genre or
--    description, run this instead:
--
--   -- update public.books
--   --    set status = 'verified', verified_source = 'admin', verified_at = now()
--   --  where hardcover_id in (28782, 166210)
--   --    and status = 'unreviewed';
--
-- 4. BOTH SERIES ARE NOW DUE ANOTHER LOOK, via the 20260910120000 trigger.
--
--   select name, held, total_books, volumes_owed, missing_positions, volumes_stale
--     from public.series_completeness
--    where series_id in ('369728f5-7300-45b2-a7c6-a76e561c8d6b',
--                        '6c0dbbf7-b11f-41b1-bd01-760bcc654215');
--
-- 5. IF EITHER BOOK ALREADY EXISTED IN ANOTHER SERIES. upsert_book coalesces
--    onto the existing series_id, so it will have done nothing. Moving it is a
--    decision, not a repair — check what that other series is and whether it
--    still holds anything afterwards, then move it explicitly by id:
--
--   -- update public.books
--   --    set series_id = '369728f5-7300-45b2-a7c6-a76e561c8d6b',
--   --        position_in_series = 4
--   --  where id = '<the id from step 2>';
--
-- 6. OPTIONAL — if omnibuses should not render on series pages at all:
--
--   -- update public.books set status = 'flagged'
--   --  where id = '12f1167b-7f5a-46c0-a711-ad4b97e4992b';
--
--    'flagged' is outside ('verified','oracle_categorized'), so the page, the
--    sitemap and seriesService all stop listing it while any user shelf pointing
--    at it keeps working. Do the same for the Arabic Ozma if you want it gone
--    rather than merely unnumbered.
--
-- 7. STILL BROKEN, NOT FIXED HERE — Drizzt #5. "Streams of Silver"
--    (8485999e-7b70-4424-b7ae-9fa02673d1d7) exists and is attached to series
--    cab048b6-8c72-4bab-b6ee-181d7e66091c, so the 2026-09-12 run reported it as
--    `belongs to a different series` and position 5 is empty. That is the same
--    shape as the Dresden Files fix of 2026-09-10, but it is only the right move
--    if cab048b6 is a shadow row rather than a legitimate Icewind Dale series.
--    Look before moving:
--
--   -- select s.id, s.name, s.normalized_name, count(b.id) as held
--   --   from public.series s left join public.books b on b.series_id = s.id
--   --  where s.id = 'cab048b6-8c72-4bab-b6ee-181d7e66091c'
--   --  group by 1,2,3;
