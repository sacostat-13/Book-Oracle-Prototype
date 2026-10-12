# Architecture

How The Books Oracle is put together: where things live, how data flows, and the
decisions behind the less obvious parts. Setup is in the [README](../README.md);
every ranking, weight and threshold is in [MATH.md](MATH.md); release history is
in [CHANGELOG.md](../CHANGELOG.md).

> Split out of README.md on 2026-10-12 (code-health spike, item O1). The *Data
> model* and *Architecture notes* sections below are carried over unchanged
> except the styles note, which described the pre-`@use` setup. Older notes are
> tagged with the version they were written for — re-verify before relying on
> one.

## The shape of the app

- **Frontend** — React 18 SPA built with Vite, Sass for styles, a small custom
  router (`src/lib/RouterContext.jsx`), bilingual EN/ES (`src/i18n/*.json`,
  `src/lib/I18nContext.jsx`). PWA via `vite-plugin-pwa`.
- **Backend** — Supabase (Postgres + auth + RLS). Writes to the shared catalog
  go through `SECURITY DEFINER` RPCs; per-user tables are protected by RLS.
- **Server functions** — `netlify/functions/*` proxy every third-party API that
  needs a secret (Anthropic, Hardcover, Google Books, PRH, Wikipedia, Lemon
  Squeezy, Resend). `netlify/edge-functions/og-prerender.js` prerenders public
  pages and Open Graph tags for crawlers and link previews.
- **Catalog maintenance** — `batch-scripts/` (Node, service-role key) fill
  ISBNs, covers, genres, languages and series. Some run nightly or weekly from
  `.github/workflows/`. Read `batch-scripts/README.md` before running any.

### Providers

`src/main.jsx` nests the app in this order, and the order matters — each
provider may read the ones outside it:

```
ThemeProvider → I18nProvider → AuthProvider → DataProvider → OracleQuotaProvider → RouterProvider → App
```

`DataProvider` (`src/lib/DataContext.jsx`) holds the reader's shelves and every
mutation on them, for both signed-in readers (Supabase) and guests
(`localStorage`). It is the largest file in the repo and the first candidate
for splitting — see the code-health spike.

## Project layout

```
├── index.html                 Vite entry (loads src/main.jsx)
├── netlify.toml               Build, functions, redirects, headers
├── vite.config.js             Vite + PWA + vitest config
├── eslint.config.mjs          Deliberately minimal lint rules (read the header)
├── netlify/
│   ├── functions/             API proxies + webhooks + sitemap + share cards
│   │   └── _shared/           Auth and helpers shared by functions
│   └── edge-functions/        og-prerender.js — HTML + OG tags for crawlers
├── supabase/
│   ├── migrations/            Supabase CLI migrations — the schema history
│   ├── SETUP.md               CLI linking and migration workflow
│   ├── fixes/ diagnostics/    One-off SQL, kept for the record
│   └── legacy/                Pre-CLI hand-applied schema_vN files (reference only)
├── batch-scripts/             Catalog maintenance (scheduled/, manual/, probes/, _shared/)
├── tests/                     vitest — batch-script logic, contracts, scoring
├── docs/                      Specs, audits, MATH.md, this file
└── src/
    ├── main.jsx               Mount + providers
    ├── App.jsx                Route switch
    ├── i18n/                  en.json + es.json (keys must stay in parity)
    ├── styles/                main.scss → tokens, layout/, components/, pages/
    ├── lib/                   Contexts, hooks, services and pure helpers
    ├── components/            Shared UI (+ landing/, constellation/, oracleSpread/)
    └── views/                 One file per route
```

## Data model

### Per-user tables
| Table | Purpose |
|---|---|
| `profiles` | One row per user. `preferences` jsonb holds `readNext`, `oracleMode`, `shelfSortMode`, etc. `is_curator` boolean marks whose wishlist becomes the shared catalog. |
| `wishlist_items` | User's wishlist. References `books.id`. |
| `read_books` | User's library (read books). References `books.id`. Includes `read_at` date. |
| `plans` | User's reading plans. Multiple plans per user supported. `content` jsonb holds the plan structure. |
| `currently_reading` | Books actively being read. `started_at` date, `pages_read` integer (v0.28). |
| `lists` | User's curated reading lists. `is_public` toggles shareable URL. |
| `list_items` | Books within a list, with `position` for ordering and optional `note`. |

### Book Clubs (v0.28)
| Table | Purpose |
|---|---|
| `book_clubs` | Named reading groups. `join_token` is a UUID string used in invite links; regenerable by admins. `created_by` is the original admin. |
| `book_club_genres` | Optional genre tags on a club (many-to-many → `genres`). |
| `book_club_members` | Membership rows. `role` is `'member'` or `'admin'`. Unique per (club, user). |
| `book_club_sessions` | One session = one book + date range + admin notes. References `books.id`. |

