-- generic-subjects-analysis.sql
--
-- "Should we allow generic subjects like 'Fiction' as genres? A generic genre
--  might be better than no genre."
--
-- The triage put 352 books in buckets 2 and 3 -- fetched, and the providers
-- returned either nothing or something too vague to place. 289 of those are
-- otherwise fully eligible for The Stacks. That is the population this question
-- is about.
--
-- Before deciding, two things are worth measuring, because the answer changes
-- depending on what is actually down there.

-- == 1. What ARE the subjects we are throwing away? ===========================
--
-- The rules discard the whole row when nothing matches. But "too generic to
-- place" is a judgement about the WHOLE subject string, and some of these rows
-- carry a usable term next to the useless one. regenre-unmatched.csv shows
-- 'Family & Relationships', 'Religion', 'War' and 'English literature' sitting
-- in the residue -- every one of those is placeable, or nearly.
--
-- This unnests to individual subjects rather than matching whole strings, which
-- is the thing the rule pass does not do. If the long tail here is substantial,
-- the cheapest win is a rule pass over single subjects, not a new "Fiction"
-- genre.

SELECT
  LOWER(TRIM(subject))                            AS subject,
  COUNT(*)                                        AS books,
  COUNT(*) FILTER (
    WHERE b.cover_url IS NOT NULL AND b.description IS NOT NULL
  )                                               AS stack_eligible,
  -- Does the taxonomy already have a home for this, under this exact name?
  EXISTS (
    SELECT 1 FROM public.genres g
     WHERE LOWER(TRIM(g.name)) = LOWER(TRIM(subject))
  )                                               AS genre_exists
FROM public.books b
CROSS JOIN LATERAL UNNEST(COALESCE(b.source_subjects, ARRAY[]::text[])) AS subject
WHERE b.status <> 'flagged'
  AND (b.genre IS NULL OR TRIM(b.genre) = '')
  AND b.subjects_fetched_at IS NOT NULL
GROUP BY LOWER(TRIM(subject))
ORDER BY books DESC;


-- == 2. What would a "Fiction" chip actually be? =============================
--
-- The case AGAINST allowing generics is not that the label is ugly. It is that
-- a genre chip is a FILTER, and a filter that matches everything filters
-- nothing. This counts how many books would land under each proposed generic
-- label, next to the size of the browsable catalogue, so the comparison is
-- concrete rather than a matter of taste.
--
-- If 'Fiction' would be the second-largest shelf on the site -- larger than
-- Fantasy, larger than Graphic Novel -- then it is not a genre. It is the
-- absence of one, wearing a genre's clothes, and it will be the chip that gets
-- tapped once and never again.

WITH browsable AS (
  SELECT COUNT(*) AS n
    FROM public.books
   WHERE status <> 'flagged'
     AND cover_url IS NOT NULL
     AND description IS NOT NULL
)
SELECT
  'Fiction (proposed)'                            AS shelf,
  COUNT(*)                                        AS stack_eligible_books,
  ROUND(100.0 * COUNT(*) / (SELECT n FROM browsable), 1) AS pct_of_browsable_wall
FROM public.books b
WHERE b.status <> 'flagged'
  AND b.cover_url IS NOT NULL
  AND b.description IS NOT NULL
  AND (b.genre IS NULL OR TRIM(b.genre) = '')
  AND b.subjects_fetched_at IS NOT NULL

UNION ALL

SELECT
  b.genre,
  COUNT(*),
  ROUND(100.0 * COUNT(*) / (SELECT n FROM browsable), 1)
FROM public.books b
WHERE b.status <> 'flagged'
  AND b.cover_url IS NOT NULL
  AND b.description IS NOT NULL
  AND b.genre IS NOT NULL
  AND TRIM(b.genre) <> ''
GROUP BY b.genre
ORDER BY stack_eligible_books DESC
LIMIT 15;


-- == 3. The population an Oracle pass would target ===========================
--
-- Every book in buckets 2 and 3 has a description -- the Stacks eligibility
-- filter requires one, and metadataBackfill refuses to write stubs under 40
-- characters. So the signal the subject fields are missing is already sitting
-- on the row, unused.
--
-- This is the exact work list, sized, so the cost of a one-off categorisation
-- pass is a number rather than a guess. oracleCategorizationService and
-- batch-scripts/manual/oracleBatch.mjs already exist, and
-- profiles.oracle_calls_exempt_total already tracks curator categorisation
-- outside the metered quota.
--
-- SELECT COUNT(*)                                   AS books_to_categorize,
--        ROUND(AVG(LENGTH(description)))            AS avg_description_chars,
--        MIN(LENGTH(description))                   AS shortest
--   FROM public.books b
--  WHERE b.status <> 'flagged'
--    AND b.cover_url IS NOT NULL
--    AND LENGTH(TRIM(COALESCE(b.description, ''))) >= 40
--    AND (b.genre IS NULL OR TRIM(b.genre) = '')
--    AND b.subjects_fetched_at IS NOT NULL;
