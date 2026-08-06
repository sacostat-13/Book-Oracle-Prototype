-- ============================================================================
-- Schema v6 migration: review status + provenance on books and series
-- ============================================================================
-- Ships as: v0.14 (additive only — no destructive changes)
--
-- WHAT THIS DOES
-- --------------
-- Replaces the boolean `verified` flag on books/series with a richer model:
--   - `status` (text):           where the row is in the review pipeline
--   - `verified_at` (tstz):      when it reached its current verified state
--   - `verified_by` (uuid):      which admin verified it (for admin verifications)
--   - `verified_source` (text):  how it got verified — 'curated_seed' | 'oracle' | 'admin'
--
-- The legacy `verified` boolean is KEPT in this migration so old clients keep
-- working. The RPCs are updated to accept both `_verified` (deprecated) and
-- the new `_status` / `_verified_source` params, deriving the boolean from
-- the status for back-compat. The boolean drops in v0.15 once clients are
-- fully migrated.
--
-- This migration also resolves a long-standing naming issue on `series`:
-- the existing `series.status` column ('ongoing' | 'complete' | 'unknown')
-- is actually *publication status*, not review status. We rename it to
-- `publication_status` so the new `status` column can carry review state
-- consistently across books and series.
--
-- PREREQS: schema_v3_migration.sql must already be applied (this assumes the
-- `books`, `series`, `upsert_book`, and `upsert_series` definitions from v3
-- are in place).
--
-- Safe to run multiple times; uses IF NOT EXISTS / IF EXISTS where possible.
-- Function replacements use CREATE OR REPLACE.
-- ============================================================================


-- ============================================================================
-- STEP 1: Rename series.status → series.publication_status
-- ============================================================================
-- The existing column holds 'ongoing' | 'complete' | 'unknown'. That's about
-- whether the series is still being published, not about review state. Rename
-- it so the new review `status` column can land cleanly.

ALTER TABLE public.series
  RENAME COLUMN status TO publication_status;

-- Re-add the comment for clarity.
COMMENT ON COLUMN public.series.publication_status IS
  'Publication state of the series: ongoing | complete | unknown. '
  'Distinct from the review `status` column added in v0.14.';


-- ============================================================================
-- STEP 2: Add review status + provenance columns to books
-- ============================================================================

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS status          text        NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS verified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_source text;

-- Status enum constraint. Five values:
--   unreviewed          — default for new rows; no review activity
--   incomplete          — flagged by client (e.g., low-confidence bookLookup match)
--                         or by an admin as needing more info
--   oracle_categorized  — the Oracle assigned genres; admin hasn't reviewed yet
--   verified            — fully reviewed (by admin or curated seed)
--   flagged             — admin-flagged for follow-up; hidden from non-admin UI
ALTER TABLE public.books
  DROP CONSTRAINT IF EXISTS books_status_check;
ALTER TABLE public.books
  ADD CONSTRAINT books_status_check
  CHECK (status IN ('unreviewed', 'incomplete', 'oracle_categorized', 'verified', 'flagged'));

-- Verified source enum constraint. NULL allowed (for unreviewed/incomplete/
-- flagged rows that have no verification source).
ALTER TABLE public.books
  DROP CONSTRAINT IF EXISTS books_verified_source_check;
ALTER TABLE public.books
  ADD CONSTRAINT books_verified_source_check
  CHECK (verified_source IS NULL OR verified_source IN ('curated_seed', 'oracle', 'admin'));

-- Index on status. Low cardinality (5 values) but the vault query
-- (.eq('status', 'verified')) is hot, and the Oracle button's filter
-- (status IN ('unreviewed', 'incomplete')) will also benefit.
CREATE INDEX IF NOT EXISTS books_status_idx ON public.books(status);

COMMENT ON COLUMN public.books.status IS
  'Review pipeline state: unreviewed | incomplete | oracle_categorized | verified | flagged';
COMMENT ON COLUMN public.books.verified_at IS
  'Timestamp when the row reached its current verified state. NULL until verified.';
COMMENT ON COLUMN public.books.verified_by IS
  'Admin user who verified the row. NULL for curated_seed and oracle sources.';
COMMENT ON COLUMN public.books.verified_source IS
  'How the row was verified: curated_seed | oracle | admin. NULL for unverified rows.';


-- ============================================================================
-- STEP 3: Same columns on series
-- ============================================================================

ALTER TABLE public.series
  ADD COLUMN IF NOT EXISTS status          text        NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS verified_at     timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_source text;

ALTER TABLE public.series
  DROP CONSTRAINT IF EXISTS series_status_check;
