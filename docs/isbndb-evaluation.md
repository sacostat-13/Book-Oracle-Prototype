# ISBNdb — evaluation for the metadata chain

*"Are you sure ISBNdb wouldn't be a better option for isbnBackfill? Could we fit
it in and remove the need to use Claude?"*

Verified against [the v2 docs](https://isbndb.com/isbndb-api-documentation-v2),
[the FAQ](https://isbndb.com/faq) and [the pricing page](https://isbndb.com/isbn-database),
August 2026. Everything marked **unverified** needs a key to settle, which is
what `batch-scripts/probes/isbndb.probe.mjs` is for.

## The API

```
POST https://api2.isbndb.com/books
Authorization: YOUR_REST_KEY          ← raw key, NOT "Bearer …"
Content-Type: application/json

{"isbns": ["9788419680877", "9780060883287", …]}
```

Query-parameter keys are explicitly rejected. Single lookups are
`GET /book/{isbn}`. There is an OpenAPI spec at `https://api2.isbndb.com/doc.json`.

| Tier | Price/mo | Searches/day | Calls/sec | Bulk |
| --- | --- | --- | --- | --- |
| Basic | $14.99 | 5,000 | 1 | 100 results/call |
| Premium | $35.99 | 15,000 | 3 | 1,000 results/call |
| Pro | $99.99 | 50,000 | 5 | 1,000 results/call |
| **Academic / Non-Profit** | **$7.50** | 2,000 | — | 10 results/call |

Basic covers the whole catalog in one day at 3,428 rows. **Unverified:** whether
a 100-ISBN bulk call costs 1 search or 100 — that is the difference between
35 calls and 3,428, and the docs do not say.

## Response fields

From the published client model: `title`, `title_long`, `isbn`, `isbn13`,
`dewey_decimal`, `binding`, `publisher`, `date_published`, `edition`, `pages`,
`dimensions`, `overview`, `synopsis`, `excerpt`, `image`, `msrp`, `authors[]`,
`subjects[]`, `reviews[]`, `prices[]`, `related[]`.

**`language` is not in that model.** Third-party client code reads a `language`
field, so it is probably present and merely undocumented — but "probably" is not
good enough for the one field we would be buying it for. **This is the single
question the trial has to answer first.**

## Could it replace Claude?

No — and it is worth being precise about why, because the overlap looks larger
than it is. `oracleBatch.mjs` asks Claude for seven things:

| Field | ISBNdb can supply? |
| --- | --- |
| `description` | **Yes** — `synopsis` / `overview` |
| genres (curated taxonomy) | **Partly** — `subjects[]` needs mapping |
| `series` name / position / total | No |
| `complexity` 1–5 | No |
| `depth` 1–5 | No |
| `author_gender` | No |
| `original_language` | No |

The bottom four are the reason the nightly job exists. Complexity and depth are
readings of the prose; author gender comes from a biographical signal; original
language is a fact about the work, not the printing. No bibliographic database
has these, because they are not bibliographic facts. **Claude stays.**

And the two it can supply, we already get for free:

- **Descriptions** are filled by `metadataBackfill.mjs` from Hardcover /
  OpenLibrary / Google Books. `oracleBatch.mjs`'s own comments record that it
  deliberately does *not* overwrite them — a publisher blurb beats a generated
  one, and that was settled in v0.60.1.
- **Subjects → genres** already has a non-LLM path in this repo:
  `batch-scripts/_shared/genreRules.mjs` (`inferAllGenres`), fed by subjects
  cached via the `cache_source_subjects` migration. Another subject source would
  widen its input, not replace the pipeline.

So the realistic gain is *more subject coverage for a mapper we already own*.
That is real, and it is not "removing the need to use Claude".

## For isbnBackfill specifically

The 32% of rows with no ISBN is the genuine gap, and ISBNdb's search endpoint
could close some of it. But `isbnFallback.mjs --target unresolved` already does
exactly this job against OpenLibrary and Google Books, and **it has not been run
yet**. Measuring the free path before paying for a second one costs nothing.

For rows that *do* have an ISBN, our own dry run answered this:
`no answer: 0`. Every ISBN resolved. There is no coverage gap to buy.

## The term that actually decides it

From the FAQ:

> you can download and store or cache the data locally with a current
> subscription … **data must be deleted if your subscription expires or is
> cancelled.**

This is the important finding, and it kills the plan I suggested earlier of
using the 7-day trial for a one-off backfill and cancelling. Writing
ISBNdb-derived values into `books.language`, `books.description` or
`book_genres` means that on cancellation you are obliged to delete them —
from a catalog that is *yours*, mixed in with values from four other sources,
with no column recording which is which.

You would need provenance tracking per field before this data could safely enter
the catalog at all. `books.author_gender_source` exists for exactly this reason
and covers exactly one column.

## Recommendation

**Don't subscribe.** Not on price — on entanglement. A paid dependency whose
terms require deleting data from your own catalog is a poor trade for
"marginally better subject coverage", when the measured coverage gap for
language is zero.

If you want to revisit it, in this order:

1. Run `isbnFallback.mjs --target unresolved --dry-run`. It may close much of
   the 32% for free, and it is already written.
2. If a gap remains, take the **Academic/Non-Profit tier at $7.50** —
   `simont@mozillafoundation.org` plausibly qualifies, and 2,000/day still
   covers the catalog in two days.
3. Before writing a single ISBNdb value into `books`, add per-field provenance
   so the deletion obligation is actually satisfiable.
4. Use the trial to answer the two unverified questions above
   (`batch-scripts/probes/isbndb.probe.mjs`) rather than to run a backfill.

## Sources

- https://isbndb.com/isbndb-api-documentation-v2
- https://isbndb.com/faq
- https://isbndb.com/isbn-database
- https://pub.dev/documentation/isbndb/latest/

---

## Addendum, August 2026 — settled, after subscribing

The subscription happened, `isbnFallback.mjs` queries ISBNdb first when
`ISBNDB_API_KEY` is set, and the two questions this document left open are now
answered. Recording them here so the evaluation is not read as still-pending.

**`language` is real.** It is in the v2 OpenAPI spec at
`api2.isbndb.com/doc.json` — `"Language of the book (ISO 639-1 code or full
name)"` — not merely inferred from third-party client code. The full Book model
is `title`, `title_long`, `isbn`, `isbn13`, `isbn10`, `binding`, `publisher`,
`language`, `date_published`, `edition`, `pages`, `dimensions`,
`dimensions_structured`, `overview`, `image`, `image_original`, `msrp`,
`excerpt`, `synopsis`, `authors[]`, `subjects[]`, `reviews[]`, `prices[]`,
`related[]`, `other_isbns`.

**`original_language` is not, and cannot be.** There is no
`original_language`, no `translated_from`, no `translator` and no
`original_title` field anywhere in the schema. The table above marked this "No"
from the published docs; the OpenAPI spec confirms it. It is not an oversight:
`language` is the language of the **printing**, and original language is a fact
about the **work**. An edition database has no place to put it.

That distinction is now in the schema too — `books.language` versus
`books.original_language`, migration `20260817140000` — so the gap is precise
rather than rhetorical. `books.language` is at **zero nulls** and ISBNdb could
have helped fill it; it was already full without paying. `books.original_language`
is what `batch-scripts/scheduled/originalLanguageBackfill.mjs` fills, from
Wikidata P364 and OpenLibrary `translated_from`, both free.

**The entanglement finding still stands and now has a mechanism.** ISBNdb's
terms require deleting cached data if the subscription lapses, which is only
satisfiable if the catalog records which values came from where. Migration
`20260819120000` adds `books.original_language_source`, joining
`books.author_gender_source`. That is two columns out of many with provenance —
enough for the two columns a script writes, not enough to make an ISBNdb-derived
`description` or `book_genres` row safely deletable. **Recommendation 3 of this
document is still open**: before any ISBNdb value is written into a column other
than `isbn`, that column needs a `_source` of its own.
