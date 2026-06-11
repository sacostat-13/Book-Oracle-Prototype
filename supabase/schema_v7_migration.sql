-- ============================================================================
-- Schema v7 migration: genres (canonical, Oracle-curated taxonomy)
-- ============================================================================
-- Ships as: v0.15 phase 2.2 (additive — no destructive changes)
--
-- WHAT THIS DOES
-- --------------
-- Adds the canonical genre taxonomy that the Oracle categorization button
-- (phase 2.4) writes into. Distinct from `categories` (v0.12 / schema_v5):
--
--   genres      → canonical, Oracle-curated, FIXED vocabulary.
--                 New genres are only added by the Oracle when nothing in
--                 the catalog fits. Strong preference for reuse.
--
--   categories  → user-driven folksonomy. Anyone can create one. Messy,
--                 personal, intentional.
--
-- Three tables in this migration:
--
--   genres            global canonical list. seeded from booksData.js with
--                     the 15 existing genres ("Classic & Older Gothic" etc.)
--   book_genres       many-to-many: book ↔ genre. global (same for all users)
--   (no per-user table — genres are not user-scoped, unlike categories)
--
-- Backfill: every book with a non-null `books.genre` gets a book_genres row
-- linking it to the matching seeded genre. Books whose `genre` doesn't match
-- any seeded value stay unlinked (will be picked up by the Oracle button on
-- first run).
--
-- The existing `books.genre` text column is KEPT for now. It still drives the
-- "eyebrow" display on cards and the existing recommendation drawer's
-- temperament dropdown. Phase 2.6 will switch the drawer to use book_genres
-- directly; we'll decide whether to drop `books.genre` after.
--
-- Safe to run multiple times; uses IF NOT EXISTS where possible.
-- ============================================================================


-- ============================================================================
-- STEP 1: normalize_genre_name helper
-- ============================================================================
-- Mirrors the category normalizer from v5: lowercase, strip leading "the ",
-- strip everything non-alphanumeric. IMMUTABLE so we can use it in a unique
-- index.
--
-- Note: this is a separate function from normalize_category_name even though
-- the logic is identical. Keeping them separate means future divergence
-- (e.g., genres allowing different chars than categories) doesn't require a
-- rename or shared dependency.

CREATE OR REPLACE FUNCTION normalize_genre_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(name, '')), '^the\s+', ''),
    '[^a-z0-9]', '', 'g'
  )
$$;


-- ============================================================================
-- STEP 2: genres table
-- ============================================================================
-- The global canonical taxonomy. Pre-seeded with the 15 existing genres
-- (see STEP 5). New genres are only added by the Oracle categorization
-- button, never by direct user input.
--
-- `source` tracks provenance: 'seed' for the initial 15, 'oracle' for any
-- the Oracle later invents. Useful for admin curation later (an admin app
-- could surface oracle-invented genres for review/merging).

