# Update Notes — v0.64 → v0.64.1: audiobooks, and a backfill that finishes

**Migrations required, in order:**

1. `20260819180000_original_language_checked_at.sql` — `books.original_language_checked_at`
2. `20260820120000_audiobook_progress.sql` — `reader_editions.duration_minutes`, `reader_editions.narrator`, `currently_reading.progress_minutes`

Apply the first **before the weekly cron next fires** (Mondays 06:00 UTC) — see
§2. Apply both before deploying the bundle: §4 is what happens if you do not.

A patch release with one new surface. v0.64 gave `reader_editions` a `format`
column and then gave an audiobook nothing to put in it; this is that gap, plus
two things v0.64 got wrong that only showed up once it was running.

## 1. Audiobooks are measured in time

Spec: `docs/audiobook-progress-v1-spec.md`.

A reader who says their copy is an audiobook is now asked how far in they are
and how long the book runs, in hours and minutes, and can record who narrates
it. `reader_editions` gains `duration_minutes` and `narrator`;
`currently_reading` gains `progress_minutes`.

**Minutes, not hours.** An audiobook is `11h 47m`; as hours that is `11.783`,
which every render has to un-round and which accumulates error when summed
across a library. The input is still two fields, because nobody types 707.

**Two columns, not one unit-tagged column.** `reader_editions` is unique per
`(user_id, book_id)`, so a reader can change format part-way through a book —
started the paperback, switched to the audiobook for a commute. With a single
`progress` number whose unit is decided by `format`, page 143 silently becomes
143 minutes.

**The total is optional, and that is a design decision rather than laziness.**
Most listeners do not know the length of the book they are in the middle of.
Cumulative hours works without it; only the progress bar needs a total. So the
feature is not gated on the number that is hardest to get.

**Duration lives on `reader_editions`, not `currently_reading`.** It has to
survive the book being finished, because that is what a completed audiobook
contributes to the stat. Putting it on the shelf row would repeat the
`user_page_count` mistake exactly one release after fixing it.

### The Dashboard was telling audiobook listeners they had read nothing

`ReadingStatsWidget` summed `effectivePages` across the library. An audiobook
has no page count, so it contributed **zero**, and a reader who finished forty
of them saw a pages total that said they had read nothing. That was live.

It is now two tiles. `pages total` explicitly **skips** audio editions rather
than relying on them happening to be null — same number, stated as a rule
instead of an accident — and `listened` sits next to it, hidden when it is
zero, because an empty tile is a worse answer than no tile.

It is **not** fixed by giving audiobooks a page count. The tempting arithmetic —
250 wpm, ~9,300 words an hour, so ten hours is "about 340 pages" — has an
invented number in every term, and the result would land in
`accomplishments.js` and on share cards indistinguishable from a counted page.
Two units, two tiles, nothing sums them.

### `editions.js`

`effectiveMinutes`, `isAudioEdition`, the minutes↔h/m translation, and
`progressFraction(book, edition, progress)` — which is the one that matters.
Almost every caller that divides by pages actually wants a *fraction*, so the
audio case is handled once. It returns `null` for "cannot be known" and every
caller renders that as **no bar**, which also fixes a print book with no page
count that used to render stuck at 0%.

## 2. The original-language backfill did not terminate

`originalLanguageBackfill.mjs` went into `scheduled/` on the grounds that it is
free **and it terminates**. The first was true.

Its filter was `original_language IS NULL`. It resolves about 40% of what it
examines; the other 60% are books Wikidata genuinely does not have, so they stay
NULL, so they stay eligible — and the weekly cron would re-ask the same ~2,000
indie novellas, Warhammer tie-ins and single-issue comics every Monday forever.
Slow, poor manners toward a free service that asks for a contact address in its
User-Agent, and a report that never shrinks, which is worse than either: a queue
that cannot drain gives no signal about whether anything is working.

`books.original_language_checked_at` is the fix, and it is
`authorGenderBackfill.mjs`'s rule verbatim — **stamp even when the answer is
nothing**, so an honest shrug is recorded as asked-and-answered.

**A failed request never stamps.** `search-failed` and `entities-unfetchable`
mean the row was *attempted*, not asked; a timestamp there converts an outage
into a permanent "we checked, there is nothing" — the 2026-08-17 postmortem's
root cause with a date on it. `shouldStampChecked()` owns that decision, in the
library half so the probe can assert on it, including that an *unknown* stage
does not stamp. Stamps are written per row rather than batched, for the reason
that cancelled run kept 98 of its answers: immediate writes survive.

`--recheck` reverts to the value filter for a deliberate sweep after a source
improves. Not for a schedule.

## 3. The progress modal follows the format

The v0.64 layout asked for a page count *first* and the edition afterwards,
behind a disclosure link. That ordering was wrong in a way only audiobooks made
visible: it asks "how many pages?" before knowing whether the book has pages at
all, and an audio listener got a disabled field, a note apologising for it, and
nowhere to record what they had actually done.

The form now establishes **what the copy is** before asking **how far in** you
are, in one order for every format:

