# The Wishlist Oracle

A reading companion — wishlist, library, reading plans, and an AI-powered "oracle"
for book discovery. Built with React + Vite + SCSS, backed by Supabase for auth
and cross-device sync, and Netlify Functions for API proxying.

> **Upgrading from v0.2?** Read `MIGRATION.md` for the schema migration and env-var changes.

## What's in here

```
oracle/
├── index.html              · Vite entry HTML (loads fonts + mounts React)
├── package.json
├── vite.config.js
├── .env.example            · Copy to .env.local
├── supabase/
│   └── schema.sql          · Run once in Supabase SQL Editor
└── src/
    ├── main.jsx            · Mount + providers
    ├── App.jsx             · Auth gate, route switch
    ├── styles/
    │   └── main.scss       · Ported verbatim from the original index.html
    ├── lib/
    │   ├── supabase.js
    │   ├── AuthContext.jsx
    │   ├── DataContext.jsx · State + Supabase sync (the core piece)
    │   ├── RouterContext.jsx
    │   ├── booksData.js    · Catalog (~280 books)
    │   ├── bookHelpers.js  · bookKey, genres, palettes
    │   ├── coverService.js · OpenLibrary + Google Books covers
    │   ├── enrichmentService.js · OL series + page count enrichment
    │   ├── goodreadsImport.js · CSV parser
    │   └── claudeApi.js    · Anthropic API call (see note below)
    ├── components/
    │   ├── Nav.jsx
    │   ├── Toast.jsx
    │   ├── BookCover.jsx
    │   ├── BookCard.jsx
    │   └── BookModal.jsx
    └── views/
        ├── Onboarding.jsx
        ├── Dashboard.jsx
        ├── Wishlist.jsx
        ├── Library.jsx
        ├── ReadNext.jsx
        ├── Profile.jsx
        ├── OracleFork.jsx
        ├── OracleCategories.jsx
        ├── OracleSimilar.jsx
        ├── PlanCreate.jsx
        └── PlanView.jsx
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up Supabase:**
   - Create a project at [supabase.com](https://supabase.com).
   - In **SQL Editor**, paste `supabase/schema.sql` and run it.
   - In **Authentication → Providers → Google**, enable Google OAuth (see "Google OAuth" below).
   - In **Authentication → URL Configuration**, add `http://localhost:5173` and your Netlify URL to the allowed Redirect URLs.
   - Copy your project URL + anon key from **Project Settings → API**.

3. **Configure env vars:**
   ```bash
   cp .env.example .env.local
   ```
   Then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

4. **Run locally:**
   ```bash
   npm run dev
   ```

5. **Deploy to Netlify:**
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site settings → Environment variables**.

## Google OAuth setup

1. In Supabase **Authentication → Providers → Google**, copy the **Callback URL**
   (looks like `https://xxxxx.supabase.co/auth/v1/callback`).
2. In [Google Cloud Console](https://console.cloud.google.com/):
   - Create a project (or reuse one).
   - **APIs & Services → OAuth consent screen** → External → fill basics.
   - **Credentials → Create Credentials → OAuth client ID** → Web application.
   - Authorized redirect URIs: paste the Supabase callback URL.
   - Copy the **Client ID** and **Client Secret**.
3. Back in Supabase, paste those into the Google provider config and save.

## A note on the AI Oracle

The Oracle's "AI mode" (in both Categories and Similar Books) calls Anthropic via
a Netlify Function proxy at `/.netlify/functions/claude`. The function holds the
`ANTHROPIC_API_KEY` server-side — it never reaches the browser. Same pattern for
Hardcover via `/.netlify/functions/hardcover`.

For local development, use `netlify dev` (instead of `npm run dev`) to run Vite
and the functions together on one port. Without it, AI Oracle and Hardcover
lookups won't work locally — but everything else will, and Hardcover gracefully
falls back to OpenLibrary.

## Data model

| Original `state` field | Supabase target               |
|------------------------|-------------------------------|
| `state.wishlist`       | `wishlist_items` rows         |
| `state.library`        | `read_books` rows             |
| `state.currentPlan`    | `plans` row (latest)          |
| `state.readNext`       | `profiles.preferences.readNext` (lightweight, lives in jsonb) |
| `state.profile.*`      | `profiles.preferences.*` + `profiles.display_name`/`avatar_url` |
| `state.onboarded`      | `profiles.preferences.onboarded` |
| `state.shelfSortMode`  | `profiles.preferences.shelfSortMode` |
| `state.oracleMode`     | `profiles.preferences.oracleMode` |

When signed out, the app falls back to `localStorage` under
`wishlist_oracle_state_v2` so guest sessions still work.

## Styling

`src/styles/main.scss` is a verbatim copy of the original CSS — SCSS is a CSS
superset, so it compiles as-is. When you're ready to refactor, split it into
partials by component (`_nav.scss`, `_shelves.scss`, `_modal.scss`, etc.) and
import from `main.scss`.

## Migration to React notes

- `state` object → `useState`/`useReducer` inside `DataContext`
- `render()` full re-renders → React reconciliation
- `addEventListener` / `document.querySelector` → JSX `onClick` props
- `innerHTML` → JSX
- Global mutable variables like `currentDraw`, `similarSelection`, `planForm`,
  `wishlistFilter`, `onbStep`, `onbData` → local `useState` inside the relevant
  view
- `enrichCache` localStorage → kept identical (per-device cache, no need to sync)
- `coverCache` Map → kept identical (per-session)