### Discussion & Decisions (v0.29)
| Table | Purpose |
|---|---|
| `session_questions` | Admin-pinned discussion questions on a session. Ordered by `position`. |
| `session_comments` | All text interactions on a session. `question_id` null = free comment; set = answer to that question. `parent_id` set = reply (one level max, enforced by DB constraint). |
| `club_polls` | Polls on a club. `is_oracle_pick` flags Oracle-generated polls. `closed` boolean gates voting. |
| `poll_options` | Choices within a poll. Book polls carry `book_id`, `book_author`, `cover_url` for display. |
| `poll_votes` | One row per (poll, user). Upsert to change vote. PK ensures one vote per member per poll. |

### Shared catalog (read-public, write via RPC only)
| Table | Purpose |
|---|---|
| `books` | The catalog. `status` enum: `unreviewed` \| `incomplete` \| `oracle_categorized` \| `verified` \| `flagged` \| `discovered`. `complexity`/`depth` (prose complexity / thematic depth, 1-5) were curated-only through v0.41 — as of v0.42 the Oracle categorization pipeline (in-app button and `oracleBatch.mjs`) assigns them too, so coverage grows as books get categorized. |
| `series` | Series rows. `publication_status` tracks ongoing/complete/unknown. |
| `genres` | Canonical genre taxonomy. Oracle-curated; 167 as of v0.67, grown from 15 seeds. `parent_id` is the **taxonomic** axis — "is this a kind of that?" — sparse, optional, nests. Every row has a description, and that is load-bearing: it is what the Oracle matches against when deciding whether to reuse a genre or invent one. |
| `genre_families` | 16 curated shelves — the **browsing** axis. `genres.family_id` is total (exactly one per genre) and never nests, and is deliberately allowed to disagree with `parent_id`: Irish Literature is a child of Literary Fiction and sits on the Place & Period shelf. Admin-only, in its own table so the Oracle — which creates genres nightly — cannot invent a family. |
| `book_genres` | Global many-to-many book ↔ genre. The only place a book's genres actually live; `books.genre` is a legacy scalar holding the top pick, and no UI surface reads it. |
| `books_needing_curation` | View, not a table. Books wanting genres, a description, or complexity/depth, with the reason as boolean columns. Every curation pass selects from here — selecting on `status` instead is what left 189 `verified` books permanently ineligible for categorisation. |
| `book_reports` | User-submitted issue reports on catalog entries. |

### RPCs (v0.28 additions)
| RPC | Auth | Purpose |
|---|---|---|
| `preview_club_by_token(token)` | anon + authed | Returns club name + description for the join landing page. Safe — no member data. |
| `join_club_by_token(token)` | authed | Resolves token → club, inserts member row, returns club_id. Idempotent. |
| `get_club_detail(club_id)` | authed member | Returns club info, genre tags, full roster, and all sessions in one call. |
| `get_session_detail(session_id)` | authed member | Returns session, book, and member progress grid (joined with `currently_reading.pages_read`). |
| `regenerate_join_token(club_id)` | authed admin | Replaces `join_token` with a fresh UUID, invalidating old links. |

### RPCs (v0.29 additions)
| RPC | Auth | Purpose |
|---|---|---|
| `get_session_discussion(session_id)` | authed member | Returns all questions with answer threads + free comments in one call. Includes `is_mine` flags. |
| `get_club_polls(club_id)` | authed member | Returns all polls with options, vote counts, and the caller's current vote. |
| `cast_vote(poll_id, option_id)` | authed member | Upserts a vote (handles first vote and vote change). Returns updated option counts. |

### RPCs (v0.42 additions)
| RPC | Auth | Purpose |
|---|---|---|
| `get_dashboard_clubs_summary()` | authed member | Aggregates all of the caller's clubs in one call for the Dashboard's Book Clubs widget: member count, the "current" session (active → most recent past → soonest upcoming), that session's book, and up to 4 member avatars (admins first). Avoids an N+1 fan-out over `get_club_detail()` per club. |

### The curated catalog (The Vault)
Starting v0.26, the Vault is powered by the curator's live wishlist rather than a bundled static file. The `get_curated_catalog()` RPC (v11 migration) returns all books wishlisted by any user with `profiles.is_curator = true`, joined with their series data. This is what the Oracle draws from when AI is disabled, and what the plan generator uses as its source pool.

### Guest mode
When signed out, state is mirrored to `localStorage` under `wishlist_oracle_state_v2`.
Everything works locally; nothing syncs. Book clubs require an account.

## Architecture notes

### Book identity — why the key is not the ISBN

`compute_book_key(title, author)` decides whether two rows are the same book.
Author is the least reliable field in the catalogue, so the obvious question is
whether ISBN should replace it. It should not, for three reasons:

1. **Coverage.** A key that is NULL for part of the table cannot be the key.
   Books published before 1970 have no ISBN at all, and the catalogue carries a
   standing backlog of rows the free passes cannot resolve — that backlog is the
   subject of the `catalog-review` issue `catalog-maintenance.yml` opens.
2. **Granularity.** ISBN identifies an *edition*, not a *work*. Hardcover,
   paperback, Kindle, translation and reissue each carry their own. The app is
   about works — "have I read this?" not "have I read the 1993 Doubleday
   printing?" — so keying on ISBN would fragment the catalogue considerably
   worse than the current key does, not better.
