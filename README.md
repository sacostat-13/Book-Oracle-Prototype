# The Wishlist Oracle

A reading companion — wishlist, library, reading plans, and an AI-powered "oracle"
for book discovery. Built with React + Vite + SCSS, backed by Supabase for auth
and cross-device sync, and Netlify Functions for API proxying.

> Current version: **v0.13.1** — see [Releases](#releases) below for changelog.
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
  4. `schema_v4_migration.sql` (notes on read_books)
  5. `schema_v5_migration.sql` (categories: tables, RLS, RPCs)
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
- `PRH_API_KEY` (server-side; for the PRH proxy — sign up at developer.penguinrandomhouse.com)

**Optional Netlify env vars:**
- `VITE_PRH_DOMAIN` — `PRH.US` (default), `PRH.MX` (Mexico/Latin America), `PRH.ESP` (Spain)
- `VITE_AMAZON_AFFILIATE_TAG`, `VITE_BOOKSHOP_AFFILIATE_ID`

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
│   ├── hardcover.js                Hardcover GraphQL proxy
│   └── prh.js                      Penguin Random House proxy
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
    │   ├── bookLookup.js           PRH → Hardcover → OL lookup chain (parallel + merge)
    │   ├── hardcoverService.js     GraphQL client (via /netlify/functions/hardcover)
    │   ├── prhService.js           PRH client (via /netlify/functions/prh)
    │   ├── claudeApi.js            AI client (via /netlify/functions/claude)
    │   ├── coverService.js         OL + Google Books cover lookup
    │   ├── enrichmentService.js    Series + pages enrichment
    │   ├── seriesService.js        Series table queries
    │   ├── goodreadsImport.js      CSV parsers (read shelf + to-read shelf)
    │   ├── purchaseLinks.js        Amazon + Bookshop URL builders
    │   └── releases.js              Bilingual release notes content
    ├── components/
    │   ├── Nav.jsx
    │   ├── Toast.jsx
    │   ├── BookCover.jsx           Cached covers + OL fallback
    │   ├── BookCard.jsx
    │   ├── BookModal.jsx           On-demand enrichment + purchase buttons
    │   ├── BulkImport.jsx          3-tab bulk import panel
    │   ├── ReleaseNotesModal.jsx    "What's new" popup (bilingual)
    │   ├── CategoryAutocomplete.jsx  Tag autocomplete with create-new + ranking
    │   └── CurrentReleaseFooter.jsx Current version block on About page
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
1. PRH         (best for Spanish/LatAm titles, ISBN lookups)
2. Hardcover   (best metadata + structured series, anglo-fiction skew)
3. OpenLibrary (broadest coverage, no auth, no rate limit)
4. Wikipedia   (best descriptions, esp. when others are sparse — v0.10)
5. Merge results to fill nulls

**Categories.** Per-user tagging on top of a globally-canonical catalog:

- `categories` table is the source of truth. Every distinct category name
  exists exactly once (per normalized name). New categories are created
  by users via the `upsert_category` RPC; admins set the `verified` flag.
- `book_categories` links a category to a book at the global level. Only
  written when a category is verified or when a verified category is
  applied. Powers the gilt "☩ verified" pills visible to all users.
- `user_book_categories` is the per-user private link. Powers the dim
  "user-only" pills visible only to the owning user. Survives un-
  verification of a category — users keep their personal organization.
- Strict normalization: lowercase + strip non-alphanumerics. "Cyberpunk",
  "cyberpunk", "Cyber-punk", "Cyber Punk" all collapse to one canonical
  row. The first user's casing/punctuation is preserved as the display
  name.
- Soft-cap of 10 categories per (user, book), enforced in the
  `link_user_category` RPC. Admin operations can exceed it by inserting
  directly.
- Autocomplete (`search_categories` RPC) ranks results: exact match >
  prefix match > verified > `usage_count` desc > alphabetical.
- A view `book_categories_view` unions verified-global + user-private
  rows. The client uses this as a single source of truth for rendering.

**Cover caching.** Once a book modal is opened, the cover URL gets persisted
to `books.cover_url`. Every subsequent load — same user, different user, anywhere —
gets it instantly without a network fetch.

**Series detection.** Books reference a `series` row via `series_id`. Curated
seeds set `verified=true`. User-contributed series get `verified=false` and
show a "⚠ needs review" badge until an editor flips the flag. Manual verification
SQL is in `MIGRATION_V3.md`.

**Wikipedia series descriptions (v0.12).** The same `wikipedia.js`
proxy that powers book descriptions (v0.10) now accepts `kind: 'series'`
to disambiguate against series articles ("X (book series)") rather than
single-book articles. Series rows in the catalog gain a layered
description from Wikipedia when one is found, surfaced in the BookModal
series block.

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

### v0.13.1 — Hotfix: tab-switching no longer resets the app

A one-effect fix for [issue #6](https://github.com/sacostat-13/Book-Oracle-Prototype/issues/6):
switching to another browser tab (or app, or even another window for long
enough) was causing the app to silently reload its state when the user
returned. Anything in flight at the moment of the switch — Bulk Import
results mid-review, a half-typed Add Book form, an open BookModal — got
wiped because the app's full state was being refetched from Supabase and
the local React state was being replaced wholesale.

**Root cause:** `AuthContext.jsx`'s `onAuthStateChange` handler was calling
`setSession(session)` unconditionally on every event. Supabase fires
`TOKEN_REFRESHED` events on tab focus (the SDK silently rotates JWTs
roughly every hour, and a focused-tab signal triggers a check). Each
unconditional `setSession` created a new React reference for `session`
and `user`, which fired the `useEffect([user, authLoading])` in
`DataContext.jsx`, which called `loadFromSupabase` and replaced the
entire local state — including any component-only UI state that wasn't
backed by the server.

**Fix:** make `setSession` a referentially-stable no-op when the user
identity hasn't changed:

```js
setSession((prev) => {
  const prevUserId = prev?.user?.id || null;
  const nextUserId = newSession?.user?.id || null;
  if (prevUserId === nextUserId) return prev;
  return newSession;
});
```

The Supabase client manages token rotation internally — the React state
update was redundant. By preserving the existing reference when the user
ID is unchanged, downstream effects no longer re-fire on token refreshes,
network blips, or Netlify cold-start auth events.

Sign-in, sign-out, and account-switch flows still work correctly — those
all change the user ID and continue to propagate.

Code-only change. No schema migration. Single file touched
(`src/lib/AuthContext.jsx`).

**Latent issue worth flagging for v0.12:** Even with this fix,
DataContext's load is still imperative — if anything else in the future
causes the `user` reference to change unintentionally, the same bug
class would resurface. The robust defense is a ref-guarded "have I
already loaded for this user ID?" check inside DataContext itself.
Worth folding into the v0.12 work when DataContext is being touched
anyway.

### v0.13 — Release notes, in your language

User-facing changes:

- **"What's new" popup.** The bottom of the About page now shows the
  current version + the latest release title, with a "See all releases"
  button that opens a scrollable history of every release.
- **Fully bilingual.** Both the footer and the popup follow the app's
  current language (English or Spanish). All eleven prior release
  entries have been backfilled with Spanish translations.
- **Future-proof.** Adding a new release is a single PR: prepend an
  object to `RELEASES` in `src/lib/releases.js` with bilingual content,
  then bump `CURRENT_VERSION`. Both surfaces (footer + popup) pick
  it up automatically.

Under the hood:

- Content lives in `src/lib/releases.js` as a versioned array. No
  Supabase tables, no admin UI — release notes ship with the code
  that introduces them. Each entry has `titleEn`/`titleEs` and
  `bodyEn`/`bodyEs` (the body is a bulleted array for clean list rendering).
- The modal reuses the existing modal-backdrop CSS class, the same Esc
  and click-outside-to-close behavior as BookModal and RatingModal.
- The current version is visually distinguished in the popup with a
  gilt-outlined version pill and "☩ current" badge — matching the
  verified-badge treatment used elsewhere.
- Placeholder entries (future releases sketched but not shipped) can
  be flagged with `placeholder: true`. `publishedReleases()` filters
  them out so the popup only shows shipped versions.

Why we shipped this before v0.12:

- v0.12 (user-added categories) is going to introduce a meaningful new
  UI surface that users will want explained. Shipping the release-notes
  system *before* the feature means it can be used to explain that
  feature when it lands.
- It's also genuinely small and standalone — no schema, no API, no
  external dependencies — so it could ship cleanly in a partial session.

### v0.12 — Your own categories

User-facing changes:

- **Add categories to any book.** The Categories section in the BookModal
  has a new "+ Add" button that opens an autocomplete input. Type a few
  letters to see existing categories ranked by verified-first, then by
  how many other readers use them. If your category doesn't exist yet,
  the dropdown offers "+ Create '<your input>'" at the bottom.
- **Verified vs. your own.** Two pill styles, same as v0.11 made room
  for: gilt-bordered "☩ Verified" pills are catalog-level tags everyone
  sees; dimmer pills are your private categories that only you see.
  Verified pills can't be removed from the client — they're global.
  Your own pills get an × in edit mode.
- **Soft-cap of 10 categories per book.** Beyond that the "+ Add" button
  disappears. Users tagging 30 things on one book turned out to be a
  signal of confusion more often than usefulness.
- **Strict deduplication.** Typing "cyberpunk", "Cyberpunk", "Cyber-Punk",
  or "Cyber Punk" all resolve to the same canonical row. Whoever typed
  it first sets the display casing/punctuation everyone else sees.
- **Wishlist filter sees your tags.** The "All categories" dropdown on
  the Wishlist now lists your categories alongside the built-in ones,
  case-insensitively merged so "Horror" the auto-genre and "horror"
  the user tag appear as one entry. Verified entries surface first with
  a ☩ marker. Selecting one filters books that match by either source.
  (The Library, Oracle, and Plan generation paths still use the auto-
  detected `b.g` field only — bringing categories everywhere is a v0.14
  conversation pending real usage signal.)
- **Wikipedia series descriptions.** When a book is part of a series and
  the series has a Wikipedia article, the BookModal's series block now
  shows the article's lede paragraph below the series name. Attribution
  link included. Especially useful for genre series where Hardcover and
  OpenLibrary often have sparse series-level data.

Under the hood:

- New `schema_v5_migration.sql` adds three tables — `categories`,
  `book_categories`, `user_book_categories` — with RLS policies that
  scope user-private rows to the owning user and require all writes
  to go through `SECURITY DEFINER` RPCs.
- Four new RPCs:
  - `upsert_category(raw_name)` — get-or-create canonical row
  - `link_user_category(book_id, raw_name)` — soft-capped add
  - `unlink_user_category(book_id, category_id)` — remove user tag
  - `search_categories(query, limit)` — autocomplete ranking
- A `book_categories_view` UNIONs global + user-private rows so the
  client can load everything-a-user-sees in one query.
- Trigger-maintained `usage_count` on `categories` powers autocomplete
  ranking and surfaces promotion candidates to admins.
- The `g` field on `books` (single auto-detected genre) coexists with
  the new categories system. They're treated as separate concepts —
  `g` powers Library grouping and the modal's eyebrow; categories are
  the multi-value additive layer in the pill row.

What's deliberately NOT here:

- No admin promotion UI. Verification still happens via raw SQL until
  the separate admin app ships. The data model — the `verified` flag
  and `usage_count` — is the foundation that future admin app builds
  on.
- No category descriptions or icons. If a category needs explaining,
  that's a v0.13+ enhancement.
- No automatic categorization. The `g` field stays as the
  auto-detected primary genre; everything else is user-driven.

**Belt-and-suspenders fix bundled in:** `DataContext` now ref-guards
its initial load against repeat-fire for the same user ID. The
v0.13.1 AuthContext fix prevented the upstream cause; this guard is
defense-in-depth for any future code path that might unintentionally
churn the `user` reference. See the v0.13.1 release notes for context.

### v0.11 — BookModal: categories surface + editable ratings

User-facing changes:

- **Categories now visible in the book modal.** A new "Categories"
  section in the modal body shows the book's category pills. Verified
  categories (those tied to an editor-curated catalog entry) display in
  the gilt "☩ Verified" treatment, matching the existing verified badge.
  Unverified categories (auto-detected by API lookup, or one day
  user-added) display in a dimmer style. For books with no categories
  yet, the section shows an empty state — discoverable, not absent.
- **Your rating, on the book's own page.** When a book is in your
  library, the modal now has a "Your rating" section showing your
  current stars + notes, with an "Edit" / "+ Add rating" button that
  opens the same rating editor introduced in v0.9. Notes render in
  italic serif with a left rule, matching the modal's overall voice.
- **"From Wikipedia" attribution.** When the description displayed in
  the modal was sourced from Wikipedia (a v0.10 feature), a small
  dotted "from wikipedia ↗" link appears in the section header,
  linking to the source article. Required by Wikipedia's CC BY-SA
  licensing and useful for users who want to read more.

Under the hood:

- v0.11 is purely UI — no schema changes, no new APIs. It surfaces
  data that was already being collected and adds the rating editor
  affordance to the modal.
- The CategoryPill component reuses `.level-pill` with inline-style
  variants for verified/unverified, matching the pattern already used
  by series-verified and book-verified pills elsewhere. When v0.12
  introduces the user-suggested category system, this same component
  gains a third "user-only" variant.
- The modal's enrichment effect now passes through Wikipedia attribution
  fields (`wikipediaUrl`, `wikipediaLang`, `descriptionSource`) to the
  shared books row via `cacheBookFields`, so the attribution sticks
  across sessions.

What's deliberately NOT here, and why:

- No add-category input. The autocomplete-with-create flow we
  designed lands in v0.12 along with the `categories` table and the
  user-suggested → admin-promoted pipeline. Surfacing what's already
  there first lets us see whether the design works before committing
  to schema.
- No category multi-select. Categories are still a single `g` field
  per book. v0.12 changes this.

### v0.10 — Wikipedia as a fourth lookup source

Wikipedia now joins PRH, Hardcover, and OpenLibrary as a source of
book metadata, with one specific purpose: **better descriptions**.

How it fits the existing chain:

- All four sources fire in parallel via `Promise.all` in `bookLookup.js`.
- The merge is null-fill for most fields (first non-null wins, in
  priority order Hardcover > PRH > OL > Wikipedia).
- The merge is special-cased for `description`: Wikipedia wins when
  the merged description from the first three is null or shorter than
  200 characters. Wikipedia's lede paragraphs are usually richer than
  Hardcover/OL blurbs, which is the main reason we added it.
- Wikipedia's thumbnail is used as a cover only when nothing else
  produced one — Wikipedia thumbnails are low-resolution and not
  book-cover-shaped.

Language handling:

- For users in Spanish mode (`book_oracle_lang === 'es'` in
  localStorage), `es.wikipedia.org` is tried first, then English as a
  fallback. Coverage of LatAm and translated series on Spanish
  Wikipedia is surprisingly good.
- For English-mode users, only `en.wikipedia.org` is queried.

Disambiguation logic (in the Netlify function):

- The query is built with a disambiguation hint — author's name when
  available, "novel" as a fallback — so generic titles ("Crash") land
  on the right page.
- Candidates are scored against title-exactness, author-presence in
  the snippet, and Wikipedia's own page-type parentheticals (novels
  win, films/songs/games lose).
- Disambiguation pages are rejected outright. If all candidates look
  like noise, the function returns `{ found: false }` cleanly.

### v0.9 — Ratings, notes, and bulk-add to library

User-facing changes:

- **Rate read books.** Books on the Library view now show a clickable star
  affordance (or the ❦ if unrated). Tapping it — or the new "+ Rate" /
  "Edit rating" button — opens a modal where users can capture a 1–5
  rating and a short personal note. Both are optional; either can be
  cleared by saving empty. Notes are private to the user (they live on
  `read_books`, not on the shared `books` catalog).
- **Bulk-add to library.** The Library now has a "⇪ Bulk add" button that
  opens the same import panel used for the wishlist. Three input modes:
  - **Goodreads CSV** (read shelf) — available as a *one-time* migration
    if the user didn't import during onboarding. Disappears after the
    first successful import. Preserves any ratings Goodreads has on file.
  - **Paste titles** — same lookup chain as the wishlist version.
  - **Amazon URLs** — ASIN-based lookup, same as wishlist.
- **Library empty state** now offers the bulk-add path directly.

Under the hood:

- `read_books.notes` (text, max 4000 chars) added via `schema_v4_migration.sql`.
  The `rating` column was already present from v0.3; v0.9 just makes it
  visible and editable.
- `DataContext` gains two new mutations:
  - `updateReadBook(book, { rating, notes })` — partial update, normalizes
    rating = 0 → null, blank notes → null. Local state updates optimistically
    before the server call.
  - `bulkAddToLibrary(books)` — for the title/Amazon import modes that
    aren't going through `importGoodreads`. No `goodreadsImported` flag
    side-effects.
- `markAsRead(book, extra)` accepts an optional second arg with `{ rating, notes }`.
  All existing callers (no second arg) keep working unchanged.
- `BulkImport` component is now target-aware:
  - `<BulkImport target="wishlist" onClose={...} />` — original behavior.
  - `<BulkImport target="library" onClose={...} />` — adds to library;
    Goodreads tab hidden if `state.profile.goodreadsImported` is true.

No breaking changes. Existing data is fully forward-compatible.

### v0.8.1 — Critical fix: similar-titled books

A one-line fix for a bug that turned out to be the root cause of
[issue #1](https://github.com/sacostat-13/Book-Oracle-Prototype/issues/1):
adding several books from the same series (Warhammer's "Fabius Bile:
Clonelord", "Fabius Bile: Manflayer", "Fabius Bile: Primogenitor", etc.)
would result in all three records carrying *identical* data — same cover,
same description, same page count, same ISBN. Every Warhammer-style
series ("Series Name: Volume Title") was broken.

**Root cause:** `cleanTitle()` in `src/lib/bookHelpers.js` was calling
`.split(':')[0]` to strip subtitles. For literary titles like "Sapiens:
A Brief History of Humankind" that's fine — but for series that *encode
the volume identifier after the colon*, it collapses every book in the
series to the same query string. PRH, Hardcover, and OpenLibrary all
received the same query ("Fabius Bile") and all returned the same
top-ranked record (Primogenitor). The dedup and matching logic
downstream was functioning correctly — it was just being fed identical
inputs three times.

**Fix:** remove the colon-split from `cleanTitle()`. APIs handle the
full title fine; OpenLibrary's search.json and Hardcover's Typesense
both score "Sapiens: A Brief History of Humankind" against "Sapiens"
with high recall.

Code-only change. No schema migration.

### v0.9 — PRH integration + Hardcover query fixes + bulk import resilience

This release addresses real user-reported issues from initial testing — primarily
that bulk imports of Spanish/Latin-American titles were finding only a fraction
of books, with no clear feedback about what failed or why.

**Hardcover query fixes**
- The previous queries used `_ilike` for series-name matching, which Hardcover's
  Hasura backend does not support — every Hardcover call was returning 400 with
  `{"error":"Method not allowed"}`. Hardcover was effectively offline.
- Rewritten queries to use `_eq` consistently. Series lookups now go through
  `search()` first to resolve the series ID, then `series(where: {id: {_eq: ...}})`.
- Search hits properly handle the Typesense response shape (`hits[].document`).
- `query_type` passed as a variable instead of literal for cleaner parameterization.
- Better error logging — the proxy now surfaces the upstream response body
  when Hardcover returns 400, so future schema issues are easier to diagnose.
- Depth-guard in `netlify/functions/hardcover.js` bumped from 8 → 15 braces.

**Penguin Random House integration**
- New `netlify/functions/prh.js` proxy (keeps the API key server-side)
- New `src/lib/prhService.js` with `prhLookupByIsbn` and `prhSearch`
- Configurable per-deploy domain via `VITE_PRH_DOMAIN` env var
  - `PRH.US` (default) — US English
  - `PRH.MX` — Mexico (best for Costa Rica/LatAm users)
  - `PRH.ESP` — Spain
- Strips HTML from flap copy, builds cover URLs from ISBN, preserves PRH title IDs

**Multi-source lookup chain**
- `bookLookup.js` now queries PRH, Hardcover, and OpenLibrary **in parallel**
  for every lookup, then merges results. Hardcover wins on canonical metadata,
  PRH fills in Spanish-edition specifics that Hardcover lacks, OL fills any
  remaining nulls.
- Same pattern for ASIN lookups, ISBN lookups, and title searches.

**Always-add-on-miss**
- When all three sources return nothing, we no longer drop the user's input.
  Instead, we return a record built from what they typed, marked
  `unverified: true` and `noApiMatch: true`.
- BulkImport surfaces these as `"add as-is"` (gilt badge) rather than
  `"not found"` (red). The user can still import them — they go in with the
  typed title/author and the unverified flag so editors can review later.
- Helpful when adding rare LatAm/indie titles that no public API has indexed.

**Cross-language duplicate detection**
- The dedup logic in BulkImport now checks BOTH the user's typed title AND the
  resolved canonical title (after API lookup) against the existing wishlist
  and library. Also matches on `isbn` and `hardcoverId` when available.
- Fixes a user-reported issue where typing "Siempre hemos vivido en el castillo"
  wasn't flagged as a duplicate of "We Have Always Lived in the Castle" already
  in the wishlist.

**Env var changes**
- New required server-side: `PRH_API_KEY` (Netlify env, server-only).
  Sign up free at [developer.penguinrandomhouse.com](https://developer.penguinrandomhouse.com/).
  Without this key, PRH calls silently fail and the chain falls through to
  Hardcover + OL — no breakage.
- New optional client-side: `VITE_PRH_DOMAIN` (defaults to `PRH.US`).

No schema migration. All changes are code-only.

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
