# Migration Runbook — v0.3 → v0.4

This iteration adds:

1. **Shared `series` table** in Supabase with editor verification
2. **"Needs review" badges** in the BookModal for unverified series
3. **Updated `upsert_book` RPC** that auto-upserts series rows when books reference them
4. **Updated curated seeder** that populates both `books` and `series` correctly

If you're updating from v0.3, follow these steps in order.

> Already on v0.2 or earlier? Apply `MIGRATION.md` (v0.2 → v0.3) first.

---

## 1. Apply the SQL migration

Open Supabase → SQL Editor, paste the contents of `supabase/schema_v3_migration.sql`, and run **each numbered step in order**, verifying success between steps.

What it does:
- Creates `series` table (read-public, write via RPC only)
- Adds `normalize_series_name` + `upsert_series` functions
- Adds `series_id` and `position_in_series` columns to `books`
- Backfills `series_id` from existing `series_name` data
- Drops the old denormalized `series_name` / `series_position` columns from `books`
- Replaces `upsert_book` with a v3 version that auto-upserts series rows

**Step 5 (the drop) is destructive.** If you want a safety net during testing, comment it out and run it later once you've verified everything works.

---

## 2. Re-seed the curated catalog

The seeder script has been updated to handle the new series table. Re-run it:

```bash
node scripts/seedCuratedCatalog.mjs
```

You'll see it run in two passes:
- Step 1/2: seeding series (upserts each distinct series as verified)
- Step 2/2: seeding books (links via series_id)

This is idempotent — existing curated rows get updated. Books that previously had only denormalized series info now properly reference series rows.

---

## 3. Deploy

No new env vars needed. Just push and Netlify rebuilds:

```bash
git add .
git commit -m "Add series table + verified flag"
git push
```

---

## 4. Verify

1. Open any book in your catalog that's part of a series (e.g. Stormlight Archive)
2. Check the BookModal series block — header should show "☩ verified" (gilt)
3. Add a Hardcover-sourced book to your wishlist that's in a series not yet in your catalog
4. Check the BookModal — that series's header should show "⚠ needs review" (red)
5. After you manually verify the series in Supabase (set `verified = true`), reload — badge flips to gilt

To manually verify a series:

```sql
update public.series
set verified = true
where name = 'Series Name Here';
```

You can also see all series at a glance:

```sql
select name, author, total_books, verified, source, created_at
from public.series
order by verified asc, created_at desc;
```

---

## What changed in the data flow

- Before: each `books` row had `series_name` text and a `series_position` number. Two books in the "same" series could disagree on naming.
- After: a `series` row is the single source of truth. Books point to it via `series_id`. The normalize function de-dups variants like "The Stormlight Archive" vs "Stormlight Archive".
- Every book lookup (Hardcover, OpenLibrary, manual add) that has series info now goes through `upsert_book` which auto-creates the series row if needed.
- Curated catalog books have their series rows pre-verified by the seeder.
- User-contributed series stay unverified until you manually flip the flag.

---

## Rollback

Restore the Supabase backup from before step 1. The code changes are backwards-compatible enough that running v0.4 code against a v0.3 schema would mostly work but with `series_id` queries returning null — book series sections would just not render. If you really need to roll back forward (rare), reverting to the v0.3 zip is safest.
