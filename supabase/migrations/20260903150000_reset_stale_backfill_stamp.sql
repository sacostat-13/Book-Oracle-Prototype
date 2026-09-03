-- Repair: version-2 backfill stamps recorded over a write that never landed.
--
-- Sequence that produced them:
--   1. 20260903130000 versioned the backfill gate, so every profile replayed
--      once against the v0.67 family ladders.
--   2. The replay's upsert was rejected by reading_accomplishments_kind_check,
--      which did not yet allow family_count / family_breadth / new_family.
--   3. `earnAccomplishments` logged the error and returned normally, so the
--      backfill stamped accomplishments_backfill_version = 2 regardless.
--
-- The profile is now marked as backfilled against ladders it never computed,
-- and the gate skips it forever — the Ledger shows the legacy plaques and no
-- families, with nothing in the console to explain why.
--
-- A version-2 stamp is therefore not trustworthy, and nothing in the data
-- distinguishes a profile that genuinely succeeded from one that did not. So
-- reset every 2 back to 1 and let all of them replay once. That is safe: every
-- insert is `on conflict (user_id, key) do nothing`, so a profile that DID
-- succeed re-earns nothing and simply re-stamps.
--
-- Apply AFTER 20260903140000_accomplishment_kinds.sql, or the replay hits the
-- same constraint again. Filename order does this.
--
-- The code-side fix is in DataContext: earnAccomplishments now returns
-- { ok, written, error } and the backfill refuses to stamp unless ok. This
-- migration cleans up the rows that flaw already wrote; the flaw itself cannot
-- recur.

update public.profiles
   set accomplishments_backfill_version = 1
 where accomplishments_backfill_version = 2;

-- Verify: expect 0 rows still stamped 2 before the app is reloaded.
--   select count(*) from profiles where accomplishments_backfill_version = 2;
