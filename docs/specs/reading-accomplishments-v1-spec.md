# Reading Accomplishments — v1 spec

*Roadmap: "A retroactive trophy shelf on your Profile — a quiet ledger of what
your reading life has already earned, not a scoreboard telling you to read more."*

## Principle

The ledger is a **record, not a nudge**. It honours what already happened; it
never demands a cadence. Concretely, three rules, in priority order:

1. **No streaks. Ever.** No "read X days in a row," no daily/weekly cadence
   goals, no decay, no counter that resets when you take a month off. Nothing
   in this feature may punish, grey-out, or guilt a gap. A reader who finishes
   nothing for a season loses no accomplishment and sees no reproach. This rule
   is load-bearing — it is the difference between a ledger and a habit-app, and
   it is written here first on purpose.
2. **Past tense, with dates.** Every entry is something you *did*, stamped with
   when. Locked/next milestones may be shown, but faintly and factually
   ("50 books — 38 so far"), never as a countdown or a demand.
3. **Earned once, kept forever.** Accomplishments are persistent and
   idempotent. They never re-fire, never double-award, never disappear.

If the reader never opens Profile, the app looks exactly as it does today.

## What exists already (v1 builds on, not beside)

The milestone *logic* is already written and shipping — `shareMoments.js`
(`computeCompletionMoments`) computes every celebratable moment at the instant
of completion: `goal_completed`, `series_completed`, `plan_completed`,
`nth_book` (ladder `YEAR_MILESTONES = [5,10,25,50,75,100,150,200]`),
`genre_count` (ladder `GENRE_MILESTONES = [5,10,25,50]`) and `new_genre`. But
that system is deliberately **ephemeral**: pure, client-only, fires only on the
exact-crossing tick (`count === milestone`), and is thrown away after the share
modal closes. Its own header calls a persistent, retroactive, profile-shelf
version "a post-1.0 feature." This is that feature.

Two more things already exist that we reuse rather than rebuild:

- **Retroactive computation is already proven.** `Profile.jsx` `stats` derives
  `seriesCompleted`, genre counts, `booksThisYear`, and pace *from the library*
  on every render — exactly the shape a backfill needs. Accomplishments are
  the same computation, persisted and dated.
- **The card is already built.** `ShareCard.jsx` renders a branded 1080×1350
  card for every one of the moment types above, and `ShareMomentModal.jsx`
  handles share/download. An earned accomplishment is a moment object; sharing
  one is opening the modal we already ship.

So the genuinely new work is three things and only three: **persistence,
retroactivity, and the shelf UI.**

## Data

New table `reading_accomplishments` (migration `schema_v32_migration.sql`):

```sql
create table reading_accomplishments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null,          -- stable identity, e.g. 'nth_book:50',
                                       -- 'genre_count:Fantasy:25', 'series:Mistborn',
                                       -- 'plan:<planId>', 'goal:2026'
  kind        text not null,          -- 'nth_book'|'genre_count'|'new_genre'|
                                       -- 'series_completed'|'plan_completed'|'goal_completed'
  book_id     uuid references books(id) on delete set null,  -- the book that earned it
  meta        jsonb not null default '{}'::jsonb,  -- n, genre, seriesName, total, planTitle, year…
  earned_at   timestamptz not null default now(),  -- book.dateRead when derivable, else now()
  created_at  timestamptz not null default now(),
  unique (user_id, key)               -- idempotency: never double-award
);
-- RLS: owner-only select/insert/delete. No update policy (accomplishments are
-- immutable — a moment, not a document, same discipline as reading_memories).
```

The `unique (user_id, key)` constraint is what makes both the live path and the
backfill safe to run repeatedly — inserts use `on conflict do nothing`.

**Guest mode:** `state.accomplishments` — an array of the same entry shape —
rides the existing localStorage persistence, mirroring `state.memories`. Same
shape, no server.

## Earning (live path)

No new firing logic. `fireCompletionMoment` in `DataContext` already computes
the full moment list at completion; we persist it there. After
`computeCompletionMoments` returns, for each *milestone-bearing* moment (all
types except the plain `book_completed` fallback), derive `key` and
`on conflict do nothing` insert. One computation now feeds two consumers — the
share modal (moments[0], unchanged) and the ledger (all of them).

