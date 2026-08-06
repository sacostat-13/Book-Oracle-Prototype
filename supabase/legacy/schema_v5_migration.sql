-- ============================================================================
-- Schema v5 migration: user-added categories
-- ============================================================================
--
-- Adds a global category catalog that users can contribute to. Three tables:
--
--   categories            global canonical list, with a verified flag.
--                         normalized_name is the dedup key (strict — same
--                         pattern as normalize_series_name from v3).
--
--   book_categories       links a category to a book at the GLOBAL level.
--                         only populated when an admin verifies a category
--                         on a book, OR when a verified category is added.
--                         these power the green/gilt "☩ verified" pills.
--
--   user_book_categories  links a category to a book FOR A SPECIFIC USER.
--                         these are user-private — only the owning user sees
--                         them. these power the unverified/user-only pills.
--                         when an admin verifies a category globally, the
--                         user_book_categories rows stay (so users keep their
--                         personal organization), but a global book_categories
--                         row is also created.
--
-- Soft cap: 10 categories per (user, book). Enforced in RPC, not at SQL level
-- so admin operations can exceed it during cleanup.
--
-- Coexists with the existing `books.genre` field — that stays as a single-value
-- "primary genre" for the eyebrow and Library grouping. Categories are the
-- multi-value additive layer that lives in pills.
--
-- The `g` field is NOT migrated into categories — they're treated as separate
-- concepts. See README v0.12 for the rationale.
--
-- Safe to run multiple times; uses IF NOT EXISTS where possible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: normalize_category_name
-- ----------------------------------------------------------------------------
-- Mirrors the JS normalizer in bookHelpers.js and the existing
-- normalize_series_name pattern: lowercase, strip leading "the ", strip
-- everything that isn't [a-z0-9]. Used as the unique dedup key.
--
-- IMMUTABLE so we can use it in a unique index.

CREATE OR REPLACE FUNCTION normalize_category_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(name, '')), '^the\s+', ''),
    '[^a-z0-9]', '', 'g'
  )
$$;

-- ----------------------------------------------------------------------------
-- Table: categories
-- ----------------------------------------------------------------------------
-- The global canonical list. Every distinct category name lives here exactly
-- once (per normalized name). New rows are created by users; admins set the
-- verified flag.
--
-- usage_count is denormalized — total number of user_book_categories rows
-- pointing at this category. Maintained by triggers below. Useful for:
--   - sorting autocomplete results
--   - surfacing categories to admins for verification
--   - eventual analytics

CREATE TABLE IF NOT EXISTS categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  normalized_name text NOT NULL,
  verified        boolean NOT NULL DEFAULT false,
  verified_at     timestamptz,
  verified_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  usage_count     integer NOT NULL DEFAULT 0,

  -- Length sanity: nothing absurd. 80 chars covers any real category name
  -- ("Latin American Magical Realism" is 30) without inviting essay-length
  -- abuse.
  CONSTRAINT categories_name_length_check CHECK (
    char_length(name) > 0 AND char_length(name) <= 80
  ),
  CONSTRAINT categories_normalized_name_nonempty CHECK (
    char_length(normalized_name) > 0
  )
);

-- Strict normalization → strict uniqueness. "Cyberpunk", "cyberpunk",
-- "Cyber-punk", "Cyber Punk" all collapse to `cyberpunk` and dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS categories_normalized_name_unique
  ON categories(normalized_name);

-- Verified categories surface first in autocomplete. This index supports the
-- common query: WHERE normalized_name ILIKE '...' ORDER BY verified DESC,
-- usage_count DESC, name ASC.
CREATE INDEX IF NOT EXISTS categories_verified_usage_idx
  ON categories(verified DESC, usage_count DESC);

-- Trigram index for the autocomplete substring search. The pg_trgm extension
-- is already enabled (Supabase has it by default for most projects). If not,
-- the CREATE EXTENSION is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS categories_name_trgm_idx
  ON categories USING gin (normalized_name gin_trgm_ops);


