# Advanced Shelf Filters — v1 spec

**Target version:** v0.62
**Surfaces:** `Wishlist.jsx`, `Library.jsx` (shared implementation)
**New filters:** page count, author gender, prose complexity, thematic depth

---

## 0. The blocker: author gender is empty, and here is exactly why

`batch-scripts/manual/oracleBatch.mjs` — the script the nightly workflow
actually runs — **never mentions `author_gender`.** Not in the prompt, not in
the parser, not in the write patch. Grep it: zero hits.

`src/lib/oracleCategorizationService.js` has the full v0.55 gender rules,
`VALID_AUTHOR_GENDERS`, `sanitizeAuthorGender()` and a `writeBookEnrichment()`
that takes an `authorGender` argument. But that module stopped running in the
browser at v0.61. It is now, by its own header, "Eligibility and Reference."
The reference half drifted: `oracleBatch.mjs` says it *mirrors* the prompt, and
it mirrors the v0.22 one.

There is a second, independent gap. `fetchBooksNeedingEnrichment()` selects:

```
.or('status.in.(unreviewed,incomplete),and(status.eq.oracle_categorized,or(complexity.is.null,depth.is.null))')
```

A book that is `oracle_categorized` with complexity and depth already filled is
**structurally unreachable**, no matter what the prompt asks for. Every book the
nightly job has already processed is permanently excluded from ever getting a
gender. So even after fixing the prompt, the existing catalog stays null.

Both must be fixed, in this order, before any gender filter ships. Section 4.

**Consequence for scope:** page count, complexity and depth can ship
immediately — the data is there. Author gender ships in the same release only
if the backfill lands first, and the filter must self-hide until coverage is
real (§3.6).

---

## 1. Data inventory — what already exists

No migration. No new columns. No new queries. Every field is already on the
client objects in `state.wishlist` / `state.library`, mapped in
`DataContext.jsx :: bookRowToClient()`:

| Filter | Client field | Column | Type | Written by |
|---|---|---|---|---|
| Pages | `b.pp` | `books.pages` | int, nullable | lookup chain, Goodreads import, `curateManualBooks` AUTO tier, Google Books |
| Prose | `b.c` | `books.complexity` | 1–5, nullable | Oracle (`oracleBatch.mjs`) |
| Depth | `b.p` | `books.depth` | 1–5, nullable | Oracle (`oracleBatch.mjs`) |
| Author gender | `b.ag` | `books.author_gender` | enum, nullable | **nothing, today** |
| — | `b.agChecked` | `books.author_gender_checked_at` | timestamptz | — |

Two mapping traps to respect, both already documented in `DataContext.jsx`:

- **`b.p` is depth, `b.pp` is pages.** One character apart, adjacent in the
  return object. Name every variable in the filter code `depth` / `pages`
  explicitly and never pass `b.p` positionally.
- **`ag` collapses `'unknown'` and never-checked into `undefined`.** It cannot
  distinguish "the Oracle looked and found no signal" from "nobody asked." Only
  `agChecked` can. The filter's coverage math (§3.6) must use `agChecked`, not
  `ag`.

Scale definitions are already canon in `oracleCategorizationService.js`
(COMPLEXITY RULES / DEPTH RULES) — 1 = approachable, 5 = challenging, judged
independently of each other. The UI must not redefine them; it labels the
endpoints and links the definitions.

---

## 2. Architecture: extract, don't duplicate

`Wishlist.jsx` and `Library.jsx` currently hold **byte-identical** filter
logic — same `genreFilter`/`categoryFilter`/`search` state, same `genreOptions`
and `categoryOptions` memos, same `filtered` memo, same `resetKey`. Adding four
more filters to both by copy-paste doubles a already-duplicated block into eight
divergent branches.

Extract first. Three new files:

```
src/lib/useShelfFilters.js        state + filtering logic + persistence
src/components/ShelfFilters.jsx   the toolbar UI, basic + advanced
src/styles/components/_shelf-filters.scss
```

### 2.1 `useShelfFilters(books, { genresByBookId, getCategoriesForBook, storageKey })`

Owns all filter state, returns:

