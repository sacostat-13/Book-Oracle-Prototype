# The Wishlist Oracle

A reading companion — wishlist, library, reading plans, book clubs, and an AI-powered "oracle"
for book discovery. Built with React + Vite + SCSS, backed by Supabase for auth
and cross-device sync, and Netlify Functions for API proxying.

> Current version: **v0.49** — see [Releases](#releases) below for changelog.
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
    │   ├── main.scss               Entry point — @imports all partials in dependency order
    │   ├── _tokens.scss            CSS custom properties (dark + light) + * box-sizing reset
    │   ├── _reset.scss             html/body, app shell, ambient texture overlays
    │   ├── _typography.scss        Text utility classes (.text-primary, .text-muted etc)
    │   ├── _global.scss            Shared UI: .page-header, .empty-state, .breadcrumb
    │   ├── layout/
    │   │   ├── _layout.scss        .container
    │   │   ├── _nav.scss           Top nav + nav search + nav dropdowns
    │   │   ├── _mobile-nav.scss    Hamburger + full-screen mobile menu
    │   │   └── _shelf.scss         Shelf controls bar
    │   ├── components/
    │   │   ├── _buttons.scss       .btn, .btn-secondary, .btn-gilt
    │   │   ├── _badges.scss        Level pill + all genre/status pills
    │   │   ├── _loading.scss       Spinner only
    │   │   ├── _toast.scss         Toast notification
    │   │   ├── _upload.scss        File upload drop zone
    │   │   ├── _card.scss          Book card, cover, placeholder, pick-btn
    │   │   └── _modal.scss         Backdrop, generic modal, book detail modal, series indicator
    │   └── pages/
    │       ├── _onboarding.scss    Onboarding flow
    │       ├── _dashboard.scss     Library hero + book spines + CTA cards
    │       ├── _dashboard-feed.scss Activity feed + currently reading strip + plan banner
    │       ├── _oracle.scss        Oracle fork layout + controls + mode toggle
    │       ├── _oracle-btn.scss    Oracle categorization button + progress indicator
    │       ├── _wishlist.scss      Wishlist toolbar + manual add form
    │       ├── _lists.scss         List/shelf views + selection mode + selection bar
    │       ├── _book-page.scss     Book detail page + report form
    │       ├── _similar.scss       Similar books picker + BookPage grid
    │       ├── _cover-grid.scss    Cover grid + view toggle + currently reading cards
    │       ├── _series-page.scss   Series page
    │       └── _plans.scss         Reading plans
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
| `books` | The catalog. `status` enum: `unreviewed` \| `incomplete` \| `oracle_categorized` \| `verified` \| `flagged` \| `discovered`. `complexity`/`depth` (prose complexity / thematic depth, 1-5) were curated-only through v0.41 — as of v0.42 the Oracle categorization pipeline (in-app button and `oracleBatch.mjs`) assigns them too, so coverage grows as books get categorized. |
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

### RPCs (v0.42 additions)
| RPC | Auth | Purpose |
|---|---|---|
| `get_dashboard_clubs_summary()` | authed member | Aggregates all of the caller's clubs in one call for the Dashboard's Book Clubs widget: member count, the "current" session (active → most recent past → soonest upcoming), that session's book, and up to 4 member avatars (admins first). Avoids an N+1 fan-out over `get_club_detail()` per club. |

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

**Oracle question suggestions (v0.29).** Admins trigger from the session discussion panel. The existing questions are sent as context so Claude avoids duplicates. Results render as a persistent pick-list — tapping adds immediately without closing the list, allowing multiple picks in one flow.

**Oracle poll flow (v0.29).** Admin taps "☩ Oracle suggests" on the club page → `ClubPolls` calls `callClaude` via the existing Netlify proxy with club genres and recent session books as context → Claude returns a JSON array of 3 book suggestions → `createPoll` inserts a poll with `is_oracle_pick: true` and three options → becomes a standard voteable poll. Winning option pre-fills the book field in SessionCreate via route params. Admins can delete any poll outright; cascade deletes options and votes automatically.

**Multi-plan support.** `plans` loads all rows per user. `DataContext` exposes `state.plans[]` alongside `state.currentPlan` (most recent, for backwards compat). `PlanView` resolves by `route.params.planId`.

**Activity feed.** The dashboard feed is synthesised client-side from already-loaded state — no extra Supabase queries. Paginated at 5 events per page.

**SCSS architecture (v0.30).** `src/styles/main.scss` is a single entry point that `@import`s 28 focused partials organised into four layers: tokens/reset/global (root-level), then `layout/`, `components/`, and `pages/`. `@import` is used over `@use` for reliable Vite HMR and correct `[data-theme]` cascade across all partials. Max nesting depth is 3 levels. No layout rules inside component files; page files contain only page-specific overrides — shared patterns go in the nearest component partial.

**Session cache.** `DataContext` caches Supabase state in `sessionStorage` so new tabs render instantly from cache, then validate in background. Cache keyed by userId with 30-minute expiry.

---

## Releases

# Update Notes — v0.40.1 → v0.41.0: Public Landing Page

Adds a real, public-facing marketing page at `/` for signed-out visitors, per
`landing-page-guideline.md`. Signed-in visitors are unaffected — they still
land on the Dashboard exactly as before.

## What's new

1. **Landing page at `/`** — hero, "the problem," six feature carousels
   (alternating text/thumbnail layout, per-feature slides), how-it-works,
   pricing, FAQ, and a final CTA band. Parchment-only regardless of the
   visitor's saved theme preference.
2. **Legal pages get dual chrome** — Privacy/Terms/Refund/Sitemap render with
   the app's Nav/Footer when you're signed in, and with the new
   LandingNav/LandingFooter (marketing style) when you're signed out.
3. **Language switcher** — an EN/ES dropdown in the landing footer, reusing
   `I18nContext` and the same `src/i18n/*.json` catalogs as the rest of the
   app (new copy lives under the `landing` key — nothing new to wire up for
   translators).
4. **SEO** — tuned title/description, JSON-LD (`SoftwareApplication` +
   `FAQPage`) for rich-result eligibility, canonical tag reuses the existing
   per-route logic.
5. **Mobile** — a short slide-down quick-link sheet from the nav (not the
   full-screen app hamburger menu), plus a sticky bottom CTA bar.

## Database changes

**None.**

## Code changes

- `src/views/Landing.jsx` (new) — the page itself
- `src/components/FeatureCarousel.jsx` (new) — alternating text/thumbnail
  carousel used by the 6 feature sections
- `src/components/LandingNav.jsx`, `LandingFooter.jsx` (new) — public chrome,
  shared between the landing page and signed-out legal pages
- `src/components/SignInGate.jsx` (new) — extracted from `App.jsx` so the
  landing page's "Start reading free" / "Log in" CTAs can open it as a modal
  instead of navigating away
- `src/App.jsx` — signed-out visits to `/` now render `<Landing>` instead of
  the sign-in gate; signed-out legal-page visits use the public chrome
- `src/i18n/en.json`, `es.json` — new `landing` key, both languages
- `src/styles/pages/_landing.scss` (new) — all landing styling, scoped under
  `.lp-root`
- `src/lib/releases.js` — new `v0.41.0` entry (bilingual, user-facing)

## Image assets needed before this goes live

The page ships with real `<img>` tags pointing at files that don't exist yet
— on purpose, so it's obvious exactly what to drop in and where. Until
they're added, the page works and reads fine, just with broken-image icons
in these spots:

| Path | Used for | Suggested shape |
|---|---|---|
| `public/images/landing/hero-dashboard.png` | Hero "screenshot" | ~1200×825, real Dashboard or Oracle chat screenshot |
| `public/images/landing/problem-bg.jpg` | "The problem" section background | ~1600×900, atmospheric library/reading photo |
| `public/images/landing/how-it-works-bg.jpg` | "How it works" section background | ~1800×1000, same mood as above, visually distinct from problem-bg |
| `public/images/landing/final-cta-bg.jpg` | Final CTA full-bleed band | ~2000×1100, warm/inviting, this one is the most prominent photo on the page |
| `public/images/landing/og-share.png` | Social share preview (`og:image`) | 1200×630 per OG spec |
| `public/images/landing/features/oracle-1-by-genre.png` | Oracle, slide 1 | ~800×500 screenshot |
| `public/images/landing/features/oracle-2-by-other-books.png` | Oracle, slide 2 | ″ |
| `public/images/landing/features/oracle-3-ask-in-plain-language.png` | Oracle, slide 3 | ″ |
| `public/images/landing/features/readingLife-1-whole-library.png` | Reading Life, slide 1 | ″ |
| `public/images/landing/features/readingLife-2-wishlist-at-a-glance.png` | Reading Life, slide 2 | ″ |
| `public/images/landing/features/readingLife-3-custom-categories.png` | Reading Life, slide 3 | ″ |
| `public/images/landing/features/readingLife-4-currently-reading-tracked.png` | Reading Life, slide 4 | ″ |
| `public/images/landing/features/plans-1-built-around-you.png` | Reading Plans, slide 1 | ″ |
| `public/images/landing/features/plans-2-watch-it-come-together.png` | Reading Plans, slide 2 | ″ |
| `public/images/landing/features/friends-1-living-feed.png` | Friends & Activity, slide 1 | ″ |
| `public/images/landing/features/friends-2-peek-at-shelves.png` | Friends & Activity, slide 2 | ″ |
| `public/images/landing/features/friends-3-curated-lists.png` | Friends & Activity, slide 3 | ″ |
| `public/images/landing/features/stats-1-yearly-goal.png` | Stats & Goals, slide 1 | ″ |
| `public/images/landing/features/stats-2-see-your-pace.png` | Stats & Goals, slide 2 | ″ |
| `public/images/landing/features/stats-3-keep-the-streak.png` | Stats & Goals, slide 3 | ″ |
| `public/images/landing/features/clubs-1-powered-by-the-oracle.png` | Book Clubs, slide 1 | ″ |
| `public/images/landing/features/clubs-2-inside-a-session.png` | Book Clubs, slide 2 | ″ |
| `public/images/landing/features/clubs-3-discover-clubs.png` | Book Clubs, slide 3 | ″ |
| `public/images/landing/features/clubs-4-spoiler-safe.png` | Book Clubs, slide 4 | ″ |

Filenames are stable across languages (keyed off the feature/slide, not the
translated title) so switching to Spanish never changes which file loads.
Real screenshots are captured in the app's dark theme — frame them (browser
chrome / drop shadow) so the contrast against the light landing page reads
intentionally, per the design guideline.

## Verify it works

1. Sign out (or open in an incognito window) and visit `/` — should show the
   landing page, not the sign-in screen.
2. Sign in — `/` should still go straight to the Dashboard as before.
3. Visit `/privacy` (or terms/refund/sitemap) signed out — public chrome;
   signed in — app chrome.
4. Click "Start reading free" / "Log in" from the landing page — opens the
   sign-in modal in place, no navigation.
5. Footer language dropdown — switches the whole page EN ↔ ES.
6. Resize to mobile width — nav collapses to a short quick-link sheet (not
   the full-screen app menu), and a sticky CTA bar appears at the bottom.

## What didn't change

- Pro pricing has no number yet — shows "Coming soon" deliberately, per the
  guideline's "don't invent numbers" rule. Fill in `landing.pricing.proPrice`
  in both i18n files once Lemon Squeezy is live.
- No testimonials/social-proof section — skipped per guideline until there
  are real quotes to show.

## A note on the dev-server HMR error some may see mid-session

