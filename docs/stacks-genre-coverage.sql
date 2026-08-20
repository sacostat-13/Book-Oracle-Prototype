-- stacks-genre-coverage.sql
--
-- "How many books would actually show up in The Stacks, per genre?"
--
-- Groundwork for a genre filter on the wall. A filter is only worth building
-- for genres that have enough behind them to fill a screen -- a chip that opens
-- onto four books is worse than no chip -- so this counts the pool as the wall
-- actually sees it, not as the catalogue reports it.
--
-- == Eligibility =============================================================
-- Mirrors baseQuery() in src/lib/useStacks.js exactly:
--
--     .neq('status', 'flagged')
--     .not('cover_url', 'is', null)
--     .not('description', 'is', null)
--
-- Two details that matter if you edit either side later:
--
--   * books.status is NOT NULL with a default, so a plain `<> 'flagged'`
--     matches PostgREST's `neq` here. If status ever becomes nullable the two
--     would silently disagree -- PostgREST's neq drops NULL rows, plain SQL
--     `<>` drops them too, but only one of the two is obvious from reading it.
--
--   * `IS NOT NULL` is not the same as "has a description". An empty string
--     passes it, on both sides. That is why this reports two numbers:
--     `stack_eligible` is what the wall shows TODAY, and `stack_eligible_real`
--     applies the 40-character floor metadataBackfill already uses when it
--     decides whether a description is worth writing. Where those two diverge,
--     the genre has cards that flip over to a blank.
--
-- Genre is read off books.genre -- the column upsert_book writes -- and NOT
-- through the book_genres join, for the same reason useStacks doesn't: that
-- table is only populated after Oracle categorisation, so joining it would
-- report zero for every crawled or freshly imported title.
--
-- Run in the Supabase SQL editor.

WITH scoped AS (
  SELECT
    COALESCE(NULLIF(TRIM(b.genre), ''), '(no genre)') AS genre,
    b.cover_url,
    b.description
  FROM public.books b
  WHERE b.status <> 'flagged'
)
SELECT
  s.genre,

  -- Canonical taxonomy, or a stray string? Only canonical genres should get a
  -- filter chip; a long tail of one-off spellings here is its own finding.
  (g.id IS NOT NULL) AS is_canonical,

  COUNT(*) AS in_catalogue,

  -- What The Stacks shows today.
  COUNT(*) FILTER (
    WHERE s.cover_url IS NOT NULL
      AND s.description IS NOT NULL
  ) AS stack_eligible,

  -- The same, minus the cards that would flip over to a blank or a stub.
  COUNT(*) FILTER (
    WHERE s.cover_url IS NOT NULL
      AND LENGTH(TRIM(COALESCE(s.description, ''))) >= 40
  ) AS stack_eligible_real,

  -- Where the losses are, so a thin genre points at what to backfill.
  COUNT(*) FILTER (WHERE s.cover_url IS NULL) AS missing_cover,
  COUNT(*) FILTER (
    WHERE LENGTH(TRIM(COALESCE(s.description, ''))) < 40
  ) AS missing_or_stub_description,

  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE s.cover_url IS NOT NULL
        AND s.description IS NOT NULL
    ) / NULLIF(COUNT(*), 0)
  ) AS pct_eligible

FROM scoped s
LEFT JOIN public.genres g
  ON LOWER(TRIM(g.name)) = LOWER(TRIM(s.genre))
GROUP BY s.genre, g.id
ORDER BY stack_eligible DESC, in_catalogue DESC;


-- == Companion: one row, for the headline number =============================
-- The denominator the per-genre counts sit inside. ensureTotal() in useStacks
-- runs the same filters as a HEAD count, so `stack_eligible` here should match
-- what the wall believes the browsable catalogue size to be.
--
-- The third column is the one that decides whether a genre filter is viable at
-- all: it is the share of the browsable wall that a genre chip could ever
-- reach. Everything outside it carries a null or non-canonical genre and would
-- be unreachable from any chip.
--
-- SELECT
--   COUNT(*) AS in_catalogue,
--   COUNT(*) FILTER (
--     WHERE status <> 'flagged'
--       AND cover_url IS NOT NULL
--       AND description IS NOT NULL
--   ) AS stack_eligible,
--   COUNT(*) FILTER (
--     WHERE status <> 'flagged'
--       AND cover_url IS NOT NULL
--       AND description IS NOT NULL
--       AND genre IS NOT NULL
--       AND TRIM(genre) <> ''
--   ) AS stack_eligible_with_genre
-- FROM public.books;