```js
{
  filtered,        // Book[] — fully filtered result
  resetKey,        // string — for usePagedList
  values,          // { search, genre, category, pages, gender, complexity, depth, includeUnrated }
  set,             // { search(v), genre(v), category(v), pages(v), … }
  options,         // { genres: [...], categories: [...] }
  available,       // { pages: bool, gender: bool, complexity: bool, depth: bool } — §3.6
  coverage,        // { pages: 0..1, gender: 0..1, complexity: 0..1, depth: 0..1 }
  activeCount,     // number of advanced filters currently narrowing
  clearAdvanced,   // () => void
}
```

`storageKey` scopes persistence: `'wishlist_filters'` vs `'library_filters'`.
Persist the same way `viewMode` already is — `try { localStorage… } catch {}`,
never assume it works.

**Do not persist `search`.** A saved query silently hiding half the shelf on
next visit is the classic version of this bug. Persist the four advanced
filters, genre, category and `includeUnrated`.

### 2.2 Filter order inside the `filtered` memo

Cheapest and most-selective first, so the expensive per-book callbacks run on
the smallest set:

1. `genre` (map lookup)
2. `pages` (scalar compare)
3. `complexity`, `depth` (scalar compare)
4. `gender` (scalar compare)
5. `category` (calls `getCategoriesForBook` — a function call per book)
6. `search` (two `toLowerCase().includes()` per book)

Everything stays client-side over the already-loaded arrays. At ~1,000 wishlist
items (the v0.44 target) this is well under a frame; do not add a Supabase
round-trip for it.

### 2.3 Migration of the two views

`Wishlist.jsx` and `Library.jsx` each lose ~55 lines (the option memos, the
`filtered` memo, `resetKey`, and the toolbar filter JSX) and gain:

```jsx
const f = useShelfFilters(wl, { genresByBookId, getCategoriesForBook, storageKey: 'wishlist_filters' });
// … <ShelfFilters state={f} context="wishlist" /> inside .lv-toolbar__group--filter
// … grouped/usePagedList consume f.filtered and f.resetKey unchanged
```

Everything downstream — `grouped`, `allGenreKeys`, `usePagedList`,
`ScrollSentinel`, `shownCount`, the two render branches — is untouched. Keep it
that way; this refactor should produce a diff that is almost entirely deletion
plus one new import.

---

## 3. The UI

### 3.1 Disclosure, not sprawl

The toolbar already carries a search field and two selects and wraps to two rows
on tablet. Four more controls inline is not viable.

Add one button at the end of `.lv-toolbar__filters`:

```
⚙ More filters          (collapsed, no filters active)
⚙ More filters · 2      (collapsed, 2 advanced filters active)
```

It toggles a panel that expands **below** the toolbar, full width, above
`CurationNotice`. The count badge is the whole point: a collapsed panel that is
silently removing 400 books is the failure mode to design against. When
`activeCount > 0` the button carries `.is-active` (the existing gold-border
treatment used by the select-mode button) and the badge is always visible.

Panel state itself is *not* persisted — open/closed is ephemeral, but it opens
automatically on mount if any persisted advanced filter is active.

### 3.2 Pages

A max, not a range. The reading-goal use case is "what can I finish this week,"
which is a ceiling; a floor is a real but much rarer want and doubles the
control's complexity. Ship the ceiling.

```
Pages          [ Any ▾ ]
```

Preset options, as a `.select` (consistent with the existing two filters, and
free on mobile where a dual-thumb slider is miserable):

| Value | Label EN | Label ES |
|---|---|---|
| `all` | — Any length — | — Cualquier extensión — |
| `200` | Under 200 pages | Menos de 200 páginas |
| `300` | Under 300 pages | Menos de 300 páginas |
| `400` | Under 400 pages | Menos de 400 páginas |
| `500` | Under 500 pages | Menos de 500 páginas |
| `501` | 500+ pages | Más de 500 páginas |

`501` is the one inverted option — it means `pp > 500`. Handle it explicitly;
do not try to express it as a max.

### 3.3 Prose and depth

Two identical controls. Both are 1–5 with the same semantics, so they get the
same widget: a five-segment chip row, multi-select.

```
Prose      [1] [2] [3] [4] [5]      approachable → challenging
Depth      [1] [2] [3] [4] [5]      approachable → challenging
```

Multi-select rather than a max, because appetite here is not monotonic — a
reader wanting "nothing too heavy tonight" picks 1–2, a reader wanting a
challenge picks 4–5. A max serves the first and not the second.