-- ----------------------------------------------------------------------------
-- Table: book_categories
-- ----------------------------------------------------------------------------
-- Global links: this book has this category, at the catalog level.
-- Populated either:
--   1. When the book's curated/seed data declared the category (rare)
--   2. When an admin verifies a category that a user added to a book
--
-- Visible to all users. Powers the gilt "☩ verified" pills.

CREATE TABLE IF NOT EXISTS book_categories (
  book_id       uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  added_at      timestamptz NOT NULL DEFAULT now(),
  added_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  PRIMARY KEY (book_id, category_id)
);

CREATE INDEX IF NOT EXISTS book_categories_category_idx
  ON book_categories(category_id);


-- ----------------------------------------------------------------------------
-- Table: user_book_categories
-- ----------------------------------------------------------------------------
-- Per-user links: this user has tagged this book with this category. The
-- visible "your categories" set on a book.
--
-- A row here means: "User X has this private category on book Y." The category
-- itself might also be globally verified (in which case it also appears in
-- book_categories) — but the user's personal tag survives independently.
--
-- This separation matters for admin un-verification: if a category is
-- un-verified, the global book_categories row goes away, but every user who
-- had that category as a private tag keeps it.

CREATE TABLE IF NOT EXISTS user_book_categories (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id       uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  added_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, book_id, category_id)
);

CREATE INDEX IF NOT EXISTS user_book_categories_book_idx
  ON user_book_categories(book_id);
CREATE INDEX IF NOT EXISTS user_book_categories_user_idx
  ON user_book_categories(user_id);
CREATE INDEX IF NOT EXISTS user_book_categories_category_idx
  ON user_book_categories(category_id);


-- ----------------------------------------------------------------------------
-- RLS policies
-- ----------------------------------------------------------------------------
-- Categories: globally readable, no direct INSERT/UPDATE — everything goes
-- through the SECURITY DEFINER RPCs below. This prevents users from
-- bypassing the soft-cap or setting verified=true directly.

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_book_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_read ON categories;
CREATE POLICY categories_read ON categories
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS book_categories_read ON book_categories;
CREATE POLICY book_categories_read ON book_categories
  FOR SELECT
  USING (true);

-- Users see only their own rows in user_book_categories.
DROP POLICY IF EXISTS user_book_categories_own ON user_book_categories;
CREATE POLICY user_book_categories_own ON user_book_categories
  FOR SELECT
  USING (auth.uid() = user_id);

-- No direct INSERT/UPDATE/DELETE policies — clients call the RPCs.


-- ----------------------------------------------------------------------------
-- Triggers: maintain usage_count on categories
-- ----------------------------------------------------------------------------
-- usage_count = number of user_book_categories rows referencing this category.
-- Maintained automatically on INSERT/DELETE.

CREATE OR REPLACE FUNCTION bump_category_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE categories SET usage_count = usage_count + 1 WHERE id = NEW.category_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE categories SET usage_count = greatest(usage_count - 1, 0) WHERE id = OLD.category_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS user_book_categories_usage_count ON user_book_categories;
CREATE TRIGGER user_book_categories_usage_count
  AFTER INSERT OR DELETE ON user_book_categories
  FOR EACH ROW EXECUTE FUNCTION bump_category_usage();


-- ----------------------------------------------------------------------------
-- RPC: upsert_category
-- ----------------------------------------------------------------------------
-- Given a raw display name, return the canonical category row, creating it
-- if necessary.
--
-- SECURITY DEFINER: bypasses RLS since users have no INSERT policy on
-- categories. The function only inserts unverified categories — verified=true
-- is never set by client-facing code paths.
--
-- Returns the full category row so the caller can immediately use both the
-- id (for linking) and the display name (for the pill).

