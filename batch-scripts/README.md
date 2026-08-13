# batch-scripts

Node scripts that maintain the shared `books` catalog. They run against Supabase
with the **service role key**, outside RLS, so every one of them can rewrite
rows for every user. Read the relevant section before running anything.

All of them:

- read credentials from `.env.local` at the repo root (never from arguments)
- take `--dry-run` and `--limit N`, and most take `--verbose`
- are safe to re-run; they fill NULLs rather than overwrite good data

Run from the repo root, not from this folder:

```bash
node batch-scripts/scheduled/metadataBackfill.mjs --dry-run --limit 20 --verbose
```

## Never call `createClient()` directly

Import the client from the shared module instead:

```js
import { createServiceClient } from '../_shared/supabaseClient.mjs';
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
```

`createClient()` builds a `RealtimeClient` unconditionally, and realtime-js
requires a global `WebSocket`. Node 22 has one; Node 20 does not. None of these
scripts open a realtime channel, but the constructor throws before any of that —
at import time, so the script dies having done nothing:

```
Error: Node.js 20 detected without native WebSocket support.
  at WebSocketFactory.getWebSocketConstructor (@supabase/realtime-js/...)
```

This crash was hit and fixed **four separate times, four different ways** — in
`send-notification-email.js`, `catalog-crawl.mjs`, `sitemap.js` and
`seedCuratedCatalog.mjs` — before anyone put the fix somewhere reusable. The
batch scripts were the fifth site, and they took down the nightly curation run.
`_shared/supabaseClient.mjs` is that one place now.

It detects the capability rather than the Node version, so it needs no changes
when the runtime moves. **Bumping `node-version` in the workflows is not the
fix** — it would hide this in CI while leaving anyone on Node 20 locally with
the same opaque startup crash.

## Layout

The folder a script lives in states **when it is safe to run**, not what it
does:

- **`scheduled/`** — free, unattended, safe to run on a timer. CI runs these.
- **`manual/`** — needs a human decision first. Either it spends money or it
  changes data in a way you want to look at.
- **`probes/`** — read-only diagnostics. Write no database rows.
- **`output/`** — generated results. Gitignored.
- **`_shared/`** — code imported by the scripts. Not runnable; nothing here
  touches the network or the database on its own.

## Genres

`_shared/genreRules.mjs` is the one keyword table mapping source subjects onto
the canonical taxonomy. Both `scheduled/metadataBackfill.mjs` and
`manual/regenreCatalog.mjs` import it — two copies of one rule set is a bug that
takes months to surface.

Three things worth knowing before touching genre code:

1. **The column is `assigned_by_source`, not `source`.** `oracleBatch` named it
   wrong and PostgREST rejected every insert. Nothing checked the result, so not
   one genre link was written for months while books were still being stamped
   `oracle_categorized`. Always destructure `{ error }` from a `book_genres`
   write.
2. **Umbrellas come from `public.genres.parent_id`**, never from a map in JS. A
   book gets the specific genre AND its parent, so the reader browsing "Horror"
   and the reader browsing "Folk Horror" both find it.
3. **Subjects are cached** on `books.source_subjects`. Edit the rules and re-run
   `regenreCatalog --apply` — offline, seconds, no network. Only ever
   `--fetch` for books that have never been looked up.

Typical loop:

```bash
node batch-scripts/manual/regenreCatalog.mjs --report            # size the job
node batch-scripts/manual/regenreCatalog.mjs --fetch             # once per book, slow
node batch-scripts/manual/regenreCatalog.mjs --apply --dry-run --verbose
node batch-scripts/manual/regenreCatalog.mjs --apply
```

Nothing billable belongs in `scheduled/`, whatever its schedule happens to be
today. That is the whole point of the split — and it is why `oracleBatch.mjs`
stays in `manual/` even though a workflow now runs it nightly. The folder
answers "is this safe to run unattended and free?", which for that script is
still no. A workflow that spends money has to say so in its own header; the
folder layout must not be the thing that quietly stops saying it.

## Cost

**Only two scripts spend money.** As of v0.61 one of them is on a schedule —
see "Nightly curation" below. That is a deliberate, bounded exception, not a
softening of the rule:

