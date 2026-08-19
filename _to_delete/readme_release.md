# Update Notes — v0.63.3 → v0.64: the catalog learns what language a book is in

**Migrations required, in order:**

1. `20260817120000_author_works.sql` — `find_books_by_author` RPC
2. `20260817140000_book_language.sql` — `books.language`, `books.original_language`, `upsert_book` gains both
3. `20260818120000_reader_editions.sql` — `reader_editions` table, owner-only RLS, backfill of `currently_reading.user_page_count`
4. `20260819120000_original_language_source.sql` — `books.original_language_source`

Commit them as SQL and apply them from the repo. `SECURITY_AUDIT_v0.39.md` (H2)
is a list of tables whose RLS nobody can verify because the change was made in
the dashboard; `reader_editions` must not join it.

**Run after migrating** — free, no keys beyond the ones already in `.env.local`:

```bash
node batch-scripts/probes/originalLanguage.probe.mjs                          # 55 offline checks
node batch-scripts/scheduled/languageBackfill.mjs --dry-run
node batch-scripts/scheduled/languageBackfill.mjs
node batch-scripts/scheduled/originalLanguageBackfill.mjs --probe "Dune|Frank Herbert"
node batch-scripts/scheduled/originalLanguageBackfill.mjs --dry-run --limit 50 --verbose
node batch-scripts/scheduled/originalLanguageBackfill.mjs
```

---

This release is two conversations that turned out to be one problem.

The first was about translations: a Spanish-speaking reader tracking *Cien años
de soledad* against 417 English pages, and "More by this author" listing
*Aprendiz del Asesino*, *La Nef Du Crépuscule* and *Die Tochter des Wolfs* as
three separate Robin Hobb books. The second was about ISBNs: 971 rows the
weekly maintenance job could not resolve, and a report full of zeros that all
meant "did not run" rather than "nothing to do".

They are the same problem seen from two ends. `books` is a **work** table
carrying **edition** facts — `isbn` and `pages` — on a row whose identity
(`normalized_key`) is title plus author. That mismatch is invisible in English.
In Spanish it produces duplicate rows, split ratings, wrong page counts and
unresolvable ISBNs, and every one of those looks like its own unrelated bug
until the catalog can say which language a row is in.

It can now. `books.language` and `books.original_language` were added in
`20260817140000`; this release is the work that fills them.

## 1. Two language columns, because there are two questions

| Column | Question | Kind of fact |
| --- | --- | --- |
| `books.language` | what language is **this row** in? | edition |
| `books.original_language` | what language was **the work** written in? | work |

*Cien años de soledad* is `language = 'es'`, `original_language = 'es'`.
*One Hundred Years of Solitude* is `language = 'en'`,
`original_language = 'es'`. That second row is why the pair exists: without
`original_language` there is no way to tell an original from a translation, and
"show the reader the original" has nothing to consult.

`upsert_book` writes `language` from lookup metadata for every new row.
Neither column has a CHECK constraint listing valid codes — there are ~184
living two-letter subtags, the list changes, and a constraint that rejects a
real language fails an upsert of a real book. The client normalises to the
BCP-47 primary subtag; the column records.

## 2. Filling `language`: zero nulls, and why that took three scripts

`languageBackfill.mjs` fills the column for rows that predate the migration,
from OpenLibrary, Google Books, and — for the printings no API has indexed —
the ISBN registration group, which is offline and free and answers for
9788419680877 (*Aprendiz de asesino*, Nocturna Ediciones) when neither API
does.

It could only work once the rows had ISBNs, which is what the ISBN work was
for. That work is written up in full in
`claude/catalog-maintenance-2026-08-17-postmortem.md`; the short version is six
bugs, of which two were structural:

