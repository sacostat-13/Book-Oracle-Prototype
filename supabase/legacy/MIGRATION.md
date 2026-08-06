# Migration Runbook — v0.2 → v0.3

This iteration introduces:

1. **Netlify Functions** to proxy Hardcover and Anthropic API calls so tokens stay server-side
2. **Hardcover integration** as the primary metadata/series source, with OpenLibrary as fallback
3. **Shared `books` table** in Supabase — a multi-tenant catalog instead of per-user denormalized data
4. **"The Vault"** — the curated catalog as a first-class concept in the app, available in the Oracle and as a plan-generation fallback

If you're updating an existing v0.2 deployment, follow these steps in order.

---

## 1. Apply the database migration

**This is destructive** — old `wishlist_items` and `read_books` columns get dropped. If you have real data you care about in v0.2, back it up first via Supabase → Database → Backups.

1. Open **Supabase → SQL Editor**
2. Paste the contents of `supabase/schema_v2_migration.sql`
3. **Run each step in order, one at a time.** The file is divided into commented steps. Verify the previous step succeeded before running the next.
4. If any step fails, stop and ping me — don't try to fix forward.

What this does:
- Creates the new `books` table with the unified schema
- Adds a `book_id` column to `wishlist_items` and `read_books`
- Migrates your existing per-user book data into shared `books` rows
- Drops the old denormalized columns
- Sets up RLS so anyone can read books but only the `upsert_book` RPC can write

---

## 2. Seed the curated catalog (The Vault)

After the migration, your `books` table has user-contributed rows but no curated ones. To populate the Vault with the original 280-book catalog as `source='curated', verified=true`:

1. Get your **service role key** from Supabase → Project Settings → API → Project API keys → service_role (NOT the anon key)
2. Add it to your local `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```
   This key bypasses RLS — keep it local, never commit it, never put it in Netlify env vars
3. Run the seeder once:
   ```bash
   cd oracle
   npm install
   node scripts/seedCuratedCatalog.mjs
   ```
   You'll see progress like `25/280…`, `50/280…`. Takes 1–2 minutes.

You only need to do this once. To re-run it later (if you update `booksData.js`), it's idempotent — existing curated books get updated, new ones get inserted.

---

## 3. Add Netlify Functions environment variables

In **Netlify → Site configuration → Environment variables**, add:

| Variable | Value |
|---|---|
| `HARDCOVER_API_TOKEN` | Your Hardcover Bearer token from hardcover.app/settings (without the `Bearer ` prefix; the function adds it) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key, starts with `sk-ant-…` |

These are **server-side only** — they're not exposed to the browser (no `VITE_` prefix). Only the Netlify Function can read them via `process.env`.

The existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` stay as-is.

---

## 4. Update Netlify build settings

If you don't already have a `netlify.toml` in the repo root, the new one bundled with this drop sets:

- Build command: `npm run build`
- Publish: `dist`
- Functions directory: `netlify/functions`
- SPA redirect (for client-side routing + OAuth callback)
- Node 20

If you already had `netlify.toml`, just verify the `functions = "netlify/functions"` line is present under `[build]`.

---

## 5. Local development

Two changes to local dev:

1. **Add `HARDCOVER_API_TOKEN` and `ANTHROPIC_API_KEY` to `.env.local`** so `netlify dev` picks them up.
2. **Use `netlify dev` instead of `npm run dev`** if you want the functions to work locally. `npm run dev` still works for everything except the Hardcover and AI Oracle calls.
   ```bash
   npm install -g netlify-cli   # one-time
   netlify dev
   ```
   This proxies Vite + functions on a single port (default :8888).

If you don't have the Netlify CLI installed and just want to test other features, run `npm run dev` and the Hardcover lookups will silently fall through to OpenLibrary.

---

## 6. Verify it works

After deploying:

1. Open the site, sign in
2. Go to Profile → check it loads with your name
3. Go to Wishlist → existing items should still be there (migrated through `book_id`)
4. Open any book modal → series detection should be more reliable
5. Go to Oracle → Categories → toggle "The Vault" → draw books → should pull from curated catalog
6. Open DevTools Network tab → confirm requests go to `/.netlify/functions/hardcover` and `/.netlify/functions/claude`, NOT directly to api.hardcover.app or api.anthropic.com

---

## Rollback

If something goes wrong with the migration and you need to roll back:

1. Restore the Supabase backup from before step 1
2. Revert the code to the v0.2 zip

The migration is destructive in step 6 (dropping old columns). If you stop before step 6 you can still go back without a backup — the old columns are still there.