3. **Accuracy.** ISBNs in this catalogue are sometimes wrong. Of the 17
   ISBN-sharing pairs found in v0.63.2, two are genuinely different works that
   collided on a bad number.

ISBN is therefore a *corroborating* signal, not an identity. It is used that way
in `useStacks` (ownership) and should be used that way in `upsert_book` — as a
secondary lookup when `normalized_key` misses, gated on the titles also matching,
so a bad ISBN cannot merge two unrelated books. `books_isbn_idx` already exists
for it.

There is a better signal available and currently unused: `books.hardcover_id` is
a *work-level* identifier from a source that has already done the disambiguation.
`upsert_book` accepts it, stores it and coalesces it on update, but never
searches by it, and there is no index on the column. The natural matching order
is `hardcover_id` (exact, work-level) → ISBN + title corroboration (edition-level)
→ `normalized_key` (fuzzy fallback).

The full answer is the works/editions split that OpenLibrary and Hardcover both
model, with reader shelves pointing at works. That is a large migration and is
not obviously worth it before v1.0 — the layered matching above addresses the
same failures for a fraction of the cost.


**API proxies.** Hardcover and Anthropic both require server-side tokens.
`netlify/functions/hardcover.js` and `netlify/functions/claude.js` hold the keys
and forward requests. Locally you need `netlify dev` to make them work.

**Lookup chain.** When the app needs metadata for a book:
1. Hardcover (best metadata + structured series)
2. OpenLibrary (broadest coverage, no auth)
3. Wikipedia (best descriptions)
4. Merge results to fill nulls

**Genres vs. categories.** Two parallel systems:
- `genres` — canonical Oracle-curated taxonomy, globally visible, fixed vocabulary.
- `categories` — user-driven folksonomy, user-scoped, free-form.

**Oracle categorization.** The "☩ Let the Oracle categorize my books" button:
- Filters books with `status IN ('unreviewed', 'incomplete')` and no genres
- Batches 20 at a time to Claude via Netlify proxy
- Writes genres + series + descriptions back, flips status to `oracle_categorized`

**Book Clubs architecture (v0.28).** Clubs are invite-only — no public directory. The join flow is a public route (`#join-club?token=...`) that resolves before auth: `preview_club_by_token` returns name + description for non-members, then `join_club_by_token` (SECURITY DEFINER) writes the membership row once the user signs in. Progress is stored on `currently_reading.pages_read` — the session page joins this against the member roster at query time via `get_session_detail`.

**Reading progress (v0.28).** `currently_reading` now carries a `pages_read` integer (default 0). `updateReadingProgress(book, pagesRead)` in DataContext optimistically updates local state and persists via a direct update. The `ProgressUpdateModal` component is shared between Currently Reading and SessionDetail.

**Discussion architecture (v0.29).** One `session_comments` table covers all comment surfaces — free comments (`question_id` null), question answers (`question_id` set), and replies (`parent_id` set). A DB constraint prevents replies-to-replies. `get_session_discussion` returns the full thread structure in one RPC call with `is_mine` flags pre-computed. `CommentThread` is a pure rendering component; `SessionDiscussion` owns data-fetching and is the only component that calls DataContext mutations.

**Oracle question suggestions (v0.29).** Admins trigger from the session discussion panel. The existing questions are sent as context so Claude avoids duplicates. Results render as a persistent pick-list — tapping adds immediately without closing the list, allowing multiple picks in one flow.

**Oracle poll flow (v0.29).** Admin taps "☩ Oracle suggests" on the club page → `ClubPolls` calls `callClaude` via the existing Netlify proxy with club genres and recent session books as context → Claude returns a JSON array of 3 book suggestions → `createPoll` inserts a poll with `is_oracle_pick: true` and three options → becomes a standard voteable poll. Winning option pre-fills the book field in SessionCreate via route params. Admins can delete any poll outright; cascade deletes options and votes automatically.

**Multi-plan support.** `plans` loads all rows per user. `DataContext` exposes `state.plans[]` alongside `state.currentPlan` (most recent, for backwards compat). `PlanView` resolves by `route.params.planId`.

**Activity feed.** The dashboard feed is synthesised client-side from already-loaded state — no extra Supabase queries. Paginated at 5 events per page.

**Styles.** `src/styles/main.scss` is the single entry point and loads every partial with `@use` (Dart Sass modules) in four layers: foundation (tokens, themes, reset, typography, global) → `layout/` → `components/` → `pages/`. Conventions — naming, state classes, tokens, breakpoints — are in [`src/styles/README.md`](../src/styles/README.md).

**Session cache.** `DataContext` caches Supabase state in `sessionStorage` so new tabs render instantly from cache, then validate in background. Cache keyed by userId with 30-minute expiry. Validation checks **two** stamps: `catalog_meta.version` (did the catalogue change?) and a shelf fingerprint from `read_books.updated_at` (did this reader's shelf change under us?). Both only decide whether the cache is *usable* — neither overwrites in-memory state, so no background-refresh race. Before v0.65 only the first existed, which is why a read date corrected outside the tab stayed invisible for 30 minutes and survived a hard refresh.