- **Hardcover failures were invisible.** `gql()` reported non-2xx responses and
  GraphQL `errors` through `vlog()` — silent without `--verbose` — and
  `return json.data || null` made an errored response indistinguishable from an
  empty one at every call site. A transient outage produced a 971-row worklist
  asserting Hardcover has no edition of *Dune*, and a GitHub issue recommending
  ~$39 of curation on books that were never missing. Transport and GraphQL
  failures are now logged unconditionally; 10 consecutive failures aborts, and
  401/403 aborts immediately.
- **A cancelled step reported as complete.** `fallback.log` stopped mid-entry at
  `[187/971]`. Per-book writes survived; the summary and worklist CSV, built
  after the final loop, did not. The workflow counted rows in a file that did
  not exist and printed `Still unresolved after OL/Google: 0`. Outputs now flush
  on completion, error and SIGINT/SIGTERM, the summary reads machine-readable
  counters lines rather than CSV row counts, and a missing line renders
  `— (did not finish)` instead of `0`.

Also fixed: Google Books was hard-gated to `langRestrict=en` against the file's
own stated policy, so "no English edition exists" was unreachable through it;
`Unknown author` was being matched as if it were an author, poisoning the query
and rejecting *Winnie-the-Pooh*, *Don Quixote* and *The Fellowship of the Ring*;
search `per_page` was 10 where "Dune Frank Herbert" returns 70; the 429 handler
never passed `attempt` through, so against an exhausted daily quota it retried
forever; and `normTitle` stripped `&` rather than expanding it, so
*Rock Bottom & Nowhere* and *Rock Bottom and Nowhere* diverged mid-word.

**ISBNdb** was added to `isbnFallback.mjs` as a source, queried first when
`ISBNDB_API_KEY` is set. The ordering is deliberate and was initially got wrong:
money was not the scarce resource. 5,000/day against a residual in the low
hundreds makes ISBNdb abundant and Google's ~1,000/day scarce, so putting the
paid source last meant paying the free one's backoff first.

Result: `select count(*) from books where isbn is null` and
`select count(*) from books where language is null` both return **0**.

## 3. Filling `original_language` — the piece this release adds

`original_language` was the last null column of that work, and it was null for a
structural reason. `20260817140000` named exactly one writer for it: the nightly
Oracle categorisation pass. That pass does not revisit books it has already
categorised, so every row predating v0.64 was permanently outside the reach of
the only thing allowed to fill it. `author_gender` hit this identical wall in
v0.62.

`batch-scripts/scheduled/originalLanguageBackfill.mjs` is the answer, and it is
free. Three sources, in descending order of authority:

