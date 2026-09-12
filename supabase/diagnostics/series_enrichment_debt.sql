-- series_enrichment_debt.sql — which series are waiting on oracleBatch, not on
-- the backfill.
--
-- 2026-09-14. series_completeness has carried both numbers since 20260909120000,
-- and the view's own comment says what the gap means: "a divergence here means
-- the status filter has started hiding volumes, which is worth knowing before it
-- is diagnosed as a missing book."
--
--   held        every volume, after series_volumes collapses duplicate editions
--   held_live   only those with status in ('verified','oracle_categorized') —
--               what the page and the sitemap actually list
--
-- Every volume the backfill applies lands as 'unreviewed'. So it counts in
-- `held` and not in `held_live`, and the difference is the enrichment backlog
-- seen from the series side. This matters for two decisions at once:
--
--   1. A series floor built on held_live would noindex series that are complete
--      in `held` terms and merely waiting on a billable call.
--   2. oracleBatch drains created_at ascending — oldest first — so these
--      volumes, being the newest rows in the table, are last in line.


-- 1. THE HEADLINE. One row: how much of the catalog is waiting.
select
  count(*)                                          as series_total,
  count(*) filter (where held > held_live)          as series_waiting,
  sum(held - held_live)                             as volumes_waiting,
  count(*) filter (where held >= 3 and held_live < 3) as would_fail_a_three_volume_floor
from public.series_completeness;

-- `would_fail_a_three_volume_floor` is the number that decides the sequencing.
-- These series HAVE three or more volumes and would still be noindexed by a
-- floor that counts held_live, purely because the enrichment has not run.


-- 2. THE SERIES, WORST FIRST. What to enrich, and in what order.
select
  name,
  held,
  held_live,
  held - held_live          as waiting,
  total_books,
  gap_count,
  description_len,
  case when held >= 3 and held_live < 3 then 'yes' end as floor_would_hide_it
from public.series_completeness
where held > held_live
order by (held >= 3 and held_live < 3) desc,   -- the ones a floor would hide
         (held - held_live) desc,               -- then by how much is waiting
         held desc
limit 100;


-- 3. THE BOOKS BEHIND IT — feed this to the enrichment picker.
--
-- Only rows that a billable call would actually change: books_needing_curation
-- is the same view oracleBatch selects from, so a book listed here is one it
-- would enrich, and nothing here is a description-only case (that is
-- metadataBackfill's job and must never reach a billable call).
select
  b.id,
  s.name as series_name,
  b.position_in_series,
  b.title,
  b.status
from public.books b
join public.series s on s.id = b.series_id
join public.books_needing_curation c on c.id = b.id
where b.series_id is not null
  and b.status not in ('verified', 'oracle_categorized')
order by s.name, b.position_in_series nulls last;


-- 4. SANITY — is the gap really the new volumes, or something older?
-- If most of the waiting rows were created before the series work started, the
-- backlog is not what this query assumes and the ordering advice changes.
select
  date_trunc('day', b.created_at)::date as created_on,
  count(*)                              as books_waiting
from public.books b
join public.books_needing_curation c on c.id = b.id
where b.series_id is not null
  and b.status not in ('verified', 'oracle_categorized')
group by 1
order by 1 desc
limit 30;