Each chip carries a `title` with the rule from
`oracleCategorizationService.js` — e.g. prose 5 = "experimental (Donoso,
Lispector)". Reuse the definitions verbatim; do not paraphrase them in the UI
layer, or the tooltip and the classifier will drift the way the prompt already
did.

Selected chips use `--ro-gold` border + `--ro-gold-text`; unselected use
`--ro-border` + `--ro-muted`. `--ro-radius-pill`. No new tokens.

### 3.4 Author gender

```
Author         [ Any ▾ ]
```

| Value | EN | ES |
|---|---|---|
| `all` | — Any author — | — Cualquier autor/a — |
| `female` | Women authors | Autoras |
| `nonbinary` | Non-binary authors | Autores no binaries |
| `mixed` | Mixed authorship | Autoría mixta |
| `male` | Men authors | Autores |

Notes, deliberate:

- **Order is not alphabetical and not enum order.** `female` first because that
  is the actual reading-goal use case — it is the one `shareMoments.js` already
  encodes (`book.ag === 'female' || book.ag === 'mixed'`).
- **`unknown` is not offered as a filter value.** It is indistinguishable from
  unenriched to the reader and would present the catalog's gaps as an attribute
  of the books. Books with `ag === undefined` are governed by §3.5.
- The label says **"Author," not "Author gender."** Filtering a shelf by the
  gender of its writers is a normal reading-goal move; framing it as a
  demographic field is not the register this app speaks in.

### 3.5 The unrated problem — the single most important decision here

`b.pp`, `b.c`, `b.p` and `b.ag` are all nullable and all sparsely populated.
A naive `b.pp <= 300` drops every book with no page count, so a reader filtering
for short books sees a shelf that is quietly missing most of it and concludes
the app is broken — or worse, doesn't notice.

**Rule: null never silently fails a filter. It fails visibly, or it passes.**

One checkbox governs all four advanced filters:

```
[ ] Include books the Oracle hasn't measured yet  (312)
```

- **Unchecked (default):** null fails the filter. The result count line gains a
  second clause: `Showing 84 of 396 books · 312 not yet measured`.
- **Checked:** null passes any advanced filter. Those books render with a
  `.lv-row__unmeasured` marker — the existing `.status` pill, text
  `unmeasured` / `sin medir`, `--ro-dim`.

The count in the checkbox label is live: how many books in the current
genre/category/search scope are missing at least one of the fields the active
advanced filters use. If no advanced filter is active, hide the checkbox
entirely.

### 3.6 Self-hiding filters

A filter over a column that is empty is worse than no filter — it renders as a
broken feature. Each advanced control is rendered only when it can do work:

```js
const COVERAGE_FLOOR = 0.10;   // 10% of the current shelf
const MIN_ABSOLUTE   = 5;      // and at least 5 books
```

`available.gender` uses **`agChecked`**, not `ag` — a shelf where the Oracle
checked 900 books and found a signal for 200 has real coverage; `ag` alone
cannot tell that from an unenriched shelf.

Coverage is computed against the *unfiltered* shelf, not the current result, so
controls don't flicker in and out as the reader narrows.

If *no* advanced filter clears the floor, the "More filters" button itself does
not render. On a fresh account with an empty wishlist, nothing appears — correct.

### 3.7 Empty state

The existing `.lv-empty` "No books match / Try clearing your filters" is a dead
end once four more filters exist. When `activeCount > 0`, replace the body with
an actionable line:

```
No books match
Your filters: under 300 pages · prose 1–2 · women authors
[ Clear advanced filters ]   ← calls clearAdvanced()
```

Naming the active filters is the fix. "Try clearing your filters" makes the
reader hunt for which one; listing them makes the culprit obvious.

---

## 4. Backfilling author gender

Two changes to `batch-scripts/manual/oracleBatch.mjs`, plus one to the
selection query. Nothing new is created — this is repairing drift.

### 4.1 Prompt and parser

Port from `oracleCategorizationService.js`, verbatim:

- The `AUTHOR GENDER RULES` block (lines ~262–275). Its strictness is the point:
  gender only from a real biographical signal, `unknown` is a normal and
  frequent answer, and — unlike complexity/depth — guessing is forbidden.
- Add `"authorGender"` to the JSON schema in the output contract
  (line ~223 of `oracleBatch.mjs`).