CREATE TABLE IF NOT EXISTS genres (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  normalized_name text NOT NULL,
  description     text,                         -- optional flavor text, admin-curated later
  source          text NOT NULL DEFAULT 'oracle',
  created_at      timestamptz NOT NULL DEFAULT now(),
  usage_count     integer NOT NULL DEFAULT 0,   -- maintained by trigger below

  CONSTRAINT genres_name_length_check CHECK (
    char_length(name) > 0 AND char_length(name) <= 80
  ),
  CONSTRAINT genres_normalized_name_nonempty CHECK (
    char_length(normalized_name) > 0
  ),
  CONSTRAINT genres_source_check CHECK (
    source IN ('seed', 'oracle', 'admin')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS genres_normalized_name_unique
  ON genres(normalized_name);

CREATE INDEX IF NOT EXISTS genres_usage_idx
  ON genres(usage_count DESC);

-- pg_trgm was enabled in v5; this is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS genres_name_trgm_idx
  ON genres USING gin (normalized_name gin_trgm_ops);

COMMENT ON TABLE genres IS
  'Canonical genre taxonomy. Oracle-curated, fixed vocabulary. '
  'Distinct from `categories` which is user-driven folksonomy.';


-- ============================================================================
-- STEP 3: book_genres table
-- ============================================================================
-- Links a book to one or more genres at the global level. Visible to all
-- users (no user_id column — genres are not user-scoped).
--
-- `assigned_by_source` tracks how the link was created:
--   'seed'     → backfilled from books.genre during this migration
--   'oracle'   → assigned by the Oracle categorization button
--   'admin'    → set by an admin via the future admin app
--
-- This is parallel to but separate from book_categories (which is for
-- verified user categories).

CREATE TABLE IF NOT EXISTS book_genres (
  book_id            uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  genre_id           uuid NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  assigned_by_source text NOT NULL DEFAULT 'oracle',

  PRIMARY KEY (book_id, genre_id),
  CONSTRAINT book_genres_assigned_by_source_check CHECK (
    assigned_by_source IN ('seed', 'oracle', 'admin')
  )
);

CREATE INDEX IF NOT EXISTS book_genres_genre_idx
  ON book_genres(genre_id);
CREATE INDEX IF NOT EXISTS book_genres_book_idx
  ON book_genres(book_id);

COMMENT ON TABLE book_genres IS
  'Global book ↔ genre links. Populated by Oracle categorization or admin. '
  'Parallel to book_categories but for the canonical genre taxonomy.';


-- ============================================================================
-- STEP 4: RLS policies
-- ============================================================================
-- Genres and book_genres are globally readable, no direct write policies —
-- everything goes through SECURITY DEFINER RPCs. This prevents users from
-- inventing arbitrary genres outside the Oracle pipeline.

ALTER TABLE genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_genres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS genres_read ON genres;
CREATE POLICY genres_read ON genres
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS book_genres_read ON book_genres;
CREATE POLICY book_genres_read ON book_genres
  FOR SELECT
  USING (true);


-- ============================================================================
-- STEP 5: Pre-seed the 15 canonical genres
-- ============================================================================
-- Exact strings from booksData.js, with the `&` style preserved. These are
-- what users have been seeing as `book.g` since v0.1, so consistency matters.
--
-- ON CONFLICT DO NOTHING makes this idempotent — re-running the migration
-- won't duplicate or overwrite existing rows.

INSERT INTO genres (name, normalized_name, source) VALUES
  ('Body Horror & Transgressive',         normalize_genre_name('Body Horror & Transgressive'),         'seed'),
  ('Classic & Older Gothic',              normalize_genre_name('Classic & Older Gothic'),              'seed'),
  ('Cozy Fantasy',                        normalize_genre_name('Cozy Fantasy'),                        'seed'),
  ('Epic & Dark Fantasy',                 normalize_genre_name('Epic & Dark Fantasy'),                 'seed'),
  ('Folk Horror',                         normalize_genre_name('Folk Horror'),                         'seed'),
  ('Gothic & Haunted Houses',             normalize_genre_name('Gothic & Haunted Houses'),             'seed'),
  ('Korean, Japanese & East Asian Lit',   normalize_genre_name('Korean, Japanese & East Asian Lit'),   'seed'),
  ('Latin American Horror & Literary',    normalize_genre_name('Latin American Horror & Literary'),    'seed'),
  ('Literary Fiction',                    normalize_genre_name('Literary Fiction'),                    'seed'),
  ('Parenting & Motherhood',              normalize_genre_name('Parenting & Motherhood'),              'seed'),
  ('Sapphic & Feminist Gothic',           normalize_genre_name('Sapphic & Feminist Gothic'),           'seed'),
  ('Sci-Fi & Speculative',                normalize_genre_name('Sci-Fi & Speculative'),                'seed'),
  ('Southern & American Gothic',          normalize_genre_name('Southern & American Gothic'),          'seed'),
  ('Vampires',                            normalize_genre_name('Vampires'),                            'seed'),
  ('Witches',                             normalize_genre_name('Witches'),                             'seed')
ON CONFLICT (normalized_name) DO NOTHING;


-- ============================================================================
-- STEP 6: Backfill book_genres from existing books.genre
-- ============================================================================
-- For every book with a non-null `genre` text value that matches a seeded
-- genre (by normalized name), insert a book_genres row with source='seed'.
--
-- Books whose `genre` text doesn't match any seeded genre stay unlinked.
-- The Oracle button will pick them up on first run. (In practice this should
-- be ~zero books since `books.genre` was populated from the same booksData.js
-- vocabulary, but be defensive — Hardcover/OL/PRH paths might have written
-- arbitrary genre strings.)

INSERT INTO book_genres (book_id, genre_id, assigned_by_source)
SELECT b.id, g.id, 'seed'
  FROM books b
  JOIN genres g ON g.normalized_name = normalize_genre_name(b.genre)
 WHERE b.genre IS NOT NULL
   AND length(trim(b.genre)) > 0
ON CONFLICT (book_id, genre_id) DO NOTHING;


-- ============================================================================
-- STEP 7: Maintain usage_count on genres
-- ============================================================================
-- usage_count = number of book_genres rows referencing this genre. Maintained
-- automatically. Useful for admin curation (least-used Oracle-invented genres
-- are candidates for merging into more popular ones).

CREATE OR REPLACE FUNCTION bump_genre_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE genres SET usage_count = usage_count + 1 WHERE id = NEW.genre_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE genres SET usage_count = greatest(usage_count - 1, 0) WHERE id = OLD.genre_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS book_genres_usage_count ON book_genres;
CREATE TRIGGER book_genres_usage_count
  AFTER INSERT OR DELETE ON book_genres
  FOR EACH ROW EXECUTE FUNCTION bump_genre_usage();

-- Initial usage_count after backfill. The trigger only fires on rows inserted
-- AFTER it's defined, so seed-time inserts above didn't bump counts. Fix
-- once, here.
UPDATE genres g
   SET usage_count = sub.cnt
  FROM (
    SELECT genre_id, count(*)::int AS cnt
      FROM book_genres
     GROUP BY genre_id
  ) sub
 WHERE sub.genre_id = g.id;


-- ============================================================================
-- STEP 8: RPC — upsert_genre
-- ============================================================================
-- Given a raw genre name, return the canonical genre row, creating it if
-- necessary. New rows default to source='oracle' since the only caller that
-- should create new genres is the Oracle categorization button. (Admin
-- promotions happen via direct UPDATE in the future admin app.)
--
-- SECURITY DEFINER because no INSERT policy exists on genres. The function
-- is the only write path available to authenticated users.

CREATE OR REPLACE FUNCTION upsert_genre(_raw_name text)
RETURNS TABLE (
  id              uuid,
  name            text,
  normalized_name text,
  source          text,
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
    RAISE EXCEPTION 'upsert_genre requires authenticated user';
  END IF;

  _trimmed := btrim(coalesce(_raw_name, ''));
  IF char_length(_trimmed) = 0 OR char_length(_trimmed) > 80 THEN
    RAISE EXCEPTION 'genre name must be 1-80 characters'
      USING ERRCODE = '22023';
  END IF;

  _normalized := normalize_genre_name(_trimmed);
  IF char_length(_normalized) = 0 THEN
    RAISE EXCEPTION 'genre name has no alphanumeric content'
      USING ERRCODE = '22023';
  END IF;

  SELECT gn.id INTO _existing
    FROM genres gn
    WHERE gn.normalized_name = _normalized
    LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN QUERY
      SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count
        FROM genres gn
        WHERE gn.id = _existing;
    RETURN;
  END IF;

  -- New genre. Default source = 'oracle' — the categorization button is the
  -- only legitimate creator. If we ever need an admin-direct-add path, it
  -- can write 'admin' via direct INSERT (which only admins can do via
  -- service role anyway).
  INSERT INTO genres (name, normalized_name, source)
    VALUES (_trimmed, _normalized, 'oracle')
    RETURNING genres.id INTO _new_id;

  RETURN QUERY
    SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count
      FROM genres gn
      WHERE gn.id = _new_id;
END;
$$;


-- ============================================================================
-- STEP 9: RPC — link_book_genre
-- ============================================================================
-- Attach a genre to a book at the global level. Used by the Oracle
-- categorization button (phase 2.4) when assigning genres to unverified
-- books. Idempotent — re-linking the same pair is a no-op.
--
-- Also: when the Oracle assigns at least one genre to a book, the calling
-- code (in oracleCategorizationService.js) will follow up with a separate
-- update_book_status RPC to flip the book to 'oracle_categorized'. That's
-- a phase 2.4 deliverable, not this migration.

CREATE OR REPLACE FUNCTION link_book_genre(
  _book_id      uuid,
  _genre_id     uuid,
  _source       text DEFAULT 'oracle'
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
    RAISE EXCEPTION 'link_book_genre requires authenticated user';
  END IF;

  IF _book_id IS NULL OR _genre_id IS NULL THEN
    RAISE EXCEPTION 'book_id and genre_id are required' USING ERRCODE = '22023';
  END IF;

  IF _source NOT IN ('seed', 'oracle', 'admin') THEN
    RAISE EXCEPTION 'invalid source value' USING ERRCODE = '22023';
  END IF;

  -- Verify the book and genre exist (clearer error than FK violation).
  PERFORM 1 FROM books WHERE id = _book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book not found' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM genres WHERE id = _genre_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'genre not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO book_genres (book_id, genre_id, assigned_by_source)
    VALUES (_book_id, _genre_id, _source)
    ON CONFLICT (book_id, genre_id) DO NOTHING;

  RETURN FOUND;
END;
$$;


-- ============================================================================
-- STEP 10: RPC — search_genres
-- ============================================================================
-- Read-only autocomplete-style query. Returns ranked genres. Used by:
--   - the Library/Wishlist genre filter dropdown (phase 2.5)
--   - the Oracle categorization service when building the prompt (phase 2.4),
--     which needs the full catalog
--
-- Empty query → return all genres ordered by usage_count desc, then alpha.
-- Non-empty query → substring match on normalized_name.

CREATE OR REPLACE FUNCTION search_genres(
  _query text DEFAULT '',
  _limit integer DEFAULT 100
)
RETURNS TABLE (
  id              uuid,
  name            text,
  normalized_name text,
  source          text,
  usage_count     integer,
  exact_match     boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _normalized text;
BEGIN
  _normalized := normalize_genre_name(coalesce(_query, ''));

  IF char_length(_normalized) = 0 THEN
    RETURN QUERY
      SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count,
             false AS exact_match
        FROM genres gn
        ORDER BY gn.usage_count DESC, lower(gn.name) ASC
        LIMIT _limit;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count,
           (gn.normalized_name = _normalized) AS exact_match
      FROM genres gn
      WHERE gn.normalized_name LIKE _normalized || '%'
         OR gn.normalized_name LIKE '%' || _normalized || '%'
      ORDER BY
        (gn.normalized_name = _normalized) DESC,
        (gn.normalized_name LIKE _normalized || '%') DESC,
        gn.usage_count DESC,
        lower(gn.name) ASC
      LIMIT _limit;
END;
$$;


-- ============================================================================
-- STEP 11: Helper view — book_genres_view
-- ============================================================================
-- Convenience view for the client load path: book_id + genre fields in one
-- shape, matching the style of book_categories_view from v5. Used by
-- DataContext.jsx to populate the per-book genres map in one query.

CREATE OR REPLACE VIEW book_genres_view AS
SELECT
  bg.book_id,
  g.id            AS genre_id,
  g.name          AS genre_name,
  g.normalized_name,
  g.source        AS genre_source,
  g.usage_count,
  bg.assigned_by_source,
  bg.assigned_at
FROM book_genres bg
JOIN genres g ON g.id = bg.genre_id;

COMMENT ON VIEW book_genres_view IS
  'Joined book ↔ genre rows for client load. Filter by book_id when querying.';


-- ============================================================================
-- STEP 12: Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION upsert_genre(text) TO authenticated;
GRANT EXECUTE ON FUNCTION link_book_genre(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION search_genres(text, integer) TO authenticated, anon;
GRANT SELECT ON book_genres_view TO authenticated, anon;


-- ============================================================================
-- Done. v0.15 phase 2.2 schema is in place.
-- ============================================================================
-- Next phases:
--   2.3 — load book_genres into client state (DataContext patch)
--   2.4 — Oracle categorization button (service + UI)
--   2.5 — two-dropdown filter on Library/Wishlist
--   2.6 — Oracle drawer copy pass
--   2.7 — drop `verified` column (final cleanup)
-- ============================================================================
