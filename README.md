# The Wishlist Oracle

A reading companion — wishlist, library, reading plans, and an AI-powered "oracle"
for book discovery. Built with React + Vite + SCSS, backed by Supabase for auth
and cross-device sync, and Netlify Functions for API proxying.

> Current version: **v0.7** — see [Releases](#releases) below for changelog.
> Upgrading from an earlier version? Check the matching `MIGRATION_*.md` / `UPDATE_*.md`.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

- Create a project at [supabase.com](https://supabase.com)
- In **SQL Editor**, run the migrations in order from `supabase/`:
  1. `schema.sql` (initial schema)
  2. `schema_v2_migration.sql` (shared books table)
  3. `schema_v3_migration.sql` (series table)
- In **Authentication → Providers → Google**, enable Google OAuth (see [Google OAuth](#google-oauth-setup) below)
- In **Authentication → URL Configuration**, add `http://localhost:5173` and your Netlify URL to the allowed Redirect URLs
- Copy your project URL + anon key from **Project Settings → API**

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

### 4. Seed the curated catalog (one-time)

Get your **service role key** from Supabase → Settings → API → service_role.
Add it to `.env.local`:
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```
(Never commit this key; never use it in the browser.)

Run the seeder:
```bash
node scripts/seedCuratedCatalog.mjs
```

### 5. Run locally

```bash
# For most development:
npm run dev

# For AI Oracle + Hardcover lookups (requires Netlify CLI):
npm install -g netlify-cli
netlify dev
```

### 6. Deploy to Netlify

The bundled `netlify.toml` sets build command, publish directory, functions directory,
and SPA redirect. Just connect the repo and Netlify handles it.

**Required env vars in Netlify** (Site → Environment variables):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `HARDCOVER_API_TOKEN` (server-side; for the Hardcover proxy)
- `ANTHROPIC_API_KEY` (server-side; for the Claude proxy)

---

## Google OAuth setup

1. In Supabase **Authentication → Providers → Google**, copy the **Callback URL**
   (looks like `https://xxxxx.supabase.co/auth/v1/callback`)
2. In [Google Cloud Console](https://console.cloud.google.com/):
   - Create a project (or reuse one)
   - **APIs & Services → OAuth consent screen** → External → fill basics
   - **Credentials → Create Credentials → OAuth client ID** → Web application
   - **Authorized JavaScript origins**: `http://localhost:5173` + your Netlify URL
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
│   └── hardcover.js                Hardcover GraphQL proxy
├── scripts/
│   └── seedCuratedCatalog.mjs      Run once after schema migrations
├── supabase/
│   ├── schema.sql                  Initial schema (v1)
│   ├── schema_v2_migration.sql     Shared books table (v2)
│   └── schema_v3_migration.sql     Series table (v3)
└── src/
    ├── main.jsx                    Mount + providers
    ├── App.jsx                     Auth gate, route switch
    ├── styles/main.scss            All styles (ported from original)
    ├── lib/
    │   ├── supabase.js             Supabase client
    │   ├── AuthContext.jsx         Google SSO via Supabase
    │   ├── DataContext.jsx         State + Supabase sync (core piece)
    │   ├── RouterContext.jsx       Minimal in-memory router
    │   ├── booksData.js            Bundled 280-book catalog
    │   ├── bookHelpers.js          bookKey, genres, palettes
    │   ├── bookLookup.js           Hardcover → OL lookup chain
    │   ├── hardcoverService.js     GraphQL client (via /netlify/functions/hardcover)
    │   ├── claudeApi.js            AI client (via /netlify/functions/claude)
    │   ├── coverService.js         OL + Google Books cover lookup
    │   ├── enrichmentService.js    Series + pages enrichment
    │   ├── seriesService.js        Series table queries
    │   ├── goodreadsImport.js      CSV parsers (read shelf + to-read shelf)
    │   ├── purchaseLinks.js        Amazon + Bookshop URL builders
    │   └── ...
    ├── components/
    │   ├── Nav.jsx
    │   ├── Toast.jsx
    │   ├── BookCover.jsx           Cached covers + OL fallback
    │   ├── BookCard.jsx
    │   ├── BookModal.jsx           On-demand enrichment + purchase buttons
    │   └── BulkImport.jsx          3-tab bulk import panel
    └── views/
        ├── Onboarding.jsx          3-step onboarding
        ├── Dashboard.jsx           Shelves + sort modes
        ├── Wishlist.jsx            Wishlist with bulk import
        ├── Library.jsx             Library by genre
        ├── ReadNext.jsx            Queue
        ├── Profile.jsx             Reading level, goal, re-import
        ├── OracleFork.jsx          Choose Categories or Similar
        ├── OracleCategories.jsx    Draw 3 books (Wishlist/Vault/AI)
        ├── OracleSimilar.jsx       Similar to selected books
        ├── PlanCreate.jsx          Generate reading plan
        └── PlanView.jsx            View active plan
```

---

## Data model

### Per-user tables
| Table | Purpose |
|---|---|
| `profiles` | One row per user. `preferences` jsonb holds `readNext`, `oracleMode`, `shelfSortMode`, etc. |
| `wishlist_items` | User's wishlist. References `books.id`. |
| `read_books` | User's library (read books). References `books.id`. |
| `plans` | User's reading plans. `content` jsonb holds the plan structure. |

### Shared catalog (read-public, write via RPC only)
| Table | Purpose |
|---|---|
| `books` | The catalog. Sources: `curated`, `hardcover`, `openlibrary`, `goodreads_import`, `user_manual`. `verified` flag controls trust. |
| `series` | Series rows with `verified` flag. Books point here via `series_id`. |

Writes to `books` go through `upsert_book` (deduplicates by normalized key, coalesce-merge).
Writes to `series` go through `upsert_series` (same pattern, dedupes by normalized name).

### Guest mode
When signed out, state is mirrored to `localStorage` under `wishlist_oracle_state_v2`.
Everything works locally; nothing syncs.

---

## Architecture notes

**API proxies.** Hardcover and Anthropic both require server-side tokens.
`netlify/functions/hardcover.js` and `netlify/functions/claude.js` hold the keys
and forward requests. Locally you need `netlify dev` to make them work.

**Lookup chain.** When the app needs metadata for a book:
1. Already in `books` table → use cached data, no network
2. Hardcover via proxy (best for series + canonical metadata)
3. OpenLibrary direct (broader coverage, no auth)
4. Merge results to fill nulls

**Cover caching.** Once a book modal is opened, the cover URL gets persisted
to `books.cover_url`. Every subsequent load — same user, different user, anywhere —
gets it instantly without a network fetch.

**Series detection.** Books reference a `series` row via `series_id`. Curated
seeds set `verified=true`. User-contributed series get `verified=false` and
show a "⚠ needs review" badge until an editor flips the flag. Manual verification
SQL is in `MIGRATION_V3.md`.

**The Vault.** Source-of-truth curated catalog, surfaced as a first-class Oracle
mode alongside "My wishlist" and "AI recommends". Plans fall back to the Vault
when AI fails. The bundled `BOOKS_DATA` is a backup for guest sessions.

---

## Styling

`src/styles/main.scss` is a verbatim copy of the original HTML/JS site's CSS —
SCSS is a CSS superset, so it compiles as-is. The Cormorant Garamond + Special
Elite + paper/ink palette dark-academia aesthetic from the original is preserved.
Free to refactor into partials when needed.

---

## Releases

### v0.7 — Cover visibility fix

- **`BookCover` now adds the `.loaded` class** when the image finishes loading,
  matching the CSS rule (`.cover img { opacity: 0 } .cover img.loaded { opacity: 1 }`)
  that was carried over verbatim from the original HTML/JS app. Without this,
  real covers were invisible — only placeholders showed.
- Added an `onError` fallback that drops back to the placeholder when an image URL
  fails to load (broken cover URL, blocked CDN, etc.)
- Added a ref-callback fallback for browser-cached images where `onLoad` may have
  fired before the listener attached
- No schema or behavior changes

### v0.6 — Render stability + docs

- **Defensive dedupe** in `DataContext` to prevent duplicate-key React warnings
  - `dedupeBooks(list)` applied at every load/append boundary
  - Index fallback in all list-rendering `.map()` calls as a belt-and-suspenders measure
- **README rewrite** with this release history
- No schema changes, no behavior changes

### v0.5 — On-demand caching + purchase links

- **On-demand metadata caching**: when a book modal opens, missing fields
  (`coverUrl`, `pp`, `d`, `isbn`, `hardcoverId`) get fetched via Hardcover/OL
  and persisted to the shared `books` row via `upsert_book`
- **`BookCover`** accepts a `coverUrl` prop and skips network fetch when present
- **Purchase links**: Amazon + Bookshop.org buttons in BookModal
- Optional affiliate tags via `VITE_AMAZON_AFFILIATE_TAG` / `VITE_BOOKSHOP_AFFILIATE_ID`
- No schema changes (writes go through existing v3 `upsert_book` RPC)

See: `UPDATE_V5.md`

### v0.4 — Series table

- **New `series` table** as single source of truth (dedup by normalized name)
- **`upsert_series` RPC** with coalesce-merge semantics
- **`upsert_book` updated** to auto-upsert series and link via `series_id`
- `books.series_name` / `books.series_position` dropped → replaced by `series_id` + `position_in_series`
- **"⚠ needs review" badge** in BookModal for unverified series
- **"☩ verified" badge** for curated/editor-verified series
- Curated seeder reworked to seed series first, then books
- New `src/lib/seriesService.js`

See: `MIGRATION_V3.md`

### v0.3 — Hardcover + shared catalog (multi-tenant books)

- **Netlify Functions** introduced as API proxy layer:
  - `netlify/functions/hardcover.js` — GraphQL proxy with token kept server-side
  - `netlify/functions/claude.js` — Anthropic API proxy (replaces direct browser call)
- **Hardcover integration** as primary metadata/series source, OL as fallback
  - `src/lib/hardcoverService.js` (lookup by ISBN, ASIN, title, series)
  - Lookup chain merges Hardcover + OL results to fill nulls
  - Series detection becomes structured (positions, total book counts)
- **Shared `books` table** (was per-user denormalized)
  - `upsert_book` RPC with security definer for safe inserts
  - RLS: anyone authenticated can read, only RPC writes
  - `verified` flag separates curated from user-contributed
  - Per-user tables (`wishlist_items`, `read_books`) now reference `books.id`
- **"The Vault"** as first-class concept
  - Third toggle in Oracle Categories
  - Plan generator falls back to Vault before bundled BOOKS_DATA
  - Curated seeder script (`scripts/seedCuratedCatalog.mjs`)
- **Write-on-import**: bulk import + Goodreads import populate the shared catalog

See: `MIGRATION.md` (v0.2 → v0.3)

### v0.2 — Bulk import + opt-in seeding

- **3-tab bulk import**: Goodreads to-read CSV, paste titles, paste Amazon URLs
- **OpenLibrary lookup pipeline**: ASIN extraction, title search, genre detection from subjects
- **Opt-in seeding**: wishlist no longer auto-fills with curated catalog at onboarding
- **"Browse curated catalog" button** on empty Wishlist state
- Goodreads CSV parser extended to read the to-read shelf
- New `src/lib/bookLookup.js`, `src/components/BulkImport.jsx`

### v0.1 — Initial React port

- Migrated from single-file HTML/JS prototype to Vite + React + SCSS
- Supabase auth (Google SSO) + per-user data sync
- All views ported: Onboarding, Dashboard, Wishlist, Library, ReadNext, Profile, Oracle (Categories + Similar), Plans (Create + View)
- BookModal with series dots, similar books, OL enrichment
- Goodreads CSV import for read books
- localStorage fallback for guest sessions
- Original dark-academia styling preserved
- AI Oracle calling Anthropic directly (later fixed in v0.3)

See: `MIGRATION.md` (HTML → React notes at the bottom)

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

**Resetting your local state**: open DevTools → Application → Local Storage →
remove the `wishlist_oracle_state_v2` key. The app rehydrates from Supabase on
next load.

---

## Prompting and styling preferences (for engineers)

- Don't over-format with bullet/header noise — prose where prose fits
- Components stay small and composable; if a view exceeds ~200 lines split out a child
- Keep all SCSS in `main.scss` until it hurts; resist premature partial-splitting
- `bookKey(book)` is the canonical book-equality function — use it for all dedup and key=
- New mutations should: dedupe input + mirror local state + persist via RPC + show toast
