-- series.description_source: who wrote the description sitting in this row.
--
-- WHY
--
-- On 2026-09-09, all 175 series pages that earned Search Console impressions
-- had description_len = 0. That is not merely a blank space on the page.
-- netlify/edge-functions/og-prerender.js falls back like this:
--
--   const seriesDesc = match.description
--     || (first?.description ? first.description.slice(0, 300) : null)
--     || `Every book in the ${match.name} series, in reading order.`;
--
-- With series.description empty, EVERY series page has been describing itself
-- to Google with volume one's jacket copy. The Malazan page's meta description
-- is the blurb for Gardens of the Moon. That is not a gap, it is a wrong
-- answer: a page whose entire purpose is the set, described as one book.
--
-- Filling the field fixes that everywhere at once, with no change to the edge
-- function, the SPA, the sitemap or the JSON-LD -- all of them already read
-- `description` and already prefer it. The reason this column exists is what
-- comes NEXT.
--
-- THE POINT OF THE COLUMN
--
-- Two different things will write to `description`, and they are not
-- interchangeable:
--
--   composed   batch-scripts/manual/seriesDescriptions.mjs. Assembled from
--              facts already in the catalog -- author, count, first and last
--              volume, publication status. Free, original, correct, and thin.
--   oracle     written by the Oracle from the volume list. Costs money, so it
--              goes where the impressions are and nowhere else.
--
-- Without this column, Thursday's Oracle pass cannot tell which rows are
-- placeholders it should improve and which are already good, so it would
-- either overwrite real writing or skip everything. `where description_source
-- = 'composed'` is the whole answer, and it is also how a human reading the
-- table can tell what a machine wrote.
--
-- NULL means the description predates this column or was written by hand.
-- Nothing overwrites a NULL source without --force, because an unlabelled
-- description is more likely to be somebody's work than a leftover.

alter table public.series
  add column if not exists description_source text;

alter table public.series
  drop constraint if exists series_description_source_check;

alter table public.series
  add constraint series_description_source_check
  check (description_source is null
         or description_source in ('composed', 'oracle', 'wikipedia', 'manual'));

comment on column public.series.description_source is
  'Who wrote series.description: composed (batch-scripts/manual/seriesDescriptions.mjs, assembled from catalog facts), oracle (LLM-written), wikipedia, manual. NULL means unknown or hand-written -- treat as precious. Read by the Oracle pass to decide what is a placeholder worth replacing.';

-- Finding the work. A description pass is cheap to target and expensive to run
-- wide, so both queries it needs are indexed rather than sequential scans over
-- a growing table.
create index if not exists series_description_source_idx
  on public.series (description_source)
  where description_source is not null;

-- -- Verification ------------------------------------------------------------
--
--   -- 1. Before the first composed run: everything is empty and unlabelled.
--   select count(*) filter (where coalesce(description,'') = '') as blank,
--          count(*) filter (where description_source is null)    as unlabelled,
--          count(*)                                              as total
--     from public.series;
--
--   -- 2. After it: what wrote what.
--   select coalesce(description_source, '(none)') as source,
--          count(*), round(avg(length(description))) as avg_len
--     from public.series
--    where coalesce(description,'') <> ''
--    group by 1 order by 2 desc;
--
--   -- 3. What Thursday's Oracle pass should target, highest demand first.
--   --    (Ordering by impressions needs the GSC export; until that table
--   --    exists, held desc is the available proxy.)
--   select s.name, s.description_source, c.held
--     from public.series s
--     join public.series_completeness c on c.series_id = s.id
--    where s.description_source = 'composed' and c.held >= 2
--    order by c.held desc
--    limit 25;
