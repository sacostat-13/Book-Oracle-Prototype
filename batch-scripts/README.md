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

## Layout

The folder a script lives in states **when it is safe to run**, not what it
does:

- **`scheduled/`** — free, unattended, safe to run on a timer. CI runs these.
- **`manual/`** — needs a human decision first. Either it spends money or it
  changes data in a way you want to look at.
- **`probes/`** — read-only diagnostics. Write no database rows.
- **`output/`** — generated results. Gitignored.

Nothing billable belongs in `scheduled/`, whatever its schedule happens to be
today. That is the whole point of the split.

## Cost

**Only two scripts spend money**, and neither is on any schedule:

| | Script | Cost |
|---|---|---|
| 💸 | `curateManualBooks.mjs` | ~4c/book — Sonnet + up to 4 web searches |
| 💸 | `oracleBatch.mjs` | Anthropic tokens per book |

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
only scripts that bill Anthropic, so neither is here — a recurring charge that
nobody approved is exactly what this layout exists to prevent.

A book with no cover never appears in The Stacks, which filters on
`cover_url IS NOT NULL`. That is why covers come before descriptions.

## Manual — run by hand

| Script | Use |
|---|---|
| `manual/curateManualBooks.mjs` 💸 | Proposes title/author corrections for manually-added rows. Writes `output/proposed-titles.csv`; applying is a separate `--apply-titles` run, so nothing changes without a second decision. |
| `manual/oracleBatch.mjs` 💸 | Bulk Oracle categorisation. |
| `manual/fixBook.mjs` | Repair a single book by id — surgical, for when one row is wrong. |
| `manual/fixBadCovers.mjs` | Remove covers that resolve to placeholders or dead URLs. |

`curateManualBooks.mjs` does appear in `catalog-maintenance.yml`, but only in a
step gated on `workflow_dispatch` with a `curate_limit` typed in by hand. It
never runs on the cron. Living in `manual/` reflects that.

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
