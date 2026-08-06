-- schema_v30_migration.sql
-- v0.44: Reading Memory v1 (docs/reading-memory-v1-spec.md)
--
-- Private notes tied to the moment a reader puts a book down (kind
-- 'progress', captured from the progress-update modal) or finishes it
-- (kind 'finished', recorded automatically from non-empty RatingModal
-- notes). Owner-only in every direction; there is deliberately NO update
-- policy — memories are moments, not documents (delete + rewrite if
-- needed). Guest-mode memories live in localStorage and never touch
-- this table.

create table if not exists reading_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  book_id     uuid not null references books(id) on delete cascade,
  kind        text not null default 'progress'
              check (kind in ('progress', 'finished')),
  body        text not null check (char_length(body) between 1 and 2000),
  pages_at    int  check (pages_at is null or pages_at >= 0),
  pct_at      int  check (pct_at is null or pct_at between 0 and 100),
  created_at  timestamptz not null default now()
);

-- One user re-reading the same book accumulates a thread; the common query
-- is "this user's memories, newest first" (whole-library load) and
-- per-book display is keyed client-side.
create index if not exists reading_memories_user_created_idx
  on reading_memories (user_id, created_at desc);

alter table reading_memories enable row level security;

create policy "reading_memories_select_own"
  on reading_memories for select
  using (auth.uid() = user_id);

create policy "reading_memories_insert_own"
  on reading_memories for insert
  with check (auth.uid() = user_id);

create policy "reading_memories_delete_own"
  on reading_memories for delete
  using (auth.uid() = user_id);

-- No update policy: editing is out of scope for v1 by design.

-- ── Verification ──────────────────────────────────────────────────────────────
-- select relrowsecurity from pg_class where relname = 'reading_memories';  -- t
-- select polname, polcmd from pg_policy
--   where polrelid = 'reading_memories'::regclass;                          -- 3 rows, no UPDATE
