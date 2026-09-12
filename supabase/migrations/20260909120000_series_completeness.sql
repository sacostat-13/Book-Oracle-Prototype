-- series_completeness: which series are short, and which need looking at again.
--
-- WHY
--
-- The 2026-09-08 diagnostic found 116 of the 175 series pages with Search
-- Console impressions holding exactly ONE book, and only 12 of the 105 claiming
-- a total_books holding them all. Filling those is expensive: it needs a
-- third-party API, it is rate limited, and the propose/review loop behind it has
-- been wrong four times in four different ways.
--
-- DETECTING them is none of those things. It is this view, and it costs nothing.
--
-- That separation is the whole point. Nearly all the pain of the 2026-09-08/09
-- work came from doing detection and filling as one 175-series batch. A view
-- that says "these four series are short today" turns a quarterly archaeology
-- dig into a habit, and it runs on a cron with no credentials, no spend and no
-- judgement.
--
-- IT STATES FACTS AND NOT POLICY
--
-- No index floor here, deliberately. SERIES_INDEX_FLOOR already lives in three
-- files -- src/lib/seriesService.js, netlify/edge-functions/og-prerender.js and
-- netlify/functions/sitemap.js -- and tests/contracts.test.js asserts the three
-- agree. Putting it in SQL too would make a fourth copy that the test cannot
-- see, which is exactly the drift this codebase keeps paying for. Callers have
-- `held` and can apply their own floor.
--
-- volumes_checked_at is added by this migration and is what makes a QUEUE
-- possible: a series is due for a look when it has never been checked, or when
-- it changed after its last check. A book arriving with a series_id is what
-- makes a series change, so the queue populates itself from ordinary catalog
-- activity rather than from a schedule that guesses.

alter table public.series
  add column if not exists volumes_checked_at timestamptz;

comment on column public.series.volumes_checked_at is
  'When a volume-completeness pass last examined this series. NULL means never. Stamped by batch-scripts/manual/seriesBackfill.mjs --propose; read by series_completeness.needs_check to decide what is due.';

create or replace view public.series_completeness as
select
  s.id                       as series_id,
  s.name,
  s.normalized_name,
  s.author,
  s.total_books,
  s.publication_status,
  s.volumes_checked_at,
  length(coalesce(s.description, '')) as description_len,

  -- What we hold, after series_volumes collapses duplicate editions. This is
  -- the number a page can actually list.
  coalesce(v.held, 0)        as held,
  -- Of those, how many pass the status bar the page and the sitemap filter on.
  -- On 2026-09-08 these were equal for all 175 ranked series; a divergence here
  -- means the status filter has started hiding volumes, which is worth knowing
  -- before it is diagnosed as a missing book.
  coalesce(v.held_live, 0)   as held_live,
  coalesce(v.unnumbered, 0)  as unnumbered,
  v.max_position,
  coalesce(v.total_pages, 0) as total_pages,

  -- Positions between 1 and the highest we hold that are absent. Red Rising
  -- rendering 1,2,3,5 shows up here as '4'. A gap is worse than a short list:
  -- a reader reads a skipped number as the page being broken.
  g.missing_positions,
  coalesce(g.gap_count, 0)   as gap_count,

  -- Short against its own claim. total_books is unreliable in both directions
  -- (Night Lords holds 4 against a claimed 3; JoJo Stone Ocean claims 17 and
  -- holds 1), so this is a prompt to look, not a count to publish.
  case when s.total_books is not null and coalesce(v.held, 0) < s.total_books
       then s.total_books - coalesce(v.held, 0) end as volumes_owed,

  -- Due for a pass: never checked, or changed since it was.
  (s.volumes_checked_at is null or s.volumes_checked_at < s.updated_at) as needs_check
from public.series s
left join (
  select
    series_id,
    count(*)                                                            as held,
    count(*) filter (where status in ('verified','oracle_categorized')) as held_live,
    count(*) filter (where position_in_series is null)                  as unnumbered,
    max(position_in_series)                                             as max_position,
    sum(coalesce(pages, 0))                                             as total_pages
  from public.series_volumes
  group by series_id
) v on v.series_id = s.id
left join lateral (
  select
    string_agg(n::text, ',' order by n) as missing_positions,
    count(*)                            as gap_count
  from generate_series(1, coalesce(v.max_position::int, 0)) n
  where not exists (
    select 1 from public.series_volumes x
     where x.series_id = s.id and x.position_in_series = n
  )
) g on true;

comment on view public.series_completeness is
  'One row per series: how many volumes it holds, what it claims, which positions are missing, and whether it is due another look. Facts only -- the index floor is policy and lives in the three application files tests/contracts.test.js checks. Built for a cron that costs nothing to run.';

grant select on public.series_completeness to anon, authenticated, service_role;

-- -- Verification ------------------------------------------------------------
-- Run after applying.
--
--   -- 1. The shape of the problem, worst first.
--   select name, held, total_books, volumes_owed, missing_positions
--     from public.series_completeness
--    where volumes_owed is not null or gap_count > 0
--    order by volumes_owed desc nulls last, gap_count desc
--    limit 40;
--
--   -- 2. Everything is due, because nothing has been checked yet.
--   select count(*) filter (where needs_check) as due, count(*) as total
--     from public.series_completeness;
--
--   -- 3. Agreement with the 2026-09-08 diagnostic: Crescent City should now
--   --    read 3 of 3 with no gaps, and Red Rising 5 of 6 missing nothing below
--   --    its maximum (Iron Gold at 4 was proposed but not applied).
--   select name, held, held_live, total_books, missing_positions
--     from public.series_completeness
--    where normalized_name in ('crescentcity','redrisingsaga','malazanbookofthefallen');
