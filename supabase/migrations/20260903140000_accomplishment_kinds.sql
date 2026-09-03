-- Widen reading_accomplishments_kind_check to the kinds the app actually earns.
--
-- The constraint has listed the same six kinds since the table was created:
--   nth_book, genre_count, new_genre, series_completed, plan_completed,
--   goal_completed
--
-- TWO things are missing from it.
--
-- 1. v0.67's family ladders — family_count, family_breadth, new_family — which
--    is the 400 that surfaced this:
--      new row for relation "reading_accomplishments" violates check
--      constraint "reading_accomplishments_kind_check"
--    EARNABLE_TYPES in src/lib/accomplishments.js was updated; the database's
--    own opinion about the same list was not.
--
-- 2. `female_authors_count`, added to EARNABLE_TYPES in v0.55 and never added
--    here. Every women-authors milestone a reader has crossed since then has
--    been rejected by this constraint. It failed quietly: the insert error is
--    logged to the console and swallowed, and the share card renders from the
--    in-memory moment regardless — so the card appeared, the reader shared it,
--    and the row was never written. Those accomplishments are recoverable: the
--    backfill replays the ladder from the library, and the version bump in
--    20260903130000 makes every profile replay once.
--
-- The lesson worth keeping: this list exists in TWO places that cannot see each
-- other. When you add a moment type to EARNABLE_TYPES, add it here in the same
-- change, or it will earn silently and persist nothing.

alter table public.reading_accomplishments
  drop constraint if exists reading_accomplishments_kind_check;

alter table public.reading_accomplishments
  add constraint reading_accomplishments_kind_check
  check (kind = any (array[
    -- current
    'nth_book',
    'series_completed',
    'plan_completed',
    'goal_completed',
    'female_authors_count',
    -- v0.67 family ladders
    'family_count',
    'family_breadth',
    'new_family',
    -- retired in v0.67 but NEVER removed: rows already earned are kept forever
    -- (reading-accomplishments-v1-spec rule 3), so the constraint must keep
    -- accepting them or the next write to an old row fails.
    'genre_count',
    'new_genre'
  ]::text[]));

comment on constraint reading_accomplishments_kind_check on public.reading_accomplishments is
  'Must stay in step with EARNABLE_TYPES + LEGACY_TYPES in src/lib/accomplishments.js. '
  'A kind missing here is earned in memory, shown on a share card, and silently '
  'never persisted — see female_authors_count, v0.55 to v0.67.';