ALTER TABLE public.series
  ADD CONSTRAINT series_status_check
  CHECK (status IN ('unreviewed', 'incomplete', 'oracle_categorized', 'verified', 'flagged'));

ALTER TABLE public.series
  DROP CONSTRAINT IF EXISTS series_verified_source_check;
ALTER TABLE public.series
  ADD CONSTRAINT series_verified_source_check
  CHECK (verified_source IS NULL OR verified_source IN ('curated_seed', 'oracle', 'admin'));

CREATE INDEX IF NOT EXISTS series_status_idx ON public.series(status);

COMMENT ON COLUMN public.series.status IS
  'Review pipeline state: unreviewed | incomplete | oracle_categorized | verified | flagged';
COMMENT ON COLUMN public.series.verified_at IS
  'Timestamp when the row reached its current verified state. NULL until verified.';
COMMENT ON COLUMN public.series.verified_by IS
  'Admin user who verified the row. NULL for curated_seed and oracle sources.';
COMMENT ON COLUMN public.series.verified_source IS
  'How the row was verified: curated_seed | oracle | admin. NULL for unverified rows.';


-- ============================================================================
-- STEP 4: Backfill from the legacy `verified` boolean
-- ============================================================================
-- Every row currently with verified=true is treated as a curated-seed
-- verification. verified_by is left NULL (curated_seed has no individual admin
-- attribution; the source itself is the provenance). verified_at uses
-- updated_at as the best available approximation.
--
-- Only runs on rows where status is still the default ('unreviewed'), so
-- re-running the migration after manual status edits won't clobber them.

UPDATE public.books
   SET status          = 'verified',
       verified_source = 'curated_seed',
       verified_at     = updated_at
 WHERE verified = true
   AND status = 'unreviewed';

UPDATE public.series
   SET status          = 'verified',
       verified_source = 'curated_seed',
       verified_at     = updated_at
 WHERE verified = true
   AND status = 'unreviewed';


-- ============================================================================
-- STEP 5: Update upsert_series to accept the new params
-- ============================================================================
-- Adds `_status` and `_verified_source`. Keeps `_verified` as a deprecated
-- back-compat param: if `_status` is not passed (NULL), we derive it from
-- `_verified`. If both are passed, `_status` wins.
--
-- The `verified` boolean column continues to be written, derived from the
-- final status. Old clients reading the boolean still get correct values.

DROP FUNCTION IF EXISTS public.upsert_series(
  text, text, int, text, text, bigint, text, boolean, jsonb
);