If you pull these files into a repo with `npm run dev` / `netlify dev`
already running, Vite's hot-reload may throw `Failed to reload
/src/lib/I18nContext.jsx` once, since a lot of interdependent files (several
of which import `I18nContext`) changed at the same time rather than through
its normal one-file-at-a-time watch flow. It's a dev-server cache hiccup, not
a real bug — a production build (`npm run build`) compiles clean, and a
dev-server restart (or hard browser reload) clears it.


### v0.49 — Vault Source Upgrade (curator-fed catalog)

The Vault is now the live union of every curator's shelves instead of the 426 `source='curated'` rows (signed-in) / bundled ~280-book `booksData.js` (guests).

**Migration (`schema_v34_migration.sql`).** `get_curated_catalog()` (v11, wishlist-only, never adopted by the client) is dropped and recreated: union of curator `wishlist_items` (taste signal) and curator `read_books` (experience signal, excluding explicit ratings < 3 — NULL ratings kept, since unrated ≠ disliked). Two new return columns: `vault_source` (`wishlist`|`library`|`both`, rolled up across curators) and `curator_rating` (max). Quality floor `status in ('verified','oracle_categorized')` — same line the sitemap draws. DROP+CREATE because the return type changed; grants (authenticated + anon) re-applied, `search_path` pinned inline (keeps the v29 audit green). Verification queries at the bottom of the file.

**Client (`DataContext.loadVault`).** Both guest and signed-in paths now call the RPC (anon grant makes guest mode work); rows map through `bookRowToClient` with `vaultSource`/`curatorRating` carried as extras (stored, unused — future ranking signal: "curator read and loved this" > "curator has it on the list"). `ALL_BOOKS` demoted to emergency fallback on RPC error/empty; the `user` dependency drops out of the callback. `booksData.js` itself stays for now (guest wishlist seeding + BookModal candidates still import it) — retiring it fully is a separate pass.

### v0.48 — Branded link previews (landscape OG cards)

Every shared book, list, and reading-plan link now unfurls with a branded 1200×630 OG card instead of a raw cover (books), a bare first-cover (lists), or nothing (plans).

**Rendering.** `share-card.mjs` gains a `?layout=og` path: a landscape 1200×630 layout (`ogCard()`) in the same brand language as the portrait card — ink gradient, gold double frame, Instrument Serif headline, Plex Mono footer. Cover (when present) sits left in a larger fit box (`OG_COVER_MAX_W/H` 310×460; `loadCover()` now takes max dims as params, defaults unchanged); without a cover the text column centers full-width, so plans and coverless books still get a fully branded preview. Headline clamps at 90 chars with a 68/56/46px size ladder. The og path takes priority over `?frame` and skips the portrait fallback.

**Meta injection.** `og-prerender.js` gains `ogCardImage(origin, {ornament, eyebrow, headline, sub, cover})` building the share-card URL via `URLSearchParams` (origin from the request, so deploy previews render their own). The book (`❦` + "by <author>"), list ("A reading list" + count/curator + first cover), and plan ("A reading plan" + count/timeline/curator, text-only) branches now point `og:image` at it. `injectMeta()` additionally emits `og:image:width`/`og:image:height` (passed as 1200/630) and `twitter:image`. Series/clubs/profiles are deliberately unchanged this release — each is a two-line follow-up in its own branch if wanted.

**Mobile share modal.** `_share.scss` gains a `ro-down(mobile)` block: the card's fixed `zoom: .72` (389px) overflowed phones, so it steps down by viewport (.58 ≤640px / .52 ≤380px / .46 ≤340px — each sized so card ≤ viewport − 56px of overlay+modal padding); `.modal__actions` stacks `column-reverse` (primary on top, "Not now" at the bottom, DOM/focus order unchanged) with full-width 44px-tall buttons; the modal itself gets `max-height: 100dvh − 24px` + `overflow-y: auto` so tall framed cards scroll instead of clipping. Overlay padding tightens to 12px via `:has(.share-moment-modal)` (older Firefox just keeps the 1rem default).

**About page.** Roadmap pruned to match reality: Branded link previews, Goodreads import polish, Reading accomplishments, and Reading memory shipped; Curated reading paths reframed as "Hand-curated reading paths" (Reading Plans already cover the generated case). Tiers are now 2/2/1 items (About.jsx arrays + `roadmapTier*` keys in both i18n files; removed keys deleted).

### v0.47 — Illustrated milestone share cards (framed genre + moment art)

Genre milestones, series, reading goals, year milestones, and book-completed now render as an illustrated **framed** card: a per-slug gold-on-ink frame + artwork composed with the live copy. The frame/art are the only static per-slug assets — all text stays a render-time param.

**Assets & build.** `public/cards/<slug>/` holds `frame.png` + `art.png` for each genre (49) and each moment (`moment-series` | `moment-milestone` | `moment-goal` | `moment-plan` | `moment-book`; book is frame-only, the reader's cover fills the slot). `scripts/build-share-cards.mjs` (needs `pngjs` + `jpeg-js`) reads png/jpg/jpeg, normalizes frames to `frame.png`, centre-trims art → `art-trim.png` (luminance-weighted centroid crop, so off-centre art still centres and the corner watermark drops), measures each frame's inner opening, and regenerates `src/lib/cardGenres.js` (the ready-slug gate) + `src/lib/cardBoxes.js` (per-frame opening box — the generated frames vary too much for one constant). Re-run it whenever assets change; `BOX_OVERRIDES` in the script handles any frame whose opening can't be auto-detected.

**Resolution & copy.** `src/lib/cardResolve.js` maps a moment → its asset slug + readiness (`frameSlugFor`, `isFramedMoment`, `MOMENT_SLUGS`). `momentCopy()` wraps `baseCopy()` with `withFramed()`: for a ready slug it drops the book cover and adds `frameUrl`/`artUrl` + the per-frame `box` (book keeps its cover in the slot). Genre sub-lines live in `src/lib/genreCards.js` (`GENRE_CARD_META`, English) and are locale-gated. `shareCardImage.js` passes `frame`, `box`, and (book) `cover`; `share-card.mjs` renders the framed layout at that box, reserving art height for a possible two-line headline so nothing overlaps. The on-screen `ShareCard.jsx` renders the same framed layout in the DOM, so the preview matches the shared PNG without calling the function.

**Prompts.** `public/cards/_PROMPTS-all-genres.md` + `_MOMENT-PROMPTS.md` — self-contained image-gen prompts (one locked gold-engraving style block) for every frame + art.

### v0.46 — Feature Discovery (empty states, coach-marks, public changelog)

**Migrations required:** none. Two new preference keys ride the existing `profiles.preferences` jsonb (and guest localStorage): `coachmarksSeen` (string[]) and `lastSeenVersion` (string). No new dependencies.

**Feature-discovery pass** (`docs/feature-discovery-v1-spec.md`), organic and non-blocking, in three moves.

*Move 1 — teaching empty states.* New shared `EmptyState` component (`src/components/EmptyState.jsx`, styles in `_global.scss`) renders the canonical `.empty-state` DOM plus an optional primary action; it reads crisp (`is-actionable`) when there's an action or a `children` button group, and stays quietly dimmed when purely informational. Rolled out to seven zero-states — Read Next, Lists, Plans, Book Clubs, Currently Reading, Wishlist, Library — each now teaching what the feature is for and offering the action that fills it. This also fixed a latent bug: the Library empty state was hardcoded English; it's now bilingual via the existing `library.*` keys plus a new `library.emptyCta`.

*Move 2 — contextual coach-marks.* New `CoachMark` primitive (`src/components/CoachMark.jsx`, `_coachmark.scss`): one quiet, dismissible pointer per page, shown only if its `id` isn't in `state.coachmarksSeen`; dismissing (× or acting on the target) adds the id via `dismissCoachmark(id)` and it never returns. Seen-state persists like `dashboardLayout` (authed `profile.preferences`, guest localStorage). Five placements: Book Page categories, the Oracle "categorize" button (Wishlist + Library, only when uncategorised books exist), the progress-modal "note to your future self", and the Dashboard customize gear. Not a multi-step tour; never blocking.

*Move 3 — public changelog + "what's new" dot.* New public, indexable `/changelog` route (`src/views/Changelog.jsx`) rendering `publishedReleases()` with real per-version headings — no login — added to `sitemap.js`, the human sitemap, and linked from About. A "what's new" button in the nav icon cluster (desktop) opens the existing `ReleaseNotesModal` and lights a dot when `CURRENT_VERSION` differs from `state.lastSeenVersion` (cleared by `markReleasesSeen()` on open). i18n `coachmark.*` / `changelog.*` / `nav.whatsNew` (EN + rioplatense ES). Known follow-up: the nav dot is desktop-only (the icon cluster is hidden on tablet-down); a mobile-menu entry is a candidate for a later pass. The blog phase from the spec is deliberately deferred.

### v0.45.1 — Share Card images: server-rendered PNGs

**No migration required.** New dependencies: `satori`, `@resvg/resvg-wasm`, `image-size` (server-side, used only by the function). Removed: `html-to-image`.

Delivers the v0.43.x follow-up flagged below: the share-card *image* is now rendered by a Netlify Function (`netlify/functions/share-card.mjs`) instead of client-side `html-to-image`. The old path drew third-party covers (OpenLibrary/Wikimedia/Hardcover) onto a `<canvas>`; those hosts don't send CORS headers, so the canvas tainted and the export threw (the `share card export failed` / `img.error` you'd see) — meaning the "share as image" action never actually produced a shareable PNG. The function fetches the cover **server-to-server** (no CORS), so it always works.

**Rendering.** `satori` (flexbox/JSX → SVG) + `@resvg/resvg-wasm` (SVG → PNG), output 1080×1350 — a faithful reproduction of `ShareCard.jsx`'s 4:5 brand template (ornament, mono eyebrow, serif headline, italic sub, cover with gold frame + shadow, book caption, footer wordmark). The function is **i18n-agnostic**: the client resolves all copy with its own `t()` via the now-exported `momentCopy()` and passes finished strings as query params (`src/lib/shareCardImage.js` → `momentCardUrl`/`momentCardFile`), so the endpoint just renders strings + cover and can double as the OG link-preview image later. Ornaments render from a symbol font (DejaVu Sans covers `✦☩❦✺⚜✧❧`); fonts and the resvg wasm are fetched from CDN once per cold start and cached across warm invocations.

**Client.** `ShareMomentModal.handleShareImage` now fetches the PNG from the function and shares it as a `File` via the Web Share API (unchanged download + clipboard fallback on desktop). The on-screen `<ShareCard>` is now a **preview only** — its cover `<img>` dropped `crossOrigin="anonymous"` (it no longer feeds a canvas), which also removes the console `img.error`.

**Netlify gotchas worth recording** (each cost a deploy): the function is **Functions v2** (`export default` returning a `Response`) so binary PNG bytes stream natively — the v1 `{ body, isBase64Encoded }` path corrupted the image (`asPng()` returns a `Uint8Array`, whose `.toString('base64')` yields `"137,80,…"`, and the base64 flag was mishandled for this ESM function). `satori`/`@resvg/resvg-wasm` must **not** be `external_node_modules`: marking them external forces esbuild to `require()` ESM-only packages, which fails on Lambda (`Cannot find module …/index.cjs`, then `import_satori.default is not a function`). satori embeds its Yoga engine inline (base64 wasm) so it bundles cleanly with no external config. File is `.mjs`. First (cold) render is ~4s, warm is sub-second — comfortably under the 10s limit.

### v0.45 — Reading Accomplishments (The Ledger)

**Migrations required:** `schema_v32_migration.sql` (new `reading_accomplishments` table + `unique(user_id, key)`; adds `profiles.accomplishments_backfilled_at`). No new dependencies.

**Reading Accomplishments v1** (`docs/reading-accomplishments-v1-spec.md`). The persistent, retroactive counterpart to v0.43's ephemeral share moments — a dated ledger of earned milestones on Profile, framed as a record, not a scoreboard. The milestone logic is unchanged: `shareMoments.js` already computes every moment (`goal_completed`, `series_completed`, `plan_completed`, `nth_book`, `genre_count`, `new_genre`), so the new work is persistence, retroactivity, and the shelf. New pure module `accomplishments.js` translates between a live moment and a stored row (`keyForMoment`/`momentToMeta`/`rowToMoment`) and replays the ladders over an existing library (`computeBackfillAccomplishments`), so both the live earn path and the backfill converge on identical stable `key`s and are idempotent against the DB unique key. **Earning** rides the existing `fireCompletionMoment`: one computation now feeds two consumers — the share modal (unchanged) and the ledger. **Retroactivity**: a one-time, date-ordered backfill runs on first load where `profiles.accomplishments_backfilled_at` is null, dating each rung to the read that crossed it; Goodreads imports still skip the celebration *modal* but earn through this backfill (dated to each book's read date), so imported history fills the shelf without firing hundreds of cards. **UI**: a new "The Ledger" section on the Profile Overview tab — plaques grouped by kind (goals, series, plans, milestones, genres), each tappable to re-open its `ShareMomentModal` card via `shareAccomplishment`. **No-streaks** is a permanent, load-bearing rule (see spec): no cadence mechanics, no countdowns, no "N to go"; the optional next-rung line was cut in v1 because it couldn't be made to read as a ledger line rather than a nudge. Data: owner-only RLS in all directions, no update policy (accomplishments are immutable). Guests get the same feature via `state.accomplishments` in localStorage. i18n `ledger.*` (EN/ES); styles `_profile-extensions.scss` (`pf-ledger-*`, DS tokens only); the share *card* keeps its hardcoded brand palette.

### v0.44 — Reading Memory, Goodreads import polish, book-status consistency

**Migrations required:** `schema_v30_migration.sql` (new `reading_memories` table) and `schema_v31_migration.sql` (repairs the `upsert_book`/`upsert_series` overloads — fixes the RPC 404 on add/mark-read and the `verified` 42703). No new dependencies.

**Reading Memory v1** (`docs/reading-memory-v1-spec.md`). A private note attached to the moment you put a book down, returned the moment you pick it back up. Capture is one collapsed link inside the existing progress-update modal ("Leave a note for your future self") that expands to an optional textarea and saves with the progress — no second modal, no required field, nothing changes if you never use it. Resurfacing is passive: the newest memory renders read-only at the top of the same modal ("Last time — p. 145, Jun 12: …"), and Book Pages of collected books show the full thread (newest first, date + page, delete-only — no editing; memories are moments, not documents) under a `Private` chip. Notes written in the finish-flow RatingModal are recorded into the same thread as `kind='finished'` — `read_books.notes` itself is untouched. Data: new `reading_memories` table (owner-only RLS in all directions, deliberately **no update policy**), loaded with the initial fetch in one flat query; guests get the same feature via `state.memories` in localStorage, keyed by `bookKey` instead of `book_id`. Deliberately out of scope for v1: Oracle involvement, prompts/notifications, editing, sharing, series resurfacing.

**Goodreads import polish.** Four changes to the read-shelf/to-read import path: (1) *series parsing* — Goodreads encodes series in the title ("The Fellowship of the Ring (The Lord of the Rings, #1)"); `splitGoodreadsSeriesTitle()` strips the suffix and emits a real series object (`s: {name, n}`, decimal positions like `#0.1` included, first series wins in multi-series parentheticals), which flows through `upsert_book`'s existing `_series_name`/`_series_position` args — imported libraries now land with series intact and cleaner titles that actually match the catalog; (2) *in-CSV dedupe* — re-added editions export as multiple rows; the kept row absorbs rating/date from its duplicates; (3) *edition-insensitive duplicate detection* — `findExistingDuplicate` gained a fallback pass comparing `cleanTitle`-normalized keys, so "The Hobbit (75th Anniversary Edition)" is recognized as the "The Hobbit" you already have (runs only after every exact pass missed); (4) *import progress* — `importGoodreads`/`bulkAddToLibrary` accept an `onProgress` callback and the confirm button counts "Adding 214 of 500…" instead of an indeterminate "Adding…" for the minutes a 500-book import takes.

**Book-status consistency.** Marking a book read now clears it from Currently Reading in both the guest and authed paths, and `finishReading` no longer re-queues the book into Read Next on completion. On the Book Page, an active re-read (currently-reading) takes precedence over the library state so live progress stays visible, and the rating modal closes on save. `upsert_book` gained a one-shot retry on PostgREST schema-cache misses (PGRST202/404) — the intermittent "add fails, but the book is there after refresh".

**PWA fixes.** `icon-192.png` and `icon-512.png` had swapped contents (the 192 file was the 512×512 image and vice versa) — Chrome rejects manifest icons whose actual size differs from the declared size, which broke the install icon; swapped back. The service worker's `CacheFirst` route for `covers.openlibrary.org` was removed: when a cover wasn't cached and Open Library refused the hotlink, workbox surfaced one unhandled `no-response` rejection per image — pure console noise, since `BookCover` already falls back to a placeholder. Covers now use the plain browser HTTP cache. (Known leftover: `icons/icon-maskable-192.png` is an SVG wearing a `.png` name — unreferenced today, replace before adding a `maskable` manifest entry.)

### v0.43.2 — Styling-debt sweep: bulk import, Discover filters, dead tokens, Sass module migration

**No migration required.** No new dependencies.

**Bulk import styling rebuilt.** `BulkImport.jsx`'s tabs referenced `.toggle-btn`/`.toggle-sub` — classes added for the Oracle pages in v0.37.1 but removed since, leaving the tabs unstyled. They now use the DS "Tabs" pattern (`.source-tab` with `__title`/`__sub`, same as the book-page source selector). `.bulk-form` is a proper raised panel (`%widget-surface` gradient + strong border + shadow) so the inline form stands apart from the page on both Wishlist and Library, in both themes. Four more classes in the component had no CSS anywhere (`manual-add-header/-close/-note`, `file-hidden` — the raw CSV file input was visible); all defined in `_misc.scss` now. The component also borrowed classes from unrelated pages (`.about-section__body`, `.session-form__book-wrap`, `.cat-auto__tag`, `.ldetail-scroll`); replaced with dedicated `bulk-summary`/`bulk-hl`/`bulk-error`/`bulk-result-list`/`bulk-result-info`/`bulk-status` classes so restyling those pages can't silently break the import flow. Result-row status badges were colored with dead `--gilt-bright`/`--paper-aged`/`--blood-bright` tokens (every status rendered the same); they now use `--ro-gold-text`/`--ro-muted`/`--ro-error`.

**Missing `--ro-space-5` token.** The spacing scale skipped from 4 to 6, but eight rules across `_book-pages`, `_social`, and `_misc` referenced `var(--ro-space-5)` — all silently resolving to nothing (this was also why `.bulk-form` had no padding). Added `--ro-space-5: 20px` to `_themes.scss` and `5: 20px` to the `$ro-space` map.

**Discover page decluttered.** `/clubs/discover` stacked genre chips + mood chips between the search bar and the results, pushing the actual clubs below the fold. Both chip rows moved into a Filters modal (existing `.overlay`/`.modal` pattern) opened from a toolbar button that shows the active-filter count; Clear all + Done actions; filters still apply live behind the overlay. New `clubs.directory.filters*` keys in both i18n files.

**Dead-token sweep (post theme-rename stragglers).** Same class of bug the v0.37.1 sweep fixed, six more spots: `SessionCreate.jsx` still had the `inputStyle`/`labelStyle` objects built from `--paper`/`--gilt` that were removed from `SessionDetail.jsx` — replaced with `.field-label`/`.input`; `CategoryAutocomplete.jsx` inline styles (`--paper`, `--paper-aged` → `--ro-text`, `--ro-muted`); the loading spinner's `--gilt` accent in `_global.scss` (the spinner had no visible spinning segment); `.placeholder`'s `--paper` → `--ro-accent-on` to match its children; selection-bar count (`--paper-aged`/`--gilt`) and two `--text-muted` references in `_book-pages.scss`.

**Sass module migration.** Every `@import` in the styles tree replaced with `@use` (`sass-migrator module` + manual follow-up): the module system scopes `@extend` to a file's own dependency graph, so the five partials extending selectors defined elsewhere (`.rating-modal` et al from `_social`, `%widget-surface` from `_dashboard`, `.btn-*` from `_buttons`, …) got explicit `@use` lines, each marked `// dependency for cross-file @extend`. Verified by compiling before/after and comparing rule-for-rule: zero rules changed or lost except six extend-generated selector combinations that cannot co-occur in the DOM (e.g. `.sign-in-confirm .report-book-trigger`). All `@import`/global-builtin deprecation warnings are gone; the build is Dart Sass 3.0-ready. `themes.css` — an unimported hand-synced copy of `_themes.scss` that had already drifted — deleted. Pre-migration styles snapshot in `styles-backup-pre-use-migration/` (delete after verifying).

### v0.43 — Share Cards: page shares, action shares, and reading milestones

**No migration required.** New dependency: `html-to-image` (client-side card → PNG export).