| | Script | Cost |
|---|---|---|
| 💸 | `curateManualBooks.mjs` | ~4c/book — Sonnet + up to 4 web searches |
| 💸 | `oracleBatch.mjs` | Anthropic tokens per book |
| 💸 | `authorGenderBackfill.mjs` | ~$0.40 per 1,000 distinct authors — one-shot |

Everything else uses free APIs: Hardcover, Open Library, Google Books, Penguin
Random House's cover CDN.

`coverBackfill.mjs` is the exception that needs care — it has a Claude
last-resort step, so the scheduled job pins `--no-claude`. Run it without that
flag only when you mean to pay.

The principle, worth keeping: **Claude is for judgment, not retrieval.** A
description or a cover is a fact somebody already wrote down and three APIs will
hand it over for nothing. Recommendations, reading plans and memory synthesis
are judgment. That is where the budget belongs — and it is why
`metadataBackfill.mjs` exists rather than pointing `oracleBatch` at 682 missing
descriptions.

## Scheduled — run weekly by CI

`.github/workflows/catalog-maintenance.yml`, Mondays 06:00 UTC. All free. Order
matters and is not arbitrary.

| # | Script | What it does |
|---|---|---|
| 1 | `scheduled/isbnBackfill.mjs` | ISBNs from Hardcover. First, because it teaches the catalog `hardcover_id`s that make every later pass cheaper. |
| 2 | `scheduled/isbnFallback.mjs` | ISBNs from Open Library / Google Books for what Hardcover couldn't answer. |
| 3 | `scheduled/coverBackfill.mjs` | Covers, pinned to `--no-claude`. After the ISBN passes — half its lookup chain is ISBN-keyed, so every ISBN resolved above becomes a cover. |
| 4 | `scheduled/metadataBackfill.mjs` | Descriptions and genres. Last, because it only considers books that already have a cover. |

These four and no others. `curateManualBooks.mjs` and `oracleBatch.mjs` are the
only scripts that bill Anthropic, so neither lives here — a recurring charge
that nobody approved is exactly what this layout exists to prevent.

## Nightly curation — billable, capped

`.github/workflows/nightly-curation.yml`, 07:00 UTC daily. Added in v0.61, when
the in-app "Let the Oracle categorize my books" button was removed from Wishlist
and Library.

That button billed a *reader's* Oracle quota to enrich the shared `books` table
— the wrong party to charge, since the genres and series it wrote benefit
everyone who ever sees the title. Readers' five calls a month now go entirely to
suggestions, plans and asking. The work itself still has to happen, so it moved
to a cron under the service role key.

| # | Script | Cost |
|---|---|---|
| 1 | `scheduled/metadataBackfill.mjs --limit 200` | free |
| 2 | `manual/oracleBatch.mjs --limit 40` 💸 | ~$0.007/book → ~$0.28/night |

Order is the same principle as the weekly job, for two reasons rather than one:
every description the free pass resolves is a book Claude is never asked about,
*and* the descriptions it writes go into the prompt as the best available
evidence for complexity and depth.

The cap is the control. A permanently full queue costs about $8.50/month; in
practice the queue drains and most nights cost cents. Raise `NIGHTLY_LIMIT` in
the workflow to clear a backlog faster, and watch the run summary — it prints
the estimate before spending anything. `workflow_dispatch` also takes a
`dry_run` input that estimates without calling the API.

A book with no cover never appears in The Stacks, which filters on
`cover_url IS NOT NULL`. That is why covers come before descriptions.

## Manual — run by hand

| Script | Use |
|---|---|
| `manual/curateManualBooks.mjs` 💸 | Proposes title/author corrections for manually-added rows. Writes `output/proposed-titles.csv`; applying is a separate `--apply-titles` run, so nothing changes without a second decision. |
| `manual/oracleBatch.mjs` 💸 | Bulk Oracle categorisation — genres, series, complexity, depth, author gender. Also invoked nightly by `nightly-curation.yml` at a capped limit; run it by hand only to clear a backlog faster than the cron will. |
| `manual/authorGenderBackfill.mjs` 💸 | One-shot backfill of `books.author_gender`, keyed on **author** rather than book. Batched Sonnet, no web search. Only touches rows where `author_gender_checked_at IS NULL`, so it is safe to re-run and drains to zero. Writes `output/author-gender.csv`. |
| `manual/fixBook.mjs` | Repair a single book by id — surgical, for when one row is wrong. |
| `manual/fixBadCovers.mjs` | Remove covers that resolve to placeholders or dead URLs. |