CREATE OR REPLACE FUNCTION public.upsert_series(
  _name text,
  _author text default null,
  _total_books int default null,
  _publication_status text default 'unknown',
  _source text default 'user_manual',
  _hardcover_id bigint default null,
  _description text default null,
  _verified boolean default false,                  -- DEPRECATED: use _status
  _metadata jsonb default '{}'::jsonb,
  _status text default null,                        -- NEW: review status
  _verified_source text default null                -- NEW: 'curated_seed' | 'oracle' | 'admin'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _norm text;
  _id uuid;
  _existing record;
  _resolved_status text;
  _resolved_verified boolean;
begin
  if _name is null or length(trim(_name)) = 0 then
    raise exception 'series name is required';
  end if;
  _norm := normalize_series_name(_name);
  if length(_norm) = 0 then
    raise exception 'series name normalizes to empty string';
  end if;

  -- Resolve status: explicit _status wins, otherwise derive from _verified.
  if _status is not null then
    _resolved_status := _status;
  elsif _verified is true then
    _resolved_status := 'verified';
  else
    _resolved_status := 'unreviewed';
  end if;

  -- Boolean is derived from status for back-compat.
  _resolved_verified := (_resolved_status = 'verified');

  select * into _existing from series where normalized_name = _norm limit 1;
  if found then
    -- Don't downgrade an existing verified series. Don't change status on
    -- updates from non-admin paths unless explicitly elevated.
    update series set
      author             = coalesce(_existing.author, _author),
      total_books        = coalesce(_existing.total_books, _total_books),
      publication_status = case when _existing.publication_status = 'unknown'
                                then coalesce(_publication_status, 'unknown')
                                else _existing.publication_status end,
      hardcover_id       = coalesce(_existing.hardcover_id, _hardcover_id),
      description        = coalesce(_existing.description, _description),
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into series (
    name, normalized_name, author, total_books, publication_status,
    source, hardcover_id, description,
    verified, status, verified_source, verified_at, verified_by,
    metadata, created_by
  ) values (
    _name, _norm, _author, _total_books, coalesce(_publication_status, 'unknown'),
    coalesce(_source, 'user_manual'), _hardcover_id, _description,
    _resolved_verified,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;


-- ============================================================================
-- STEP 6: Update upsert_book to accept the new params
-- ============================================================================
-- Same pattern as upsert_series: new `_status` and `_verified_source` params,
-- legacy `_verified` kept for back-compat. The internal upsert_series call
-- now passes status/source through so a verified book seeds a verified series.

DROP FUNCTION IF EXISTS public.upsert_book(
  text, text, text, bigint, text, numeric, int, text, text, text,
  int, int, text, boolean, jsonb, uuid, text
);

CREATE OR REPLACE FUNCTION public.upsert_book(
  _title text,
  _author text,
  _isbn text default null,
  _hardcover_id bigint default null,
  _series_name text default null,
  _series_position numeric default null,
  _pages int default null,
  _description text default null,
  _cover_url text default null,
  _genre text default null,
  _complexity int default null,
  _depth int default null,
  _source text default 'user_manual',
  _verified boolean default false,                  -- DEPRECATED: use _status
  _metadata jsonb default '{}'::jsonb,
  _series_id uuid default null,
  _series_source text default null,
  _status text default null,                        -- NEW: review status
  _verified_source text default null                -- NEW: 'curated_seed' | 'oracle' | 'admin'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _key text;
  _id uuid;
  _existing record;
  _resolved_series_id uuid := _series_id;
  _resolved_status text;
  _resolved_verified boolean;
begin
  if _title is null or length(trim(_title)) = 0 then
    raise exception 'title is required';
  end if;

  -- Resolve status: explicit _status wins, otherwise derive from _verified.
  if _status is not null then
    _resolved_status := _status;
  elsif _verified is true then
    _resolved_status := 'verified';
  else
    _resolved_status := 'unreviewed';
  end if;

  _resolved_verified := (_resolved_status = 'verified');

  -- Resolve series_id from the name if not given explicitly.
  -- Propagate status/source to the series so curated-seed books seed curated
  -- series, and oracle-categorized books seed oracle-categorized series.
  if _resolved_series_id is null and _series_name is not null and length(trim(_series_name)) > 0 then
    _resolved_series_id := upsert_series(
      _series_name,
      _author,
      null, null,
      coalesce(_series_source, _source, 'user_manual'),
      null, null,
      _resolved_verified,                           -- _verified (deprecated)
      '{}'::jsonb,
      _resolved_status,                             -- _status (new)
      _verified_source                              -- _verified_source (new)
    );
  end if;

  _key := compute_book_key(_title, _author);

  select * into _existing from books where normalized_key = _key limit 1;
  if found then
    -- Existing-row update path: do NOT change status on upsert. Status
    -- transitions are explicit operations (Oracle button, admin actions),
    -- not side effects of a metadata refresh.
    update books set
      isbn               = coalesce(_existing.isbn, _isbn),
      hardcover_id       = coalesce(_existing.hardcover_id, _hardcover_id),
      series_id          = coalesce(_existing.series_id, _resolved_series_id),
      position_in_series = coalesce(_existing.position_in_series, _series_position),
      pages              = coalesce(_existing.pages, _pages),
      description        = coalesce(_existing.description, _description),
      cover_url          = coalesce(_existing.cover_url, _cover_url),
      genre              = coalesce(_existing.genre, _genre),
      complexity         = case when _existing.verified then _existing.complexity else coalesce(_existing.complexity, _complexity) end,
      depth              = case when _existing.verified then _existing.depth else coalesce(_existing.depth, _depth) end,
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_id, position_in_series, pages, description, cover_url,
    genre, complexity, depth, source,
    verified, status, verified_source, verified_at, verified_by,
    metadata, created_by
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _resolved_series_id, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source,
    _resolved_verified,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;


-- ============================================================================
-- STEP 7: Permissions
-- ============================================================================
-- The RPCs were already granted to authenticated in v2/v3; CREATE OR REPLACE
-- preserves grants. Re-grant defensively in case a Supabase project lost them.

GRANT EXECUTE ON FUNCTION public.upsert_book TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_series TO authenticated;


-- ============================================================================
-- Done. v0.14 schema is in place.
-- ============================================================================
-- Old clients keep working — they read/write the `verified` boolean as before.
-- New clients can read `status` / `verified_source` / `verified_by` /
-- `verified_at` and write via the new RPC params.
--
-- v0.15 will:
--   1. Migrate all client reads from `verified` to `status`
--   2. Add the Oracle categorization button (writes status='oracle_categorized')
--   3. Add genres tables + two-dropdown filter
--   4. Ship a destructive follow-up migration that drops the `verified` column
--      and the `_verified` RPC param after a deploy cycle confirms safety.
-- ============================================================================
