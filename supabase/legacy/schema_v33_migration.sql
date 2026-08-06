-- ============================================================
-- schema_v33_migration.sql
-- Genre Achievements Cleanup — align reading_accomplishments with the
-- consolidated genre taxonomy.
--
-- Context: genre consolidation (rounds 1 & 2) folded a number of genres
-- into canonical ones and deleted the old rows from `genres`. But
-- reading_accomplishments is immutable by design (insert-only, no UPDATE
-- policy) and the backfill only ever inserts `on conflict do nothing`.
-- So genre milestones earned before consolidation — keyed by the old
-- genre NAME, e.g.
--     genre_count:Urban Fantasy:10   new_genre:Gothic
--     genre_count:Medieval:5         new_genre:Apocalyptic Fantasy
-- still linger and render on the Profile ledger against genres that no
-- longer exist.
--
-- Strategy (chosen): delete + re-backfill, driven off the canonical
-- `genres` table rather than a hard-coded old->new list, so this also
-- catches any earlier or future consolidation drift, not just round 2.
--   1. Reset accomplishments_backfilled_at for every user who owns a
--      stale genre accomplishment, so the client replays the milestone
--      ladders over the now-consolidated genresByBookId. The replay is
--      idempotent (unique(user_id, key) + on-conflict-do-nothing) and
--      re-awards the correct merged-genre milestones (e.g. the merged
--      'Fantasy' count), dated to the read that crossed each threshold.
--   2. Delete the orphaned genre_count / new_genre rows.
--
-- Only genre-based accomplishments are touched. nth_book, series_completed,
-- plan_completed and goal_completed rows carry no genre and are left alone.
--
-- Runner constraints (same as the consolidation scripts): no
-- CREATE TEMP TABLE / WITH — every statement is self-contained. Run as
-- postgres / service role to bypass RLS. Idempotent; safe to re-run.
-- ============================================================
BEGIN;

-- 1. Flag affected profiles for a fresh backfill. Done BEFORE the delete,
--    while the stale rows still exist to identify their owners. NOT EXISTS
--    (rather than NOT IN) keeps this null-safe. A genre accomplishment is
--    "stale" when its meta.genre no longer matches any name in `genres`.
UPDATE public.profiles p
SET accomplishments_backfilled_at = NULL
WHERE EXISTS (
  SELECT 1
  FROM reading_accomplishments ra
  WHERE ra.user_id = p.id
    AND ra.kind IN ('genre_count', 'new_genre')
    AND ra.meta->>'genre' IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM genres g WHERE g.name = ra.meta->>'genre'
    )
);

-- 2. Delete the orphaned genre accomplishments (genre no longer canonical).
DELETE FROM reading_accomplishments ra
WHERE ra.kind IN ('genre_count', 'new_genre')
  AND ra.meta->>'genre' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM genres g WHERE g.name = ra.meta->>'genre'
  );

COMMIT;

-- ============================================================
-- Sanity checks — run manually after commit
-- ============================================================
-- No genre accomplishment should reference a non-existent genre anymore:
-- SELECT ra.meta->>'genre' AS genre, ra.kind, count(*)
-- FROM reading_accomplishments ra
-- WHERE ra.kind IN ('genre_count', 'new_genre')
--   AND ra.meta->>'genre' IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM genres g WHERE g.name = ra.meta->>'genre')
-- GROUP BY 1, 2;                          -- should return 0 rows
--
-- Users queued for re-backfill (their client replays on next load):
-- SELECT count(*) FROM public.profiles WHERE accomplishments_backfilled_at IS NULL;
--
-- Spot-check that surviving genre accomplishments all map to real genres:
-- SELECT DISTINCT ra.meta->>'genre' AS genre
-- FROM reading_accomplishments ra
-- WHERE ra.kind IN ('genre_count', 'new_genre')
-- ORDER BY 1;
