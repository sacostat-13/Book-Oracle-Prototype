-- revert_curate_batch1.sql — undo the suspect title changes from the first curate run,
-- so those rows re-enter the queue and can be re-proposed under the corrected prompt.
--
-- READ THIS FIRST: renames and merges are NOT equally reversible.
--
--   RENAME  fully reversible. Only books.title/author/normalized_key changed; no user
--           data moved. Section 1 restores them exactly.
--
--   MERGE   NOT fully reversible, by a limitation of merge_books(). book_merge_log
--           records refs_moved and refs_deduped as COUNTS, not row identities:
--
--             {"refs_moved":{"book_genres.book_id":2},
--              "refs_deduped":{"wishlist_items.book_id":1}}
--
--           refs_moved rows can be found again (they point at the target now), but
--           refs_deduped rows were DELETED — a user who held both books had the
--           redundant entry removed, and the log did not keep which one. Restoring the
--           deleted book row is possible; restoring that wishlist entry is not.
--
--           Section 2 therefore restores the BOOK only, and is written as commented
--           SQL you should run one row at a time after reading the note there.

begin;

-- ===========================================================================
-- SECTION 1 — revert the four part-for-container renames.
-- ===========================================================================
-- Each of these mapped a single work onto a larger collection that CONTAINS it:
--
--   La patrona   → Tales of the Unexpected     ("The Landlady" is a story inside it)
--   La bruja     → The Lottery and Other Stories
--   Estacas      → In a Lonely Place            (Wagner collection)
--   There Used to Be People Here → One Who Has Been Here Before   (unrelated titles)
--
-- The new prompt forbids this explicitly, so re-running curate should either propose
-- something correct or decline with low confidence.
--
-- normalized_key is recomputed with compute_book_key() — the same function upsert_book
-- uses, so there is no chance of the JS and SQL definitions drifting here.
--
-- isbn and hardcover_id are cleared as well: both were derived from the WRONG identity,
-- so keeping them would leave a link to the collection on a row that is not the
-- collection. Clearing them also puts the row back in isbnBackfill's queue.

update public.books b
set title          = v.old_title,
    author         = coalesce(v.old_author, b.author),
    normalized_key = public.compute_book_key(v.old_title, coalesce(v.old_author, b.author)),
    isbn           = null,
    hardcover_id   = null
from (values
  ('38aa6833-fb54-4b69-a901-ad9c43591b48'::uuid, 'La patrona',                   null::text),
  ('f2bc15be-08e3-4435-84af-ed21dff6aa25'::uuid, 'La bruja',                     null::text),
  ('ca8bef23-8fe2-4e38-9e4f-88aa9113ec8d'::uuid, 'Estacas',                      null::text),
  ('1fadf52c-7aef-4b56-8cb2-ad7e07c09912'::uuid, 'There Used to Be People Here', null::text)
) as v(id, old_title, old_author)
where b.id = v.id;

-- If curate also changed the AUTHOR on any of these, put the old value in the third
-- column above instead of null — proposed-titles.csv has it in `old_author`. Leaving it
-- null keeps whatever author is currently stored.

commit;


-- ===========================================================================
-- SECTION 2 — the two language merges. RUN ONLY IF YOU WANT THEM SPLIT AGAIN.
-- ===========================================================================
-- Los peligros de fumar en la cama → merged into The Dangers of Smoking in Bed
-- Paraíso Podrido                  → merged into Paradise Rot
--
-- Consider whether you actually want these reversed. The merge was not wrong about the
-- WORK — those are genuinely the same book in two languages — it was wrong about which
-- title should survive. Two cheaper options:
--
--   (a) Leave the merge and just rename the surviving row to the Spanish title, if the
--       Spanish edition is the one your readers want to see. One statement, no data loss:
--
--         update public.books
--         set title = 'Los peligros de fumar en la cama',
--             normalized_key = public.compute_book_key('Los peligros de fumar en la cama', author),
--             isbn = null, hardcover_id = null
--         where id = '4299afe0-f7d0-40cb-9610-451ee684e444';
--
--   (b) Decide the catalog should hold one row per WORK, not per language edition, and
--       leave both merges alone. This is arguably the cleaner model — it is what the
--       merge already did — and only the displayed title is at issue.
--
-- If you do want the rows split back out, restore the book from its snapshot. Note the
-- restored row will have NO user references: the wishlist entries now point at the
-- surviving row, and Paraíso Podrido's duplicate wishlist entry was deleted outright.
--
--   insert into public.books
--   select (jsonb_populate_record(null::public.books, l.from_snapshot)).*
--   from public.book_merge_log l
--   where l.from_snapshot->>'title' = 'Los peligros de fumar en la cama';
--
-- Then clear its derived fields so it re-enters the backfill queue:
--
--   update public.books set isbn = null, hardcover_id = null
--   where title = 'Los peligros de fumar en la cama';


-- ===========================================================================
-- VERIFY, then re-run
-- ===========================================================================
--   select id, title, author, isbn, hardcover_id, normalized_key
--   from public.books
--   where id in ('38aa6833-fb54-4b69-a901-ad9c43591b48',
--                'f2bc15be-08e3-4435-84af-ed21dff6aa25',
--                'ca8bef23-8fe2-4e38-9e4f-88aa9113ec8d',
--                '1fadf52c-7aef-4b56-8cb2-ad7e07c09912');
--
-- Expect the old titles back, isbn and hardcover_id null.
--
-- Then, with the corrected prompt:
--   node batch-scripts/curateManualBooks.mjs --limit 10 --verbose
--
-- Delete or archive batch-scripts/proposed-titles.csv first — a rerun overwrites it, and
-- you do not want last run's approvals applied a second time.
