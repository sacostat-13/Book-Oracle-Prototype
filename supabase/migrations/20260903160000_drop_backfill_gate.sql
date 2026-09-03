-- Drop the backfill version gate. The optimisation cost more than it saved.
--
-- 20260903130000 added `accomplishments_backfill_version` so the retroactive
-- accomplishments backfill could re-run when the milestone ladders changed.
-- That was a correct fix for a real problem — but the problem only existed
-- because there was a stamp at all.
--
-- A stamp records "this has been done", so it is only true if the write landed.
-- When reading_accomplishments_kind_check rejected the v0.67 family rows, the
-- stamp was written regardless and every profile was permanently marked as
-- backfilled against ladders it had never computed. Repairing that took a
-- second migration (20260903150000) and left a class of bug that can recur any
-- time a write fails between the compute and the stamp.
--
-- The backfill now simply runs on every mount. It is idempotent by
-- construction — every insert is `on conflict (user_id, key) do nothing` — so
-- the cost is a redundant computation and an upsert of rows that already exist.
-- Wasteful, bounded, and incapable of claiming work is finished when it is not.
--
-- `accomplishments_backfilled_at` is KEPT. It is from v0.45 and is the honest
-- record of when a reader's history was first honoured. Nothing reads or writes
-- it any more; it is history, and history is not ours to delete.

alter table public.profiles
  drop column if exists accomplishments_backfill_version;

-- 20260903130000 and 20260903150000 stay in the migration history as applied.
-- They are superseded, not wrong — this is the record of why they went away.
