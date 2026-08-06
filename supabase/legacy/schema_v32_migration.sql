-- schema_v32_migration.sql
-- v0.45: Reading Accomplishments v1 (docs/reading-accomplishments-v1-spec.md)
--
-- A persistent, retroactive ledger of reading milestones — the durable
-- counterpart to the ephemeral share moments computed in shareMoments.js.
-- One row per earned accomplishment, immutable once written. Owner-only in
-- every direction; deliberately NO update policy (an accomplishment is a
-- moment, not a document — same discipline as reading_memories).
--
-- `key` is the stable identity of a milestone for a given user, e.g.
--   'nth_book:50'  'genre_count:Fantasy:25'  'series:Mistborn'
--   'plan:<planId>'  'goal:2026'
-- The unique (user_id, key) constraint is load-bearing: it makes BOTH the
-- live earn path (fireCompletionMoment) and the one-time backfill safe to
-- run repeatedly via `on conflict (user_id, key) do nothing` — a milestone
-- can never double-award.
--
-- Guest-mode accomplishments live in localStorage and never touch this
-- table. Idempotent; safe to run repeatedly.

create table if not exists reading_accomplishments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null check (char_length(key) between 1 and 200),
  kind        text not null
              check (kind in (
                'nth_book', 'genre_count', 'new_genre',
                'series_completed', 'plan_completed', 'goal_completed'
              )),
  book_id     uuid references books(id) on delete set null,  -- the book that earned it, if any
  meta        jsonb not null default '{}'::jsonb,             -- n, genre, seriesName, total, planTitle, year…
  earned_at   timestamptz not null default now(),            -- book.dateRead when derivable, else now()
  created_at  timestamptz not null default now(),
  unique (user_id, key)
);

-- The common query is "this user's whole ledger, most recent first"; the
-- shelf groups and per-book display are done client-side.
create index if not exists reading_accomplishments_user_earned_idx
  on reading_accomplishments (user_id, earned_at desc);

alter table reading_accomplishments enable row level security;

drop policy if exists "reading_accomplishments_select_own" on reading_accomplishments;
create policy "reading_accomplishments_select_own"
  on reading_accomplishments for select
  using (auth.uid() = user_id);

drop policy if exists "reading_accomplishments_insert_own" on reading_accomplishments;
create policy "reading_accomplishments_insert_own"
  on reading_accomplishments for insert
  with check (auth.uid() = user_id);

drop policy if exists "reading_accomplishments_delete_own" on reading_accomplishments;
create policy "reading_accomplishments_delete_own"
  on reading_accomplishments for delete
  using (auth.uid() = user_id);

-- No update policy: accomplishments are immutable by design.

-- One-time backfill marker. When null, the client replays the milestone
-- ladders over the existing library once (dated to each book's read date),
-- inserts on-conflict-do-nothing, then stamps this. Because the table is
-- idempotent the stamp is only an optimisation, never a correctness guard.
alter table public.profiles
  add column if not exists accomplishments_backfilled_at timestamptz;

-- ── Verification ──────────────────────────────────────────────────────────────
-- select relrowsecurity from pg_class where relname = 'reading_accomplishments';  -- t
-- select polname, polcmd from pg_policy
--   where polrelid = 'reading_accomplishments'::regclass;                          -- 3 rows, no UPDATE
-- select conname from pg_constraint
--   where conrelid = 'reading_accomplishments'::regclass and contype = 'u';        -- unique (user_id, key)
-- select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name = 'accomplishments_backfilled_at';  -- 1 row
