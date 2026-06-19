# The Wishlist Oracle

A reading companion — wishlist, library, reading plans, and an AI-powered "oracle"
for book discovery. Built with React + Vite + SCSS, backed by Supabase for auth
and cross-device sync, and Netlify Functions for API proxying.

> Current version: **v0.27** — see [Releases](#releases) below for changelog.
> Upgrading from an earlier version? Check the matching `MIGRATION_*.md` / `UPDATE_*.md`.

---

## Setup

### 1. Install dependencies

```bash
npm install three   # required for the 3D shelf (v0.26)
npm install
```

### 2. Set up Supabase

- Create a project at [supabase.com](https://supabase.com)
- In **SQL Editor**, run the migrations in order from `supabase/`:
  1. `schema.sql` (initial schema)
  2. `schema_v2_migration.sql` (shared books table)
  3. `schema_v3_migration.sql` (series table)
  4. `schema_v4_migration.sql` (notes on read_books)
  5. `schema_v5_migration.sql` (categories: tables, RLS, RPCs)
  6. `schema_v6_migration.sql` (status enum + verified_source + verified_by columns)
  7. `schema_v7_migration.sql` (genres: tables, seed, RPCs, backfill)
  8. `schema_v8_migration.sql` (discovered status)
  9. `schema_v9_migration.sql` (book_reports table)
  10. `schema_v10_migration.sql` (currently_reading table)
  11. `schema_v11_migration.sql` (is_curator flag + get_curated_catalog RPC)
  12. `schema_v12_migration.sql` (lists, list_items, public plan RLS + RPCs)
- In **Authentication → Providers → Google**, enable Google OAuth (see [Google OAuth](#google-oauth-setup) below)
- In **Authentication → URL Configuration**, add `http://localhost:8888` and your Netlify URL to the allowed Redirect URLs
- Copy your project URL + anon key from **Project Settings → API**
- After running v11 migration, mark yourself as the catalog curator:
  ```sql
  update profiles set is_curator = true where id = '<your-user-uuid>';
  ```

### 3. Configure env vars

```bash
cp .env.example .env.local
```

Required:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

Optional (for affiliate purchase links):
```
VITE_AMAZON_AFFILIATE_TAG=your-tag-20
VITE_BOOKSHOP_AFFILIATE_ID=your-bookshop-id
```

### 4. Run locally

```bash
# For most development:
npm run dev

# For AI Oracle + Hardcover lookups (requires Netlify CLI):
npm install -g netlify-cli
netlify dev
```

### 5. Deploy to Netlify

The bundled `netlify.toml` sets build command, publish directory, functions directory,
and SPA redirect. Just connect the repo and Netlify handles it.

**Required env vars in Netlify** (Site → Environment variables):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `HARDCOVER_API_TOKEN` (server-side; for the Hardcover proxy)
- `ANTHROPIC_API_KEY` (server-side; for the Claude proxy)

**Optional Netlify env vars:**
- `VITE_AMAZON_AFFILIATE_TAG`, `VITE_BOOKSHOP_AFFILIATE_ID`

---

## Google OAuth setup

1. In Supabase **Authentication → Providers → Google**, copy the **Callback URL**
   (looks like `https://xxxxx.supabase.co/auth/v1/callback`)
2. In [Google Cloud Console](https://console.cloud.google.com/):
   - Create a project (or reuse one)
   - **APIs & Services → OAuth consent screen** → External → fill basics
   - **Credentials → Create Credentials → OAuth client ID** → Web application
   - **Authorized JavaScript origins**: `http://localhost:8888` + your Netlify URL
   - **Authorized redirect URIs**: paste the Supabase callback URL
3. Copy the **Client ID** and **Client Secret** back into Supabase's Google provider config

---

## Project layout

```
oracle/
├── index.html                      Vite entry
├── netlify.toml                    Build + functions config
├── package.json
├── vite.config.js
├── .env.example
├── netlify/functions/
│   ├── claude.js                   Anthropic API proxy
│   ├── hardcover.js                Hardcover GraphQL proxy
│   └── prh.js                      Penguin Random House proxy
├── scripts/
│   └── oracleBatch.mjs             Standalone Oracle enrichment script
├── supabase/
│   ├── schema.sql                  Initial schema (v1)
│   ├── schema_v2_migration.sql     ... through ...
│   └── schema_v11_migration.sql    is_curator + get_curated_catalog RPC (v0.26)
└── src/
    ├── main.jsx                    Mount + providers
    ├── App.jsx                     Auth gate, route switch
    ├── styles/
    │   ├── main.scss               Entry point — imports all partials
    │   ├── tokens.scss             CSS variables + base reset
    │   ├── nav.scss                Top nav + search
    │   ├── mobile-nav.scss         Hamburger + mobile overlay
    │   ├── layout.scss             App container
    │   ├── buttons.scss            All button variants
    │   ├── upload.scss             File upload UI
    │   ├── loading.scss            Spinners + skeletons
    │   ├── toast.scss              Toast notifications
    │   ├── badges.scss             Reading level badges
    │   ├── onboarding.scss         Onboarding flow
    │   ├── dashboard.scss          Dashboard / library hero
    │   ├── dashboard-feed.scss     Activity feed + currently reading strip (v0.26)
    │   ├── shelf.scss              Shelf controls
    │   ├── lists.scss              List views
    │   ├── book-page.scss          Book detail page
    │   ├── cover-grid.scss         Cover grid + currently reading view
    │   ├── series-page.scss        Series page
    │   ├── modal.scss              Book modal
    │   ├── oracle.scss             Oracle page + cards
    │   ├── oracle-ui.scss          Oracle mode toggle
    │   ├── oracle-btn.scss         Oracle categorization button
    │   ├── similar.scss            Similar books picker
    │   ├── wishlist.scss           Wishlist toolbar + manual add
    │   └── plans.scss              Reading plans
    ├── lib/
    │   ├── supabase.js             Supabase client
    │   ├── AuthContext.jsx         Google SSO via Supabase
    │   ├── DataContext.jsx         State + Supabase sync (core piece)
    │   ├── RouterContext.jsx       Minimal in-memory router
    │   ├── bookHelpers.js          bookKey, genres, palettes
    │   ├── bookLookup.js           Hardcover → OL → Wikipedia lookup chain
    │   ├── hardcoverService.js     GraphQL client via Netlify proxy
    │   ├── claudeApi.js            AI client via Netlify proxy
    │   ├── coverService.js         OL + Google Books cover lookup
    │   ├── enrichmentService.js    Series + pages enrichment
    │   ├── seriesService.js        Series table queries
    │   ├── goodreadsImport.js      CSV parsers
    │   ├── purchaseLinks.js        Amazon + Bookshop URL builders
    │   ├── oracleCategorizationService.js  Oracle batch-categorization logic
    │   └── releases.js             Bilingual release notes content
    ├── components/
    │   ├── Nav.jsx                 Hamburger menu + mobile overlay
    │   ├── Toast.jsx
    │   ├── BookCover.jsx           Cached covers + OL fallback
    │   ├── BookCard.jsx
    │   ├── BookModal.jsx           On-demand enrichment + purchase buttons
    │   ├── BulkImport.jsx          3-tab bulk import panel
    │   ├── ReleaseNotesModal.jsx   "What's new" popup (bilingual)
    │   ├── CategoryAutocomplete.jsx
    │   ├── OracleCategorizationButton.jsx
    │   └── CurrentReleaseFooter.jsx
    └── views/
        ├── Onboarding.jsx
        ├── Dashboard.jsx           Activity feed + currently reading (v0.26)
        ├── Wishlist.jsx
        ├── Library.jsx
        ├── ReadNext.jsx
        ├── CurrentlyReading.jsx    (v0.25)
        ├── Profile.jsx             Reading stats
        ├── OracleFork.jsx
        ├── OracleCategories.jsx
        ├── OracleSimilar.jsx
        ├── BookPage.jsx
        ├── SeriesPage.jsx          (v0.24)
        ├── PlanCreate.jsx          Generate reading plan
        ├── PlanView.jsx            View any plan by ID (v0.26)
        ├── Lists.jsx               My curated lists (v0.27)
        ├── ListDetail.jsx          Single list — cover grid + bulk select (v0.27)
        └── ListView.jsx            Public read-only view for shared lists and plans (v0.27)
```

---

## Data model

### Per-user tables
| Table | Purpose |
|---|---|
| `profiles` | One row per user. `preferences` jsonb holds `readNext`, `oracleMode`, `shelfSortMode`, etc. `is_curator` boolean marks whose wishlist becomes the shared catalog. |
| `wishlist_items` | User's wishlist. References `books.id`. |
| `read_books` | User's library (read books). References `books.id`. Includes `read_at` date. |
| `plans` | User's reading plans. Multiple plans per user supported. `content` jsonb holds the plan structure. |
| `currently_reading` | Books actively being read. `started_at` timestamp. |

### Shared catalog (read-public, write via RPC only)
| Table | Purpose |
|---|---|
| `books` | The catalog. `status` enum: `unreviewed` \| `incomplete` \| `oracle_categorized` \| `verified` \| `flagged` \| `discovered`. |
| `series` | Series rows. `publication_status` tracks ongoing/complete/unknown. |
| `genres` | Canonical genre taxonomy. Oracle-curated. 15 seeds pre-loaded. |
| `book_genres` | Global many-to-many book ↔ genre. |
| `book_reports` | User-submitted issue reports on catalog entries. |

### The curated catalog (The Vault)
Starting v0.26, the Vault is powered by the curator's live wishlist rather than a bundled static file. The `get_curated_catalog()` RPC (v11 migration) returns all books wishlisted by any user with `profiles.is_curator = true`, joined with their series data. This is what the Oracle draws from when AI is disabled, and what the plan generator uses as its source pool.

### Guest mode
When signed out, state is mirrored to `localStorage` under `wishlist_oracle_state_v2`.
Everything works locally; nothing syncs.

---

## Architecture notes

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

**Multi-plan support (v0.26).** `plans` now loads all rows per user (previously limited to 1). `DataContext` exposes `state.plans[]` alongside `state.currentPlan` (most recent, for backwards compat). `PlanView` resolves by `route.params.planId` when navigating from the dashboard plan list.

**Activity feed (v0.26).** The dashboard feed is synthesised client-side from already-loaded state — `state.library` (finished events from `read_at` dates), `state.currentlyReading` (started events), `state.wishlist` (added events grouped by day), and `state.plans` (plan created events). No extra Supabase queries. Paginated at 5 events per page.

**SCSS architecture (v0.26).** `src/styles/main.scss` is now a single entry point that `@use`s 25 focused partials. Each partial owns one concern. New features get their own partial — no more hunting through 2600 lines.

---

## Releases

### v0.27 — Lists, sharing, and smarter browsing

**Custom Lists**
- Create named curated reading lists, add any book from your collection, reorder, and toggle public/private.
- Public lists get a shareable URL (`#list-view?listId=...`) that renders read-only for anyone — no account required.
- `lists` and `list_items` tables with full RLS (`schema_v12_migration.sql`). `get_public_list()` RPC returns list + owner info for the public view.

**Shareable Plans**
- Any plan URL (`#plan-view?planId=...`) now resolves publicly via `get_public_plan()` RPC.
- Guests and other users see the plan read-only with a "Copy this plan" button that saves it to their own account.

**Nav restructure**
- Primary nav trimmed to 6 items: Wishlist · Library · Reading (dropdown) · Lists · Oracle · ···
- Reading dropdown contains Currently Reading and Read Next.
- ··· overflow menu contains Profile, About, Language toggle, Sign out.

**Book pages open in new tabs**
- All book opens now use `openBookTab()` which encodes a snapshot in the URL so the page renders instantly without waiting for the library to load.
- Book pages are public routes — render before auth/data loads, with auth-dependent actions appearing progressively.
- `BookModal` removed entirely; `BookPage` is the canonical book surface.

**Multi-select bulk actions**
- "Select" toggle in Wishlist, Library, and ListDetail toolbars activates selection mode.
- Works in both list view and cover grid: checkbox overlay on covers, gold highlight on list rows.
- Floating `SelectionBar` offers context-aware actions: Add to list, Mark as read (Wishlist), Remove.
- `useSelection` hook + `SelectionBar` component shared across all three views.

**Session cache**
- `DataContext` caches Supabase state in `sessionStorage` so new tabs render instantly from cache, then validate in background.
- Cache keyed by userId with 30-minute expiry. Persist effect gated on `supabaseLoadedRef` to prevent stale data overwriting good data on mount.

**Bug fixes**
- `genresByBookId` no longer wiped on mount by premature `saveLocal` call.
- Lists query isolated from main `Promise.all` so a lists failure can't break genre loading.
- Nav dropdown styles moved to `nav.scss` where they belong.

### v0.26 — Your dashboard, alive

**Activity feed**
- The dashboard replaces the static bookshelf with a chronological activity feed — finished books, books you started reading, wishlist adds (bulk adds collapse into one entry with a mini cover grid), and reading plans created.
- Feed is paginated: shows 5 events initially with a "Show more" button loading 5 at a time.
- Date labels group entries by Today / Yesterday / N days ago / N weeks ago.

**Currently Reading strip**
- Prominent horizontal strip at the top of the dashboard showing your active books with cover art, title, author, and "Since X days ago". Clicking opens the book page.

**Multiple reading plans**
- Plans no longer overwrite each other. Create as many as you want — series plans, genre immersions, level-up progressions — each is a separate row in Supabase.
- The dashboard shows all plans stacked as banners, newest first. The top one is labelled "Current Reading Plan".
- `PlanView` resolves by `planId` route param so any plan can be opened directly. Delete removes only that plan.

**Live curated catalog (The Vault)**
- `booksData.js` (280-book static bundle) is retired. The Vault is now the curator's live Supabase wishlist (~1000+ titles), fetched via the new `get_curated_catalog()` RPC.
- The Oracle, reading plan generator, and guest fallback all draw from this live source.
- To activate: run `schema_v11_migration.sql`, then `UPDATE profiles SET is_curator = true WHERE id = '<your-uuid>'`.

**SCSS split**
- `main.scss` split into 25 focused partials under `src/styles/`. Entry point is now a clean `@use` manifest. New feature styles go in their own file.

**Bug fixes**
- `PlanCreate.jsx`: removed `ALL_BOOKS` references — series plan builder and fallback plan now use `vault` (live catalog) instead.
- `PlanView.jsx`: removed stale `ALL_BOOKS` import.

### v0.25 — Currently Reading & cover shelves

**Currently Reading view**
- New `currently-reading` route with cards showing cover, start date, and live day counter.
- `currently_reading` Supabase table (`schema_v10_migration.sql`) with RLS.
- Three new DataContext actions: `startReading`, `finishReading`, `removeFromCurrentlyReading`.
- ▶ Start button added to Wishlist and Read Next list items.
- Nav item **Reading** (ES: **Leyendo**) with badge counter.

**Cover grid (Wishlist + Library)**
- `LibraryCoverGrid.jsx` — responsive cover grid with genre groups as named shelves.
- `☰ List / ⊞ Covers` toggle in both toolbars, persisted to `localStorage`.
- Hover overlay shows title, author, and genre pills.

**Cover backfill scripts** (`batch-scripts/`)
- `coverBackfill.mjs` — multi-source pipeline: Open Library → OL/PRH by ISBN → Google Books → OL/PRH by Google ISBNs → Hardcover → Claude.
- `fixBadCovers.mjs` — nulls out known bad cover URLs.
- `debugCover.mjs` — traces every pipeline step for a single book.

### v0.24 — Series pages

- New `#series-page` route: progress bar, all books in order with covers, Wikipedia description, inline add/queue/mark-read actions.
- Entry points from BookModal, BookPage, and Profile in-progress series cards.
- Read badge overlays on series book covers.

### v0.23 — Reading stats and smarter series plans

- Reading stats on Profile: total books/pages, 12-month pace chart, top genres, most-read author, series completion.
- Series in progress are tappable and link directly to plan creation.
- Reading Plans series picker now shows only user's own series (in-progress and wishlisted).

### v0.22 — Read dates, smarter search, Oracle expansion

- Read dates captured on every book. `read_books.read_at` stored; shown in Library.
- Bulk import Claude fallback for books not found in Hardcover or OpenLibrary.
- Oracle enriches genres, series, and descriptions in one pass.
- `scripts/oracleBatch.mjs` for command-line batch processing (~$0.007/book).
- PRH dropped from lookup chain.

### v0.21 — Oracle architecture overhaul

- Oracle enriches genres, series, and descriptions in one batch instead of genres only.
- `scripts/oracleBatch.mjs` standalone batch script with `--dry-run`, `--limit` flags.
- PRH removed from lookup chain.

### v0.20 — Report book issues

- Report button on BookModal and BookPage expands into an inline form.
- Users select wrong fields (Title, Description, Series, Genres) + optional comment.
- `book_reports` table (`schema_v9_migration.sql`).

### v0.19 — Global search

- Search bar in top nav: instant local hits + live Hardcover search (debounced 300ms).
- Oracle fallback when Hardcover returns nothing — Claude identifies the book.
- `discovered` status on books viewed from search but not yet added.
- Manual add form removed from Wishlist (search replaces it).

### v0.18 — Book pages

- New `#book-page` route: full description, genre pills, series navigation, purchase links.
- "See more" link in BookModal opens the book page.
- Series dot navigation links between book pages.

### v0.17 — Mobile-first experience

- Hamburger nav at ≤700px with full-screen overlay.
- Book modal becomes a bottom sheet on mobile.
- Toolbar filters stack vertically on small screens.

### v0.16 — Series navigation fixed

- Correct series dot count using `primary_books_count` from Hardcover.
- Compilation/study-guide filter in Hardcover search results.

### v0.15 — Oracle genre categorization

- "☩ Let the Oracle categorize my books" button: batch-assigns canonical genres via Claude.
- Genre-based grouping in Wishlist and Library.
- Two-dropdown filtering: Genres (canonical) + Categories (user folksonomy).
- `schema_v6_migration.sql` (status enum) + `schema_v7_migration.sql` (genres tables, 15 seeds, RPCs).

### v0.13.1 — Hotfix: tab-switching no longer resets the app

- `AuthContext.jsx`: `setSession` is now a no-op when user ID hasn't changed, preventing spurious full-state reloads on Supabase token refresh events.

### v0.13 — Release notes, in your language

- "What's new" popup on About page, fully bilingual, powered by `src/lib/releases.js`.

### v0.12 — User categories

- Add categories to any book via autocomplete. Verified (global) vs. personal (private) pill styles.
- Wishlist filter sees user tags. Soft-cap of 10 categories per book.
- Strict deduplication by normalized name. `schema_v5_migration.sql`.

### v0.11 — BookModal: categories + editable ratings

- Categories section in BookModal. Editable ratings inline in the modal. Wikipedia attribution link.

### v0.10 — Wikipedia as a fourth lookup source

- Wikipedia joined Hardcover + OL for descriptions. Language-aware (Spanish mode tries `es.wikipedia.org` first).

### v0.9 — Ratings, notes, and bulk-add to library

- Rate read books with 1–5 stars + notes. Bulk-add to Library panel.

### v0.8.1 — Hotfix: similar-titled books

- `cleanTitle()` no longer splits on `:`, fixing series entries like "Fabius Bile: Clonelord".

### v0.7 — Cover visibility fix

- `BookCover` adds `.loaded` class on image load, fixing invisible real covers.

### v0.6 — Render stability + docs

- Defensive dedupe in DataContext. README rewrite.

### v0.5 — On-demand caching + purchase links

- Book metadata cached to shared `books` row on modal open. Amazon + Bookshop.org purchase links.

### v0.4 — Series table

- New `series` table as single source of truth. `upsert_series` RPC. Verified/unverified badges.

### v0.3 — Hardcover + shared catalog

- Netlify Functions as API proxy layer. Hardcover as primary metadata source. Shared `books` table. The Vault.

### v0.2 — Bulk import + opt-in seeding

- 3-tab bulk import (Goodreads CSV, paste titles, Amazon URLs). Opt-in seeding.

### v0.1 — Initial React port

- Migrated from single-file HTML/JS to Vite + React + SCSS. Supabase auth. All views ported.

---

## Local development tips

**Without Netlify CLI** (`npm run dev`):
- Supabase auth + DB sync work
- Hardcover lookups fail silently → fall back to OpenLibrary
- AI Oracle fails → falls back to wishlist/Vault matching

**With Netlify CLI** (`netlify dev`):
- Everything works including AI Oracle and Hardcover
- Single port (default :8888) proxies both Vite + functions
- Requires `HARDCOVER_API_TOKEN` and `ANTHROPIC_API_KEY` in `.env.local`

**Resetting local state**: DevTools → Application → Local Storage → remove `wishlist_oracle_state_v2`.

---

## Prompting and engineering notes

- `bookKey(book)` is the canonical book-equality function — use it for all dedup and `key=`
- New mutations: dedupe input + mirror local state + persist via RPC + show toast
- New view styles go in their own SCSS partial, `@use`d in `main.scss`
- `state.plans[]` holds all plans; `state.currentPlan` is the most recent (backwards compat)
- The Vault (`vault` in DataContext) is now a live Supabase query, not a bundled array
