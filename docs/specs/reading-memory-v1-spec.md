# Reading Memory — v1 spec

*Roadmap: "Gentle post-session prompts that build a private record of your reading
life — what you felt, what you'd tell a friend, where you left off and why."*

## Principle

The companion is quiet. That means: capture is **optional and inline** (never a
second modal, never a required field), memories are **private by default with no
sharing in v1**, and resurfacing happens **only where the reader already is** —
no notifications, no nudges, no streaks. If the reader never uses it, the app
looks exactly like it does today.

## What exists already (v1 builds on, not beside)

- Finishing a book already captures rating + notes (`RatingModal` →
  `markAsRead(extra)` → `read_books.notes`). That's the "what you'd tell a
  friend" moment, already built.
- Progress updates (`ProgressUpdateModal` → `updateReadingProgress` →
  `currently_reading.pages_read`) capture *numbers* but lose the *why*.
  A reader who puts a book down at p. 145 for six weeks reopens it to a page
  number and nothing else.

v1 fills exactly that gap: **a note attached to the moment you put the book
down, returned to you the moment you pick it back up.**

## Capture

One addition to `ProgressUpdateModal`: below the pages input, a collapsed
text-button in the existing `btn-text btn--sm` style (same pattern as the
edition-override link):

> ✎ Leave a note for your future self

Tapping expands a single optional textarea (placeholder: *"Where are you —
and what's staying with you?"*, max 2000 chars). It saves together with the
progress save — one button, one action, no separate flow. Left empty, nothing
is stored.

No capture UI is added to the finish flow — `RatingModal` notes already cover
it. The finish note is *recorded into the memory timeline* (see Data) so the
book's memory reads as one continuous thread.

## Resurfacing

Two places, both passive:

1. **`ProgressUpdateModal`, on open** — if the book has a memory, a quiet block
   above the pages input:

   > *Last time — p. 145, three weeks ago:*
   > "Just reached the trial. Don't trust the uncle."

   Newest memory only. Dismissable by ignoring it.

2. **BookPage, "Your reading memory" section** — for collected books with ≥1
   memory: the full thread, newest first, each entry showing date + page +
   body, with a small delete (privacy requires delete; no editing in v1 —
   memories are moments, not documents). Section carries a `Private` chip and
   renders only for the owner (it lives on library/currently-reading data,
   which is already per-user).

## Data

New table `reading_memories` (migration `schema_v30_migration.sql`):

```sql
create table reading_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  book_id     uuid not null references books(id) on delete cascade,
  kind        text not null default 'progress',   -- 'progress' | 'finished'
  body        text not null check (char_length(body) <= 2000),
  pages_at    int,          -- pages_read at capture time, if known
  pct_at      int,          -- % at capture time, if computable
  created_at  timestamptz not null default now()
);
-- RLS: owner-only select/insert/delete. No update policy (no editing in v1).
```

- On finish, if `RatingModal` notes are non-empty, insert a `kind='finished'`
  row alongside the existing `read_books.notes` write (notes stay where they
  are — nothing moves, nothing breaks).
- **Guest mode:** `state.memories` — `{ [bookKey]: MemoryEntry[] }` — rides the
  existing localStorage persistence. Same shape, no server.

DataContext additions: `addReadingMemory(book, body, {pagesAt, pctAt, kind})`,
`deleteReadingMemory(book, memoryId)`, `memoriesForBook(book)`; memories load
with the initial user fetch (single query, keyed client-side).

## i18n

New `memory.*` block in `en.json` and `es.json` (es in the app's existing
rioplatense voice): capture link, placeholder, resurface header ("Last time"),
BookPage section title, `Private` chip, relative-time strings if not already
available, delete confirm.

## Out of scope for v1 (deliberately)

Oracle involvement of any kind; prompts, reminders or notifications; editing
entries; sharing; sequel/series resurfacing ("you read book 1 two years ago —
here's what you said"); memory on wishlist-only books. Each is a candidate for
v2 *after* real usage shows which moments people actually write in.

## Build checklist

1. Migration + RLS (`schema_v30_migration.sql`)
2. DataContext: state, loaders, `addReadingMemory` / `deleteReadingMemory`, guest path
3. `ProgressUpdateModal`: capture field + "last time" block
4. Finish flow: record `kind='finished'` rows from non-empty RatingModal notes
5. BookPage: memory thread section
6. i18n en + es
7. Styles: `_misc.scss` (`memory-*` classes, DS patterns only)
