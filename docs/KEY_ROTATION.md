# Supabase key rotation — runbook

Written during the August 2026 rotation, after keys were exposed. Kept because
the next rotation should not require rediscovering the order of operations.

## The one thing to get right

**Rotate before you tidy.** Making a repo private, rewriting history, deleting a
commit — none of that un-publishes a key that was public. Bots scrape new public
repos within seconds, forks keep their own copies, and caches outlive both. A
key that was exposed is compromised; the only fix is a new key.

## What is and isn't a secret

| Value | Secret? | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | **No** | Shipped in the browser bundle. Every visitor has it. Cannot be rotated — the project ref is permanent. Changing it means a new project and a full data migration. |
| Publishable key (`sb_publishable_…`) | **No** | Also in the browser bundle by design. Safe because RLS constrains it. |
| Secret key (`sb_secret_…`) | **YES** | Bypasses RLS entirely. Full read/write on every user's data. |
| `ANTHROPIC_API_KEY` | **YES** | Spends money. |
| `HARDCOVER_API_TOKEN` | **YES** | Rate-limited per account. |

A leaked URL is not an incident. A leaked secret key is — and it is only useful
to an attacker *because* the URL is public, so there is no point protecting the
URL after the fact.

## Legacy JWT keys vs the new API keys

Supabase is retiring the legacy `anon` and `service_role` JWTs, and **legacy keys
can no longer be rotated individually**. The old remedy — regenerating the JWT
secret — invalidates every token signed with it, which logs out every user and
breaks the anon key at the same time.

The replacement path is to stop using legacy keys rather than rotate them:

1. Create a new **secret key** (`sb_secret_…`) in Settings → API Keys.
2. Move every server-side consumer onto it.
3. Delete the legacy `service_role` key.

New-style keys stop working within seconds of deletion. Legacy JWTs carry a
ten-year expiry, so a leaked one stays valid until the whole secret is rotated.

## Order of operations

Do these in order. Steps 2 and 3 can overlap; step 4 must come last.

### 1. Create the new keys

Supabase → Settings → API Keys. Create a secret key. Note the publishable key
while you are there — you need it in step 3.

### 2. Update every server-side consumer

The variable **name** stays `SUPABASE_SERVICE_ROLE_KEY`; only the value changes.
Thirteen call sites read that name and renaming them mid-rotation would risk
more than the inaccurate label costs.

- **Netlify** → Site configuration → Environment variables → `SUPABASE_SERVICE_ROLE_KEY`
- **GitHub** → Settings → Secrets and variables → Actions → `SUPABASE_SERVICE_ROLE_KEY`
  (read by `.github/workflows/catalog-maintenance.yml`)
- **Local** → `.env.local`

Consumers, for completeness:

```
netlify/functions/claude.js
netlify/functions/sitemap.js
netlify/functions/catalog-crawl.mjs
netlify/functions/manage-subscription.js
netlify/functions/create-checkout-session.js
netlify/functions/lemon-squeezy-webhook.js
netlify/functions/send-notification-email.js
netlify/functions/_shared/auth.js
netlify/edge-functions/og-prerender.js
batch-scripts/scheduled/*.mjs   (4 scripts)
batch-scripts/manual/*.mjs      (4 scripts)
```

### 3. Move the client onto the publishable key

`src/lib/supabase.js` already reads `VITE_SUPABASE_PUBLISHABLE_KEY`. Confirm it
is set in Netlify's build environment, because **this is what breaks the app if
you miss it** — the client falls back to a placeholder and PostgREST answers
every request with "No API key found in request".

`netlify/functions/_shared/auth.js` also falls back through the anon key. Its
chain now includes the publishable names, so it survives step 4.

### 4. Delete the legacy keys

Only once steps 2 and 3 are deployed and verified. Deleting first takes the site
down.

### 5. Redeploy

Netlify environment variable changes do not apply to already-built functions.
Trigger a deploy, then confirm:

- the app loads and can read books (publishable key works)
- an Oracle call succeeds (`claude.js` has the secret key)
- the catalog workflow runs — dispatch it manually with `limit: 10`

## After rotating: assume it was used

A stolen secret key reads data without generating errors, so nothing will look
broken. Check Supabase → Logs for the exposure window:

- REST reads against `profiles`, `wishlist_items`, `read_books` from unfamiliar IPs
- any writes you cannot account for
- auth events you did not initiate

If user data was readable, work out whether that triggers a disclosure
obligation. Reading history is personal data.

## Preventing the next one

- `.env` and `.env.local` are gitignored (`.gitignore` lines 3–4). Keep it that way.
- Never paste a real key into `.env.example`, README, or a migration doc, even
  truncated. `MIGRATION.md` uses `eyJhbGc...` as an illustration — that is the
  correct amount of key to write down.
- Enable GitHub secret scanning with push protection. It blocks the push rather
  than emailing after the fact.
- The catalog workflow writes `.env.local` inside the runner from Actions
  secrets. That file never leaves the runner, and the artifact upload is scoped
  to `batch-scripts/output/*.csv` and `*.log` — check that scope stays narrow if
  anyone adds to it.
