-- subject-coverage.sql — how much evidence does the rule table actually have?
-- Read-only.
--
-- `source_subjects` is the ONLY input regenreCatalog --apply reads. A book with
-- none cannot be placed by any rule, no matter how good the rules get, so this
-- is the ceiling on what re-genreing can ever achieve.
--
-- Three states, and they are not the same thing:
--
--   never asked      subjects_fetched_at IS NULL
--                    --fetch will pick these up.
--   asked, nothing   subjects_fetched_at set, source_subjects empty or null
--                    --fetch SKIPS these forever. Only --retry-empty re-asks.
--   has subjects     something to work with.

-- ── 1. The headline ─────────────────────────────────────────────────────────
select
  count(*)                                                          as books_total,
  count(*) filter (where subjects_fetched_at is null)               as never_asked,
  count(*) filter (where subjects_fetched_at is not null
                     and coalesce(array_length(source_subjects, 1), 0) = 0)
                                                                    as asked_got_nothing,
  count(*) filter (where coalesce(array_length(source_subjects, 1), 0) > 0)
                                                                    as has_subjects,
  count(*) filter (where coalesce(array_length(source_subjects, 1), 0) = 1)
                                                                    as has_exactly_one,
  round(avg(coalesce(array_length(source_subjects, 1), 0))::numeric, 2)
                                                                    as avg_subjects
from public.books
where status <> 'flagged';

-- ── 2. "Has subjects" overstates it ─────────────────────────────────────────
-- A lone subject of "Fiction" is not evidence. It clears the has_subjects test
-- above and places nothing, which is why 173 books turned up in
-- regenre-unmatched.csv while 742 were unplaced.
select
  count(*) filter (where coalesce(array_length(source_subjects, 1), 0) > 0)
                                                                    as has_any,
  count(*) filter (where array_to_string(source_subjects, '; ') ~* '^(fiction|general|fiction, general)$')
                                                                    as only_generic,
  count(*) filter (where coalesce(array_length(source_subjects, 1), 0) > 1)
                                                                    as has_two_or_more
from public.books
where status <> 'flagged';

-- ── 3. Is it worth retrying the rest? ───────────────────────────────────────
-- metadata_attempts counts how often the free sources have been asked and come
-- back empty. A book at the MAX_ATTEMPTS ceiling (6) has been asked six times;
-- a seventh is unlikely to be different. Books low on this scale are the ones
-- --retry-empty should reach first.
select
  coalesce(metadata_attempts, 0)                                    as attempts,
  count(*)                                                          as books,
  count(*) filter (where coalesce(array_length(source_subjects, 1), 0) = 0)
                                                                    as still_empty
from public.books
where status <> 'flagged'
group by 1
order by 1;

-- ── 4. Sanity check on the run just completed ───────────────────────────────
-- Subjects written in the last hour. Should be about the 24 the log reported.
select count(*) as fetched_in_last_hour
from public.books
where subjects_fetched_at > now() - interval '1 hour'
  and coalesce(array_length(source_subjects, 1), 0) > 0;
