-- ============================================================================
-- v0.19 schema migration: add 'discovered' to books.status CHECK constraint
-- ============================================================================
--
-- 'discovered' = book exists in the global catalog (upserted via search/book page)
-- but has no wishlist_items row linking it to any user's collection.
-- These books are excluded from Oracle batches and all collection views.
-- They become 'unreviewed' automatically when a user adds them to their wishlist
-- or library (addToWishlist / markAsRead already call upsert_book which does
-- not downgrade status on existing rows — the calling code passes the right status).
--
-- Safe to run multiple times (idempotent via DROP/ADD constraint pattern).
-- ============================================================================

ALTER TABLE public.books
  DROP CONSTRAINT IF EXISTS books_status_check;

ALTER TABLE public.books
  ADD CONSTRAINT books_status_check
  CHECK (status IN (
    'unreviewed',
    'incomplete',
    'oracle_categorized',
    'verified',
    'flagged',
    'discovered'        -- v0.19: seen via search, not yet in any user's collection
  ));

COMMENT ON COLUMN public.books.status IS
  'Review pipeline: unreviewed | incomplete | oracle_categorized | verified | flagged | discovered';

-- ============================================================================
-- Done. No data migration needed — existing rows are unaffected.
-- New rows inserted via upsertDiscoveredBook will use status=''discovered''.
-- ============================================================================
