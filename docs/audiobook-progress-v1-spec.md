# Audiobook progress — v1 spec

*"If a user says they are actually using an audiobook, can we just update the
progress so they add the time they have been hearing it? Pulling a total of
hours might be harder, but we can just ask users to add the total number of
hours. Then that would open up a new stat, where users could see amount of
hours hearing books."*

Yes. And the reason it is a small change rather than a large one is that
`reader_editions` already exists and already has a `format` column — v0.64 built
the place this goes. What v0.64 did *not* build is anything for an audiobook to
put there.

## The problem, stated honestly

Today an audiobook listener is a second-class reader in this app, in a way that
is quiet enough to be missed:

- **Their progress bar has no units.** `format = 'audio'` currently suppresses
  the bar entirely (`reader-editions-v1-spec.md`, verification case 3), which
  was the right call — a bar stuck at 0% is worse than no bar. But "no bar" is
  a workaround for a missing measurement, not a feature.
- **Their reading does not count.** `Dashboard.jsx:340` sums
  `effectivePages(b, editions?.[b.bookId]) || 0` across the library. An
  audiobook has no page count, so it contributes **zero**. A reader who
  finished forty audiobooks this year sees a pages total that says they read
  nothing. **This is the part that actually stings**, and it is already live.

So this is not only a new stat. It is a correctness fix for a stat that is
currently wrong by omission, and the new stat is how it gets fixed honestly.

## Principle

**An audiobook is measured in time, and time is not pages.**

The app will not convert between them. There is a standing temptation here —
"average reading speed is ~250 words/minute, an audiobook is ~9,300 words/hour,
so 10 hours ≈ 340 pages" — and every term in that sentence is invented. A
converted number would flow into `accomplishments.js`, into share cards, into a
reader's sense of their own year, and nothing downstream could tell it from a
counted one.

Two units, two stats, never mixed. `docs/isbndb-evaluation.md` refused a paid
source over a data-provenance obligation; this is the same instinct applied to
a number we would be inventing ourselves.

## Data

Two nullable columns. No new table.

```sql
-- 202608xxxxxxxx_audiobook_progress.sql

alter table public.reader_editions
  add column if not exists duration_minutes integer;

comment on column public.reader_editions.duration_minutes is
  'Total length of THIS reader''s audio edition, in minutes. NULL = unknown, which is a supported state: cumulative listening still counts without it, only the progress bar needs it. Minutes, not hours, because an audiobook is 11h 47m and a float column would render 11.783.';

alter table public.currently_reading
  add column if not exists progress_minutes integer;

comment on column public.currently_reading.progress_minutes is
  'How far into an audio edition this reader is, in minutes. Parallel to current_page, not a replacement: the unit is decided by reader_editions.format, and a reader who switches format mid-book must not have their old number reinterpreted.';
```

### Why minutes

Audiobook lengths are published as `11h 47m`. Stored as hours it is `11.783`,
and every render has to un-round it; stored as minutes it is `707` and the
formatting is one function. `xlsx`-style float drift on a column that gets
summed across a whole library is a real, boring bug.

The **input** is still hours-and-minutes — two small number fields, or one
field that accepts `11:47` and `11h 47m`. Nobody types 707.

### Why `duration_minutes` is optional, and why that matters

Most readers do not know the total length of the book they are listening to
without going to look it up. Making it required would make the feature a chore
at exactly the moment it should be one tap.

It is only needed for the **progress bar**. The **cumulative hours stat works
without it** — that is a straight sum of minutes listened, which the reader
knows because they just told us. So:

| Reader gives | They get |
| --- | --- |
| minutes listened only | hours-listened stat, no progress bar |
| minutes listened + total | both |
| nothing | today's behaviour, unchanged |

This is a better shape than requiring the total, and it falls out of asking
what each number is actually for.

### Why not one `progress` column with a unit flag

Tempting — one number, `format` decides whether it means pages or minutes — and
wrong. `reader_editions` is unique per `(user_id, book_id)`, so a reader *can*
change `format` on a book they are part-way through: they started the paperback,
switched to the audiobook for a commute. With a single column, page 143 silently
becomes 143 minutes. Two columns cost one nullable integer and make that
impossible.

### Why not on `read_books`

Same reason `reader_editions` exists at all. `currently_reading` is deleted when
the book is finished, so `progress_minutes` goes with it — correctly, because
part-way progress stops being interesting. The **duration** lives on
`reader_editions`, which survives the shelf move, and that is what the finished
book's contribution to the stat is read from. This is precisely the
`user_page_count` mistake, not repeated.

## Resolution: one helper, alongside the existing one

`src/lib/editions.js` gains a sibling to `effectivePages`:

```js
// Minutes of audio this edition runs to, or null. The audio counterpart of
// effectivePages — and note there is no fallback to a catalog value, because
// the catalog has no duration and should not pretend to.
export function effectiveMinutes(edition) {
  return edition?.format === 'audio' ? (edition?.duration_minutes || null) : null;
}

// How far through, 0..1, or null when it cannot be known.
//
// THE point of this function: almost every caller that today divides by pages
// actually wants a FRACTION. Giving them one means the audio case is handled
// once, here, instead of at every progress bar in the app.
export function progressFraction(book, edition, cr) {
  if (edition?.format === 'audio') {
    const total = effectiveMinutes(edition);
    if (!total || !cr?.progress_minutes) return null;
    return Math.min(1, cr.progress_minutes / total);
  }
  const total = effectivePages(book, edition);
  if (!total || !cr?.current_page) return null;
  return Math.min(1, cr.current_page / total);
}
```

