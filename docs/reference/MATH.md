# The maths

Every place The Books Oracle ranks, weights, scores, thresholds or randomises
something — what it computes, the exact numbers, where the code lives, and what
to watch out for when changing it.

**Read this before changing any number in a scoring function.** Most weights
are relative to each other: changing one in isolation usually changes which
signal wins, not just by how much.

> Written 2026-10-12 from the code at that date (code-health spike, item M1).
> When you change a formula, change its section here in the same commit.
>
> **Tested = yes** means `tests/scoring.test.js` (or the test named in the
> section) pins the numbers in an example table. Those tables are what you
> update when you change a weight on purpose.

## Contents

| # | Topic | Code | Tested |
|---|---|---|---|
| 1 | [Book address key](#1-book-address-key) | `src/lib/book/bookHelpers.js` · SQL `client_title_key` | **yes** |
| 2 | [Taste profile](#2-taste-profile) | `src/lib/scoring/tasteProfile.js` | **yes** |
| 3 | [Local Match %](#3-local-match-) | `src/lib/scoring/localMatch.js` | **yes** |
| 4 | [Oracle (LLM) Match %](#4-oracle-llm-match-) | `src/lib/oracle/tastePrompt.js` | n/a |
| 5 | [Reading-level nudge](#5-reading-level-nudge) | `src/lib/scoring/levelNudge.js` | **yes** |
| 6 | [Similar books (Book page)](#6-similar-books-book-page) | `src/lib/scoring/similarity.js` | **yes** |
| 7 | [Similar to your picks (fallback)](#7-similar-to-your-picks-fallback) | `src/lib/scoring/similarity.js` | **yes** |
| 8 | [Oracle draw from wishlist / Vault](#8-oracle-draw-from-wishlist--vault) | `src/views/OracleCategories.jsx` · `src/lib/scoring/drawWeight.js` · `src/lib/util/random.js` | **yes** |
| 9 | [Level Passage (fallback plan)](#9-level-passage-fallback-plan) | `src/lib/scoring/levelPlan.js` | **yes** |
| 10 | [Best edition for purchase links](#10-best-edition-for-purchase-links) | `src/lib/scoring/editionPicker.js` | **yes** |
| 11 | [Which row represents a work](#11-which-row-represents-a-work) | `src/lib/scoring/workRepresentative.js` · `src/lib/book/workGroups.js` | **yes** |
| 12 | [Picking a lookup hit](#12-picking-a-lookup-hit) | `src/lib/sources/hardcoverService.js` · `src/lib/matching/tokenMatch.js` · `src/lib/matching/titleMatch.js` | **yes** |
| 13 | [Genre inference from subjects](#13-genre-inference-from-subjects) | `batch-scripts/_shared/genreRules.mjs` | partly |
| 14 | [Primary (shelf) genre](#14-primary-shelf-genre) | `src/lib/scoring/primaryGenre.js` | **yes** |
| 15 | [Series matching and queue order](#15-series-matching-and-queue-order) | `batch-scripts/_shared/series*.mjs` | **yes** |
| 16 | [Daily shuffle and index floors](#16-daily-shuffle-and-index-floors) | `src/lib/api/genreService.js` · `src/lib/util/random.js` · `src/lib/api/seriesService.js` | **yes** |
| 17 | [Reading streak](#17-reading-streak) | `src/lib/scoring/readingStreak.js` | **yes** |
| 18 | [Milestones, accomplishments, reader ranks](#18-milestones-accomplishments-reader-ranks) | `src/lib/achievements/shareMoments.js` · `accomplishments.js` · `readerRanks.js` | partly |
| 19 | [Oracle quota and Pro limits](#19-oracle-quota-and-pro-limits) | SQL `oracle_free_limit` · `src/hooks/useProLimits.js` | no |
| 20 | [Prompt size budget](#20-prompt-size-budget) | `src/lib/oracle/oraclePrompt.js` | no |
| 21 | [Randomness](#21-randomness) | `src/lib/util/random.js` and others | **yes** |

## Vocabulary

The client book object still uses short keys (renaming them is spike item C3):

| Key | Meaning | Range |
|---|---|---|
| `t`, `a` | title, author | — |
| `g` | legacy single genre (the real genres are `genresByBookId[bookId]`) | — |
| `c` | **prose complexity**, set by the Oracle | 1–5 |
| `p` | **thematic depth**, set by the Oracle | 1–5 |
| `pp` | pages | — |
| `rating` | the reader's stars | 1–5 |

Two different 1–5 scales meet in this document, and they must not be confused:

- **Reading level** (`profile.readingLevel`) — what the *reader* says their
  appetite for complexity is. Used for matching.
- **Book complexity** (`c`) — what the *Oracle* says the book's prose demands.

Neither is the reader's **rank** (Initiate → Library, §18), which counts books
read. Rank must never feed matching: reading many easy books does not mean a
reader wants harder ones.

---

## 1. Book address key

`bookKey(book)` / `addressKey(text)` in `src/lib/book/bookHelpers.js`, mirrored by
`client_title_key` / `client_author_key` in SQL.

```
addressKey(s) = s → NFD → remove combining marks U+0300–U+036F → lowercase → keep [a-z0-9]
key           = addressKey(title) + "|" + first 10 chars of addressKey(author)
```

- It is an **address** (shelves, client-side de-duplication, shared links), not
  the identity. `books.normalized_key` (`compute_book_key`) is the identity and
  is built differently on purpose.
- **Accents are folded, not dropped** (decided 2026-10-12): *Cien años de
  soledad* → `cienanosdesoledad`. This is the rule `workGroups.titleVariantKey`
  already used. Letters with no decomposition (ø, ß, æ, ł) and non-Latin scripts
  are still removed — identically in JS and SQL, which is why the SQL side uses
  `normalize(…, NFD)` and not `unaccent()` (which would map ø→o, ß→ss and
  disagree with the browser).
- The JS and SQL versions **must stay identical**, or shared links 404 for
  everyone except the sharer. `tests/match-decisions.test.js` pins examples and
  checks the migration uses the same character range.
- **Links shared before the change keep working:** the old functions live on as
  `client_*_key_legacy`, and `find_book_by_client_key` tries the new key first,
  then the legacy one. The prerender takes its canonical URL from
  `books_share_key`, so an old URL resolves and points crawlers at the new one.
- Migration: `supabase/migrations/20261012120000_accent_folded_share_key.sql`
  (rebuilds the expression indexes — replacing an `immutable` function does not).

## 2. Taste profile

`buildTasteProfile(library, genresByBookId, profile)` — built from data already
on the client, no extra queries. Feeds §3, §4 and §5.

| Field | Computed as |
|---|---|
| `genreAffinity[genre]` | mean star rating of the reader's **rated** books in that genre (uses Oracle genres, falls back to `g`) |
| `avgComplexity` | mean `c` of books rated **≥ 4★** |
| `avgDepth` | mean `p` of books rated **≥ 4★** |
| `complexitySampleCount` | how many books fed `avgComplexity` |
| `favoriteGenres`, `currentMood`, `readingLevel`, `goal` | copied from the profile (onboarding answers) |
| `hasSignal` | any rated genre **or** any stated favourite genre |

Only liked books (4–5★) shape complexity/depth: a reader who struggled through a
dense book and rated it 2★ is not asking for more of it.

## 3. Local Match %

`computeLocalMatch(book, tasteProfile, genresByBookId)` → integer 0–100, or
`null` (show no badge rather than a made-up number).

```
genreScore = max(genreAffinity[g] for g in book's genres) / 5
             or 0.75  if no rated genre matches but a stated favourite does
             or none

fit_c = 1 − min(1, |book.c − avgComplexity| / 4)
fit_p = 1 − min(1, |book.p − avgDepth| / 4)
fitScore = mean of whichever of fit_c, fit_p exist

match = round(100 × (0.7 × genreScore + 0.3 × fitScore))   both present
      = round(100 × genreScore)                             genre only
      = round(100 × fitScore)                               fit only
      = null                                                neither
```

| Lever | Value | Effect of raising it |
|---|---|---|
| genre weight | 0.7 | genre dominates more; complexity fit matters less |
| fit weight | 0.3 | must stay `1 − genre weight` |
| favourite-genre credit | 0.75 | stated favourites score closer to a 5★ history |
| distance divisor | 4 | the full 1–5 range; lower = harsher on mismatch |

**The 20 % floor is intended** (decided 2026-10-12): `/5` maps 1★ to 0.2, not 0.
A genre the reader rated low is weak evidence against it, not proof of dislike,
so it still contributes a little. Pinned in `tests/match-decisions.test.js`.

## 4. Oracle (LLM) Match %

For books the Oracle invents (not in our catalog, nothing local to score), the
prompt includes `describeTasteProfile()` — the same signals as §2 in words — and
`MATCH_SCORING_INSTRUCTIONS`, which asks the model to return an integer 0–100,
weighing genre affinity most and complexity/depth second.

This is a **reasoned estimate, not a reproducible calculation**. Two calls on
the same book can differ. Do not compare it numerically with §3.

## 5. Reading-level nudge

`suggestLevelFromTaste(tasteProfile)` → suggested level 2–5, or `null`. Drives
the dismissible "LevelNudge" card on the Dashboard.

Suggest `stated + 1` only when **all** hold:

- the reader has stated a level and it is below 5;
- `complexitySampleCount ≥ 5` (`LEVEL_NUDGE_MIN_SAMPLES`);
- `round(avgComplexity) > stated`.

Always one step, however far ahead the earned level is; never written silently.

## 6. Similar books (Book page)

`rankSimilar(display, pool, { genresByBookId, limit, exclude })` with
`BOOK_PAGE_WEIGHTS` in `src/lib/scoring/similarity.js` — the
"You might also like" strip. Candidates are the reader's own wishlist, library
and Read Next; **books the reader has finished are excluded**. The page scores
the top 24, collapses same-work rows (§11), then shows 12.

| Signal | Points |
|---|---|
| each Oracle genre shared with this book | **+4** |
| same legacy genre `g` (only when this book has no Oracle genres) | +3 |
| same author | +3 |
| complexity within ±1 | +1 |
| page count within 30 % | +1 |

Score-0 candidates are dropped; the rest sort by score, top `limit` shown. Ties
keep pool order.

§6 and §7 are two weight presets over the same `similarityScore()`; changing
what "similar" means is one edit to a preset in `similarity.js`.

## 7. Similar to your picks (fallback)

`rankBySeeds(selection, candidates, { limit })` with `SEED_WEIGHTS` in
`src/lib/scoring/similarity.js`, called from `OracleSimilar.jsx` — used when the
AI call fails or in wishlist mode. Scores each candidate against each of the
1–3 seed books the reader picked, and sums:

| Signal per seed | Points |
|---|---|
| same genre `g` | +3 |
| complexity within ±1 | +2 |
| depth within ±1 | +1 |

`match % = round(100 × score / (seeds × 6))` — 6 is `maxScore(SEED_WEIGHTS)`. Top
`SIMILAR_COUNT` (5) returned.

## 8. Oracle draw from wishlist / Vault

`handleDraw()` → `drawByMatch()` in `OracleCategories.jsx`, non-AI modes and the
AI-failure fallback:

1. pool = wishlist or Vault, filtered to the chosen genre;
2. remove anything already in Read Next or the library;
3. compute §3 Match % for every candidate;
4. pick **3 without replacement, weighted toward higher Match %**
   (`weightedSample()` in `src/lib/util/random.js`, Efraimidis–Spirakis).

```
weight = (match / 100) ^ DRAW_WEIGHT_POWER        DRAW_WEIGHT_POWER = 2
match  = UNSCORED_DRAW_MATCH (50) when §3 returns null
```

| Lever (`scoring/drawWeight.js`) | Value | Effect |
|---|---|---|
| `DRAW_WEIGHT_POWER` | 2 | a 90 % book is 4× as likely as a 45 % one; higher = closer to "always the top 3", 1 = proportional, 0 = uniform |
| `UNSCORED_DRAW_MATCH` | 50 | books with no signal are neither favoured nor buried |

Decided 2026-10-12: the Oracle should draw books that fit the reader, but a
weighted draw (not a plain top-3) keeps repeat draws from showing the same
books every time.

## 9. Level Passage (fallback plan)

`levelPlanSteps()` in `src/lib/scoring/levelPlan.js`, called by
`buildFallbackPlan()` in `PlanCreate.jsx` (type `level`) when the AI plan fails.
Constants: `COMPLEXITY_TOLERANCE` 0.7, `PICK_AMONG` 5, `UNRATED_COMPLEXITY` 3.
For month `i` of `timeline` months, from the reader's level `start` to `end`:

```
targetComplexity(i) = start + (end − start) × i / max(1, timeline − 1)
candidates = books with |c − targetComplexity| ≤ 0.7, not already read or chosen
pick = random among the first 5 candidates (pool sorted by c, missing c = 3)
```

Months with no candidate are skipped, so a Passage can come back shorter than
asked.

## 10. Best edition for purchase links

`scoreEdition(e)` / `pickBestEdition(editions)` — which ISBN/ASIN the Amazon
and Bookshop links use. Highest score wins. Weights: `FORMAT_SCORE` and
`EDITION_WEIGHTS` in `editionPicker.js`.

| Rule | Points |
|---|---|
| no valid ISBN | disqualified (−∞) |
| compilation flag, or format text says box set / omnibus | −1000 |
| format (Hardcover ids): physical / "both" / ebook / audio | +100 / +80 / +20 / −50 |
| valid ISBN-13 | +10 |
| has ASIN | +1 (tie-break only) |
| English edition / known non-English | +30 / −40 |
| popularity | `min(8 × log10(1 + owners), 30)` |

The popularity cap (30) is deliberately smaller than the physical→ebook gap (80)
and the English→foreign gap (70): no amount of popularity may promote an
audiobook or a foreign printing over a US print edition. Keep that ordering if
you change any of these. `pickBestEdition` also returns warnings (non-English,
audio only, sparse) for batch review.

## 11. Which row represents a work

`collapseWorks(books, { uiLang })` merges rows that are the same work (union-find
over title/author and other identity rules; each group keeps the position of its
first member) and shows the best row by `scoreWorkRepresentative()`
(`REPRESENTATIVE_WEIGHTS` in `src/lib/scoring/workRepresentative.js`):

| Rule | Points |
|---|---|
| row is in the book's original language | +1000 |
| row is in the reader's UI language | +100 |
| has a cover | +50 |
| verified / any reviewed status | +20 / +10 |
| row exists in our DB (`bookId`) | +8 |
| has description | +5 |
| has page count | +2 |

The gaps are tiers: original language beats everything, UI language beats any
amount of completeness. A Spanish reader sees *Cien años de soledad* — and the
English original of an English novel, not its translation.

## 12. Picking a lookup hit

When the lookup chain (Hardcover → OpenLibrary → Wikipedia) gets several results:

- **Hardcover** (`scoreSearchHit` / `isCompilationHit`): compilation −10; title contains the query +2;
  popularity `min(users / 1000, 1)`. Compilation = flagged, or title matches
  omnibus/box set/"Books 1–3"/anthology, or has 3+ commas.
- **Live search** (`titleMatchScore` in `matching/tokenMatch.js`): share (0–1) of the query's content words
  present in the candidate title, accent-insensitive, stop-words removed;
  `bestTitleMatch` takes the best over the whole query and each colon/dash
  segment ("Morras Malditas: Apaguemos la luz" matches on its second half).
- **Batch scripts** (`titleMatch.js`): `titleMatches()` and `authorMatches()`
  must both pass before any ISBN or year is written.

Two title matchers remain, on purpose: `tokenMatch.js` is forgiving (live
search, where a near miss just shows a less relevant result) and `titleMatch.js`
is strict (batch scripts, where a near miss writes a wrong ISBN). For plain
"same name ignoring case and punctuation" use `compactKey()` in `titleMatch.js`.

## 13. Genre inference from subjects

`rankGenres(subjects)` in `batch-scripts/_shared/genreRules.mjs` turns
OpenLibrary subjects into Oracle genres:

```
for each subject at position i, for each GENRE_RULE (genre, pattern, specificity) it matches:
  score[genre] += positionWeight(i) × specificity
positionWeight = 3 for subjects 1–6, 2 for 7–15, 1 after
```

Ties break by: earliest matching subject → more specific rule → A–Z. A genre is
assigned only if its score ≥ **3** (`MIN_GENRE_SCORE`), at most **5** per book
(`MAX_GENRES_PER_BOOK`). Position outranks specificity because OpenLibrary
lists subjects roughly by prominence.

## 14. Primary (shelf) genre

`getPrimaryGenre(book, genres)` — which section a book is filed under in grouped
shelf views: the genre with the **lowest global usage count** (the most
specific), ties A–Z, falling back to `g` then "Uncategorized". This keeps niche
shelves populated instead of everything collapsing into "Horror".

## 15. Series matching and queue order

`rankSeriesHits(hits, wantedName)`: exact normalised name **2**; one name
contains the other **1** unless the extra words are only a format qualifier
(manga, collected editions, omnibus…) or years; else 0. Returns *every* hit ≥ 1,
best first — the caller walks the list because exact-name records are sometimes
empty stubs.

`seriesQueue.mjs` orders the stale-series queue by last-examined time (never
examined = 0, first) so successive runs rotate instead of re-serving the same
head. Tested by simulating several runs.

## 16. Daily shuffle and index floors

**Daily shuffle** (`dailyShuffle(items, seedKey)`): `shuffle()` driven by
`seededRandom("<seedKey>:<UTC date>")` — FNV-1a (`hashSeed`) into xorshift32,
all in `src/lib/util/random.js`. Everyone sees
the same order today and a new one tomorrow, so prerendered HTML and the client
agree and caches stay valid for a day. Lists that fit on one page (≤ 20,
`GENRE_PAGE_SIZE`) are not shuffled.

**Index floors** — below these, a page stays reachable and linked but is
`noindex` and out of the sitemap:

| Page | Floor |
|---|---|
| genre page | **5** books (`INDEX_FLOOR`) |
| series page | **2** volumes (`SERIES_INDEX_FLOOR`) |

## 17. Reading streak

`monthlyReadingStreak(library, now)` → `{ months, includesCurrentMonth, lastFinishedOn }`.

- A streak is consecutive **calendar months** (reader's local time) with at
  least one finished book (`dateRead`).
- **The current month is a grace period.** If it has a finish, counting starts
  there; if it doesn't yet, counting starts from last month and the streak is
  still alive (`includesCurrentMonth = false` shows "finish one this month to
  keep it going").
- The first completed month with no finish ends the run.
- Temperature: **≥ 3** months warm, **≥ 6** hot (`STREAK_WARM_MONTHS`,
  `STREAK_HOT_MONTHS`).

Until 2026-10-12 the current month counted as a gap (every streak showed 0 on
the 1st) and the label said "days". Both are covered by `tests/reading-streak.test.js`.

## 18. Milestones, accomplishments, reader ranks

Milestone ladders (`src/lib/achievements/shareMoments.js`) — crossing one creates a share
moment and, for persistent kinds, an accomplishment (`accomplishments.js`, keyed
so each is awarded at most once):

| Ladder | Thresholds |
|---|---|
| books read in a year | 5, 10, 25, 50, 75, 100, 150, 200 |
| books in one genre *(legacy: kept for already-earned accomplishments)* | 5, 10, 25, 50 |
| books in one genre family | 10, 25, 50, 100, 250, 500, 1000 |
| genres explored within a family | 3, 5, 10 |
| books by women authors (`ag` female or mixed) | 5, 10, 25, 50, 100 |
| "first book in a new family" moments | only once the library has ≥ 5 books |

Reader ranks (`TITLE_TIERS` in `src/lib/achievements/readerRanks.js`) by total books read:
Initiate 1 · Seeker 5 · Scribe 15 · Archivist 30 · Keeper 60 · Voice 100 ·
Sage 250 · Warden 500 · Library 1000. Ranks are cosmetic and never feed matching.

## 19. Oracle quota and Pro limits

Enforced server-side (`supabase/migrations/20260923120000_pro_unlimited_and_misses.sql`);
the client only displays them.

| Plan | Oracle calls |
|---|---|
| Free | 5 per calendar month; 10 during the first 30 days after signup |
| Pro | unlimited, with a silent fair-use ceiling of 30 per day |

"None of these call to me" records a miss; a charged free draw is refunded, up
to 2 per month. Free creation limits (`FREE_LIMITS` in `src/hooks/useProLimits.js`): 1 owned
club, 3 Anthologies, 1 Passage. Pro means an active subscription only: curators
are not Pro (decided 2026-10-13); their own exemption is unmetered categorization.

## 20. Prompt size budget

`claude.js` rejects prompts over 50,000 characters. The "don't suggest these,
the reader already has them" list is capped at **6,000** characters
(`EXCLUDE_CHAR_BUDGET`); the rest of a prompt runs about 4,000. Raising the
budget does not improve recommendations — the list is a hint.

## 21. Randomness

| Need | Use |
|---|---|
| a fair random order or pick | `shuffle()` / `sample()` in `src/lib/util/random.js` — Fisher–Yates, never mutates the input |
| a random pick that favours some items | `weightedSample()` in `src/lib/util/random.js` (§8) |
| the same order for everyone today | `dailyShuffle()` (§16), or `shuffle(items, seededRandom(key))` for any other stable order |
| a stable value per string (placeholder cover palette, ornament) | `hashStr()` in `bookHelpers.js` |
| deterministic visuals in 3D scenes | local seeded generators in `components/*/scene.js` |

Never use `array.sort(() => Math.random() − 0.5)`: it is biased, and `.sort`
mutates — on React state it silently reorders the reader's real data (this is
how the Oracle Spark reshuffled wishlists until 2026-10-12).

---

## Decisions

| Date | § | Decision |
|---|---|---|
| 2026-10-12 | 1 | Address keys fold accents (NFD) like the rest of the app; old links resolve through a legacy fallback |
| 2026-10-12 | 3 | A 1★ genre keeps counting 20 % — low rating is weak evidence, not a veto |
| 2026-10-12 | 8 | Local Oracle draws are weighted toward higher Match % (power 2), not uniform and not a fixed top 3 |