- Port `VALID_AUTHOR_GENDERS` and `sanitizeAuthorGender()`. Invalid → `null` →
  field is not written.

Cost impact: one short enum per book on top of five existing fields. Negligible
against the ~$0.007/book estimate; leave `NIGHTLY_LIMIT` alone.

### 4.2 The write patch

```js
if (parsed.authorGender) {
  const g = sanitizeAuthorGender(parsed.authorGender);
  if (g) {
    patch.author_gender = g;
    patch.author_gender_checked_at = new Date().toISOString();
  }
}
```

**Stamp `author_gender_checked_at` for `'unknown'` too.** This is the whole
mechanism that stops the nightly job re-billing the same shrug forever —
`getBooksNeedingOracle()` already depends on it (`if (!b.agChecked) return true`)
and will loop indefinitely without it.

### 4.3 The selection query

Widen the `.or()` so already-categorized books become reachable:

```js
.or([
  'status.in.(unreviewed,incomplete)',
  'and(status.eq.oracle_categorized,or(complexity.is.null,depth.is.null,author_gender_checked_at.is.null))',
].join(','))
```

`backfillOnly` needs **no change**. It is `book.status === 'oracle_categorized'`
(line ~438), so a row selected only for its null gender is already
backfill-only: genres, series and description are correctly left untouched
while complexity, depth and the new gender field still write. Verify this rather
than editing it — the existing condition happens to be exactly right, and
"fixing" it is the likely mistake here.

**Run it gated first.** This widening makes every `oracle_categorized` book
eligible at once. Estimate before spending:

```bash
node batch-scripts/manual/oracleBatch.mjs --dry-run --limit 100 --verbose
node batch-scripts/manual/oracleBatch.mjs --limit 100        # sample, inspect
```

Then let the nightly cron drain the rest at `NIGHTLY_LIMIT`. Do not raise the
cap to clear it in one night; the point of the cap is that nobody approved a
recurring charge, and a one-off spike is exactly what it exists to make visible.

### 4.4 `curateManualBooks.mjs`

Its AUTO tier fills `isbn, hardcover_id, pages, description, cover_url` — facts
somebody already wrote down. Gender is judgment, and adding it here would
violate the stated principle: *Claude is for judgment, not retrieval* — that
script's Claude call is a retrieval call with web search.

The correct change is smaller: it repairs identity for rows whose *title and
author were wrong*. When `--apply-titles` writes a corrected author, any
existing `author_gender` is now about a different person. Null both fields so
the nightly job re-asks:

```js
if (titleOrAuthorChanged) {
  patch.author_gender = null;
  patch.author_gender_checked_at = null;
}
```

Same reasoning already applied to `normalized_key`: a corrected author
invalidates everything derived from the old one.

Also worth doing while here: its AUTO tier already fills `pages`, which is the
same column the page filter reads. Nothing to change — just noting the page
filter's coverage improves for free every time that script runs.

---

## 5. i18n keys

`src/i18n/en.json` and `es.json`, under `wishlist.*` (shared by Library — the
existing keys already are, e.g. `wishlist.allGenres` is used in both).

| Key | EN | ES |
|---|---|---|
| `wishlist.moreFilters` | More filters | Más filtros |
| `wishlist.fewerFilters` | Fewer filters | Menos filtros |
| `wishlist.clearFilters` | Clear advanced filters | Limpiar filtros avanzados |
| `wishlist.filterPages` | Pages | Páginas |
| `wishlist.anyPages` | — Any length — | — Cualquier extensión — |
| `wishlist.pagesUnder` | Under {n} pages | Menos de {n} páginas |
| `wishlist.pagesOver` | {n}+ pages | Más de {n} páginas |
| `wishlist.filterProse` | Prose | Prosa |
| `wishlist.filterDepth` | Depth | Profundidad |
| `wishlist.scaleLow` | approachable | accesible |
| `wishlist.scaleHigh` | challenging | exigente |
| `wishlist.filterAuthor` | Author | Autoría |
| `wishlist.anyAuthor` | — Any author — | — Cualquier autor/a — |
| `wishlist.authorFemale` | Women authors | Autoras |
| `wishlist.authorMale` | Men authors | Autores |
| `wishlist.authorNonbinary` | Non-binary authors | Autores no binaries |
| `wishlist.authorMixed` | Mixed authorship | Autoría mixta |
| `wishlist.includeUnmeasured` | Include books the Oracle hasn't measured yet | Incluir libros que el Oráculo todavía no midió |
| `wishlist.unmeasured` | unmeasured | sin medir |
| `wishlist.notMeasured` | {n} not yet measured | {n} sin medir todavía |
| `wishlist.noMatchFilters` | Your filters: {list} | Tus filtros: {list} |

