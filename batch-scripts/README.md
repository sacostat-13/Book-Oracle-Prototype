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
| 5 | `scheduled/languageBackfill.mjs` | `books.language` from OpenLibrary / Google Books / the ISBN registration group. After the ISBN passes, because every one of its sources is ISBN-keyed. |
| 6 | `scheduled/originalLanguageBackfill.mjs` | `books.original_language` from Wikidata / OpenLibrary `translated_from` / the catalog's own work groups. Last, because its cheapest source is other rows that the earlier passes just filled. |

These six and no others. `curateManualBooks.mjs` and `oracleBatch.mjs` are the
only scripts that bill Anthropic, so neither lives here — a recurring charge
that nobody approved is exactly what this layout exists to prevent.

## The two language passes

They fill different columns and answer different questions, and confusing them
is the easiest mistake to make here:

| Script | Column | Question | Sources |
| --- | --- | --- | --- |
| `languageBackfill.mjs` | `books.language` | what language is **this row** in? | OpenLibrary, Google Books, the ISBN registration group |
| `originalLanguageBackfill.mjs` | `books.original_language` | what language was **the work** written in? | Wikidata P407 (P364 wins where present), OpenLibrary `translated_from`, sibling rows of the same work |

*One Hundred Years of Solitude* is `language = 'en'` and
`original_language = 'es'`. Both columns are correct and they disagree, which is
the whole point of having two.

Three things worth knowing before touching either:

1. **`books.isbn` is not necessarily that row's edition.** It is chosen by
   `editionPicker.js` to make a purchase link work, and `isbnFallback --target
   foreign` exists specifically to *replace* a non-English ISBN with an English
   one. So a row titled *Aprendiz del Asesino* can legitimately carry the ISBN of
   the English *Assassin's Apprentice*. `languageBackfill` cross-examines every
   ISBN answer against the title for that reason, and writes nothing when they
   disagree — a wrongly-populated column outranks the title heuristic everywhere
   it is consulted, which is worse than a null.
2. **A title match is not an identification.** `originalLanguageBackfill`
   searches Wikidata by title and then refuses every candidate that is not
   corroborated by the author, against the author item's own labels and aliases.
   Rows whose author is null or a placeholder (`Unknown author`, `Various`, …)
   are never searched at all.
3. **Neither script guesses, and neither writes `'unknown'`.** They are free, so
   they have nothing to protect by claiming an answer. An unresolved row stays
   NULL and stays eligible — for the next run, and for `oracleBatch`, which knows
   things a bibliographic database does not.

`src/lib/originalLanguage.js` holds every rule that can be got wrong without a
network call — author matching, placeholder rejection, code normalisation,
work-group propagation, write precedence — so
`probes/originalLanguage.probe.mjs` can exercise it offline. Run the probe
before a backfill; it takes a second and needs nothing.

### When the numbers look wrong, run `--diagnose`

The first dry run of `originalLanguageBackfill` resolved **0 of 48** rows and
reported every one of them as "no answer" — a single number covering five
different outcomes. Two bugs were underneath it, and both are worth knowing
because both have precedent in this repo:

1. `getJson` returned MediaWiki's `{"error": …}` payload as if it were data.
   The API answers **HTTP 200** for a rejected parameter, so a systematically
   broken request was indistinguishable from a book Wikidata has never heard
   of. This is `gql()`'s `return json.data || null` again, in a different file.
2. The whole search was one `wbsearchentities` call in English.
   `wbsearchentities` matches labels and aliases **by prefix, in one language**.
   Against titles like *Los peligros de fumar en la cama*, *Hadriana en todos
   mis suenos* and *En la tierra somos fuzgazmente grandiosos*, it finds
   nothing — and "nothing" was reported as "no answer" rather than "never
   properly asked".

The search is now the union of three lookups: `wbsearchentities` in English,
`wbsearchentities` in the row's own language (possible only because
`books.language` is at zero nulls), and CirrusSearch full text on title +
author. Loosening the *search* does not loosen the *answer* — every candidate
still has to be corroborated by the author.

