# Splices the v0.64 additions into batch-scripts/README.md and docs/isbndb-evaluation.md.
import sys

# ── batch-scripts/README.md ──────────────────────────────────────────────────
p = 'batch-scripts/README.md'
s = open(p, encoding='utf-8').read()

# 1. Weekly table: two new free, terminating passes.
old_row = "| 4 | `scheduled/metadataBackfill.mjs` | Descriptions and genres. Last, because it only considers books that already have a cover. |"
new_rows = old_row + """
| 5 | `scheduled/languageBackfill.mjs` | `books.language` from OpenLibrary / Google Books / the ISBN registration group. After the ISBN passes, because every one of its sources is ISBN-keyed. |
| 6 | `scheduled/originalLanguageBackfill.mjs` | `books.original_language` from Wikidata / OpenLibrary `translated_from` / the catalog's own work groups. Last, because its cheapest source is other rows that the earlier passes just filled. |"""
assert s.count(old_row) == 1, 'weekly table row not found'
s = s.replace(old_row, new_rows)

old_tail = "These four and no others."
new_tail = "These six and no others."
assert s.count(old_tail) == 1
s = s.replace(old_tail, new_tail)

# 2. A section on the two language passes, before "## Nightly curation".
lang_section = """
## The two language passes

They fill different columns and answer different questions, and confusing them
is the easiest mistake to make here:

| Script | Column | Question | Sources |
| --- | --- | --- | --- |
| `languageBackfill.mjs` | `books.language` | what language is **this row** in? | OpenLibrary, Google Books, the ISBN registration group |
| `originalLanguageBackfill.mjs` | `books.original_language` | what language was **the work** written in? | Wikidata P364, OpenLibrary `translated_from`, sibling rows of the same work |

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

`books.original_language_source` records which source spoke
(`wikidata` | `openlibrary` | `catalog_sibling` | `oracle_inferred` |
`self_stated` | `verified`). The last two are the human tier and no script
writes them; `--force` refuses to overwrite them. This mirrors
`author_gender_source`, and it exists because the column has two writers now.

**ISBNdb cannot answer `original_language`.** Its Book model has `language` —
the printing's language, which is `books.language` — and no
`original_language`, `translated_from`, `translator` or `original_title` field.
Original language is a fact about a work; ISBNdb is an edition database. See
`docs/isbndb-evaluation.md`.

"""
marker = "## Nightly curation — billable, capped"
assert s.count(marker) == 1
s = s.replace(marker, lang_section.lstrip('\n') + marker)

# 3. Probes table.
old_probe = "| `probes/debugCover.mjs` | Trace the cover lookup chain for one book and print what each source returned. |"
new_probe = old_probe + """
| `probes/originalLanguage.probe.mjs` | 55 offline assertions over `src/lib/originalLanguage.js` — author matching, placeholder rejection, ISO-code normalisation, work-group propagation, write precedence. No network, no database. Exit 1 on regression, so it is safe in CI. |
| `probes/isbndb.probe.mjs` | What ISBNdb actually returns for a given ISBN, and whether a bulk call costs one search or a hundred. |
| `probes/titleLanguage.probe.mjs` | The title-language heuristic against known-awkward titles. |
| `probes/workGroups.probe.mjs` | `collapseWorks()` against hand-built rows: originals, translations, series, and pairs that must *not* collapse. |"""
assert s.count(old_probe) == 1
s = s.replace(old_probe, new_probe)

# 4. The "new books get their gender from oracleBatch once its prompt is fixed"
#    note is now stale — oracleBatch asks for it.
old_stale = """New books get their gender from `oracleBatch.mjs` on the nightly run, once that
script's prompt is fixed to ask for it — it currently does not. Until then this
script is the only thing filling the column."""
new_stale = """New books get their gender from `oracleBatch.mjs` on the nightly run — its
prompt asks for it as of v0.64, so this script is now genuinely one-shot rather
than the only writer.

`scheduled/originalLanguageBackfill.mjs` is the same shape of one-shot for
`books.original_language`, and it is in `scheduled/` rather than here for one
reason: it costs nothing. Free and terminating is exactly what that folder
means."""
assert s.count(old_stale) == 1, 'stale author-gender note not found'
s = s.replace(old_stale, new_stale)

open(p, 'w', encoding='utf-8').write(s)
print('batch-scripts/README.md ok')

# ── docs/isbndb-evaluation.md ────────────────────────────────────────────────
p = 'docs/isbndb-evaluation.md'
s = open(p, encoding='utf-8').read()

addendum = """
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
"""

if 'Addendum, August 2026' not in s:
    s = s.rstrip() + '\n' + addendum
open(p, 'w', encoding='utf-8').write(s)
print('docs/isbndb-evaluation.md ok')
