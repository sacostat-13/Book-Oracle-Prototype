# The Books Oracle

A dark-academia reading companion at [thebooksoracle.com](https://thebooksoracle.com) —
wishlist, library, Passages (reading plans), Anthologies (curated lists), book clubs,
Kindred (follows), series pages and an AI "Oracle" for book discovery. Bilingual
English / Spanish (rioplatense).

React + Vite + Sass on the front, Supabase for auth and data, Netlify Functions as
API proxies.

> Current version: **v0.72.6** — release history in [CHANGELOG.md](CHANGELOG.md).

## Where to read next

| You want to… | Read |
|---|---|
| Understand how the app is put together | [docs/reference/ARCHITECTURE.md](docs/reference/ARCHITECTURE.md) |
| Change a ranking, weight, threshold or match % | [docs/reference/MATH.md](docs/reference/MATH.md) |
| Find where a piece of logic lives | [src/lib/README.md](src/lib/README.md) |
| Write or change styles | [src/styles/README.md](src/styles/README.md) |
| Touch the database schema | [supabase/SETUP.md](supabase/SETUP.md) |
| Run catalog maintenance scripts | [batch-scripts/README.md](batch-scripts/README.md) |
| See what changed and why | [CHANGELOG.md](CHANGELOG.md) |
| Find any other doc (specs, SQL diagnostics, audits) | [docs/README.md](docs/README.md) |

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase

The schema lives in `supabase/migrations/` and is managed with the Supabase CLI
(a devDependency — no global install). [supabase/SETUP.md](supabase/SETUP.md)
covers linking, pulling and pushing migrations; the old hand-applied
`schema_vN_migration.sql` files in `supabase/legacy/` are reference only and must
not be replayed.

For a fresh project you will also need to:

- enable Google OAuth under **Authentication → Providers → Google** (see below);
- add `http://localhost:8888` and your Netlify URL under
  **Authentication → URL Configuration**;
- mark the catalog curator, whose wishlist powers the Vault:
  ```sql
  update profiles set is_curator = true where id = '<your-user-uuid>';
  ```

### 3. Environment variables

```bash
cp .env.example .env.local
```

Browser (`VITE_*`, in `.env.local` and in Netlify):

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_…` key |
| `VITE_AMAZON_AFFILIATE_TAG`, `VITE_BOOKSHOP_AFFILIATE_ID` | no | affiliate purchase links |
| `VITE_ANNUAL_PRICE` | no | annual Pro price shown in the UI |

Server-side (Netlify → Site → Environment variables; for local `netlify dev`):

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | `claude.js` — the Oracle |
| `HARDCOVER_API_TOKEN` | `hardcover.js` and batch scripts |
| `GOOGLE_BOOKS_API_KEY` | `googlebooks.js` (keyless calls are rate-limited to zero) |
| `PRH_API_KEY` | `prh.js` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | webhooks, notifications, sitemap, share cards, batch scripts |
| `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_SIGNING_SECRET`, `LEMON_SQUEEZY_REDIRECT_URL`, `LEMON_SQUEEZY_REDIRECT_URL_ANNUAL` | Pro checkout and subscription webhook |
| `RESEND_API_KEY`, `WEBHOOK_SECRET` | notification emails |
| `ALLOWED_ORIGINS` | CORS allow-list for the proxies |

Rotating a key? See [docs/reference/KEY_ROTATION.md](docs/reference/KEY_ROTATION.md).

### 4. Run locally

```bash
npm run dev       # UI only — Oracle, Hardcover and other proxies won't answer
netlify dev       # full app with functions (npm install -g netlify-cli once)
```

### 5. Deploy

Netlify builds from `netlify.toml` — connect the repo and set the variables above.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite |
| `npm run lint` | ESLint (hooks rules + `no-undef`; see the header of `eslint.config.mjs`) |
| `npm test` / `test:watch` | vitest |
| `npm run verify` | lint + build + test — run before every push |
| `npm run link:db` / `pull:db` / `push:db` / `new:db` / `diff:db` | Supabase CLI migrations |

## Releasing

Every release gets a version and an entry in [CHANGELOG.md](CHANGELOG.md) (what was wrong,
what changed, files, how to verify) and bumps the version line at the top of this README.

What else depends on whether readers should hear about it:

| Release | Also update |
|---|---|
| **Reader-facing** — something a reader will see or use | `src/data/releases.js`: the bilingual EN/ES entry **and** `CURRENT_VERSION`; plus `public/app-version.json` to the same number (the build refuses to run if they differ). This shows the What's New dot (and the popup, if the entry is `major`) and lets installed apps detect the update. Keep `critical: false` unless old clients must reload immediately. |
| **Internal** — refactors, docs, tooling, fixes nobody would notice | nothing else. Leave `releases.js` and `CURRENT_VERSION` alone, and say so at the top of the CHANGELOG entry. |

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