`curateManualBooks.mjs` does appear in `catalog-maintenance.yml`, but only in a
step gated on `workflow_dispatch` with a `curate_limit` typed in by hand. It
never runs on the cron. Living in `manual/` reflects that.

`authorGenderBackfill.mjs` is a one-shot, and stays out of every workflow. Two
reasons worth stating, because the second is easy to lose:

- **It has an end.** It only selects `author_gender_checked_at IS NULL`, and it
  stamps that column even when the answer is `"unknown"` — so each run strictly
  shrinks the queue and a second full run costs nothing. Work that terminates
  does not belong on a timer.
- **It is retrieval, which usually means Claude is the wrong tool** — but no
  free API exposes author gender, so the "three APIs will hand it over for
  nothing" escape hatch that justifies `metadataBackfill.mjs` doesn't exist
  here. Hence the deliberately cheap shape: grouped by author so each person is
  asked about once, batched 50 to a call, and no web search. `unknown` is an
  accepted answer rather than something to spend more money chasing.

New books get their gender from `oracleBatch.mjs` on the nightly run, once that
script's prompt is fixed to ask for it — it currently does not. Until then this
script is the only thing filling the column.

## Probes — read-only, write nothing to the database

| Script | Use |
|---|---|
| `probes/probeHardcoverTags.mjs` | What Hardcover actually calls a genre. `--vocab`, `--variants`, `--neighbours "Gothic"`. Run this before editing `GENRE_MAP` in `netlify/functions/catalog-crawl.mjs`. |
| `probes/debugCover.mjs` | Trace the cover lookup chain for one book and print what each source returned. |

Hardcover's genre tags are a **folksonomy, not a taxonomy** — the same shelf
appears as `Science Fiction`, `Sci-fi`, `Scifi` and `science-fiction`, and
`cozy fantasy` exists in lowercase where `Cozy Fantasy` returns nothing at all.
Matching is exact-string, so casing is not cosmetic. Probe before you guess.

## output/

Generated CSVs, gitignored. Safe to delete; every one is reproducible by
re-running its script. Nothing here should ever be edited by hand.

| File | Written by |
|---|---|
| `isbn-unresolved.csv` | `isbnBackfill.mjs` |
| `isbn-still-unresolved.csv` | `isbnFallback.mjs` |
| `proposed-titles.csv` | `curateManualBooks.mjs` — **review before applying** |
| `author-gender.csv` | `authorGenderBackfill.mjs` — already applied; for spot-checking |
| `genre-unmatched.csv` | `metadataBackfill.mjs` — books whose subjects matched no rule |
| `hardcover-tag-*.csv`, `hardcover-neighbours-*.csv` | `probeHardcoverTags.mjs` |

`genre-unmatched.csv` is the one to read before considering any Claude spend on
genres: a theme recurring there is a one-line addition to `GENRE_RULES` in
`metadataBackfill.mjs`, not a billable run.

## A note on version control

This folder used to be ignored wholesale in the root `.gitignore`, which meant
the weekly workflow could never have worked in CI — it runs
`node batch-scripts/isbnBackfill.mjs` against a checkout that had no such file.
The scripts are tracked now; `output/` is ignored via `batch-scripts/.gitignore`.

If you add a script that writes results, write them to `output/` so they stay
out of git by default.

Scripts sit one level deep now, so paths relative to `__dirname` need two hops,
not one:

```js
readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');  // repo root
writeFileSync(join(__dirname, '..', 'output', 'thing.csv'), csv); // batch-scripts/output
```

Getting this wrong fails at startup with a confusing `ENOENT` on `.env.local`
rather than anything about the move.