Rioplatense notes:

- Keep `todavía no midió` over `aún no ha medido` — the peninsular perfect is
  not used anywhere else in `es.json`.
- **`Autoras` is already the established term**: `accomplishments.femaleAuthorsLabel`
  is `"{n} libros de autoras"` and the landing copy uses `esta autora`. Match it —
  `Autoras`, not `Autoras mujeres`.
- Note the file's existing convention of using the **feminine as the generic**
  (`"Buscar título o autora…"`, `"fieldAuthor": "Autora *"`). The `filterAuthor`
  label should therefore be `Autoría` (neutral) to avoid colliding with that
  generic-feminine usage, which is why it is not `Autora`.
- **There is no existing `-es` inclusive form in `es.json`** — I checked. So
  `Autores no binaries` introduces a convention. Either commit to it or use
  `Autoría no binaria`, which fits the `Autoría` / `Autoría mixta` pattern the
  other two options already use. Recommend the latter for internal consistency;
  it is your call as the voice owner.

---

## 6. SCSS

New partial `src/styles/components/_shelf-filters.scss`, added to `main.scss`
as `@use 'components/shelf-filters';` alongside the existing component block
(note: `@use`, not `@import` — the file is fully migrated). All existing tokens — `--ro-gold`, `--ro-gold-text`, `--ro-border`,
`--ro-muted`, `--ro-dim`, `--ro-surface-2`, `--ro-radius-pill`,
`--ro-radius-md`, `--ro-space-3`, `--ro-space-4`, `--ro-font-mono`.

- Reuse `.select` for the two dropdowns — no new field styling.
- The panel: `--ro-surface-2` background, `1px solid var(--ro-border)`,
  `--ro-radius-md`, `--ro-space-4` padding, top margin `--ro-space-3`.
- Grid: `repeat(auto-fit, minmax(220px, 1fr))`, collapsing to one column at
  `@include tokens.ro-down(tablet)` — matching the existing
  `.lv-toolbar__filters` breakpoint behaviour.
- Chip rows: `--ro-radius-pill`, `--ro-font-mono`, 32px min touch target.
- **No hardcoded `rgba` parchment values.** Light mode is token-driven; a
  literal `rgba(...)` here breaks it and the standing rule.
- Panel expand: `max-height` + `opacity` transition, wrapped in
  `@media (prefers-reduced-motion: reduce) { transition: none; }`.

---

## 7. Ship order

1. `oracleBatch.mjs` — prompt, parser, write patch, selection query (§4.1–4.3)
2. `--dry-run --limit 100`, inspect, then a real `--limit 100` sample
3. Extract `useShelfFilters` + `ShelfFilters`, migrate both views, **no new
   filters yet** — verify the refactor is behaviour-neutral first
4. Pages, prose, depth filters + unrated handling (§3.2, 3.3, 3.5)
5. Gender filter — self-hiding until coverage clears the floor, so it can merge
   before the backfill finishes and lights up on its own
6. `curateManualBooks.mjs` gender invalidation (§4.4)
7. i18n EN/ES, SCSS
8. `releases.js` (bilingual) + `README.md` version line — standing requirement

Steps 3 and 4 are separable and step 3 should land as its own commit. A
behaviour-neutral extraction that quietly changes filtering is very hard to
spot afterwards.

## 8. Verification

- Refactor is neutral: same book counts for every genre/category/search combo in
  Wishlist and Library before and after step 3.
- `b.p` / `b.pp` are not transposed — a depth-3 filter must not return
  three-page books. Assert explicitly.
- A shelf with zero page counts hides the pages filter rather than returning an
  empty list.
- With `includeUnrated` unchecked, `filtered.length + notMeasuredCount` accounts
  for every excluded book — no third, silent bucket.
- `author_gender_checked_at` is stamped on `'unknown'` results; re-running
  `oracleBatch --dry-run` after a full pass reports zero eligible books, not the
  same set again.
- ES strings render without clipping in the chip row at 320px.
- Both light and dark mode.