**Page shares.** `ShareModal.jsx` (copy link, native `navigator.share`, X/WhatsApp/Telegram intents) wired into five destinations: Book Page, List detail (public lists only — the button stays gated on `is_public`, replacing the old bare copy-link button), Book Club detail (public clubs only; the join-token link remains the path for private invites), Plan view (any plan with an `_id` — plans were already publicly reachable by UUID via `get_public_plan`), and Profile (both the `/profile` settings page and the `/u/:username` self view). URL builders centralized in `src/lib/shareService.js` so client URLs always match the routes og-prerender covers.

**og-prerender extended.** `netlify/edge-functions/og-prerender.js` now also serves OG/Twitter meta for `/l/:listId`, `/plans/:planId`, `/clubs/:clubId`, and `/u/:username` (config.path extended to match). Public gating is inherited rather than re-invented: lists/plans go through the same `get_public_list`/`get_public_plan` RPCs the share pages use (non-public → null → pass through untouched); clubs are only served when `visibility = 'public'` — enforced explicitly in the function since the service-role key bypasses RLS; profiles render for any username, matching the page's own behaviour. Static-route collisions (`/plans/new`, `/clubs/new`, `/clubs/discover`) are skipped before any fetch. New `callRpc()`/`respond()` helpers deduplicate the per-entity blocks; the book/series handlers are unchanged (series now uses `respond()` too).

**Action shares (the "share moment" system).** New `src/lib/shareMoments.js` — pure, client-only milestone computation, deliberately table-free: milestones are recomputed from the library at the instant of completion and only fire on an *exact threshold crossing* (`count === milestone`), so nothing ever re-fires on reload and no persistence is needed. This is the cheap-accomplishments model; a real achievements system (persistent, retroactive, trophy shelf on Profile) stays post-1.0. `computeCompletionMoments()` returns every moment a completion produced, sorted by significance — goal completed → series completed → plan completed → Nth book of the year (5/10/25/50/75/100/150/200) → genre-count milestone (5/10/25/50 per canonical genre) → first book in a new genre (suppressed until the library has ≥5 books, so early reads aren't all "new territory") → plain book-completed fallback. Only the top moment is shown.

**Wiring:** `DataContext.markAsRead` calls `fireCompletionMoment()` after both the guest and authed library updates (and therefore covers `finishReading` too, which delegates to it). Goodreads imports are excluded — a 400-book import is not 400 celebrations. Plan completion is detected here as well (all plan books present in the post-completion library, and the just-finished book must be one of them, so an unrelated completion can't claim credit for a plan finished weeks ago). Club sessions fire their own moments directly: `SessionCreate` shows a "now reading" card after insert when the club is public; `SessionDetail` offers a deliberate share button on past sessions (no auto-modal — there's no single moment a session "finishes" for a viewer). New DataContext state `shareMoment` + `showShareMoment()`/`dismissShareMoment()`, rendered globally by `<ShareMomentModal/>` in App.jsx's authed shell.

**The card.** `ShareCard.jsx` renders at a fixed 540×675 (4:5) and exports at 2× (1080×1350) via `html-to-image`'s `toPng` — the DOM node stays true-size and is scaled down in the modal with `zoom` (with a `transform: scale()` fallback), so exports stay crisp regardless of viewport. The card is a fixed **brand asset, not an app surface**: its palette is deliberately hardcoded to the Dark Academia constants instead of `var(--ro-*)` so the PNG looks identical in both themes — the one sanctioned exception to the no-hardcoded-parchment rule, flagged as such in `_share.scss`. Cover images are third-party (OpenLibrary/Wikimedia/…); when a host refuses CORS the export throws and the modal degrades to text + link with an explanatory note — never a broken PNG. On no-file-share platforms (desktop) the image downloads and the caption is placed on the clipboard instead.

**Follow-up (v0.43.x):** port the same card template to a satori-based Netlify function so OG *link previews* also show the branded card instead of the raw cover art. Keep `ShareCard.jsx` and that endpoint in sync when either changes. — **Done in v0.45.1** (`netlify/functions/share-card.mjs`): the satori template now renders the shared image; wiring it into the OG/Twitter `<meta>` tags in `og-prerender.js` is the remaining step to also brand link previews.

i18n: full new `share.*` block (modal labels, card copy per moment type, share texts per entity) in both `en.json` and `es.json`.

**Also in this release — four fixes:**

**Friends Feed books are clickable.** `FriendsFeedWidget` rows made the avatar and friend name clickable but not the book — cover and title now call `openBookTab(ev.book, 'dashboard')` (the feed events already carried `t`/`a`/`coverUrl`, so `bookKey()` resolves).

**Upgrade CTAs → Profile → subscription.** Every "Upgrade to Pro" button (Dashboard AI-quota bar, Spark widget quota states, About pricing card, and a new button on the Oracle quota wall — which previously had upgrade *text* but nothing to click) now does `go('profile', { scrollTo: 'subscription' })`. Profile's subscription section gained `id="pf-subscription"` and a mount effect that `scrollIntoView`s when `?scrollTo=subscription` is present, delayed 150ms so it wins over the router's own scroll-to-top. Checkout itself stays exactly one place: the Profile section's button.

**Checkout hardening.** `create-checkout-session.js` now probes the Lemon Squeezy URL server-side before returning it; a 404/410 (stale `LEMON_SQUEEZY_REDIRECT_URL` — deleted/renamed product) returns a clean 502 the client shows as a toast, instead of letting the LS overlay open a full-screen 404 page that traps browser history. Root cause of the local "Page not found. Request ID: …" symptom is the env var pointing at a dead LS checkout link — verify it against the product's current Share URL in the LS dashboard (local `.env` and Netlify prod env separately).

**Profile restructure: fully tabbed.** My Profile was one long undifferentiated scroll trying to be two pages at once — a reading identity and a settings screen. Now the whole page is one card with five tabs: **Overview** (default: stats grid, pace chart, top genres, most read author — now panel-wrapped instead of floating bare on the background — series in progress, and the Reading Challenge, panel-wrapped with no outer label since the component self-labels), **Account** (identity fields, favorite genres/mood, reading level, library + Goodreads import, danger zone), **Privacy**, **Subscription**, **Notifications**. The active tab is reflected in the URL as `?tab=<name>` via `history.replaceState` (deliberately not `go()` — the router scrolls to top on navigation, wrong for an in-place tab switch, and replaceState avoids one history entry per click). `?scrollTo=subscription` from the Upgrade CTAs is kept as an alias that opens the Subscription tab and scrolls the card into view. Guests see Overview + Account + Privacy. Spacing pass alongside: `pf-section` padding and title margins tightened from `space-6` to `space-4`, account card padding 34→28px, and flush-start rules so content after the tab row doesn't double up separators. Note this supersedes the DS note about stats sections living "directly on the page background" — they now live inside the card's Overview tab.

**Quota display after Pro→Free downgrade.** `calls_used` can legitimately exceed the free limit mid-period after a downgrade (e.g. 14 used, limit 5). `OracleQuotaContext` now clamps `calls_remaining` at 0 (the raw limit−used went negative), and the Dashboard AI-quota bar caps both the displayed used count (`Math.min(used, limit)` → "5 of 5", not "14 of 5") and the fill percentage at 100%. Profile's quota bar percentage is capped the same way. Server values stay untouched — this is display-side only, so the real counter still resets correctly at period end.

### v0.42 — Ask the Oracle, Match %, Dashboard widgets, and complexity/depth backfill

**Migration required:** `supabase/schema_v27_migration.sql`.

**Dashboard — "My Books at Glance."** The hero's numeric chips (previously small inline pills: level badge + Read/Wishlist/Currently Reading counts all mixed together) are now split: the level badge stays a small pill, and the counts move into a prominent `db-glance-grid` of stat cards reusing the exact `.db-stat-card`/`.db-stat-value`/`.db-stat-label` classes from the Reading Stats widget — no new visual language. Added **Reading Plans** and **Book Clubs** counts, which weren't surfaced at the top before (Currently Reading still only shows if > 0; Read/Wishlist/Plans/Clubs always show).

**Dashboard — Book Clubs widget extension.** Previously just name + member count + a generic "View" link, pulled from the lightweight `state.clubs` index (no sessions/members — that's only fetched on demand via `get_club_detail()` per club). New `get_dashboard_clubs_summary()` RPC (v27 migration) aggregates all of the caller's clubs in one round trip instead: member count, the "current" session (active → most recent past → soonest upcoming, so the card never goes blank between sessions), that session's book, and up to 4 member avatars. `ClubsWidget` rebuilt to show the book cover, a `Session N` badge (colored by active/past/upcoming, reusing `--ro-forest` for active — matches the design spec's green pill), a "Reading *{title}*" line, and a stacked avatar row with a "+N reading along" overflow count. Falls back to the old plain name/count row if the summary hasn't loaded yet or a club has no sessions.

**Bug found and fixed post-deploy:** the RPC's member-avatar ordering assumed `book_club_members` has a `created_at` column (to sort "admins first, then earliest joined") — that table predates what's tracked in this repo's migrations, so this wasn't verifiable ahead of time. Failed at runtime with `42703 column m.created_at does not exist` once deployed. Fixed by dropping that ordering criterion entirely (now: admins first, then `user_id` — stable but arbitrary tiebreak). If a `joined_at`/`created_at` column gets added to that table later, swap it back in.

**Dashboard — Yearly Genre Breakdown, in the Reading Goal widget.** Reuses the same `state.genresByBookId` source as Profile's existing all-time "Top genres," but scoped to books read *this year* and capped to the top 3 (Profile's version stays all-time, top 8 — intentionally different, not a duplicate). Styled to match the design spec: 9px bars, one color per genre (burgundy/forest/gold, cycling), sitting below the goal progress bar. Shows even before a reading goal is set.

**Bug found and fixed post-deploy:** the genre bars initially rendered with no visible fill. Root cause: `.db-goal__genre-track` kept `flex: 1` from an earlier side-by-side layout iteration — in that layout `flex: 1` meant "grow to fill remaining width," but after restructuring to a stacked (`flex-direction: column`) layout so long genre names wouldn't truncate, the same property meant "grow to fill remaining *height*" instead. With no fixed height on the row, the track's flex-basis of 0% never had freed space to grow into, so it collapsed to 0px. Fixed by switching to `width: 100%` and letting the column's default `align-items: stretch` handle the width instead.

**New: Ask the Oracle** (`OracleAsk.jsx`, route `/oracle/ask`) — a third recommendation mode alongside By Genres and Based on Other Books, added as a third card on `OracleFork.jsx` (grid widened from 2 to 3 columns). Free-text request box, injects the reader's `favoriteGenres`/`currentMood` (from onboarding) as context alongside the query, with a nudge banner + CTA to Profile when neither is set. Shares the exact same `callClaude()` proxy and `useOracleQuota()` bucket as the other two modes — this is a different prompt shape hitting the same quota, not a separate billing path. Added to the human-readable `/sitemap` page and per-route document title.

**New: Match %.** New shared module `src/lib/matchHelpers.js`:
- `buildTasteProfile(library, genresByBookId, profile)` — computes average rating per genre from the reader's library (books with both a rating and known genres), plus `favoriteGenres`/`currentMood`, plus average complexity/depth of books rated 4-5★. All from data already loaded client-side — no new query.
- `computeLocalMatch(book, tasteProfile, genresByBookId)` — zero-LLM score: genre affinity (best-matching genre's average rating, or partial credit for a stated-favorite genre with no rating history yet) weighted 70%, complexity/depth closeness weighted 30%. Returns `null` (not a fabricated number) when there's no usable signal at all for that book.
- `describeTasteProfile()` + `MATCH_SCORING_INSTRUCTIONS` — shared text injected into every AI-mode prompt, so all three AI modes score against the same rubric. This is a reasoned LLM estimate grounded in real signals we provide, not a reproducible statistical computation — an intentional tradeoff to avoid a separate scoring subsystem.

Wired into all five recommendation paths: `OracleCategories` wishlist/vault draws (previously pure random shuffle with **no scoring at all** — now get a real local match %, draw itself stays random to preserve the "surprise" framing); `OracleCategories` AI mode; `OracleSimilar`'s wishlist/fallback mode (its existing seed-based score — genre/complexity/depth distance to the 1-3 *selected seed books*, not the reader's overall taste profile — is now normalized into an honest 0-100 rather than left as an unbounded raw integer, since "similar to these specific books" is the more correct basis for that page anyway); `OracleSimilar` AI mode; `OracleAsk`. `BookCard.jsx` gained a `.match-badge` pill (gold fill, matching the design spec's `background: var(--ro-gold); color: var(--ro-gold-on)` badge exactly) shown whenever `book.match` is a number.

**Oracle categorization now also assigns complexity/depth.** Both `oracleCategorizationService.js` (in-app "Let the Oracle categorize my books") and `oracleBatch.mjs` (standalone admin backfill script) previously returned only genres + series + description. `complexity`/`depth` were `-- curated only` per the schema comment — every book added via Hardcover/OpenLibrary/Goodreads import or manual entry has always had them `null`, which is what Match % needs to score a reader's own library (as opposed to Reading Plans, which turned out to be unaffected — see note below). Both prompts now also request `complexity`/`depth` (1-5, same rubric already used in `PlanCreate.jsx`: casual/mid/literary/challenging/experimental, with Faulkner/Han Kang/Donoso/Lispector as anchors for the top end) and write them back in the same DB update as the rest of the enrichment. New `sanitizeLevel()` guard (duplicated in both files, since one runs in-browser and one is a standalone Node script) clamps to an integer 1-5 or discards the value entirely — a missing complexity/depth degrades gracefully everywhere downstream; a wrong one baked into the DB would not.

**Investigated, not changed:** confirmed Reading Plans are *not* affected by the complexity/depth gap — `PlanCreate.jsx` and `OracleCategories`'s Vault mode both draw exclusively from `loadVault()`, hard-filtered to `source = 'curated'`, which by construction always has complexity/depth populated. The `(b.c || 3)` fallback in `PlanCreate.jsx` is defensive code that in practice never fires. Worth revisiting if Plans ever expand beyond the curated Vault.

**Fixed — CSP silently blocking OpenLibrary and Google Books.** `connect-src` in `netlify.toml` never included `covers.openlibrary.org`, `openlibrary.org`, or `www.googleapis.com`. `img-src` allows `https:` broadly, so `<img>` tags loading covers directly always worked — but `connect-src` governs `fetch()`, which is what broke two separate things: (1) the service worker's runtime image-caching (`workbox` calling `fetch()` to cache covers for offline use — the visible symptom that surfaced this), and (2) actual lookup calls in `coverService.js`, `bookLookup.js`, and `enrichmentService.js`, which all call these three domains directly via `fetch()` (not through a Netlify function proxy, unlike Hardcover and Wikipedia, which are proxied and unaffected). The OpenLibrary tier of the Hardcover → OpenLibrary → Wikipedia lookup chain, and the Google Books fallback, have likely been silently failing in production this whole time — caught in try/catch, falling through to the next source. Added all three domains to `connect-src`.

**Found, not fixed this release:** `bookPage.verified`'s translation string already includes the ☩ symbol (`"☩ Verified"`), but `BookCard.jsx` also prepends a literal `☩` in JSX — the verified badge has likely been rendering a doubled symbol since it was introduced. Left as-is since it's unrelated to this release's scope; flagging for a future pass.

i18n: new `oracle.forkByAsk`/`forkByAskDesc`/`ask*` keys (Ask the Oracle page + nudge banner), `dashboard.glanceRead`/`glanceWishlist`/`glanceClubs`/`goalWidgetGenresTitle`, `dashboard.clubSession`/`clubReadingMeta`/`clubMemberCount`/`clubReadingAlong`, and `bookPage.match` — all added to both `en.json` and `es.json`. `oracle.forkSubtitle` updated from "Two ways…" to "Three ways…".

### v0.40.1 — Public Club Directory: search, join modes, waitlist

**Migration required:** `supabase/schema_v26_migration.sql`.

**First slice of v0.40.** Book clubs can now be discovered and joined from inside the app without an invite link — still fully auth-gated, no unauthenticated access anywhere in this release.

**Schema.** `book_clubs` gains `visibility` (`private` | `public`, default `private`), `join_mode` (`auto` | `approval`), and `max_members` (nullable = unlimited). New `book_club_moods` mirrors the existing `book_club_genres` pattern against the same 8-id mood taxonomy from onboarding (`comfort`, `challenge`, `escapism`, `mind-bending`, `character-driven`, `atmospheric`, `fast-paced`, `short-read`), so clubs can be tagged and filtered by vibe as well as genre. New `club_join_requests` is a single queue table covering both "awaiting admin approval" and "waitlisted, club is full" — a partial unique index (`club_id, user_id` where status is active) allows a fresh request after a past one resolved.

**RPCs, all `security definer`.** `join_public_club()` locks the club row before counting members, so two people can't race the last open seat — routes to instant membership, a pending-approval request, or the waitlist depending on `join_mode` and remaining capacity. `approve_join_request()` / `reject_join_request()` are the admin actions; approval re-checks capacity in case the club filled up since the request was made, holding on the waitlist instead of over-filling. A `promote_from_waitlist()` trigger fires `after delete on book_club_members`: frees exactly one seat, so promotes exactly the oldest waitlisted request — straight to member if `join_mode = 'auto'`, or back to `pending_approval` if `'approval'` (a freed seat doesn't waive admin review). `search_public_clubs()` powers the directory: text search, genre/mood filters, an open-only filter, and three sort orders (activity / members / newest), joined against each club's active `book_club_sessions` row (if any) for a "currently reading" preview.

