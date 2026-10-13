# src/lib

Plain JavaScript modules — no React components. Grouped by what they are
about, so the folder name tells you where to look.

| Folder | Holds | Examples |
|---|---|---|
| `book/` | The book model and its rules: identity keys, editions, ISBNs, languages, purchase links | `bookHelpers` (`bookKey`, `addressKey`), `editions`, `isbn`, `workGroups` |
| `matching/` | "Is this the same title / author?" | `tokenMatch` (forgiving, live search), `titleMatch` (strict, shared with `batch-scripts/`) |
| `scoring/` | Every ranking, weight and threshold — documented in [docs/reference/MATH.md](../../docs/reference/MATH.md) | `localMatch`, `similarity`, `editionPicker`, `readingStreak` |
| `sources/` | External book data: lookup chain and its clients, imports, scanner resolution | `bookLookup`, `hardcoverService`, `googleBooksService`, `goodreadsImport` |
| `api/` | Our own backend (Supabase reads/RPCs) | `supabase`, `listsApi`, `clubsApi`, `genreService`, `seriesService`, `anthologyInsights` |
| `oracle/` | Talking to the Oracle: prompts, the Claude proxy, provenance, cached draws | `claudeApi`, `oraclePrompt`, `oracleProvenance` |
| `achievements/` | Milestones, the accomplishments ledger, reader ranks | `shareMoments`, `accomplishments`, `readerRanks` |
| `share/` | Sharing: Web Share / clipboard, share-card images | `shareService`, `shareCardImage` |
| `genres/` | How genres are displayed and which names are not genres | `genreDisplay`, `genrePlaceholders` |
| `device/` | Browser capabilities: camera scanning, PWA install, WebGL, view transitions | `barcodeScanner`, `installPrompt`, `webgl`, `coverMorph` |
| `util/` | Small generic helpers | `random`, `dates`, `selection`, `siteUrl` |

Elsewhere in `src/`: React providers in `contexts/`, hooks in `hooks/`, static
content (release notes, moods, avatars, the bundled catalog) in `data/`.

## Generator-owned files (left at this level on purpose)

`genreCards.js`, `genreDescriptions.js`, `cardGenres.js`, `cardBoxes.js` are
written by local scripts in `scripts/` (`build-genre-cards.mjs`,
`build-genre-descriptions.mjs`, `build-share-cards.mjs`), which hard-code these
paths and are not in git. Move them only together with those scripts.

## Adding a module

Pick the folder by what the module is *about*, not who calls it. A formula goes
in `scoring/` and gets a section in MATH.md. If nothing fits, ask whether it is
really one module or two.