```
ISBN → Format → Title → Language
  ├── print / ebook : Pages read · Pages in your edition · Translator
  └── audio         : How far are you · Total length · Narrator
```

ISBN stays first because it is the one field a reader can copy off the back
cover without deciding anything, and filling it fills several of the others.
Format is second because it is the switch. The disclosure link is gone: a form
whose primary field lives inside a collapsed section has no primary field.

Two consequences that are data-safety rather than layout:

- **Switching format is not lossy.** The hidden branch's numbers are preserved
  on save, never nulled. A reader who read 76 pages of the paperback before
  switching to the audiobook has not un-read them.
- **The ISBN lookup will not write a page count onto an audio edition.**
  Google's count is the print edition's, and copying it there would give an
  audiobook pages — the exact thing this release exists to prevent.

**The action buttons no longer scroll out of reach.** `.rating-modal` caps
itself at the viewport and scrolls its own content (v0.60.3); that stopped
modals growing *past* the screen but never stopped the buttons sitting below the
fold of that scroll, and this form is now always long enough that they do.
`.pu-actions` is `position: sticky` against the bottom of the surface —
inside the modal, inheriting its background, knowing nothing about where the
modal happens to be on screen.

**And every control is full width.** The form had accumulated
`.pf-input--narrow` (a fixed 120px borrowed from the reading-challenge target),
full-width text inputs and intrinsically-sized selects, so five stacked fields
had four different right edges. Nothing here benefits from being narrow — a page
count in a 120px box is not easier to read, just a ragged column. Scoped to
`.pu-form`; `.pf-input--narrow` is doing the right thing where it came from.

## 4. A failed shelf query was being cached as an empty library

Postmortem: `claude/cached-empty-shelf-2026-08-20-postmortem.md`. Caught in
development; production was running the previous bundle and never named the
column, so no reader saw it.

Adding `progress_minutes` to the `currently_reading` SELECT made the **whole
query** fail on a database without the migration — PostgREST loses the entire
result set over one unknown column. That much was a deploy-ordering mistake.
What it exposed was not.

`loadFromSupabase` did not throw. Every result is consumed as
`(res.data || [])`, so it returned a well-formed state object with
`currentlyReading: []` — indistinguishable, to its caller, from a reader who
genuinely has nothing on the go. So the caller did what it does with any
successful load:

```js
supabaseLoadedRef.current = true;   // "this is real data now"
setState(remote);                   // renders the empty shelf
saveSessionCache(user.id, remote);  // caches it for 30 minutes
saveLocal(state);                   // and writes it to localStorage
```

On the next load the session cache **hits and deliberately does not refetch
state** — by design, so a stale read cannot clobber in-memory mutations. It
re-checks only the catalog-version integer, which had not changed. **So applying
the migration changed nothing**: the database was fixed and the app was reading
a cached lie. And because `sessionStorage` survives F5 and dies only with the
tab, the reload that should have proved the fix was the one action guaranteed
not to.

The column was not the defect. **A failed query was laundered into cached
truth**, and any outage or dropped connection could have done the same.

Two fixes:

- `selectTolerant()` retries without the new column when the error names it, and
  logs `[schema] …`. A deployed bundle running against a not-yet-migrated
  database is the normal state for the minutes around a deploy, not an edge
  case. It also caught that `reader_editions` was missing `duration_minutes` and
  `narrator` from its SELECT — written by `saveReaderEdition`, never read back.
- **The four shelf queries throw on error** — `currently_reading`,
  `wishlist_items`, `read_books`, `plans`. That puts them on the path that
  already handled this correctly: the caller catches, falls back to
  localStorage, and does **not** set `supabaseLoadedRef`, so neither cache
  learns anything from a failed load.

`memories`, `accomplishments` and `reader_editions` still degrade to empty on
purpose. Losing those costs a progress bar's precision, not a reader's library.
That distinction is the rule worth keeping: **degrade the enrichment, never the
shelf.**

## 5. Known state

- **Check PostgREST's schema cache before believing a migration is applied.**
  `NOTIFY pgrst, 'reload schema';` — the dashboard does it, a direct psql or CLI
  migration may not, and the symptom is `column ... does not exist` against a
  column that plainly exists.
- **When testing a cache-related fix, close the tab.** F5 does not clear
  `sessionStorage`.
- `loadFromSupabase` returns a bare state object, so "this load is complete" is
  something the caller assumes rather than reads. The `throw` added in §4 is the
  only thing enforcing it. Returning `{ ok, state }` would be cheap
  belt-and-braces; not blocking.
- The two stat labels beside the new one (`avg per month`, `pages total`) are
  hardcoded English rather than run through `t()`. The new tile matches them
  rather than half-translating the widget. Worth closing on its own.
- `originalLanguageBackfill` resolves ~40% of what it examines and the residual
  is a genuine coverage ceiling, not a tuning problem — see
  `claude/v0.64-original-language-tuning-log.md` before reaching for it again.
  Rows it cannot answer stay NULL and are the nightly Oracle pass's job.