1. **Wikidata P364** ("original language of film, TV show, novel, musical work
   or web series"), via the MediaWiki action API. No key, no account, CC0 data —
   so nothing written from here carries a deletion obligation.
2. **OpenLibrary `translated_from`** on the edition record. Present only where a
   librarian filled it in, so coverage is low; where it is there it is the most
   direct possible answer.
3. **Propagation across the catalog's own work groups.** If two rows share a
   `hardcover_id`, a `goodreads_id` or an ISBN and one has an answer, the other
   has the same answer. No requests, and it is the source that scales — every
   Wikidata hit pulls its translations along with it.

### A title match is not an identification

Searching Wikidata for "Dune" returns the novel, the films, the video games, a
desert and a surname. The rule the script is built around is that **no candidate
answers until it has been verified against the author** — and verified against
the author item's own labels and aliases, not against a description string:

| Candidate | Outcome |
| --- | --- |
| has P364, and a P50 author's label or alias matches the row's author | accept |
| has P364, no author corroboration | discard |
| two accepted candidates that disagree | conflict — write nothing, report it |
| row's author is null or a placeholder | never searched at all |

The last line is the postmortem's §4 taken literally. 31 rows store the literal
string `Unknown author`; a row with no author cannot have a title match
verified, so it is skipped rather than searched and hoped over.

`authorLikelySame()` is the whole guard, so it is deliberately asymmetric:
surnames must match and given-name evidence must not *contradict*. An initial
agreeing with a first letter is agreement, because the catalog holds both
"G. García Márquez" and "Gabriel García Márquez" — and diacritics come off both
sides, because it also holds "Gabriel Garcia Marquez" from a Goodreads CSV. Two
different full given names on a shared surname is a rejection: Stephen King and
Owen King are not the same person, and if that ever stops being true every King
in the catalog inherits the wrong answer.

### What it will not do

- **Guess.** Not from the author's nationality, not from `books.language`, not
  from the shape of the title. *Los peligros de fumar en la cama* is
  Spanish-original and *Lágrimas en H Mart* is not, and nothing about either
  title says which.
- **Write `'unknown'`.** `oracleBatch.mjs` stores it deliberately, as a resolved
  answer that stops a book being re-billed. This script has no per-book cost, so
  it has nothing to protect by claiming an answer it does not have. Unresolved
  rows stay NULL and stay eligible — for the next run, and for the Oracle, which
  knows things Wikidata does not.
- **Overwrite.** Write-once, matching `oracleBatch`'s guard: the language García
  Márquez wrote in does not change, so a second and different answer means one
  of the two is wrong, and the older one has at least had a chance to be
  corrected by hand. `--all` re-checks and reports; `--force` applies; neither
  reaches a value whose source is `self_stated` or `verified`.

### ISBNdb cannot answer this, and that is not a coverage gap

We now pay for ISBNdb, so the question will be asked again. Its Book model is
`title`, `title_long`, `isbn`, `isbn13`, `isbn10`, `binding`, `publisher`,
`language`, `date_published`, `edition`, `pages`, `dimensions`, `overview`,
`image`, `msrp`, `excerpt`, `synopsis`, `authors[]`, `subjects[]`, `reviews[]`,
`prices[]`, `related[]`, `other_isbns` — re-checked against the v2 OpenAPI spec
at `api2.isbndb.com/doc.json` in August 2026.

`language` is there. `language` is the **printing's** language, which is
`books.language`, which is already at zero nulls. There is no
`original_language`, no `translated_from`, no `translator`, no `original_title`.
This is not an oversight: original language is a fact about a *work*, and ISBNdb
is an *edition* database. `docs/isbndb-evaluation.md` reached the same
conclusion from the published docs and the finding still holds.

### Provenance

`20260819120000` adds `books.original_language_source`, mirroring
`author_gender_source` and for the same reason: the column now has more than one
writer, so "who said this?" has to be answerable. Values are `wikidata`,
`openlibrary`, `catalog_sibling`, `oracle_inferred`, `self_stated`, `verified`.
The last two are the human tier, are never written by a script, and are what
`--force` refuses to overwrite. `oracleBatch.mjs` now stamps `oracle_inferred`
alongside every value it writes, and the migration retro-stamps the existing
rows, which are all its work by definition.

There is a second reason to want this in place. ISBNdb's terms require deleting
cached data if the subscription lapses — an obligation only satisfiable if the
catalog records which values came from where. No ISBNdb value can reach this
column, but the next paid source should find the shape already built.

## 4. `reader_editions` — the edition belongs to the reader

Spec: `docs/reader-editions-v1-spec.md`. One work in the catalog; the edition is
a fact about *this reader and this work*.

`currently_reading.user_page_count` was the right idea in the wrong place: it
lives on the currently-reading row, so a reader tells us their copy is 512 pages,
finishes the book, and the app forgets. `reader_editions` is one row per
(reader, work), independent of which shelf the book is on, carrying `language`,
`isbn`, `edition_title`, `translator`, `page_count` and `format`. The migration
backfills from `user_page_count`; the old column stays for one release so a
stale client does not break.

In the progress modal, the "edition pages" link became **"Which edition are you
reading?"** — language, format, page count, and an ISBN field that runs the
lookup already in the app and fills in the rest. Type thirteen digits, get the
language, page count and translated title. An audiobook (`format = 'audio'`)
shows no progress bar rather than a bar stuck at 0%.

`effectivePages(book, edition)` in `src/lib/editions.js` is the one rule, used
everywhere a page number is shown or divided by — with one deliberate exception:
`computeSimilar` still uses `book.pp`. Similarity is a fact about the work, and
using edition pages there would make one reader's recommendations differ from
another's for no reason a reader could name.

**Owner-only RLS, no public read.** `SECURITY_AUDIT_v0.39.md` (C3) is about a
table made world-readable to support one small feature; `reader_editions` has no
cross-user use case in v1, so it gets none.

## 5. Where the language columns are actually read

`src/lib/workGroups.js` collapses rows that are provably the same work — shared
`hardcover_id`, ISBN, `goodreads_id`, or series position — so a novel and its
translations appear once. It then has to choose which row to show, and that
choice is what `original_language` is for.

**"More about the author" now stays in the original language.** The section
lists an author's works, and a list that mixes *Assassin's Apprentice*,
*Aprendiz del Asesino* and *Die Tochter des Wolfs* is not a bibliography — it is
the same book three times. `find_books_by_author` (`20260817120000`) answers
from our own catalog first, because a catalog hit resolves to a real page with a
validated cover; Google Books `inauthor:` tops it up only when the catalog
answer is thin, so a mid-list or non-Anglophone author does not get "More by
this author: (nothing)".

`src/lib/titleLanguage.js` — the heuristic that guesses language from function
words in the title — is the stopgap this release retires. It is deliberately
weak (*Die Tochter des Wolfs* guesses French, because "des" is both), and every
row the backfills fill is a row it never sees again. It survives in one place
only: as a *guard* in `languageBackfill.mjs`, where it can veto a suspicious
answer but never supply one.

## 6. Verification

1. `node batch-scripts/probes/originalLanguage.probe.mjs` — 55 offline checks
   over author matching, placeholder rejection, language-code normalisation,
   work-group propagation and write precedence. No network, no database; safe in
   CI and safe before a backfill.
2. `--probe "Title|Author"` on the backfill runs the **real** resolver against
   inputs from the command line, printing every candidate and why it was
   accepted or discarded. The postmortem's second wrong turn was a diagnostic
   that hardcoded its inputs and came back clean while the job was broken; this
   one cannot.
3. `select count(*) from books where isbn is null` → 0.
   `select count(*) from books where language is null` → 0.
   `select original_language_source, count(*) from books where original_language is not null group by 1;`
   after the run.
4. `select count(*) from books where original_language_source is not null and original_language is null;`
   → must be 0. A source with no value is a bug in whatever wrote it.
5. Owner isolation on `reader_editions`: as user A, `select *` returns only A's
   rows; as anon, zero. Run it — audit H2 is a list of tables where this was
   assumed.
6. A reader records a 496-page Spanish edition of a 417-page work, finishes it,
   and reopens the book page: the edition line still reads 496. This is the exact
   case `user_page_count` fails today.

## 7. Known state

- `.github/workflows/catalog-maintenance.yml` — per-step `timeout-minutes`
  (40/55/30/35/10) inside a 300-minute job, downstream steps `if: ${{ !cancelled() }}`,
  and a summary that reads counters lines. **Workflow files cannot be written
  remotely and must be applied by hand.** `originalLanguageBackfill.mjs` is free
  and terminates, so it belongs in the weekly job after `isbnFallback`; it emits
  an `[originalLanguageBackfill] …` counters line in the same format.
- `ISBNDB_API_KEY` needs adding to repo secrets **and** to the "Compose
  .env.local from secrets" step. Missing it fails silently — the script just
  skips the source.
- The residual unresolved ISBNs are mostly things no source can fix: single-issue
  comics and Free Comic Book Day issues (no ISBN exists), short stories, and
  titles stored wrongly — *Crushed*, *Generation Why* and *No Normal* are Ms.
  Marvel collections filed under their subtitles alone. Those need correcting
  in-app, not a better lookup.
- Rows `originalLanguageBackfill` cannot resolve stay NULL by design, and the
  nightly Oracle pass will fill them for books it categorises from here on.
  There is no third pass planned and none needed.