**Notifications.** `notifications.type` extended with `join_request`, `join_approved`, `join_rejected`, `waitlist_promoted`.

**New UI.** `ClubDirectory.jsx` (`/clubs/discover`) — search bar, genre/mood chip filters, open-only toggle, sort dropdown, and a card grid showing each club's join-mode badge, member count vs. cap, and currently-reading book. Descriptions clamp to 3 lines with a "View more" toggle that only appears when the text actually overflows (measured via `scrollHeight` vs `clientHeight`, not a fixed word count). Linked from a new "Discover clubs" button next to "New book club" on the existing Book Clubs page. `BookClubCreate.jsx` gained a Private/Public toggle plus (when Public) join-mode, member-limit, and mood-tag fields.

**Fixed in passing — `BookClubCreate.jsx` colors.** Its name/description fields were still using inline `style` objects referencing `--paper`/`--gilt`, pre-rename theme variables that don't exist since the `--ro-` token rename in v0.37.1 (that sweep covered `EditSessionModal` in the same file family but missed this one) — they were silently falling back to browser defaults instead of the DS. Replaced with `.field-label`/`.input`.

**Deferred to the next slice (v0.40.2):** the admin-facing "Pending requests" / "Waitlist" panel in `BookClubDetail.jsx`. The data functions (`fetchClubJoinRequests`, `approveJoinRequest`, `rejectJoinRequest`) are already in `DataContext.jsx` — this release just doesn't have the UI wired up yet, so approvals/rejections need to go through Supabase directly until then.

No i18n changes skipped — new `clubs.directory.*` keys and `clubs.fieldVisibility`/`fieldJoinMode`/`fieldMaxMembers`/`fieldMoods` and friends added to both `en.json` and `es.json`.

### v0.37.1 — Design System redesign: sign-in, forms, Oracle, clubs, profile

**Major redesign, no DB migrations required.** This is the first full pass powered by the Books Oracle Design System — sign-in/onboarding, both Oracle recommendation flows, the book club page, several forms, and the Profile page were rebuilt end-to-end to match the design system's components (corner-bracketed cards, the real button/input system, `.book-card`/`.oracle-fork-*`/`.bp-*` families) instead of a patchwork of styled and unstyled screens.

This release is a design-system alignment pass across several views that had drifted from `main.scss` — either using class names with no matching CSS rule (rendering as unstyled browser defaults), or inline `style` objects referencing pre-rename theme variables like `--gilt`/`--paper`/`--paper-aged`/`--ink` that no longer exist since the `--ro-` token rename.

**Fixed — crash in club sessions.** `MemberProgressRow` in `SessionDetail.jsx` called `t()` without ever calling `useT()` in its own scope, throwing `ReferenceError: t is not defined` for any session where a member had page-count progress to render. Same bug, same fix, also existed in `EditSessionModal` in the same file.

**Fixed — i18n interpolation swallowed React elements.** `I18nContext.jsx`'s `t()`/`tNode()` interpolation coerced every `{var}` substitution with `String(value)`, so a translation call that embeds a live element (e.g. `t('signIn.guestPrompt', { link: <a>...</a> })`) rendered the literal text `[object Object]` instead of a clickable link. Added `interpolateNode()` for the plain-string path and reworked `htmlToReact()`'s substitution step to splice element vars in as real child nodes via a sentinel-split instead of stringifying them. No call sites needed to change other than switching `SignInGate` and `Onboarding`'s guest-link prompts from `t()` to `tNode()`.

**Sign-in & onboarding.** `.onboarding-wrap`, `.onboarding-card`, `.onb-eyebrow/-title/-desc/-actions`, `.choice-grid/.choice/-title/-sub`, and `.upload-zone/-icon/-text/-sub/-help` had zero CSS behind them anywhere in the stylesheet — the sign-in gate and the whole 3-step onboarding flow rendered as plain unstyled text. Added `src/styles/components/_onboarding.scss` implementing the DS "Login & Onboarding" pattern (bracketed card, step segments, option cards, CSV dropzone), registered in `main.scss`.

**Corner brackets on modals/cards.** `.rating-modal` and `.pf-account-card` drew their top-left/top-right corner brackets via `::before`/`::after` (automatic), but the bottom-left/bottom-right corners were defined as `.rating-modal__bl`/`.rating-modal__br` (resp. `pf-account-card__bl`/`__br`) — classes that require literal child `<div>`s no component ever rendered. Every modal and the profile account card has therefore only ever shown two of its four corners. Replaced with a single `ro-corner-brackets()` mixin (new, in `_tokens.scss`) that draws all four corners as one layered `background-image` on `::before` — no markup changes needed in any consuming component.

**Book Club page.** `.page-header/-eyebrow/-title` → `.page-head/-head__eyebrow/-head__title` (matches `_global.scss`). `.li-genre-pill` → `.chip`. All `.li-action` buttons (a class with only a `--disabled` modifier defined, no base rule) replaced with the real button system: `.btn-tertiary`/`.btn-secondary` for toolbar actions, `.btn-text` for small inline row actions (promote/remove member), `.btn-danger` for the delete-club flow.

**Oracle pages.** `OracleFork.jsx`, `OracleCategories.jsx`, `OracleSimilar.jsx`: same `.page-header` → `.page-head` fix, plus `.oracle-fork`/`.cta-card`/`.cta-title`/`.cta-desc` (undefined) → the real `.oracle-fork-grid`/`.oracle-fork-card`/`__label`/`__sub` classes already defined in `_book-pages.scss`. Added `.oracle-mode-toggle`, `.toggle-group`/`.toggle-btn`/`.toggle-sub`, `.controls`/`.field`, `.oracle-results-grid`, `.selection-tray`/`.tray-chip`/`.chip-title`/`.chip-remove`, and `.book-tile`/`.book-tile-grid` to `_book-pages.scss` — none of these existed. `BookCard.jsx` (used for every Oracle recommendation) was rebuilt on the real `.book-card` component from `_cards.scss`, including `.book-card__quote` for the AI's "why this book" line — previously an inline-styled `<em>` referencing `var(--gilt)`. `SelectableCard` in `OracleSimilar.jsx` now reuses the shared `BookCover` component instead of duplicating placeholder logic inline.

**Forms.** `ReportBookForm.jsx`'s classes (`report-book*`) had no CSS at all — added a full definition to `_book-pages.scss` reusing `.btn-text`/`.bp-section__label`/`.textarea`. The "new list" modal (`Lists.jsx`) and `AddToListModal.jsx` now use `.field-label`/`.input`/`.textarea`/`.overlay` instead of `.form-label`/`.search-input`/`.modal-backdrop` (none of which exist). `EditSessionModal` in `SessionDetail.jsx` had its `inputStyle`/`labelStyle` objects (built from `--paper`/`--gilt`) removed in favor of `.field-label`/`.input`.

**Profile page layout.** Per the DS profile pattern, Reading Stats / Pace / Top Genres / Most Read Author / Series in Progress are meant to be free-standing sections directly on the page (each already has its own bordered cards/rows) — not nested inside one shared panel. Un-wrapped them from the enclosing `.panel` into a new `.profile-stats` flex column (36px rhythm via `--ro-space-8`); the Account/Username/Privacy/Reading Challenge/Subscription block below remains a single bordered card, matching the DS spec exactly.

**Codebase-wide cleanup.** Swept every `.jsx` file for two recurring anti-patterns: (1) a dead `"btn "` prefix in front of a real `.btn-primary`/`-secondary`/etc. class (`.btn` bare never existed), found in 23 files; (2) duplicate `className` attributes on a single element — invalid JSX where only the second value is ever applied, silently dropping the first. Fixed the instances directly tied to the views above (`BookModal.jsx` in `components/`, `ReleaseNotesModal.jsx`). Several more duplicate-`className` instances were found after this release shipped — see **v0.37.2** below for the full sweep.

### v0.39.9 — Fixed silent 1000-row truncation in sitemap.xml and og-prerender

**No migration required.**

**Root cause, found from Simon's own production logs** (`Fetched 1000 verified books... Match found: false`): PostgREST caps the rows returned by any single query at the Supabase project's "Max Rows" setting, which defaults to **1000** — and it overrides whatever `.limit()`/`limit=` value the request asks for. Both `og-prerender.js` (`limit=5000`) and `sitemap.js` (`.limit(5000)`) silently got truncated to the first 1000 rows in whatever default order Postgres returned them, so any book past that point could never be found or listed — with zero error, since PostgREST doesn't consider this an error condition.

**Fix:** both now paginate with `offset`/`.range()` in pages of 1000, capped at 20 pages (20,000 books) as a hard ceiling so a runaway catalog size can't hang either function indefinitely. `og-prerender.js` stops as soon as it finds a match, so most real bot requests should still only cost one or two round trips rather than scanning the whole catalog every time. `sitemap.js` always needs the full catalog regardless, so it pages straight through to the end.

No i18n changes this release.

### v0.39.8 — Fixed og-prerender's book lookup (never matched anything)

**No migration required.**