CREATE OR REPLACE FUNCTION upsert_category(_raw_name text)
RETURNS TABLE (
  id              uuid,
  name            text,
  normalized_name text,
  verified        boolean,
  usage_count     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _normalized text;
  _trimmed    text;
  _existing   uuid;
  _new_id     uuid;
  _uid        uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'upsert_category requires authenticated user';
  END IF;

  _trimmed := btrim(coalesce(_raw_name, ''));
  IF char_length(_trimmed) = 0 OR char_length(_trimmed) > 80 THEN
    RAISE EXCEPTION 'category name must be 1-80 characters'
      USING ERRCODE = '22023';
  END IF;

  _normalized := normalize_category_name(_trimmed);
  IF char_length(_normalized) = 0 THEN
    RAISE EXCEPTION 'category name has no alphanumeric content'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO _existing
    FROM categories c
    WHERE c.normalized_name = _normalized
    LIMIT 1;

  IF _existing IS NOT NULL THEN
    -- Return the existing row.
    RETURN QUERY
      SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count
        FROM categories c
        WHERE c.id = _existing;
    RETURN;
  END IF;

  -- Create new (unverified)
  INSERT INTO categories (name, normalized_name, created_by)
    VALUES (_trimmed, _normalized, _uid)
    RETURNING categories.id INTO _new_id;

  RETURN QUERY
    SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count
      FROM categories c
      WHERE c.id = _new_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- RPC: link_user_category
-- ----------------------------------------------------------------------------
-- Add a category to a book for the current user. Handles the upsert of the
-- category itself, the soft-cap check, and the user_book_categories link.
--
-- Returns the category row on success. Raises on cap exceeded.

CREATE OR REPLACE FUNCTION link_user_category(
  _book_id  uuid,
  _raw_name text
)
RETURNS TABLE (
  id              uuid,
  name            text,
  normalized_name text,
  verified        boolean,
  usage_count     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid      uuid;
  _cat_id   uuid;
  _cat_row  RECORD;
  _count    integer;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'link_user_category requires authenticated user';
  END IF;

  IF _book_id IS NULL THEN
    RAISE EXCEPTION 'book_id is required' USING ERRCODE = '22023';
  END IF;

  -- Verify the book exists. Without this the FK violation message is opaque.
  PERFORM 1 FROM books WHERE id = _book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book not found' USING ERRCODE = '22023';
  END IF;

  -- Soft cap: 10 categories per (user, book). Hard cap left to the DB-level
  -- FK + primary key (duplicate links can't happen). 10 is enforced here so
  -- the cap can be relaxed for admin operations by calling the underlying
  -- INSERT directly.
  SELECT count(*) INTO _count
    FROM user_book_categories
    WHERE user_id = _uid AND book_id = _book_id;
  IF _count >= 10 THEN
    RAISE EXCEPTION 'category limit reached for this book (10 max)'
      USING ERRCODE = '23514';
  END IF;

  -- Resolve or create the category
  SELECT * INTO _cat_row FROM upsert_category(_raw_name) LIMIT 1;
  _cat_id := _cat_row.id;

  -- Link (idempotent)
  INSERT INTO user_book_categories (user_id, book_id, category_id)
    VALUES (_uid, _book_id, _cat_id)
    ON CONFLICT DO NOTHING;

  -- If the category is already verified globally, also ensure the
  -- book_categories link exists. This makes verified categories that a user
  -- adds show up as global pills for everyone else too.
  IF _cat_row.verified THEN
    INSERT INTO book_categories (book_id, category_id, added_by)
      VALUES (_book_id, _cat_id, _uid)
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count
      FROM categories c
      WHERE c.id = _cat_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- RPC: unlink_user_category
-- ----------------------------------------------------------------------------
-- Remove a category from a book for the current user.
--
-- Note: removing the user's link does NOT remove the global book_categories
-- link, even if no users have it as a personal tag anymore. Verified global
-- links can only be removed by admins (no client RPC for that).

CREATE OR REPLACE FUNCTION unlink_user_category(
  _book_id     uuid,
  _category_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unlink_user_category requires authenticated user';
  END IF;

  DELETE FROM user_book_categories
    WHERE user_id = _uid
      AND book_id = _book_id
      AND category_id = _category_id;

  RETURN FOUND;
END;
$$;


-- ----------------------------------------------------------------------------
-- RPC: search_categories
-- ----------------------------------------------------------------------------
-- Autocomplete query. Given a partial input string, return ranked categories:
--   1. Verified first (verified=true sorts above false)
--   2. Then by usage_count descending
--   3. Then alphabetical (lower(name))
--
-- We match against normalized_name with a normalized version of the input —
-- so a user typing "Cyber-Punk" finds the existing "Cyberpunk" entry.
--
-- Limit defaults to 8. Component handles the "Create new" affordance itself
-- when no exact match is found.

CREATE OR REPLACE FUNCTION search_categories(
  _query text,
  _limit integer DEFAULT 8
)
RETURNS TABLE (
  id              uuid,
  name            text,
  normalized_name text,
  verified        boolean,
  usage_count     integer,
  exact_match     boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _normalized text;
BEGIN
  _normalized := normalize_category_name(coalesce(_query, ''));

  -- Empty query → return most-used verified categories. Useful for the
  -- initial dropdown state (autocomplete open with no input typed).
  IF char_length(_normalized) = 0 THEN
    RETURN QUERY
      SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count,
             false AS exact_match
        FROM categories c
        ORDER BY c.verified DESC, c.usage_count DESC, lower(c.name) ASC
        LIMIT _limit;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count,
           (c.normalized_name = _normalized) AS exact_match
      FROM categories c
      WHERE c.normalized_name LIKE _normalized || '%'
         OR c.normalized_name LIKE '%' || _normalized || '%'
      ORDER BY
        (c.normalized_name = _normalized) DESC,         -- exact match wins
        (c.normalized_name LIKE _normalized || '%') DESC, -- prefix match next
        c.verified DESC,
        c.usage_count DESC,
        lower(c.name) ASC
      LIMIT _limit;
END;
$$;


-- ----------------------------------------------------------------------------
-- Helper view: book_categories_for_user
-- ----------------------------------------------------------------------------
-- Convenience view that unions the verified-global categories on a book with
-- the user's private categories, deduped. Used by the client load path so
-- it can fetch everything-this-user-sees-on-this-book in one query.
--
-- The `source` column tells the UI which pill style to render:
--   'verified'  → gilt ☩ pill (also appears in book_categories)
--   'user'      → dim pill (only in user_book_categories, not verified yet)
--
-- A category can appear with source='verified' even when the user hasn't
-- personally tagged it — those are the catalog-level pills everyone sees.

CREATE OR REPLACE VIEW book_categories_view AS
SELECT
  bc.book_id,
  NULL::uuid              AS user_id,         -- not user-specific
  c.id                    AS category_id,
  c.name                  AS category_name,
  c.normalized_name,
  c.verified,
  c.usage_count,
  'verified'::text        AS source
FROM book_categories bc
JOIN categories c ON c.id = bc.category_id

UNION ALL

SELECT
  ubc.book_id,
  ubc.user_id,
  c.id                    AS category_id,
  c.name                  AS category_name,
  c.normalized_name,
  c.verified,
  c.usage_count,
  CASE WHEN c.verified THEN 'verified' ELSE 'user' END AS source
FROM user_book_categories ubc
JOIN categories c ON c.id = ubc.category_id;

COMMENT ON VIEW book_categories_view IS
  'Union of verified global categories + user-private categories. '
  'Filter by book_id and (user_id IS NULL OR user_id = auth.uid()) when querying.';


-- ============================================================================
-- Permissions
-- ============================================================================
-- Make sure authenticated users can call the RPCs but not bypass them.

GRANT EXECUTE ON FUNCTION upsert_category(text) TO authenticated;
GRANT EXECUTE ON FUNCTION link_user_category(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION unlink_user_category(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION search_categories(text, integer) TO authenticated, anon;
GRANT SELECT ON book_categories_view TO authenticated, anon;

-- ============================================================================
-- Done. v0.12 schema is in place.
-- ============================================================================