The Goodreads-import skip (`if (book.fromGoodreads) return`) stays for the
*share modal* — 400 cards is not 400 celebrations — but imported books must
still **earn** accomplishments. They flow in through the backfill below, dated
to each book's `dateRead`, so an import of your reading history retroactively
fills the shelf without firing 400 modals. (This is the compounding Fable
flagged: imports give the ledger history to honour.)

## Retroactivity (backfill)

A one-time, idempotent backfill computes every accomplishment the existing
library already implies — the same derivation `Profile.jsx` `stats` does, but
awarded and dated:

- **Per-book ladders** (`nth_book`, `genre_count`, `new_genre`): walk the
  library sorted by `dateRead` ascending, replaying the exact-crossing checks
  from `shareMoments.js` so the *earned_at* of each rung is the date the book
  that crossed it was read. Undated books sort last and stamp `now()`.
- **Series / goal**: award from the current library snapshot (`seriesCompleted`
  logic already in Profile stats; goal per completed year).

Trigger: a `profiles.accomplishments_backfilled_at` timestamp (or a client
`localStorage` flag for guests). On first load after ship where it's null, run
the backfill once, insert `on conflict do nothing`, set the stamp. Because the
table is idempotent, a re-run is harmless — the flag is just an optimisation.

## Shelf UI

One new section on `Profile.jsx`, following the existing `pf-section` /
`sectionTitle` pattern, placed after Stats (it *is* the narrative expansion of
the stat tiles). Working title **"The Ledger."**

Entries grouped by kind — Years, Series, Genres, Plans, Goals — each earned
item a small plaque: the moment's ornament (`✦ ☩ ❦ ✺ ⚜ ✧`, already mapped per
type in `ShareCard`), its headline, and the `earned_at` date. Sort within group
by `earned_at` desc. Empty groups are omitted (a reader with no completed
series simply has no Series row — never an empty "0 / locked" grid).

Optional, faint, and strictly factual: the *next* rung per active ladder, shown
like `Profile`'s existing `seriesInProgress` block ("50 books — 38"), no
countdown language, no "12 to go!". This is the only forward-looking element and
it must read as information, not a prompt. If it can't be made to feel like a
ledger line rather than a nudge, cut it — rule 1 wins.

Each plaque is tappable → opens `ShareMomentModal` with the moment object
reconstructed from the row (`kind` + `meta` + resolved book). This is the growth
loop: every retroactively-earned milestone becomes another dark-academia share
card. Pairs with the planned satori OG endpoint (already noted in `ShareCard`'s
header) — accomplishments multiply the branded links people share.

## i18n

New `accomplishment.*` / `ledger.*` block in `en.json` and `es.json` (es in the
app's rioplatense voice): section title, group headings, the factual
next-rung string, plaque date formatting, and any headline strings not already
covered by the existing `share.card.*` keys (reuse those where the card copy
already exists). No notification or reminder strings — there are none.

## Out of scope for v1 (deliberately)

Streaks and any cadence/time-pressure mechanic (**permanently** out, not just
v1 — see rule 1); new milestone *types* beyond what `computeCompletionMoments`
already produces; leaderboards, friend comparison, or any social ranking;
notifications or nudges of any kind; editing or manual/curated accomplishments;
accomplishments on wishlist-only or unread books. New ladders and badge art are
candidates for v2 *after* the imported-history shelves show which milestones
people actually share.

## Build checklist

1. Migration + RLS (`schema_v32_migration.sql`), `unique (user_id, key)`,
   `profiles.accomplishments_backfilled_at`.
2. DataContext: `state.accomplishments`, loader (single query with initial
   user fetch), guest localStorage path, `keyForMoment(moment)` helper.
3. Live earn: persist milestone moments inside `fireCompletionMoment`
   (`on conflict do nothing`); leave the share-modal path unchanged.
4. Backfill: date-ordered replay from library, one-time flag, idempotent insert.
5. Profile: "The Ledger" section — grouped plaques, tap-to-share via
   `ShareMomentModal`, optional factual next-rung line.
6. i18n en + es (reuse `share.card.*` where copy exists).
7. Styles: `_profile-extensions.scss` (`ledger-*` classes, `--ro-*` tokens only;
   the share *card* keeps its hardcoded brand palette as today).
8. Release discipline: `releases.js` (EN/ES) + `README.md`.
