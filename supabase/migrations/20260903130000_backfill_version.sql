-- Version the accomplishments backfill instead of stamping it once.
--
-- v0.45 gated the retroactive backfill on `accomplishments_backfilled_at`: a
-- timestamp, set the first time it ran, checked as a boolean. That was right
-- while the ladders never changed.
--
-- v0.67 changed the ladders — the per-genre ones are retired and three family
-- ladders replace them. Every existing reader already carries a stamp, so the
-- backfill would never run again and the new accomplishments would never be
-- computed for anyone who was not brand new. The feature would have shipped
-- inert for exactly the readers with the most history to honour.
--
-- A version makes "has it run?" answerable per LADDER SET rather than once
-- forever. Re-running is safe by construction: every insert is
-- `on conflict (user_id, key) do nothing`, so a replay re-earns nothing and
-- adds only what the new ladders imply.
--
-- The timestamp column stays. It is the honest record of when the first
-- backfill happened, and nothing should overwrite that.

alter table public.profiles
  add column if not exists accomplishments_backfill_version integer not null default 0;

comment on column public.profiles.accomplishments_backfill_version is
  'Which ladder set the retroactive accomplishments backfill last ran for. '
  'Bump ACCOMPLISHMENTS_BACKFILL_VERSION in DataContext.jsx when the ladders in '
  'shareMoments.js change, and every profile replays once against the new set.';

-- Readers who were backfilled under the v0.45 genre ladders are version 1;
-- 0 (the default) means never backfilled at all. Both are below the current
-- version, so both replay — which is correct, and cheap.
update public.profiles
   set accomplishments_backfill_version = 1
 where accomplishments_backfilled_at is not null
   and accomplishments_backfill_version = 0;
