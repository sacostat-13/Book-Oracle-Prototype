# The Wishlist Oracle

A reading companion — wishlist, library, reading plans, book clubs, and an AI-powered "oracle"
for book discovery. Built with React + Vite + SCSS, backed by Supabase for auth
and cross-device sync, and Netlify Functions for API proxying.

> Current version: **v0.29** — see [Releases](#releases) below for changelog.
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
  6. `schema_v6_migration.sql` (status enum + verified_source + verified_by columns)
  7. `schema_v7_migration.sql` (genres: tables, seed, RPCs, backfill)
  8. `schema_v8_migration.sql` (discovered status)
  9. `schema_v9_migration.sql` (book_reports table)
  10. `schema_v10_migration.sql` (currently_reading table)
  11. `schema_v11_migration.sql` (is_curator flag + get_curated_catalog RPC)
  12. `schema_v12_migration.sql` (lists, list_items, public plan RLS + RPCs)
  13. `schema_v13_migration.sql` (book clubs, sessions, reading progress)
  14. `schema_v14_migration.sql` (discussion, questions, polls, Oracle suggestions)
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
│   ├── schema_v12_migration.sql    lists + shareable plans (v0.27)
│   ├── schema_v13_migration.sql    book clubs + sessions + reading progress (v0.28)
│   └── schema_v14_migration.sql    discussion, questions, polls, Oracle suggestions (v0.29)
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
    │   ├── cover-grid.scss         Cover grid + currently reading cards + progress bars (v0.28)
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
    │   ├── Nav.jsx                 Top nav — desktop links + mobile overlay (v0.28: Clubs entry)
    │   ├── Toast.jsx
    │   ├── BookCover.jsx           Cached covers + OL fallback
    │   ├── BookCard.jsx
    │   ├── BookModal.jsx           On-demand enrichment + purchase buttons
    │   ├── BulkImport.jsx          3-tab bulk import panel
    │   ├── ReleaseNotesModal.jsx   "What's new" popup (bilingual)
    │   ├── CategoryAutocomplete.jsx
    │   ├── OracleCategorizationButton.jsx
    │   ├── CurrentReleaseFooter.jsx
    │   ├── AddToListModal.jsx
    │   ├── AddToListPicker.jsx
    │   ├── SelectionBar.jsx
    │   ├── ProgressUpdateModal.jsx  Pages-read modal for currently-reading books (v0.28)
    │   ├── CommentThread.jsx        Reusable threaded comment list with replies (v0.29)
    │   ├── SessionDiscussion.jsx    Questions + free comments section for sessions (v0.29)
    │   └── ClubPolls.jsx            Poll list, voting UI, Oracle suggestion trigger (v0.29)
    └── views/
        ├── Onboarding.jsx
        ├── Dashboard.jsx           Activity feed + currently reading + clubs widget (v0.28)
        ├── Wishlist.jsx
        ├── Library.jsx
        ├── ReadNext.jsx
        ├── CurrentlyReading.jsx    Progress bars + update modal (v0.28)
        ├── Profile.jsx             Reading stats
        ├── OracleFork.jsx
        ├── OracleCategories.jsx
        ├── OracleSimilar.jsx
        ├── BookPage.jsx
        ├── SeriesPage.jsx
        ├── PlanCreate.jsx          Generate reading plan
        ├── PlanView.jsx            View any plan by ID
        ├── Lists.jsx               My curated lists (v0.27)
        ├── ListDetail.jsx          Single list — cover grid + bulk select (v0.27)
        ├── ListView.jsx            Public read-only view for shared lists and plans (v0.27)
        ├── BookClubs.jsx           My clubs index (v0.28)
        ├── BookClubCreate.jsx      Create a new club (v0.28)
        ├── BookClubDetail.jsx      Club detail — sessions, roster, polls, admin controls (v0.28–v0.29)
        ├── SessionCreate.jsx       Admin form to create a reading session (v0.28)
        ├── SessionDetail.jsx       Session page — book info, progress grid, discussion (v0.28–v0.29)
        └── JoinClub.jsx            Public join-by-token landing page (v0.28)
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
| `books` | The catalog. `status` enum: `unreviewed` \| `incomplete` \| `oracle_categorized` \| `verified` \| `flagged` \| `discovered`. |
| `series` | Series rows. `publication_status` tracks ongoing/complete/unknown. |
| `genres` | Canonical genre taxonomy. Oracle-curated. 15 seeds pre-loaded. |
| `book_genres` | Global many-to-many book ↔ genre. |
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

### The curated catalog (The Vault)
Starting v0.26, the Vault is powered by the curator's live wishlist rather than a bundled static file. The `get_curated_catalog()` RPC (v11 migration) returns all books wishlisted by any user with `profiles.is_curator = true`, joined with their series data. This is what the Oracle draws from when AI is disabled, and what the plan generator uses as its source pool.

### Guest mode
When signed out, state is mirrored to `localStorage` under `wishlist_oracle_state_v2`.
Everything works locally; nothing syncs. Book clubs require an account.

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

**Book Clubs architecture (v0.28).** Clubs are invite-only — no public directory. The join flow is a public route (`#join-club?token=...`) that resolves before auth: `preview_club_by_token` returns name + description for non-members, then `join_club_by_token` (SECURITY DEFINER) writes the membership row once the user signs in. Progress is stored on `currently_reading.pages_read` — the session page joins this against the member roster at query time via `get_session_detail`.

**Reading progress (v0.28).** `currently_reading` now carries a `pages_read` integer (default 0). `updateReadingProgress(book, pagesRead)` in DataContext optimistically updates local state and persists via a direct update. The `ProgressUpdateModal` component is shared between Currently Reading and SessionDetail.

**Discussion architecture (v0.29).** One `session_comments` table covers all comment surfaces — free comments (`question_id` null), question answers (`question_id` set), and replies (`parent_id` set). A DB constraint prevents replies-to-replies. `get_session_discussion` returns the full thread structure in one RPC call with `is_mine` flags pre-computed. `CommentThread` is a pure rendering component; `SessionDiscussion` owns data-fetching and is the only component that calls DataContext mutations.

**Oracle poll flow (v0.29).** Admin taps "☩ Oracle suggests" on the club page → `ClubPolls` calls `callClaude` via the existing Netlify proxy with club genres and recent session books as context → Claude returns a JSON array of 3 book suggestions → `createPoll` inserts a poll with `is_oracle_pick: true` and three options → becomes a standard voteable poll. Winning option pre-fills the book field in SessionCreate via route params.

**Multi-plan support.** `plans` loads all rows per user. `DataContext` exposes `state.plans[]` alongside `state.currentPlan` (most recent, for backwards compat). `PlanView` resolves by `route.params.planId`.

**Activity feed.** The dashboard feed is synthesised client-side from already-loaded state — no extra Supabase queries. Paginated at 5 events per page.

**SCSS architecture.** `src/styles/main.scss` is a single entry point that `@use`s 25 focused partials. New features get their own partial where appropriate; smaller additions (like progress bars) go in the most relevant existing file.

**Session cache.** `DataContext` caches Supabase state in `sessionStorage` so new tabs render instantly from cache, then validate in background. Cache keyed by userId with 30-minute expiry.

---

## Releases

### v0.29 — Discussion & Decisions

**Discussion on sessions**
- Admins can pin discussion questions on any session — members answer each one in its own thread. Questions are ordered and collapsible.
- A free comments section below each session lets the conversation range beyond the pinned questions.
- Replies nest one level deep (enforced by DB constraint — no infinite threads).
- Authors can edit or delete their own comments; admins can delete any comment.

**Polls**
- Admins create polls on a club with 2–5 options (book titles or free text).
- Members vote and can change their vote while the poll is open. Results show as a live percentage bar visible to all members immediately after voting.
- Admins close a poll when ready. The winning option shows a "Create session from this book →" shortcut that pre-fills SessionCreate.

**Oracle suggestion polls**
- Admins tap "☩ Oracle suggests" — Claude generates three book recommendations based on the club's genre tags and recent session history.
- Suggestions become a poll automatically with `is_oracle_pick` flagged. No separate confirmation step.
- The full Oracle → poll → session pipeline is available in one flow.

**DB changes** (`schema_v14_migration.sql`)
- New tables: `session_questions`, `session_comments`, `club_polls`, `poll_options`, `poll_votes`
- New RPCs: `get_session_discussion`, `get_club_polls`, `cast_vote`

### v0.28 — Book Clubs

**Book Clubs**
- Create a named reading group, write a description, and tag it with genres from the Oracle taxonomy.
- Invite members via a shareable join link (`#join-club?token=...`). The landing page shows a club preview for anyone — sign-in required to actually join. Admins can regenerate the token at any time, invalidating old links.
- Club detail page shows all sessions, the full member roster with roles, and admin controls (remove member, promote to admin, delete club).
- Members can leave a club from the detail page. The creator cannot leave — they must delete.

**Sessions**
- Admins create Sessions: one book, a start date, an end date, and optional notes for the group.
- Sessions with a current date range appear as "Active" on the club detail page and in a quick-access widget on the Dashboard.
- The Session detail page shows the book cover, description, admin notes, and a live member progress grid sorted by pages read.

**Reading progress**
- `currently_reading` now stores `pages_read` (integer, default 0).
- The "↑ Progress" button on Currently Reading opens a modal to enter your page count. A live progress bar shows your percentage against the book's total pages (with a note that your edition may differ).
- Session pages pull each member's `pages_read` automatically — no separate session-specific progress table needed.
- Progress is optimistically updated in local state before the Supabase write resolves.

**DB changes** (`schema_v13_migration.sql`)
- New tables: `book_clubs`, `book_club_genres`, `book_club_members`, `book_club_sessions`
- `ALTER TABLE currently_reading ADD COLUMN pages_read integer NOT NULL DEFAULT 0`
- New RPCs: `preview_club_by_token`, `join_club_by_token`, `get_club_detail`, `get_session_detail`, `regenerate_join_token`

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
- Cache keyed by userId with 30-minute expiry.

### v0.26 — Your dashboard, alive

**Activity feed** — chronological feed of finished books, books started, wishlist adds, and plans created. Paginated at 5 events per page.

**Currently Reading strip** — prominent strip at the top of the dashboard showing active books with cover art and day counter.

**Multiple reading plans** — plans no longer overwrite each other. Dashboard shows all plans stacked as banners.

**Live curated catalog (The Vault)** — `booksData.js` retired. The Vault is now the curator's live Supabase wishlist via `get_curated_catalog()` RPC.

**SCSS split** — `main.scss` split into 25 focused partials.

### v0.25 — Currently Reading & cover shelves

- New `currently-reading` route with cards showing cover, start date, and day counter.
- `currently_reading` Supabase table (`schema_v10_migration.sql`) with RLS.
- Cover grid (Wishlist + Library) with genre-grouped shelves and list/grid toggle.

### v0.24 — Series pages

- New `#series-page` route: progress bar, all books in order, Wikipedia description, inline actions.

### v0.23 — Reading stats

- Reading stats on Profile: total books/pages, 12-month pace chart, top genres, most-read author, series completion.

### v0.22 — Read dates, smarter search, Oracle expansion

- Read dates captured on every book. Bulk import Claude fallback. Oracle enriches genres + series + descriptions in one pass.

### v0.21 — Oracle architecture overhaul

- Oracle enriches genres, series, and descriptions in one batch. `scripts/oracleBatch.mjs` standalone script.

### v0.20 — Report book issues

- Report button on BookModal and BookPage. `book_reports` table (`schema_v9_migration.sql`).

### v0.19 — Global search

- Search bar in top nav with instant local hits + live Hardcover search + Oracle fallback.

### v0.18 — Book pages

- New `#book-page` route with full description, genre pills, series navigation, purchase links.

### v0.17 — Mobile-first experience

- Hamburger nav at ≤700px. Book modal becomes a bottom sheet on mobile.

### v0.15 — Oracle genre categorization

- "☩ Let the Oracle categorize my books" button. Genre-based grouping in Wishlist and Library.

### v0.13 — Release notes, in your language

- "What's new" popup on About page, fully bilingual, powered by `src/lib/releases.js`.

### v0.12 — User categories

- Add categories to any book via autocomplete. `schema_v5_migration.sql`.

### v0.9 — Ratings, notes, and bulk-add to library

- Rate read books with 1–5 stars + notes.

### v0.3 — Hardcover + shared catalog

- Netlify Functions as API proxy layer. Hardcover as primary metadata source. Shared `books` table. The Vault.

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

## Engineering notes

- `bookKey(book)` is the canonical book-equality function — use it for all dedup and `key=`
- New mutations: dedupe input + mirror local state + persist via RPC + show toast
- New view styles go in their own SCSS partial, `@use`d in `main.scss`
- `state.plans[]` holds all plans; `state.currentPlan` is the most recent (backwards compat)
- `state.clubs[]` holds lightweight club entries (no sessions/members); full detail fetched on demand via `get_club_detail` RPC
- The Vault (`vault` in DataContext) is a live Supabase query, not a bundled array
- Club membership is checked server-side in every RPC — non-members get null back, not an error
- `pages_read` lives on `currently_reading`, not on a session-specific table — one update syncs across all sessions that reference the same book
- `session_comments` serves all comment surfaces via `question_id` / `parent_id` nullability — one table, one RLS policy set, one RPC
- `cast_vote` uses `ON CONFLICT DO UPDATE` — changing your vote is always a safe upsert, never a delete+insert race
- `CommentThread` is a pure rendering component — pass it comments + callbacks, it knows nothing about sessions or clubs
