# Supabase CLI setup

One-time wiring so schema changes go through migrations instead of pasted SQL.

## The situation this has to accommodate

The database is **already live** with ~47 hand-applied migrations
(`schema_v2_migration.sql` … `schema_v47_migration.sql`). Those are historical
records, not CLI migrations — they aren't timestamped, several were edited after
being applied, and some were run partially. The CLI must not try to replay them.

So: **baseline from the live database**, and keep the old files as reference.

## 1. Install and link

The CLI is a devDependency and every script calls it through `npx`, so no global
install is needed.

```bash
npm install
npx supabase --version      # confirm the binary actually landed — see below
npx supabase login          # opens a browser, stores an access token
npx supabase init           # creates supabase/config.toml
npm run link:db             # links to project ref wwkqgnbnacajeqpdedbp
```

### If `supabase` is "not recognized"

The npm package downloads a platform binary in a **postinstall** step, and that
step fails silently on Windows more often than it should — you end up with the
package present and no working binary. `npx supabase --version` is the test.

Three fixes, in order of preference:

```powershell
# 1. Force the postinstall to run again
npm rebuild supabase

# 2. Scoop — the install path Supabase actually recommends on Windows
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# 3. Skip local install entirely; npx fetches it per-invocation (slow but works)
npx --yes supabase@latest --version
```

If you go the Scoop route, `supabase` is on your PATH globally and the `npx`
prefix in the npm scripts still resolves to it, so nothing needs changing. You
can drop `supabase` from devDependencies at that point.

Note the pinned version in `package.json` (`^2.22.6`) was a guess — if npm
resolves it oddly, `npm install -D supabase@latest` and commit whatever it
picks.

`init` will warn that `supabase/` already exists — that's fine, it only adds
`config.toml` and won't touch the existing `.sql` files.

The project ref above is read from the Supabase URL already in the client
(`wwkqgnbnacajeqpdedbp`). Linking asks for the **database password**, not the
service role key — it's under Project Settings → Database.

## 2. Baseline from the live schema

```bash
npm run pull:db
```

`supabase db pull` introspects the live database, writes
`supabase/migrations/<timestamp>_remote_schema.sql`, and records it as already
applied. That single file becomes the starting point; nothing is re-run against
production.

Commit it. This is the first time the schema has existed in git as a single
coherent artifact.

## 3. Archive the hand-written history

```bash
mkdir -p supabase/legacy
git mv supabase/schema_*.sql supabase/legacy/
git mv supabase/rls_audit.sql supabase/dedupe_audit.sql supabase/legacy/ 2>/dev/null
```

The CLI only reads `supabase/migrations/`, so loose files in `supabase/` are
ignored — but leaving them alongside a real migration history invites someone
to run the wrong one. Keep them for reference, out of the way.

**Exception:** `schema_v47_migration.sql` (the catalog dedupe) is not applied
yet. Leave it where it is until it has been run, then archive it too — or
better, re-express it as a proper migration (step 4) and run it via `push:db`.

## 4. Day-to-day

```bash
npm run new:db -- add_hidden_books     # create an empty timestamped migration
# ...write SQL...
npm run push:db                        # apply pending migrations to the linked project
npm run list:db                        # what's applied locally vs remotely
```

If you change something in the Supabase dashboard by hand, capture it:

```bash
npm run diff:db -- describe_the_change  # writes the delta as a new migration
```

## 5. Keeping a local copy

### Which commands need Docker

The CLI runs `pg_dump` inside a container so its version matches the server's.
That means:

| Command | Docker? |
|---|---|
| `push:db`, `list:db`, `link:db` | **No** — plain network calls |
| `dump:db`, `dump:data` | **Yes** |
| `pull:db`, `diff:db` | **Yes** — they diff against a shadow database |
| `reset:db` | **Yes** — it *is* a local database |

### Option A — install Docker Desktop

Unlocks everything, including a real local database for `reset:db` and safe
migration rehearsal. The recommended path if you intend to keep doing schema
work.

```bash
npm run dump:db
npm run dump:data
```

### Option B — no Docker, native pg_dump

Enough for backups and for baselining, which is what matters here.

1. Install Postgres **client** tools (the server isn't needed):

   ```powershell
   scoop install postgresql
   # or the EDB installer, selecting only "Command Line Tools"
   pg_dump --version
   ```

   The client version must be **>= the server's**. Check the server under
   Project Settings → Database → Postgres version; a newer `pg_dump` is fine,
   an older one refuses to run.

2. Get the connection string from Project Settings → Database → Connection
   string → **URI**. Use the **Session pooler** entry — Supabase moved direct
   connections to IPv6 and most home networks can't reach them.

3. Set it for the shell (do NOT commit it — it contains the password):

   ```powershell
   $env:SUPABASE_DB_URL = "postgresql://postgres.wwkqgnbnacajeqpdedbp:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   ```

4. Dump:

   ```bash
   npm run dump:schema:pg    # → supabase/dump/schema.sql
   npm run dump:data:pg      # → supabase/dump/data.sql
   npm run dump:full:pg      # → supabase/dump/full.sql
   ```

   The `%SUPABASE_DB_URL%` syntax in those scripts is Windows `cmd`. On
   PowerShell or bash, run `pg_dump` directly with `$env:SUPABASE_DB_URL` /
   `$SUPABASE_DB_URL`.

### Baselining without Docker

`pull:db` needs Docker, so build the baseline by hand instead:

```bash
npm run dump:schema:pg
mkdir -p supabase/migrations
mv supabase/dump/schema.sql supabase/migrations/20260101000000_baseline.sql
npx supabase migration repair --status applied 20260101000000
```

`migration repair` marks it as already applied so `push:db` never tries to
replay it against production. Verify with `npm run list:db` — the baseline
should appear in both Local and Remote columns.

`supabase/dump/` is gitignored — dumps contain user data and shouldn't be
committed. Take one before any destructive migration, `schema_v47` included.

## Cautions

- **`npm run reset:db` wipes the LOCAL dev database and replays every
  migration.** It does not touch production, but it's the closest thing here to
  a footgun. It also requires Docker.
- **Never run `push:db` against production without reading the plan.** The CLI
  prints pending migrations and asks for confirmation — read it rather than
  reflexively confirming.
- `supabase/migrations/` and `supabase/config.toml` must stay tracked in git.
  `supabase` was previously ignored wholesale, which is how a migration file was
  once overwritten unrecoverably.
- Row Level Security policies come across in `db pull`, but **verify** after
  baselining — `select tablename, policyname from pg_policies` before and after
  should match.