**Root cause, found via Simon's own debug logging added to the deployed function:** a version of `og-prerender.js` had replaced the fetch-all-and-match approach with an `ilike` search on a chunk of the already-normalized `bookKey()` string (e.g. searching for `"thehaunt"`). That can never match anything: `bookKey()` strips spaces and punctuation before comparing, but the `ilike` search runs against the raw `title` column, which still has them — `"The Haunting of Hill House"` does not literally contain the substring `"thehaunt"` (there's a space between "The" and "Haunting"). Every lookup silently failed, for every book, regardless of what was in the database. Verified against the exact book from the bug report: `bookKey("The Haunting of Hill House", "Shirley Jackson")` computes to `thehauntingofhillhouse|shirleyjac`, matching the requested URL exactly once the fetch-and-compare-in-JS approach (same tradeoff `sitemap.js` already makes — there's no stored `book_key` column to query by directly) is restored.

**Also widened the status filter** in both `og-prerender.js` and `sitemap.js` from `status = 'verified'` to `status IN ('verified', 'oracle_categorized')` — the app's own `DataContext.jsx` treats those two as equivalent everywhere else (Oracle-categorized books show the same "verified" pill in the UI), so both were silently excluding a real chunk of the catalog for no good reason.

No i18n changes this release.

### v0.39.7 — OG-tag prerendering for social/link-preview bots

**⚠️ Not yet verified on a live deploy.** This is the deferred piece flagged back in v0.39.2/v0.39.3: `useDocumentMeta()` (client-side) covers Google fine since it executes JS before indexing, but does nothing for Slack/Twitter/WhatsApp/Discord-style unfurl bots, which fetch HTML once and never run JS. Edge Functions run on a Deno runtime that can't be simulated in a sandbox, so this has only been reviewed for logical correctness — the pure logic (bot-UA regex, `bookKey()` matching, HTML `<head>` injection) was unit-tested against the real `index.html` and real bot user-agent strings, but the actual Supabase REST calls and Deno-specific APIs (`Deno.env.get`, edge `context.next()`) have not run against a real deploy. **Test with a real preview deploy before trusting this in production** — a bot-UA curl request or a tool like opengraph.xyz / Twitter's card validator against a real book URL, and check Netlify's edge function logs for the first few real hits.

**No migration required.** No new env vars — reuses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, already configured for `sitemap.js` and `send-notification-email.js`.

**`netlify/edge-functions/og-prerender.js`** — new Edge Function, scoped via its own `config.path = ['/book/*', '/series/*']` export (Netlify's modern per-function routing, no `netlify.toml` redirect needed for the routing itself). Checks the request's `User-Agent` against a bot pattern covering Facebook, Twitter/X, Slack, WhatsApp, Telegram, Discord, LinkedIn, Pinterest, Reddit, Tumblr, Applebot, Googlebot, and a handful of SEO/crawler tools (Ahrefs, Semrush) and generic `bot`/`crawl`/`spider` substrings. Real browsers and anything that doesn't match pass straight through via `context.next()` — completely untouched, zero risk to normal traffic.

For a matched bot request to `/book/:bookKey`, fetches verified catalog books from Supabase and finds the one whose computed `bookKey()` matches the URL param (same tradeoff `sitemap.js` already makes — there's no stored `book_key` column to query by directly, so it scans and computes per-row; bounded to bot traffic only, a small fraction of real requests, so the cost is acceptable). For `/series/:seriesName`, looks the series up directly by its indexed `normalized_name` column — no scan needed there. Either way, injects a real `<title>`, `<meta name="description">`, `og:title`/`og:description`/`og:image`/`og:url`, a `twitter:card` tag, a canonical link, and Schema.org JSON-LD (`Book` or `BookSeries`) into the served HTML's `<head>` — removing the static `<title>`/description tags first so there's never a duplicate. Any Supabase error, missing env vars, or no-match falls through to the unmodified page rather than risking a broken response for a bot (or, in a request-mixing edge case, a real user).

**`netlify.toml`** — added `edge_functions = "netlify/edge-functions"` to the `[build]` block, explicit alongside the existing `functions = "netlify/functions"` declaration (matches Netlify's default location either way, just made explicit for consistency with how the Node functions directory is already declared).

No i18n changes this release (OG tags are generated server-side in English only — worth revisiting if Spanish-language link previews matter, since the client already knows the visitor's language but this Edge Function has no way to know it before the response is served).

### v0.39.6 — Series page rebuilt, silent-fail bug in read-date/rating edits

**No migration required.**

**Profile stats not reflecting an edited read date.** `updateReadBook()` in `DataContext.jsx` had `if (!user || !book.bookId) return;` *after* the optimistic local `setState` had already run — meaning whenever `book.bookId` was falsy, the edit looked successful in the moment (local state updated, UI reflected the new date/rating immediately) but the Supabase write never fired. Next fresh load (new session, different device, or just the session cache expiring) pulled the old value back from the server, silently reverting the edit — exactly matching the report of a corrected read-date reverting to the wrong month in Profile stats. Fixed to mirror the same resolve-or-create fallback `markAsRead()` already uses: `const bookId = book.bookId || (await upsertBookOnServer(book))`, only giving up (with a toast) if that still fails. This is shared by every editor built on `updateReadBook` — `BookModal.jsx`, `Library.jsx`, and `BookPage.jsx`'s rating editor all get the fix automatically.

**Series page was substantially unstyled.** Confirmed by request: `SeriesPage.jsx` renders ~25 `series-page-*` classes plus `page-eyebrow` and `book-modal-section-title`, and **none of them had a matching CSS rule anywhere in the codebase.** The only reason the page wasn't *completely* bare was that two classes it happens to share with `BookPage.jsx` — `sp-read-label` and `sp-purchase-link` — survived. The likely history: an earlier version of this page used a `.sp-*`/BEM naming scheme (`.sp-page`, `.sp-progress__label`, `.sp-bar__fill`, etc.), which still existed in `_book-pages.scss`, but the component was rewritten to use `.series-page-*` names without anyone updating (or removing) the old CSS. Rewrote the stylesheet from scratch against the classes the component actually renders, and removed the dead `.sp-page`/`.sp-progress*`/`.sp-bar*`/`.sp-description`/`.sp-books-label`/`.sp-no-books` rules that nothing used. Swapped the two other dead references directly in the JSX: `page-eyebrow` → `page-head__eyebrow`, `book-modal-section-title` → `bp-section__label` (both real, already-styled classes used elsewhere in the DS).

**Given its own visual identity, not a reskinned Reading Plan.** Per explicit request — series and plans should read as different things. Three deliberate departures from `.plan-hero`: (1) upright, non-italic display title (both `.plan-hero__title` and `.bp-title` are italic); (2) forest-green progress bar/badges instead of the gold used everywhere else for progress (Oracle Spark, CurrentlyReading, Plans); (3) book list is a row-per-book layout with a position number and a colored left-border (forest for read, gold for queued) — closer to a table of contents than `.plan-month-card`'s stacked cards or `.book-tile-grid`'s cover grid.

**`.li-action` had no base rule at all** — only `.li-action--disabled` existed. Every plain `<button className="li-action">` (and the `.danger`/`.success` modifiers used on the series page) rendered with zero styling, just browser button defaults. Added a proper small-text-button base plus `.danger` (burgundy) and `.success` (forest) color modifiers. This is shared markup used in `ListView.jsx` and `SessionCreate.jsx` too, so both incidentally get real styling now as well — not something previously reported, but the same missing base class, so worth knowing about.

No i18n changes this release.

### v0.39.5 — Mobile search, reading progress on BookPage, remaining phantom-scroll spots

**No migration required.**

**Mobile search bar was invisible.** `NavSearch.jsx`'s own root div always renders `className="nav-search"` regardless of the `compact` prop passed to it — the `compact` prop only changes internal layout, not the wrapper class. `.nav-search` has a `@include ro-down(tablet) { display: none; }` rule, correctly hiding the *desktop topbar* copy on small screens — but since the mobile hamburger menu's search (`.mobile-menu__search > NavSearch`) uses that same inner class, that rule hid it too, leaving mobile with no way to search at all. Fixed with a scoped override: `.mobile-menu__search .nav-search { display: block; ... }`.

**"Mark as read" didn't open the rating prompt.** Both `markAsRead` buttons on `BookPage.jsx` (read-next → read, and neither → read) called `markAsRead(display)` and stopped there — same as every other call site in the app (`BookModal.jsx`, `SelectionBar.jsx`, `PlanView.jsx`, `ReadNext.jsx`, `SeriesPage.jsx` all do the same). `BookPage.jsx` already had a working rating-edit flow (`ratingEditorOpen` + `RatingModal`, triggered by a separate "Add rating" button once a book's already in the library) — it just wasn't wired to the initial mark-as-read action. Both buttons now `await markAsRead(display)` then `setRatingEditorOpen(true)`; by the time the promise resolves, `state.library` has the new entry, so `libraryRow` resolves and the modal opens with it already selected. Also switched the modal's `mode` from a hardcoded `"edit"` to `liveRating > 0 ? 'edit' : 'create'`, so the copy is correct for a freshly-rated book instead of always saying "Edit".

**No way to track reading progress from BookPage.** The action-button chain only branched on `inLib` / `inNext` / neither — there was no case at all for a book currently in `state.currentlyReading`. Visiting a book you'd already started reading fell through to the "neither" branch, showing "Add to wishlist"/"Add to next" as if you hadn't touched it. Added a proper `inCurrentlyReading` branch, porting the exact progress-bar markup, `finishReading`/`updateReadingProgress` calls, and `RatingModal`/`ProgressUpdateModal` wiring already working in `CurrentlyReading.jsx` (same `.cr-progress-*` classes, already global in `_book-pages.scss` — no new CSS needed). Shows the progress bar + percentage, an "Update progress" button (opens `ProgressUpdateModal`), a "Mark finished" button (opens `RatingModal` in `finish` mode, same as the currently-reading list view), and a remove option.

**Remaining phantom-scroll spots from v0.39.4:** that release fixed `.app`/`.onboarding-wrap`/`.loading`/`.book-loader`/`.modal`, but missed two real-world cases that only show up in nested contexts:
- **`.onboarding-wrap`** is used by two different kinds of pages: standalone full-screen ones (`SignInGate`, `Onboarding.jsx` — correctly full-viewport) and, since v0.39.3, `NotFound.jsx`, which renders *nested* below `Nav` and above `Footer` via `App.jsx`'s `legalViews` map. Forcing another full `100dvh` inside a page that already has `.app`'s own `100dvh` plus `Nav` plus `.container` padding produced a page far taller than one screen — the huge whitespace reported on the 404 page. Added an `.onboarding-wrap--nested` modifier (applied only in `NotFound.jsx`) that drops the height force entirely rather than trying to compute an exact `calc()` offset.
- **`.loading`** (used by `PlanCreate.jsx`, `ListView.jsx`, `BookClubDetail.jsx`, `PlanView.jsx`, `FriendProfile.jsx`, `SessionDetail.jsx`, `JoinClub.jsx`, `SeriesPage.jsx`) had the same `min-height: 100dvh` — but every single one of its usages is a spinner nested below `Nav`, never a standalone full-page state (those all use `.book-loader--full` instead, which was already correct). Reduced to `min-height: 50vh` — enough to center a spinner without pushing the page well past one screen.

No i18n changes this release (all the reused progress/finish copy already existed from `CurrentlyReading.jsx`).

### v0.39.4 — Fixed mobile phantom scroll (100vh bug)

**No migration required. Pure CSS fix, 6 files.**

**The bug:** several full-screen containers (`.app`, `.onboarding-wrap` used by both the sign-in gate and onboarding, `.loading`, `.book-loader`, plus `html`/`body` and `.modal`'s max-height) used `min-height: 100vh` / `calc(100vh - 52px)`. On mobile Safari and Chrome, `100vh` is measured against the *largest* possible viewport (address bar hidden), which is taller than what's actually visible when the address bar is showing — typically true on first load. That extra difference becomes phantom scroll space below content that should fill the screen exactly, which is what showed up on the sign-in page.

**The fix:** every `min-height: 100vh` (and the modal's `max-height: calc(100vh - 52px)`) now has a second declaration right after it using `100dvh` (dynamic viewport height — tracks the *actual* visible viewport as the browser chrome shows/hides). Browsers that don't understand `dvh` simply ignore that second line and keep the `100vh` fallback; browsers that do (all mobile Safari/Chrome versions relevant here) use the accurate value. Same technique in both declarations — the second line always wins where supported, without needing a feature-detection JS check.

Files touched: `src/styles/_reset.scss`, `src/styles/_global.scss`, `src/styles/layout/_shell.scss`, `src/styles/components/_onboarding.scss`, `src/styles/components/_book-loader.scss`, `src/styles/components/_modal.scss`.

**On the second report (links not scrolling to top on click):** traced this to the still-live production build predating the v0.39.1 path-routing rewrite — the old hash router never called `window.scrollTo()` on navigation at all. The new `RouterContext.jsx` (shipped in v0.39.1, not yet deployed as of this writing) already calls `window.scrollTo({ top: 0, behavior: 'smooth' })` on every `go()`, so this should resolve once v0.39.1+ is deployed. Confirm after deploying — flag it again if it's still happening once the new router is live.

**Also checked and confirmed fine:** the sign-in page's Privacy/Terms/Refund links (`<a href="#privacy" target="_blank">`) still work correctly under the new router — `target="_blank"` opens a fresh tab/app instance, and `RouterContext.jsx`'s legacy-hash migration (added in v0.39.1) catches bare `#privacy`-style hashes on load and redirects to `/privacy`. Not broken, but worth knowing it's currently depending on that "legacy bookmark" migration path rather than calling `go()` directly — fine for now, but flag if that migration code is ever removed down the line.

### v0.39.3 — Real 404 page, human sitemap page

**No migration required.**

**Router fallback changed.** Previously, any unmatched path silently rendered the dashboard (`parseLocation()` fell back to `{ name: 'dashboard' }` for literally anything it couldn't parse) — which meant broken links, typos, or stale bookmarks quietly looked like they worked instead of telling the visitor (or a crawler) the page doesn't exist. `RouterContext.jsx` now returns `{ name: 'not-found', params: { path: pathname } }` for anything unmatched. Root `/` is unaffected — that's still `dashboard`, intentionally. One nice side effect: `/book/` with an empty/missing key now correctly 404s instead of silently opening the dashboard.

**`NotFound.jsx`** — new view, reuses the `onboarding-card` shell (same centered card, gold corner brackets) rather than introducing a new layout. Oracle-themed copy (\"The Oracle can't see where you're going\") with a small inline closed-eye SVG in the same line-art style as the app's other icons (`IconSparkle`, etc. in `Dashboard.jsx`). Sets `noindex` via `useDocumentMeta()` so search engines don't index it.

**`useDocumentMeta.js`** — gained a `noindex` option: adds `<meta name="robots" content="noindex, nofollow">` when true, and explicitly *removes* that tag when false/omitted, so it can't linger on a real page after visiting the 404 and navigating away.

**`App.jsx`** — `not-found` and `sitemap` added to `PUBLIC_ROUTES` and the `legalViews` render map (same pattern as `privacy`/`terms`/`refund` — rendered with `Nav`/`Footer` in guest mode for signed-out visitors). `not-found` gets an explicit `ROUTE_META` entry with `noindex: true`; this has to be set at the App.jsx level (not just inside `NotFound.jsx`) because parent effects commit *after* child effects in React, so without it the generic default would silently clear the noindex flag `NotFound.jsx` just set.

**`SitemapPage.jsx`** — new human-readable sitemap at `/sitemap` (distinct from the machine-readable `/sitemap.xml` function from v0.39.2), grouped into Explore (Home, About, Oracle, genre/similar-books finders, reading plans, book clubs) and Legal. Deliberately excludes wishlist/library/currently-reading/profile — those are personal, auth-gated, per-user views with nothing stable to link to for a signed-out visitor or a crawler; the intro text says so explicitly. Linked from `Footer.jsx`'s legal-links column. Also added as a low-priority static entry in `sitemap.xml`.

New i18n keys: `footer.sitemap`, `notFound.*` (eyebrow/title/desc/cta), `sitemapPage.*` (title/desc/heading/intro/section.explore/section.legal), EN + ES CR vos.

### v0.39.2 — Sitemap, per-route titles, sitemap.xml

**No DB migration.** `netlify/functions/sitemap.js` reads the existing `books`/`series` tables read-only with the service role key already configured for `send-notification-email.js` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). If those env vars are ever unset, the function degrades to serving just the static entries rather than erroring.

**`src/lib/useDocumentMeta.js`** — new shared hook. Sets `document.title`, `<meta name="description">`, and basic `og:title`/`og:description`/`og:image`/`og:url` tags client-side on route/data change. This helps Google (which renders JS before indexing) and gives every page a correct browser-tab title; it does **not** help non-JS social preview bots (Slack/Twitter/Facebook unfurls), which need server-side injection — that's a separate, not-yet-built piece (see below).

**`App.jsx`** — added a `ROUTE_META` map giving every static route (dashboard, wishlist, library, profile, oracle, legal pages, etc.) a real title/description via `useDocumentMeta()`. Deliberately excludes `book-page` and `series-page`: React commits child effects before parent effects, so a generic default set here would run *after* and clobber the specific title those two views set once their data resolves.

**`BookPage.jsx` / `SeriesPage.jsx`** — each now calls `useDocumentMeta()` directly once its data resolves: book pages get `"{title} by {author} — The Books Oracle"` plus the book's own description (truncated to 200 chars) and cover as `og:image`; series pages get `"{name} series — The Books Oracle"` plus the Wikipedia-sourced description once it loads.

**`netlify/functions/sitemap.js`** — new function, generates `sitemap.xml` at request time (not build time, so it's always current without a redeploy) from every `books` row with `status = 'verified'`, using the exact same `bookKey()` normalization as the client (duplicated here since this runs server-side) so every catalog book's sitemap URL matches its real `/book/:bookKey` route. Also walks each book's linked `series` row for `/series/:name` entries. Static public routes (home, about, legal pages) are always included, even if the DB query fails, so a transient Supabase hiccup degrades to a partial sitemap instead of a 500. **Scope note:** this only covers the curated/verified catalog and its series — user-generated public pages (shared lists, plans, friend profiles) are intentionally excluded since they're ephemeral/private-by-default and not meaningful to index.

**`netlify.toml`** — added a `/sitemap.xml → /.netlify/functions/sitemap` rewrite (status 200, not a redirect, so the URL bar stays `/sitemap.xml`), placed before the SPA catch-all so it takes precedence.

**Still pending for v0.39 (deliberately deferred, not attempted this pass):** server-side meta-tag injection for non-JS crawlers (Slack/Twitter/Facebook link previews, older/simpler bots). The client-side `useDocumentMeta()` hook above covers Google and any modern JS-executing crawler, but real coverage for unfurl bots needs either a Netlify Edge Function that detects bot user-agents and injects OG tags into the HTML server-side, or a prerendering service. This needs a live preview deploy to test properly (can't be verified in this sandbox), so it's being held for a follow-up pass rather than shipped unverified.

No i18n changes this release (titles/descriptions are currently English-only static strings in `App.jsx`/`BookPage.jsx`/`SeriesPage.jsx` — worth moving into `en.json`/`es.json` in a later pass if Spanish-language search visibility matters).

### v0.39.1 — Path-based routing (SEO groundwork)

**No migration required.** Purely client-side routing change; no schema, RPC, or Netlify config changes.

**What it does.** Replaces hash-based routing (`#/book-page?bookKey=...`) with real paths (`/book/houseofleaves%7Cmark`) across the whole app. This is step one of the v0.39 SEO release — real paths are crawlable and shareable in a way hash fragments never reliably were (most non-JS crawlers/scrapers, including OG preview bots for Slack/social, don't execute JS and can't see anything after a `#`). Per-route meta tags, canonical tags, and prerendering (the rest of v0.39) all depend on this landing first.

**Domain note.** Primary domain is now `thebooksoracle.com`; `.net`/`.org` are set up as redirects at the Netlify level (confirmed, no code change needed there). `readingoracle.com` was indexed previously and is **not yet redirected** to the new domain — that's an action item outside this codebase (needs `readingoracle.com` pointed at Netlify with its own redirect rule, or a 301 configured wherever it's currently hosted) to avoid losing its crawl history/backlinks.

**`RouterContext.jsx` — rewritten.** `parseHash`/`writeHash` replaced with `parseLocation`/`buildPath`. Routes are declared once in `ROUTE_DEFS` as either static (`/wishlist`) or dynamic with a `:param` segment (`/book/:bookKey`). Static paths are matched via an exact-match table *before* dynamic patterns are tried, so `/clubs/new` can never be misparsed as `/clubs/:clubId` with `clubId === 'new'`. The public/shareable routes got real dynamic segments: `/book/:bookKey`, `/series/:seriesName`, `/plans/:planId`, `/l/:listId` (public share view), `/lists/:listId` (owner management view — deliberately a different prefix than `/l/` to avoid colliding with the public one), `/clubs/:clubId`, `/clubs/:clubId/sessions/new`, `/sessions/:sessionId`, `/join/:token`, and the existing `/u/:username`. Everything else (dashboard, wishlist, library, profile, oracle, etc.) got a static clean path. Non-path params (`from`, `fromLabel`, `anchor`, `snap`, `preview`, `prefillTitle`/`prefillAuthor`) still ride along as a query string exactly as before — the `go(name, params)` call signature used by ~15 view files didn't change, only how the router turns it into a URL.

**Legacy hash migration.** On load, if the URL still has an old-style hash (`#/book-page?bookKey=...`), `migrateLegacyHash()` parses it and rewrites the address bar to the new path via `history.replaceState`, so old bookmarks/shared links/anything Google indexed under the hash scheme keeps working and gets carried forward to the new URL shape rather than silently breaking.

**Edge case handled.** `go('plan-view')` is called in one place before a plan's id is known yet (right after creation). Rather than writing a broken `/plans/undefined` into the address bar (which would also misparse as a real `planId` of `"undefined"` on refresh), `buildPath()` now returns `null` and skips the URL update when a required dynamic param is missing — the view still renders correctly from React state either way; only the address bar update is skipped.

**Preserved `?lang=` query param.** `I18nContext.jsx`'s language sync previously worked because the pathname/search never changed under hash routing — only the hash did. Since `go()` now rebuilds the full path *and* query string on every navigation, it explicitly re-reads and re-appends the current `?lang=` value so it doesn't get silently dropped on the first click after a language switch.

**Manual hash-URL construction fixed in 3 places that bypassed the router directly:** `BookPage.jsx` was patching `window.location.hash` in place on load (now patches the real `/book/:bookKey` path instead); `Lists.jsx` and `ListDetail.jsx`'s "copy link" button and `BookClubDetail.jsx`'s `joinUrl()` were hand-building `#list-view?listId=...` / `#join-club?token=...` strings — all three now build real `/l/:listId` and `/join/:token` URLs.

**`App.jsx`.** Added a `<link rel="canonical">` sync effect, always pointed at `thebooksoracle.com` regardless of which domain/alias served the request. This is a partial, client-side-only step; full per-route `<title>`/OG/meta tags and prerendering for crawlers that don't execute JS are still pending (tracked as the next piece of v0.39).

**`public/robots.txt`** added, referencing `https://thebooksoracle.com/sitemap.xml` (the sitemap itself is generated in a later v0.39 step, once the public route list is finalized).

No i18n changes this release.

### v0.38 — Onboarding overhaul: favorite genres, current mood

**No migration required.** New fields live under the existing `profiles.preferences` JSONB, same as `readingLevel`/`goal`/`goodreadsImported`. No new columns or tables.

**What it does.** Onboarding is now 5 steps instead of 3: reading level → **favorite genres (new)** → **current mood (new)** → Goodreads import → goal. Favorite genres are picked from the existing seeded `genres` table (multi-select, up to 5). Current mood is a fixed set of 8 chips (comfort, challenge, escapism, mind-bending, character-driven, atmospheric, fast-paced, short-read), multi-select up to 3. Both are optional — no validation blocks `Continue`.

**Existing users are not prompted.** Per product decision, only new signups go through the updated flow. Existing users see and set these fields from Profile whenever they like; there's no forced re-onboarding banner or modal.

**`Onboarding.jsx`.** Reworked from 3 to 5 steps (`TOTAL_STEPS = 5`, step dots now render via a loop instead of 3 hardcoded divs). Added `favoriteGenres`/`currentMood` local state, `toggleGenre`/`toggleMood` handlers with `GENRE_MAX = 5` / `MOOD_MAX = 3` caps, and a `genreOptions` list sourced from `state.genres` (already loaded globally by `DataContext`). Both are written to the profile in `finish()` alongside the existing fields.

**`Profile.jsx`.** New `ReaderPrefsSection` component, mounted below `PrivacySection`, mirrors the existing collapsed-summary-with-Edit pattern used elsewhere on the page. Shows the current selections as a comma-separated summary with an Edit button that expands into the same chip grid used in onboarding. Writes go through the existing generic `setProfile()` patch function — no new DataContext mutator was needed since `preferences` already persists arbitrary profile keys on every state change.

**`DataContext.jsx`.** `favoriteGenres: []` and `currentMood: []` added to `defaultState.profile`, and both are now explicitly whitelisted in `savePreferences()`'s persisted JSONB (the profile object itself already spreads `preferences` generically on load, so no change was needed there).

**Oracle Spark (`Dashboard.jsx`).** `OracleSparkWidget` now receives `profile` and folds `favoriteGenres`/`currentMood` into the prompt sent to `callClaude` as a short personalization preamble, when either is set. Reading level and goal were already available to other Oracle flows (`PlanCreate.jsx`); this is the first widget to consume the two new fields. Other Oracle surfaces (`OracleSimilar.jsx`, `OracleCategories.jsx`, `PlanCreate.jsx`'s "explore" mode) are good candidates for the same treatment but were left untouched this release to keep the diff focused — flag if you want those wired in too before 1.0.

**`_onboarding.scss`.** Added `.chip-grid` / `.chip(.selected)(:disabled)` for the genre picker (pill-shaped, reuses `--ro-gold` tokens), `.onb-hint` for the small "X of 5 selected" caption, and a `:disabled` state on `.choice` for the mood grid once the 3-item cap is hit.

New i18n keys: `onboarding.step2*`–`step5*` (renumbered/rewritten step copy), `onboarding.genreCount`, `onboarding.moods.*` (8 mood entries × title/sub, EN + ES CR vos), `profile.labelFavoriteGenres`, `profile.labelCurrentMood`, `profile.genresNotSet`, `profile.moodNotSet`, `profile.genreMaxHint`, `profile.moodMaxHint`.

### v0.37.3 — Custom page counts per edition

**Migration required:** `schema_v37_3_migration.sql` — adds `currently_reading.user_page_count` (nullable integer). No backfill; `NULL` falls back to the catalog's `books.pages`.

**What it does.** Readers whose physical/digital edition has a different page count than the catalog row can now set a personal override. It's stored per-`currently_reading` row and never mutates the shared `books` table. Per-user analytics (Reading Stats widget, library totals) intentionally continue to use the canonical catalog page count — the override only affects a reader's own progress bar and percentage, in `CurrentlyReading.jsx` and in Book Club session progress (`SessionDetail.jsx`).

**`get_session_detail` RPC.** The `progress` lateral join now also selects `cr2.user_page_count`, returned per member as `user_page_count` alongside `pages_read`. Client-side, each member's effective total is `member.user_page_count ?? book.pages` rather than one club-wide total.

**`DataContext.jsx`.** `updateReadingProgress(book, pagesRead, userPageCount)` gained a third, optional parameter: pass a positive integer to set the override, `null` to clear it back to the catalog value, or omit it entirely to leave whatever's stored untouched. The initial `currently_reading` load query and `bookRowToClient` mapping now also select and map `user_page_count` → `userPageCount`, so it's available on first load, not just after an in-session update.

**`ProgressUpdateModal.jsx`.** Added a collapsed-by-default "My edition has a different page count" toggle. Expanding it reveals a number input seeded from the existing override (or blank); saving computes the effective total from whichever is active and passes `(pagesRead, userPageCount)` to `onSave`. Clearing the override field and saving writes `null`, not `0` or the catalog number.

**`CurrentlyReading.jsx` and `SessionDetail.jsx`.** Both now compute `totalPages = member.user_page_count ?? book.pages` (or `b.userPageCount ?? b.pp` on the Currently Reading grid) wherever a progress bar, percentage, or "X / Y pages" label is rendered, instead of using the catalog total directly.

**Dashboard — checked, no changes needed.** The `CurrentlyReadingWidget` doesn't render a page count or progress bar at all. The Reading Stats widget sums `b.pp` (catalog pages) across the finished library, which is correct as-is per the Option A decision above.

New i18n keys (`progress.*` in `en.json`/`es.json`): `editionDifferLink`, `editionPagesLabel`, `editionOverrideNote`, `editionUseDefault`. Removed the now-unused `progress.editionNote` static string, superseded by the toggle UI.

### v0.37.2 — List pages, cover hover, email sign-in & fixes

**No DB migrations required** (but see *Supabase configuration* at the end for the new email sign-in and sender-domain setup).

**Lists redesign (DS Patterns / Lists).** `Lists.jsx` (List Dashboard) and `ListDetail.jsx` (List Page) rebuilt to the design system: DS headers (eyebrow, big italic serif title, ornament divider), `.plan-badge` count pills, and DS action rows. The dashboard now shows each list as a stacked section with a capped cover preview — `COVER_PREVIEW` (6) real covers, then a `.cover-grid-more` "+N more" box that mirrors the dashboard feed's overflow tile. Make Public / Copy link / Delete stay inline on each dashboard row per request. New CSS: `.ls-dash-*` and `.ls-page-*` families in `_social.scss`.

**Cover hover — fixed globally + restyled to DS v5.** The `.cover-grid-hover` overlay had `opacity: 0` with no `:hover` rule anywhere to reveal it, so hovering any cover did nothing app-wide (Library, Wishlist, Lists, ListDetail — all use `.cover-shelf-grid`). Added the `&:hover`/`&:focus-visible` trigger and restyled to the DS v5 List hover: the card lifts (`translateY(-3px)`), a fixed top-to-bottom scrim keeps text legible over any cover color, a gold accent bar sits above a bold-serif title, italic-gold author, and stacked mono-uppercase genre tags. Also fixed invalid `--var(...)` typos and a duplicated `aspect-ratio`/`border-radius` in that block. Genre tags were wired into the `Lists`/`ListDetail` overlays (they were only in `LibraryCoverGrid` before), and `ListDetail`'s in-overlay Remove button — previously unclickable because the overlay is `pointer-events: none` — now opts back into pointer events.

**New "My Plans" page + PlanView fix.** New `plan-list` route and `PlanList.jsx` view listing every saved plan with title, description, badges, book-count progress bar and created date; clicking opens `plan-view` with a `from: 'plan-list'` breadcrumb. The nav "My Plans" item now points here instead of the creator. Separately, `plan-view` was being rendered by `ListView` (both routes shared one early-return branch in `App.jsx`), so the real `PlanView` was dead code and plans rendered with old `plan-step`/`plan-month` classes — split them so `plan-view` renders the dedicated, DS-styled `PlanView`.

**Email sign-in; guest removed.** `AuthContext.jsx` gained `signInWithEmail` (Supabase `signInWithOtp` magic link) alongside Google. `SignInGate` in `App.jsx` was rewritten: guest/offline bypass removed (`allowGuest` state gone, gate condition simplified to `if (!user)`), email magic-link form + "check your inbox" state added. **Apple/Facebook OAuth were removed at the user's request** — only Google + email remain.

**Withdraw a pending friend request.** `FriendProfile.jsx` showed a static "Request sent" pill for outgoing pending requests; it's now a `.friend-withdraw-btn` that swaps to "Withdraw request" on hover and calls `declineRequest(pendingEntry.id)` (the existing decline/cancel path). New `friends.withdrawRequest` i18n key.

**Routing fixes.** `privacy`/`terms`/`refund` had render cases in `App.jsx` but were missing from `KNOWN_ROUTES`, so direct hash links like `#privacy` failed the known-route check and fell back to dashboard (the footer buttons worked only because they call `go()` directly). Registered them. Also added `&anchor` parsing to `parseHash` so `#about&pricing` resolves to About with `params.anchor = 'pricing'`, and `About.jsx` now scrolls that section into view — this is the URL LemonSqueezy links to.

**About / Profile.** `About.jsx` moved off shared `.session-prompt`/`.plan-step-eyebrow` classes (whose base styles were fighting inline overrides and hurting readability) onto a dedicated `.about-feature`/`.about-roadmap-*` family. Profile sections moved off the shared `.bp-section` onto a dedicated `.pf-section` family with DS spacing, so Profile spacing can change without affecting BookPage/BookModal.

---

*The remainder of v0.37.2 covers earlier fixes from the same cycle:*

**Crash — club session discussion.** `SessionDiscussion.jsx` called `t()` in its render body but never called `useT()` at the component's top level; a previous edit had instead scattered `const t = useT()` inside several nested `async` event handlers — itself a Rules-of-Hooks violation, since hooks can only be called during a component's render, not from a detached callback. A separate free-standing helper, `fetchOracleQuestions`, called `useT()` and `useOracleQuota()` directly, which would throw "Invalid hook call" the moment an admin clicked "Oracle suggests". Fixed by declaring `t` and the quota handlers once at the top of `SessionDiscussion`, removing every erroneous nested hook call, and passing `t`/`handleQuotaError`/`onCallSucceeded` into `fetchOracleQuestions` as plain parameters.

**Corner brackets, take two.** The `ro-corner-brackets()` mixin introduced in v0.37.1 drew all four corners as a single layered `background-image` on `::before`. That couldn't be visually verified in the environment it was built in and shipped looking wrong. Replaced with the exact technique the design system's own reference mockup uses: four plain bordered `<span>`s via a new shared `<CornerBrackets />` component (`src/components/CornerBrackets.jsx`) and `.corner-bracket` CSS (`components/_corner-brackets.scss`). Wired into every bracketed card: `BookModal`, `AddToListModal`, `Lists`' new-list modal, `ListDetail`'s add-book modal, `RatingModal`, `AnnouncementModal`, `ReleaseNotesModal`, `ProgressUpdateModal`, `SessionDetail`'s edit-session modal, the sign-in card, the onboarding flow, and the profile account card (which was upgraded from a plain `.panel` to the real bracketed `.pf-account-card`, matching the design system reference exactly).

**Modal consistency.** `.modal` (the `overlay`/`modal__head`/`__body`/`__actions` family) was missing `position: relative`, which meant `.modal__close` — an absolutely-positioned × button — was anchoring to the nearest positioned ancestor (`.overlay`, fixed to the full viewport) instead of the modal card itself. Also added a default `padding: 26px` to `.modal` for the several consumers (`AddToListModal`, the new-list modal, `ListDetail`'s add-book modal) that drop content directly into `.modal` without the `__head`/`__body`/`__actions` structure — those three each set a complete padding shorthand of their own, so this has no effect where they're used.

**Oracle recommendation cards — broken covers.** `BookCard.jsx` passed its cover-sizing class directly to the shared `<BookCover />` component: `<BookCover className="book-card__cover" />`. `BookCover` renders an `<img>` with a hardcoded inline `style={{ width: '100%', height: '100%' }}`, which always wins over a class by CSS specificity — with no sized container, the image rendered at its full intrinsic size, breaking the whole card layout. Every other usage in the codebase correctly wraps `<BookCover />` in a sized container div instead; fixed to match. Also moved the primary action button (add to Read Next, etc.) to appear right under the title/author instead of after the genre tags, description, and the Oracle's "why this book" line.

**Duplicate `className` sweep, round 2.** Found and fixed 8 more instances of the v0.37.1 duplicate-attribute bug: `BookClubs.jsx`, `ListDetail.jsx`, `FriendProfile.jsx` (plus 3 more `.level-pill`/`.page-eyebrow` instances and a regressed `.wishlist-toolbar`/`.search-input` pair in the same file — restored to the current `.lv-toolbar`/`.lv-search` classes), `PlanCreate.jsx`, `AnnouncementModal.jsx`, `RatingModal.jsx`, `CategoryAutocomplete.jsx`, and `CommentThread.jsx`. Zero duplicate-`className` elements remain anywhere in `src/`.

**Remaining forms cleanup.** `ProgressUpdateModal.jsx` and `SessionDiscussion.jsx` had inline `fieldStyle`/`labelStyle`/`inputStyle` objects referencing dead `--gilt`/`--paper` tokens — replaced with `.field-label`/`.input`/`.pf-input--narrow`. Added a `.corner-bracket--sm` size variant, a `.plan-step-title--tight` spacing modifier, and `.session-prompt--question`/`--answers` modifiers to close out the remaining inline-style overrides in the discussion thread.

---

**Supabase configuration for v0.37.2:**
- **Email (magic link) sign-in:** In the Supabase dashboard → Authentication → Providers, ensure **Email** is enabled. For passwordless links specifically, no password is required from the user — Supabase emails a one-time link. (See *"Password vs. magic link"* note below if you want to also offer email+password.)
- **Sender identity / domain:** By default auth emails come from Supabase's own address. To send as **The Books Oracle / support@thebooksoracle.com**, configure Custom SMTP in Authentication → Emails → SMTP Settings (point it at Resend's SMTP, or your provider), and set the sender name to "The Books Oracle" and sender email to support@thebooksoracle.com. You must verify the `thebooksoracle.com` domain with the sending provider (Resend) first.

**Known issues (flagged, not fixed this round):**
- `BulkImport.jsx`, `SessionCreate.jsx`, `BookClubCreate.jsx` still build inline styles from the dead `--gilt`/`--paper`/`--paper-aged` tokens.
- `src/views/BookModal.jsx` and `src/views/Nav.jsx` are dead code (unused duplicates) — recommend deleting them.
- Transactional emails (friend requests, etc.) send via Resend from a Supabase Database Webhook / Edge Function, which is separate from the Supabase Auth sender config above — see *"Why the friend-request email didn't arrive"* in the deployment notes.

### v0.37 — Extended notifications, preferences & footer

**Extended notifications.** The bell panel now handles eight event types: `friend_request`, `friend_accepted` (existing), plus `club_invite`, `poll_started`, `poll_finalized`, `discussion_question`, `discussion_reply`, and `announcement`. All new types are driven by DB triggers (schema_v23) — no app-layer code needed to fire them. Each notification in the bell panel is clickable and navigates directly to the relevant club, session, or profile. The `notificationLabel()` and `notificationRoute()` helpers in `useNotifications.js` keep the Nav component clean.

**Announcements.** New `announcements` table with a `broadcast_announcement(title, body, admin_id)` RPC that fans out one `announcement` notification per user. When clicked in the bell panel, the notification opens an `AnnouncementModal` inline rather than navigating away. The body supports `\n` line breaks — each paragraph renders separately in the modal.

**Sending an announcement** (run in Supabase SQL editor):
```sql
SELECT broadcast_announcement(
  'Your title here',
  E'First paragraph.\n\nSecond paragraph.',
  '<your-admin-profile-uuid>'  -- find in Supabase → Authentication → Users
);
```

**Finding your announcement UUID** (to retry or delete):
```sql
SELECT id, title, created_at FROM public.announcements ORDER BY created_at DESC LIMIT 5;
```

**Resetting notifications as unread** (re-show without re-broadcasting):
```sql
UPDATE public.notifications
SET read = false
WHERE type = 'announcement'
AND data->>'announcement_id' = '<announcement-uuid>';
```

**Deleting and re-broadcasting** (full retry):
```sql
-- Delete notifications for this announcement
DELETE FROM public.notifications
WHERE type = 'announcement'
AND data->>'announcement_id' = '<announcement-uuid>';

-- Delete the announcement itself
DELETE FROM public.announcements WHERE id = '<announcement-uuid>';

-- Re-broadcast
SELECT broadcast_announcement('Title', E'Body', '<admin-uuid>');
```

**Nuclear reset** (wipe all announcements and notifications):
```sql
DELETE FROM public.notifications WHERE type = 'announcement';
DELETE FROM public.announcements;
```

**Notification preferences.** `notification_preferences` JSONB column on `profiles` replaces the old `email_notifications` boolean. Four toggles: Book Club activity, Friends, Announcements (locked on), Email master toggle. Preferences are saved live on toggle — no save button needed. The email function respects both the category toggle and the master email switch.

**Email function expanded.** `send-notification-email.js` now handles all eight types with distinct subject lines, body copy, and CTA links per type. Respects the new `notification_preferences` JSONB, falling back to the legacy `email_notifications` boolean for users who haven't been migrated.

**Footer.** `src/components/Footer.jsx` wired into `App.jsx` — appears on every page below page content. Shows © year, and links to Privacy, Terms, Refund, and About. Legal links removed from the About page section (now in Footer only).

**Session reminders deferred.** Requires a scheduled Netlify function (cron) — tracked in backlog for v0.38+.

**DB migration:** `schema_v23_migration.sql` — expands notification type constraint, adds `announcements` table, adds `notification_preferences` JSONB with migration of existing `email_notifications` values, adds DB triggers for all new notification types, adds `broadcast_announcement` RPC.

### v0.36.4 — Bug fix: friend library toolbar styling

**No DB migrations required.**

The `FriendLibrary` toolbar in `FriendProfile.jsx` was using inline `style` objects with `var(--input-bg)`, `var(--ro-text-primary)`, Special Elite monospace font, and no custom caret — matching neither dark nor light mode appearance of the rest of the app's filter controls.

Fixed by switching to the established CSS classes: `.wishlist-toolbar` (flex row with space-between, wraps on mobile), `.wishlist-filters` (left group with gap), `.search-input` (dark background, gilt border, EB Garamond italic). The `select` elements now use inline styles that replicate the global `select` rule from `_oracle.scss` — `var(--ro-shadow)` background, gilt SVG caret via `background-image`, `appearance: none`, EB Garamond italic. This matches the Library and Wishlist toolbar appearance exactly.

### v0.36.3 — Bug fix: friend library was empty

**No DB migrations required.**

Two bugs combined to produce the empty library:

1. **Wrong i18n key.** The empty-library fallback rendered the raw key string `friends.friendsEmpty` because that key did not exist in the `friends` namespace — it was in `profile.friendsEmpty` ("No friends yet. Share your profile link..."), which is the wrong message for an empty book library anyway. Added `friends.friendsEmpty` and `friends.libraryEmpty` with the correct copy in both locales.

2. **Broken Supabase join.** `getFriendLibrary` used a deeply nested PostgREST join: `book:books(..., book_genres(genre:genres(...)))`. Supabase silently drops nested joins it can't resolve in one pass, returning `null` for `book` on every row — making the library appear empty even when books exist. Fixed by matching DataContext's proven join shape: `book:books(*, position_in_series, series:series(*))`, then fetching genre data in a separate `book_genres` query keyed on the book IDs. Genre data is attached as `_genres` on each row before `normalizeBook` processes it.

`normalizeBook` in `FriendProfile.jsx` updated to read `row._genres` and use the correct `books` table column names (`title`, `author`, `cover_url`, `page_count`) rather than the client-side aliases (`t`, `a`, `coverUrl`, `pp`) that DataContext applies after fetching.

### v0.36.2 — Friend profile: full library with filters

**No DB migrations required.**

`FriendProfile.jsx` is rewritten around a `FriendLibrary` sub-component that handles all filtering and display. `getFriendLibrary` in `useFriends.js` now selects `book_genres(genre:genres(id,name,normalized_name))` alongside the book fields so Oracle genre tags are available without a second query.

Each library row is normalized by a `normalizeBook()` helper that flattens the `read_books + books + book_genres` join into a consistent shape (`{ t, a, coverUrl, rating, dateRead, genres[], ... }`).

`FriendLibrary` computes filter options client-side from the normalized data using `useMemo`: genre options from `book_genres` (falling back to `books.genre` for books without Oracle tags), year options from `read_at`. Filtering applies search (title + author substring), genre (`normalized_name` match), and year in sequence. Sort options: recently read (default, `read_at` desc), highest rated, title A–Z, author A–Z. All filters reset `page` to 1 via a `useEffect` dependency on the filter values.

Pagination is client-side load-more: `visible = filtered.slice(0, page * 48)`. The "Load more" button shows the remaining count. This keeps the DOM small on first render for large libraries while avoiding a network round-trip per page.

Each book card shows cover (90px wide, 2:3 aspect), star rating below, title and author in truncated single-line text. Hovering the card shows the full title + author + year via the `title` attribute (native browser tooltip — no custom tooltip component needed).

### v0.36.1 — Friends feed + profile URL fix

**No DB migrations required.**

**Profile URL routing fix.** `RouterContext.jsx`'s `parseHash()` only read `window.location.hash`, so pathname-based URLs like `/u/mandalaxiii` were invisible to the router — it saw no hash and fell back to dashboard. `parseHash()` now first checks if `window.location.pathname` matches `/u/:username` (the regex `^\/u\/([a-z0-9_-]{3,24})$`), and if so synthesises a `friend-profile` route with the username as a param. `go('friend-profile', ...)` now also writes the clean pathname (`/u/:username`) via `history.pushState` instead of a hash, so the URL stays shareable after any in-app navigation to a friend profile.

**Self-view on own profile link.** Visiting your own `/u/username` URL now renders `FriendProfile` correctly. The `isSelf` check (`state.profile?.username === username`) suppresses the "Add friend" button and surfaces the "Copy link" affordance instead, so you see exactly what friends see.

**Friends feed widget.** New `friends-feed` widget in `Dashboard.jsx`. On mount it calls `getFriendsFeedEvents(userId)` (new export in `useFriends.js`) which queries `friend_pairs` for accepted friend IDs, fetches their `read_books` (respecting `preferences.friendsCanSeeLibrary`) and `currently_reading` rows with a 90-day window, joins profile data, merges and sorts chronologically, and returns up to 40 events. The widget renders each event as a friend avatar + book cover + prose sentence ("Simon finished The Haunting of Hill House") with a star rating if present and a relative date label. A manual Refresh button re-fetches; a "last updated HH:MM" label shows freshness. If the user has no friends yet, a prompt with a link to the profile friends section is shown instead of an empty state.

**My activity rename.** The existing `feed` widget now passes `eyebrow={t('dashboard.widgetMyFeed')}` ("My activity" / "Mi actividad") to `WidgetShell` so the two feed widgets are clearly differentiated in the settings panel and on the dashboard.

**`DEFAULT_DASHBOARD_LAYOUT`** updated to include `friends-feed` between `clubs` and `feed`.

### v0.36 — Friends, usernames & notifications

**DB migration required: run `supabase/schema_v20_migration.sql` before deploying.**

**New env vars required in Netlify:**
- `RESEND_API_KEY` — from resend.com, for transactional email
- `WEBHOOK_SECRET` — any strong random string, must match the value set in the Supabase Database Webhook config

**Supabase setup required (one-time):** In Supabase → Database → Webhooks, create a webhook on the `notifications` table for `INSERT` events pointing to `/.netlify/functions/send-notification-email`, with header `x-webhook-secret: <WEBHOOK_SECRET>`.

**Usernames.** `profiles.username` is a new unique, lowercase, 3–24 character column (`[a-z0-9_-]`). The Profile page now has a dedicated Username section with real-time availability checking (debounced 400ms Supabase query), a live profile URL preview, and inline save/cancel. A separate Display Name section lets users set how they're greeted — fully independent from their username. Both write directly to `profiles.username` / `profiles.display_name` via new `updateUsername` and `updateDisplayName` DataContext actions rather than going through the preferences jsonb.

**Friendships.** New `friendships` table with `requester`, `addressee`, `status` (pending/accepted/blocked). A `friend_pairs` bidirectional view makes "who are my friends" queries clean without union logic in the app. New `useFriends` hook exposes `friends`, `pending`, `incoming`, `sendRequest`, `acceptRequest`, `declineRequest`, `removeFriend`. Duplicate request prevention checks both directions before inserting. RLS restricts each user to only their own rows.

**Friend profiles.** New `FriendProfile.jsx` view, reached at `/u/:username` via the new `friend-profile` route in RouterContext and App.jsx. Shows avatar, display name, `@username`, stats pills (books this year, total, currently reading count), currently reading strip, and the full library cover grid. Privacy: `preferences.friendsCanSeeLibrary` (default true) gates library visibility; DB-level RLS on `read_books` enforces it server-side for accepted friends.

**Notification bell.** `useNotifications` hook fetches the last 30 notifications with actor profile joins and subscribes to `postgres_changes` on the `notifications` table filtered to the current user — new requests appear in real time. The bell in `Nav.jsx` shows a red unread count badge and opens a dropdown panel. All notifications are marked read on panel open. Each `friend_request` notification renders inline Accept/Decline buttons; `friend_accepted` renders a "View profile →" link. On mobile the panel becomes a bottom sheet.

**Email notifications.** `netlify/functions/send-notification-email.js` is triggered by a Supabase Database Webhook on `notifications` INSERT. It verifies a shared secret header, looks up the recipient email via `supabase.auth.admin.getUserById` (service role), checks `profiles.email_notifications`, looks up the actor's display name and username, and sends a styled HTML email via the Resend API. Email opt-out is a toggle in the new Privacy section of the Profile page. Falls back gracefully to a console log in local dev when `RESEND_API_KEY` is absent.

**DB trigger.** `handle_friendship_notification()` PL/pgSQL function fires after INSERT or UPDATE on `friendships`. On INSERT with `status = 'pending'` it inserts a `friend_request` notification for the addressee. On UPDATE from `pending` → `accepted` it inserts a `friend_accepted` notification for the requester.

**Privacy toggles.** Two new boolean columns on `profiles`: `is_discoverable` (default true, reserved for future friend search) and `email_notifications` (default true, read by the email function). Both are surfaced as toggle switches in the Profile privacy section and written by the new `updatePrivacyPrefs` DataContext action.

**New files:** `schema_v20_migration.sql`, `netlify/functions/send-notification-email.js`, `src/lib/useFriends.js`, `src/lib/useNotifications.js`, `src/views/FriendProfile.jsx`, `src/styles/pages/_friends.scss`.

**Modified files:** `DataContext.jsx`, `Nav.jsx`, `Profile.jsx`, `App.jsx`, `RouterContext.jsx`, `main.scss`, `en.json`, `es.json`, `releases.js`, `README.md`.

### v0.35.1 — Bug fix: book not removed from Reading Next when started

**No DB migrations required.**

`startReading` in `DataContext.jsx` had an asymmetry between its guest and authenticated paths. The guest path correctly filtered `readNext` when adding a book to `currentlyReading`. The authenticated path (the one used by all logged-in users) was missing that filter — it upserted the `currently_reading` row in Supabase and updated local `currentlyReading` state, but never touched `readNext`. The book stayed in the queue indefinitely.

Fix: the authenticated path now includes `readNext: s.readNext.filter((b) => bookKey(b) !== k)` in its `setState` call, matching the guest path.

For users already affected (book stuck in `readNext` in saved preferences), a second fix was added to the state hydration block that runs on login: `readNext` loaded from preferences is now filtered against both `currentlyReading` and `library` before being written to state. Any stale entry is silently removed, and the cleaned list is persisted the next time preferences save. No user action required.

### v0.35 — Customizable dashboard & reading challenge

**No DB migrations required.** All new state is stored in the existing `preferences jsonb` column on profiles.

**Customizable dashboard.** The dashboard now renders widgets from a user-controlled ordered list (`preferences.dashboardLayout`) rather than a hardcoded sequence. A gear button in the dashboard header opens a bottom-sheet settings panel. Each widget has a visibility toggle and up/down arrow buttons for reordering. The resolved layout merges the saved order with any new widgets introduced in future releases so existing users automatically get new widgets appended at the bottom without losing their custom order. `DEFAULT_DASHBOARD_LAYOUT` in `Dashboard.jsx` is the canonical widget registry — adding a new widget means adding it there.

**Oracle Spark.** A new `oracle-spark` widget shows a "Surprise me" prompt that calls Claude with a random slice of the user's wishlist and asks it to pick one title with a one-sentence reason. The result renders inline with cover, title, author, and the Oracle's reasoning. Costs one quota slot via the existing `callClaude` / `/.netlify/functions/claude` path. Handles quota-empty and no-wishlist states with appropriate fallback UI. A "Try another" button resets to idle without consuming another quota slot until the user taps the draw button again.

**Reading challenge.** `readingGoalCount` (a plain integer, books per year) is a new `preferences` field. The Profile page replaces the old motivational-goal dropdown with a full reading challenge section: set a target, see a progress bar with a semi-transparent pace marker (a thin vertical bar at the current day-of-year position), a live count of books finished vs target, and a colour-coded pace status (ahead in green, behind in red, on-track in muted). The Dashboard `reading-goal` widget shows the same data in compact form. Both use identical pace logic: `expected = target × (dayOfYear / daysInYear)`, `delta = done − expected`.

**Reading Stats widget.** Compact three-cell grid showing total books read, average monthly pace over the last 12 months, and total pages. Links to the full Profile stats.

**Series in Progress widget.** Reads from the same series computation used by Profile stats. Shows up to 4 in-progress series, each with a mini progress bar and read/total count. Clicking navigates to the series page.

**Reading Streak widget.** Counts consecutive months (working backwards from now) in which at least one book was finished. Colour-scales from muted (1–2 months) to gilt (3–5) to gilt-bright (6+).

**New SCSS.** `_dashboard-widgets.scss` covers the settings sheet, all new widget shells, and the profile challenge bar. Imported in `main.scss`.

**i18n.** 40+ new keys added to both `en.json` and `es.json` covering all new widget labels, challenge states (ahead/behind/complete/on-pace), and settings panel copy.

### v0.34 — Design system overhaul

**No DB migrations required.**

**Token system extended.** `_tokens.scss` now defines three new groups: a semantic status palette (`--status-read-*`, `--status-reading-*`, `--status-queued-*`, `--status-wishlist-*`), a spacing scale (`--space-1` through `--space-5` at 8/16/24/40/64px), and a font-size floor (`--ro-text-xs: 0.75rem`, `--ro-text-sm`, `--ro-text-base`). All hard-coded `rgba()` values throughout the codebase that express status or spacing now reference these tokens.

**Light mode rethought as parchment.** The previous light mode was a mechanical inversion of the dark palette — warm ink, beige text, gold that desaturated to ochre. It now uses a layered parchment approach: `--ink: #f5edd8` (warm cream base), `--paper: #2a1d0e` (rich sepia), `--gilt: #9a7a2e` (4.7:1 contrast on cream, up from 3.1:1), and explicit hex text tokens (`--ro-text-muted: #6b5340` etc.) that replace the opacity-chain pattern that compounded contrast failures. `--ro-border-subtle` and `--ro-border-mid` are now ink-based in light mode rather than gilt-based, which gives borders more presence on warm surfaces.

**Opacity dimming eliminated from text.** The pattern `color: var(--paper-aged); opacity: 0.5–0.6` has been replaced throughout with explicit `--ro-text-muted`, `--ro-text-dim`, and `--ro-text-faint` token references. Opacity chains on text are unsafe because each step compounds the contrast reduction — a 0.6 opacity on an already-reduced-contrast colour fails WCAG AA in light mode.

**Semantic status palette.** Reading status (read, currently reading, queued, wishlisted) previously borrowed brand colours — moss green for read, gilt for queued. Status now has its own token set with distinct hues: moss green (read), gilt (actively reading), slate blue (queued), plum (wishlisted). This frees the gold accent to remain purely decorative/premium. A `.status-pill--*` CSS class set in `_badges.scss` replaces the scattered inline `rgba()` badge definitions.

**Dashboard feed — accent bars and coloured icons.** Each event type in the activity feed now has a 3px left-accent bar and a 32px coloured icon dot keyed to the status palette: green for finished, gold for started, plum for wishlisted, blue for plans. The feed verb changed from `Special Elite uppercase` (Tier 1 eyebrow) to `EB Garamond italic` (Tier 3 metadata) — it was competing visually with book titles. Finished events now surface the star rating inline when present.

**Series dots → progress track for long series.** Series with more than 6 books now render a 4px horizontal progress track with a filled read-count bar and a gilt position marker instead of crowded numbered dots. Series with ≤ 6 books keep the improved dots, which now use status tokens (`--status-read-*`, `--status-queued-*`) and have a subtle `box-shadow` ring on the current book. Dots also wrap gracefully on narrow screens via `flex-wrap: wrap`.

**Eyebrow hierarchy.** Three tiers are now enforced: Tier 1 (page section labels — `Special Elite`, `0.35em` tracking, gilt) stays as-is. Tier 2 (component headers like modal section titles, series label, breadcrumbs) reduces tracking to `0.18em` and uses `--ro-text-muted` instead of gilt. Tier 3 (inline metadata — author, date, feed verb) switches to `EB Garamond italic` at `0.875rem` with no uppercase. `.book-modal-section-title` was the main Tier 1 overuse; it now renders at Tier 2.

**Font-size floor enforced.** All UI text now respects `--ro-text-xs: 0.75rem` (12px). Previous violations: pace chart month letters (8.8px), similar-card author (9.3px), feed verb/tag/date-label (9.3–9.9px). The similar-card author switched from `Special Elite uppercase 0.58rem` to `EB Garamond italic 0.75rem`. Pace chart month labels are tooltip-only (the letter labels remain, bumped to 0.75rem minimum).

**Similar books grid mobile cap.** At ≤ 500px, the auto-fill grid was squeezing up to 5 columns at 50px each, making covers unreadable. Now capped at 3 columns with `grid-template-columns: repeat(3, 1fr)`.

**Oracle toggle mobile improvements.** Toggle buttons have a `min-height: 44px` tap target and switch to `flex-direction: row` on narrow screens. The toggle group goes full-width at ≤ 600px.

**Book page spacing.** Ad-hoc inline `marginTop` values replaced with `var(--space-*)` tokens throughout `_book-page.scss`. Series block, actions, purchase links, and body sections all use the scale. Mobile cover is now centred (`margin: 0 auto`) rather than left-aligned when stacking to single column.

### v0.33.1 — Bug fixes: series navigation, feed & infinite loop

Patch release addressing regressions and missing features reported after v0.33.

**Feed now shows finished books.** `buildFeed` in `Dashboard.jsx` was reading `b.readAt || b.read_at` to determine the completion date, but `markAsRead` stores the date under `b.dateRead`. Completed books were silently excluded from the activity feed; only "started reading" events appeared. Fixed to check `b.dateRead || b.readAt || b.read_at`.

**Series dots on Book Page no longer show "Not Found".** Clicking a series dot called `go('book-page', { bookKey })` without a snapshot payload. Books not in the user's collection have no entry in `state.wishlist / library / readNext`, so BookPage showed "Not Found". A new `buildBookPageParams(book, from, fromLabel)` helper in `bookHelpers.js` mirrors the existing `openBookTab` logic (base64 book snapshot in the URL) but returns params for `go()` instead of calling `window.open()`. All in-app series navigation now uses this helper.

**Back button no longer stays broken after a series click.** After clicking a series dot (which now includes a snap) and pressing back, the previous book page URL also needed a snap to survive the DataContext race on popstate. BookPage now silently calls `history.replaceState()` to patch a snapshot into the current URL as soon as it resolves the book from the collection, so any history entry going forward is self-contained.

**Infinite Wikipedia loop fixed.** Both `BookPage` and `BookModal` had `useEffect` hooks that depended on the whole `book`, `enrichment`, and `enrichedOverlay` objects. `cacheBookFields` writes enriched data back into DataContext state, which produces a new object reference for the book on the next render. React sees the changed reference, re-fires the effect, calls `fetchSeriesDescriptionFromWikipedia` again — endlessly. Both effects now depend on stable primitive values (`book?.t`, `book?.a`, `book?.s?.name`, etc.) so they fire once per actual book change, not on every render cycle.

**Rating, notes, and categories visible on Book Page.** `BookPage.jsx` previously rendered genres but omitted the user's star rating, reading notes, and personal categories — features that existed only in `BookModal`. Added `getCategoriesForBook`, `removeCategoryFromBook`, `updateReadBook` from DataContext; imported `RatingModal` and `CategoryAutocomplete`; added inline `CategoryPill` component. The Book Page now has a rating section (with Edit/Add button opening the full rating modal) and a categories section with add/remove, identical in behaviour to the modal.

**Profile pace chart is now interactive.** Bars show a floating tooltip on hover (book count + full month name). Clicking a bar with books toggles a drill-down panel beneath the chart listing every book read that month with cover thumbnail, title, author, and star rating. `openBookTab` is passed as `onOpenBook` so covers are tappable.

**Oracle toggle group visible in light mode.** `.toggle-group` had a hardcoded `rgba(13,9,7,0.6)` background — near-black in both modes. In light mode this made the button text invisible. Changed to `var(--ro-surface-raised)` which correctly tracks the theme.

**Series name validation prevents mismatched Hardcover results.** When Hardcover's series search returns a series with a different name than expected (e.g. searching "Bride" returns "Scared Sexy"), the fetched books are now discarded rather than merged. Both `BookPage` and `SeriesPage` normalize and compare the fetched series name against `display.s.name` before merging.

**Hardcover null-position entries included when series count is short.** If `primary_books_count` is 6 but only 5 books have non-null positions in Hardcover, the 6th slot was silently dropped. `hardcoverFetchSeriesBooks` now appends null-position entries to fill the gap up to `primaryTotal`.

**No DB migrations required.**

### v0.33 — Subscription polish

Post-launch fixes to the subscription and quota system.

**Usage tracking for all tiers.** `oracle_calls_this_month` now increments for Pro users as well as free users. Previously the RPC returned early for `active` accounts without touching the counter, making it impossible to monitor AI costs per user. The column is now a reliable usage log regardless of tier.

**Quota counter no longer resets on page refresh.** The `consume_oracle_call` RPC was being called fire-and-forget after the Anthropic response — on AWS Lambda (which Netlify Functions run on), any async work after the function returns is killed. The call was never completing, so the DB was never updated. It is now `await`ed before returning the response.

**Stripe webhook compatibility with API version `2026-05-27.dahlia`.** The `invoice.payment_succeeded` and `checkout.session.completed` handlers were looking for `obj.subscription` and `user_id` at the top level of the invoice object. In the newer API shape these are nested under `obj.parent.subscription_details.*`. Both handlers now check both locations.

**Subscription badge refreshes on tab focus.** A `visibilitychange` listener was added to `OracleQuotaContext` so the quota re-fetches from Supabase whenever the user switches back to the tab. This catches webhook-driven changes and manual DB edits without requiring a page reload.

**React rendering error fixed.** `refreshQuota()` was being called directly in the component body on return from Stripe Checkout, triggering a "Cannot update a component while rendering a different component" warning. Moved into a `useEffect` with three polling attempts (immediate, 2s, 5s) to handle the webhook delivery window.

**DB migrations:** `schema_v19` replaces both `consume_oracle_call` and `get_oracle_quota` RPCs with the corrected logic.

### v0.32 — Subscription model

**Oracle quota system and Stripe integration**

The app is now ready for public launch with a monetization layer that gates AI features behind a quota without breaking the core reading experience.

**Free tier: 5 AI calls/month.** The quota is shared across all AI-powered features — Oracle draws (by genre and by similarity), reading plan generation, batch book categorization, discussion question generation, poll suggestions, and the search fallback. The counter resets on the first of each month (UTC). Free users can still use the full app: library, wishlist, read next queue, book clubs, lists, series pages, and the shelf view are entirely unaffected.

**Pro tier: unlimited AI ($5/month via Stripe).** Stripe Checkout handles payment — we never store or touch card data. The Stripe Customer Portal handles cancellation, card updates, and invoice history. Webhook events (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_succeeded/failed`) update `subscription_status` on the profile row in real time.

**Quota enforcement is server-side only.** The check happens in the `claude.js` Netlify function via a `get_oracle_quota` RPC call before any Anthropic request is made. `consume_oracle_call` runs atomically after a successful Anthropic response — a failed API call never costs a quota slot. The client can't manipulate quota state.

**UI surfaces.** A usage widget on the Dashboard shows calls used/remaining with a progress bar and reset date. Profile has a subscription section with a tier badge (Free / ✦ Pro / ⚠ Past due), quota meter, and direct links to upgrade or manage. The Oracle draw buttons are disabled (not hidden) when quota is exhausted — wishlist and vault draws still work since they don't call Claude.

**DB changes:** `schema_v15` adds `subscription_status`, `oracle_calls_this_month`, `oracle_calls_reset_at` to `profiles` with RLS locking them client-read-only. `schema_v16` adds a SELECT policy on `genres` (fixing empty genre dropdowns in PlanCreate). `schema_v17` adds `stripe_customer_id` and `stripe_subscription_id`. `schema_v18` grants all pre-launch users `active` status so existing testers aren't immediately paywalled.

**New Netlify functions:** `claude.js` (updated with quota enforcement), `create-checkout-session.js`, `stripe-webhook.js`, `manage-subscription.js`.

**Required new env vars:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

### v0.31 — Full localization

**Complete EN/ES wiring across all 47 screens**

Every user-visible string in the app — buttons, labels, breadcrumbs, empty states, confirmation dialogs, toast messages, status badges, progress labels, form placeholders — is now driven by the translation system. Nothing is hardcoded in English anymore.

The previous approach used inline `isSpanish ? 'es' : 'en'` ternaries scattered across files. These have all been replaced with `t('key')` calls against the central `src/i18n/en.json` / `src/i18n/es.json` key pairs.

**Translation key growth: 697 → 930 pairs.** 233 new keys were added for strings that previously existed only as hardcoded literals in component code — modals, club flows, session management, bulk import, shelf controls, and more.

**Spanish uses Costa Rican vos conventions throughout** — not generic Latin American Spanish.

**Pattern upgrade:** files using `useI18n()` + `isSpanish` boolean were upgraded to `useT()` uniformly. Sub-components that received `isSpanish` as a prop now call `useT()` directly or receive `t` explicitly. `ReleaseNotesModal` and `CurrentReleaseFooter` retain `isSpanish` legitimately to select between `titleEs`/`bodyEs` data fields on release objects, not for hardcoded strings.

**Files touched:** 47 JSX files (Toast and BookCover have no user-visible strings and need no wiring).

### v0.30 — Refactor: styles & routing

**Light mode**
- Theme toggle in the navigation switches between dark (default) and light mode. Preference persisted in `localStorage`; OS `prefers-color-scheme` respected on first visit.
- All token overrides for light mode live in `_tokens.scss` under `[data-theme="light"]` — no inline styles anywhere. `ThemeContext.jsx` sets the attribute on `<html>`.

**SCSS architecture rewrite**
- Flat pile of 25 root-level partials reorganised into a proper four-layer hierarchy: root globals (`_tokens`, `_reset`, `_typography`, `_global`), then `layout/`, `components/`, and `pages/` subdirectories — 28 files in total.
- Misplaced rules corrected: `.toast` extracted from `loading.scss`, `.empty-state`/`.breadcrumb` extracted from `toast.scss`, `.page-header` extracted from `dashboard.scss`, genre pills moved from `oracle-btn.scss` to `components/_badges.scss`, duplicate `.cover-grid-item` definition removed.
- All files de-indented (phantom 2-space indent from the original monolith cut removed throughout).
- Switched from `@use` to `@import` in `main.scss` — fixes Vite HMR not hot-reloading partial changes and ensures `[data-theme]` attribute selectors cascade correctly across all files.
- Max 3-level nesting rule enforced. No layout rules inside component files.
- `vite.config.js` updated with `server.watch` and `css.preprocessorOptions.scss.loadPaths` to ensure all subdirectory partials are watched.

**Routing fix**
- `syncLangParam()` in `I18nContext.jsx` was writing `?lang=es` into the URL via `new URL(window.location.href)`, which captured the hash and then re-serialised it incorrectly on Netlify Dev — causing book page URLs to break when the language was set to Spanish.
- Fix: hash is now preserved separately and re-appended after the query param update, so the dev server never sees a URL change that could trigger a reload.

### v0.29 — Discussion & Decisions

**Discussion on sessions**
- Admins can pin discussion questions on any session — members answer each one in its own thread. Questions are ordered and collapsible.
- A free comments section below each session lets the conversation range beyond the pinned questions.
- Replies nest one level deep (enforced by DB constraint — no infinite threads).
- Authors can edit or delete their own comments; admins can delete any comment.

**Oracle discussion question suggestions**
- Admins tap "☩ Oracle suggests" in the questions panel — Claude generates five discussion questions tailored to the session's book (themes, characters, emotional resonance, reader reactions).
- Existing questions are passed as context so Claude never duplicates what's already there.
- Suggestions appear as a tappable pick-list. Each tap adds the question immediately and marks it ✦ — the list stays open so admins can pick multiple in one go. Dismiss when done.

**Polls**
- Admins create polls on a club with 2–5 options (book titles or free text).
- Members vote and can change their vote while the poll is open. Results show as a live percentage bar visible to all members immediately after voting.
- Admins can close a poll (locks voting, shows final results), delete a poll entirely, or use the winning option to pre-fill a new session form.

**Oracle suggestion polls**
- Admins tap "☩ Oracle suggests" on the polls panel — Claude generates three book recommendations based on the club's genre tags and recent session history.
- Suggestions become a poll automatically with `is_oracle_pick` flagged. No separate confirmation step.
- The full Oracle → poll → session pipeline completes in one flow.

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
- New view styles go in their own SCSS partial under `pages/`, `@import`ed in `main.scss`; shared UI patterns go in `components/`
- `state.plans[]` holds all plans; `state.currentPlan` is the most recent (backwards compat)
- `state.clubs[]` holds lightweight club entries (no sessions/members); full detail fetched on demand via `get_club_detail` RPC
- The Vault (`vault` in DataContext) is a live Supabase query, not a bundled array
- Club membership is checked server-side in every RPC — non-members get null back, not an error
- `pages_read` lives on `currently_reading`, not on a session-specific table — one update syncs across all sessions that reference the same book
- `session_comments` serves all comment surfaces via `question_id` / `parent_id` nullability — one table, one RLS policy set, one RPC
- `cast_vote` uses `ON CONFLICT DO UPDATE` — changing your vote is always a safe upsert, never a delete+insert race
- `CommentThread` is a pure rendering component — pass it comments + callbacks, it knows nothing about sessions or clubs
- Deleting a poll cascade-deletes its `poll_options` and `poll_votes` via FK constraints — no manual cleanup needed