`--diagnose` never writes and splits "no answer" into the funnel:
`no-search-hits`, `no-language-property`, `author-not-corroborated`,
`no-iso-639-1-code`, `search-failed`. The funnel prints on **every** run now,
not just under `--diagnose`, because the aggregate it replaces was the
misleading one — and if more than a quarter of rows fail at the request level
the summary says so in words rather than leaving you to read it as coverage.

```bash
node batch-scripts/scheduled/originalLanguageBackfill.mjs --diagnose --limit 50
```

Reading the funnel:

| Bucket | What it means | What to do |
| --- | --- | --- |
| `search-failed` | requests are erroring | a fault. Read the API error lines above it; do not read any other number on the page as coverage |
| `no-search-hits` | searched every title form, Wikidata has no such item | mostly correct for indie, Warhammer and single-issue comics. If it is high on *ordinary* books, the catalog's titles are carrying Goodreads series annotation and the fix is in the importer |
| `no-language-property` | items found, none state P407 or P364 | a genuine Wikidata gap. Leave it to the Oracle |
| `author-not-corroborated` | items state a language, none are by this author | usually the guard working — a different book with the same title. Only a bug if you recognise the book |
| `conflict` | two corroborated candidates disagreed | look at it. The first run's two conflicts were edition items being read as works, which was a real defect |

**Two properties, and P364 is not the one.** P364 ("original language of film,
TV show, novel…") reads like the right property and is a film property in
practice — zero answers across the first fifty rows, against fourteen for P407
("language of work or name"). P364 still wins where both are present.

**An edition is not a work.** P407 on a `Q3331189` item is the language of that
*printing*, which is `books.language`. Reading it as the original language is
how *Cress* produced "en vs sv". Edition items are followed through P629 to the
work; they are never believed directly.

`books.original_language_source` records which source spoke
(`wikidata` | `wikidata_p407` | `openlibrary` | `catalog_sibling` |
`oracle_inferred` | `self_stated` | `verified`). The last two are the human tier and no script
writes them; `--force` refuses to overwrite them. This mirrors
`author_gender_source`, and it exists because the column has two writers now.

**ISBNdb cannot answer `original_language`.** Its Book model has `language` —
the printing's language, which is `books.language` — and no
`original_language`, `translated_from`, `translator` or `original_title` field.
Original language is a fact about a work; ISBNdb is an edition database. See
`docs/isbndb-evaluation.md`.

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

New books get their gender from `oracleBatch.mjs` on the nightly run — its
prompt asks for it as of v0.64, so this script is now genuinely one-shot rather
than the only writer.

`scheduled/originalLanguageBackfill.mjs` is the same shape of one-shot for
`books.original_language`, and it is in `scheduled/` rather than here for one
reason: it costs nothing. Free and terminating is exactly what that folder
means.

## Probes — read-only, write nothing to the database

| Script | Use |
|---|---|
| `probes/probeHardcoverTags.mjs` | What Hardcover actually calls a genre. `--vocab`, `--variants`, `--neighbours "Gothic"`. Run this before editing `GENRE_MAP` in `netlify/functions/catalog-crawl.mjs`. |
| `probes/debugCover.mjs` | Trace the cover lookup chain for one book and print what each source returned. |
| `probes/originalLanguage.probe.mjs` | 55 offline assertions over `src/lib/originalLanguage.js` — author matching, placeholder rejection, ISO-code normalisation, work-group propagation, write precedence. No network, no database. Exit 1 on regression, so it is safe in CI. |
| `probes/isbndb.probe.mjs` | What ISBNdb actually returns for a given ISBN, and whether a bulk call costs one search or a hundred. |
| `probes/titleLanguage.probe.mjs` | The title-language heuristic against known-awkward titles. |
| `probes/workGroups.probe.mjs` | `collapseWorks()` against hand-built rows: originals, translations, series, and pairs that must *not* collapse. |

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