`null` means "cannot be known", and every caller renders that as *no bar* rather
than as 0%. That is the existing audio behaviour, generalised — it now also
covers a print book with no page count, which today shows a bar stuck at zero
for the same reason.

### Call sites

| Where | Today | After |
| --- | --- | --- |
| Progress bar, `BookPage` / `CurrentlyReading` | `current_page / effectivePages` | `progressFraction` |
| `ProgressUpdateModal` | page input | page **or** time input, by `format` |
| `Dashboard` pages-read | `effectivePages` sum | unchanged — **still pages only** |
| `Dashboard` hours-listened | — | **new** |
| `accomplishments.js` page totals | `effectivePages` | unchanged — pages only |
| `computeSimilar` length signal | `book.pp` | unchanged |

The three "unchanged" rows are the spec. Pages-read stays a count of pages, and
hours-listened is a separate number next to it. Nothing sums them.

## UI

**1. `ProgressUpdateModal` — the input follows the format.**

The edition block from v0.64 already asks for format. When it is `audio`, the
page field becomes a time field:

> **How far are you?**  `[ 4 ]` h `[ 20 ]` m
> *of* `[ 11 ]` h `[ 47 ]` m — *leave blank if you don't know*

Two decisions worth naming:

- **Absolute position, not a delta.** "How far are you" matches how an
  audiobook app shows it — Audible and Libro.fm both display a position, and
  the reader can read the number straight off their phone. Asking "how long did
  you listen for?" requires them to do arithmetic the app can do, and gets
  double-counted the moment they update twice in a session.
- **Total is on the same screen, optional, and remembered.** Asked once per
  book, not per update, because it does not change.

**2. `BookPage` — the existing edition line, in the right unit.**

The v0.64 line already reads *Reading the Spanish edition · Cien años de soledad
· 496 pp*. For audio it reads *Listening · 11h 47m*. Same line, same
owner-only visibility, different noun.

**3. `Dashboard` — one new stat tile.**

Next to pages read, not instead of it: **`142h listened`**. Rendered only when
it is non-zero, so it does not appear as an empty tile for readers who do not
listen to anything.

Composition, and both halves matter:

```
hours listened =
    sum of progress_minutes over currently_reading rows whose edition is audio
  + sum of duration_minutes over read_books rows whose edition is audio
```

**A finished audiobook counts its full duration**, which is an approximation and
should be written down as one: a reader who abandoned a book at 80% and marked
it read gets the extra 20%. The alternative — carrying a final position onto
`read_books` — is a column and a write on every completion to fix a rounding
error nobody will notice. Not worth it in v1; worth revisiting if the number
ever needs to be authoritative rather than encouraging.

A finished audiobook with **no** `duration_minutes` contributes zero and cannot
do otherwise. That is the honest answer, and it is the argument for prompting
for the total at the point the reader marks an audio edition as read, if they
have not given one.

## Prefill: worth a probe, not worth blocking on

Asking the reader is the right v1 — it is what `page_count` does, it works
offline, and it is one field.

That said, `hardcoverLookupByIsbn` is already in the ISBN path and Hardcover's
edition records may carry an audio duration; an audiobook's ISBN is usually
distinct from the print one, so `reader_editions.isbn` is already the right key.
**`batch-scripts/probes/` is where that question gets answered** — one probe
against a known audiobook ISBN, in the shape of `probes/isbndb.probe.mjs`. If
the field is there, the existing ISBN lookup prefills the total and the reader
confirms it. If it is not, nothing changes and we have not built anything on a
guess.

Google Books does not carry audio duration. Do not go looking.

## What v1 deliberately does not do

- **No listening sessions.** No "you listened 45 minutes today" history, no
  streaks, no per-day chart. That needs an events table, and the stat this asks
  for is a total.
- **No playback-speed adjustment.** A reader at 1.5× has genuinely spent fewer
  hours than the book runs, and there is no honest way to know without asking
  a question nobody wants asked. The stat is *hours of audiobook*, and the tile
  should say something close to that rather than implying wall-clock.
- **No pages↔hours conversion.** Stated twice on purpose.
- **No catalog-level duration.** `books` gets no duration column. Length is an
  edition fact and this app has spent v0.64 learning that lesson.

## Verification

1. An audio edition with a total and a position shows a progress bar at the
   right fraction; the same edition with no total shows **no bar**, not 0%.
2. A print book with no page count also shows no bar — the same code path,
   fixing an existing wart.
3. A reader switches a part-read book from print to audio: the page number is
   still there when they switch back, and was never displayed as minutes.
4. Finish an audiobook, reopen the book page: the edition line still reads
   *11h 47m*. This is the `user_page_count` case, in the new unit.
5. Dashboard hours-listened equals the hand-summed total for a test account
   with two finished audiobooks and one in progress.
6. Pages-read is **unchanged** by any of the above. If adding an audiobook
   moves the pages number, something converted.
7. The hours tile does not render for an account with no audio editions.

## Why this is worth doing now

It is two nullable columns, one helper, one input variant and one tile — a day's
work — because `reader_editions` already exists to hold it. And it closes a
live wrong answer: the Dashboard currently tells audiobook listeners they have
read nothing, which is both untrue and the kind of thing that makes someone
stop opening an app.
