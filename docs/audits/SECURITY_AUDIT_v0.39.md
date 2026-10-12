# Reading Oracle — Security Audit (v0.39 QA)

Scope: Netlify Functions, Supabase RLS/migrations, secrets handling. Focus per request:
(1) cross-user data theft, (2) Anthropic/Claude API cost abuse, (3) standard web-app items.

Overall: the frontend/secrets story is solid (no service-role key in the bundle, `.env`
files are gitignored and untracked, payment webhook verifies its HMAC signature). The
serious problems are concentrated in **two root causes**: JWTs are never signature-verified
in any function, and the Claude proxy fails *open*. Together these make the Oracle proxy an
open, unmetered Claude endpoint — the exact token-money risk you called out.

---

## CRITICAL

### C1. Claude proxy can be used for free, unlimited calls (token-money burn)
`netlify/functions/claude.js`

Three flaws combine into one open door:

1. **No JWT signature verification** (lines 87–94). The function base64-decodes the JWT
   payload and trusts the `sub` claim. Anyone can hand-craft a token with any `sub`.
2. **Fail-open quota.** `get_oracle_quota` returns `{status:'error'}` when the profile
   doesn't exist (`schema_v22_migration.sql`). In `claude.js`, `if (quota && quota.status !== 'error')`
   leaves `quotaEnforced = false`, so the code **skips the limit and calls Anthropic anyway**
   (lines 100–116). A forged token with a random UUID → no profile → no quota → free call.
   The comment on line 115 ("fail open and proceed") confirms this is by design.
3. **`Access-Control-Allow-Origin: '*'`** (line 21) — callable from any origin / any script.

Impact: an attacker who finds the endpoint (it's in the deployed JS bundle) can run unlimited
Claude calls on your API key. This is the single most important finding.

### C2. Caller controls `model` and `maxTokens` with no cap
`netlify/functions/claude.js` line 72

`const { prompt, systemPrompt, maxTokens = 2000, model = 'claude-sonnet-4-5' } = body;`

`model`, `maxTokens`, `prompt`, and `systemPrompt` all come straight from the request body
with no allowlist or size limit. Even a *legitimate* quota user can request the most expensive
model at maximum `max_tokens` on every call — quota counts calls, not tokens, so cost per
"call" is unbounded. `systemPrompt` being fully overridable also turns the endpoint into a
general-purpose Claude proxy (whatever prompt the attacker wants), not just book recs.

**Fix for C1+C2 (do all of these):**
- Verify the JWT signature against your Supabase JWT secret (or call Supabase `/auth/v1/user`
  with the token) before trusting `sub`. Reject on failure.
- **Fail closed:** if the quota lookup errors or returns null, deny the call, don't proceed.
- Allowlist `model` to the one or two you actually use; clamp `maxTokens` (e.g. `Math.min(maxTokens, 2000)`).
- Cap `prompt`/`systemPrompt` length; consider ignoring client `systemPrompt` entirely and
  setting it server-side.
- Restrict CORS to `https://readingoracle.com` instead of `*`.
- Add a coarse per-IP rate limit as defense-in-depth.

### C3. All user profiles (incl. billing IDs) are world-readable
`schema_v20_migration.sql` lines 96–97

```sql
create policy "public profile read" on public.profiles for select using (true);
```

RLS is row-level, not column-level, and this policy isn't restricted `to authenticated`, so
**anyone with the public anon key (including unauthenticated) can `select *` from every profile
row** — including `stripe_customer_id`, `stripe_subscription_id`, `ls_customer_id`,
`ls_subscription_id`, and `subscription_status` (added in `schema_v17`/`v22`). That's billing
PII and a cross-user data leak. It was added to support friend views, which only need
username/display_name/avatar.

**Fix:** Don't expose the whole table. Either (a) create a view with only the public columns and
grant select on that, moving billing columns to a separate table with owner-only RLS, or
(b) use Postgres column privileges / a `SECURITY DEFINER` function that returns only public
fields. Restrict the policy `to authenticated` at minimum.

---

## HIGH

### H1. No JWT verification anywhere → cross-user billing access
`create-checkout-session.js`, `manage-subscription.js`, `claude.js` all decode the JWT without
verifying it. In `manage-subscription.js`, the forged `sub` is looked up and the function
returns **that user's Lemon Squeezy customer-portal URL**. Chained with C3 (which leaks every
user's `id` and `ls_subscription_id`), an attacker can pull any user's billing portal link.
**Fix:** same JWT verification as C1, applied to every function that trusts `sub`.

### H2. Social/club tables have no migration in the repo — RLS unverifiable
The app queries `book_clubs`, `book_club_members`, `book_club_sessions`, `session_comments`,
`session_questions`, `club_polls`, `poll_options`, `lists`, `list_items`, `book_club_genres`
(seen in `src/`), but **none of these have a `create table` / RLS migration in `supabase/`**.
They were likely created directly in the Supabase dashboard. These are exactly the tables that
hold multi-user shared content — if RLS was never enabled on any of them, they're fully
readable/writable by anyone with the anon key.
**Fix:** In the Supabase dashboard, verify `rowsecurity = true` and correct policies on every
one of these tables, then commit the DDL as migrations so it's auditable. Query to check:
`select relname, relrowsecurity from pg_class where relkind='r' and relnamespace='public'::regnamespace;`

---

## MEDIUM / LOW

- **M1. Fail-open quota on Supabase outage** (`claude.js` line 115): even with C1 fixed, a
  transient Supabase failure lets calls through unmetered. Fail closed. (Folded into C1 fix.)
- **M2. Webhook signature uses non-constant-time compare** (`lemon-squeezy-webhook.js` line 26,
  `computed === signatureHeader`): timing side-channel. Use a constant-time comparison. Low
  practical risk but easy to fix.
- **L1. CORS `*` on all functions** (`claude.js`, `create-checkout-session.js`,
  `manage-subscription.js`): tighten to your origin.
- **L2. Verbose upstream error detail** returned to client in a couple of proxies
  (e.g. `detail: String(e)`): fine for now, avoid leaking internals in prod.
- **Checked and OK:** no service-role key in frontend bundle; `.env`/`.env.local` gitignored and
  untracked; `prh.js` requires `path` to start with `/`, preventing the userinfo-host SSRF trick;
  webhook HMAC verification present; per-user tables (`wishlist_items`, `read_books`, `plans`,
  `notifications`, `friendships`, `currently_reading`) have owner-scoped RLS in the committed schema.

---

## Suggested fix order
1. C1 + C2 — lock down the Claude proxy (verify JWT, fail closed, clamp model/tokens, CORS). Highest $ risk.
2. C3 + H1 — stop exposing billing columns; verify JWTs everywhere.
3. H2 — audit RLS on the club/list/discussion tables in Supabase and commit migrations.
4. M/L items.
