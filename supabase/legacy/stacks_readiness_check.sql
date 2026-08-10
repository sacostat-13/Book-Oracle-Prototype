-- stacks_readiness_check.sql — can a reader browse without hitting the end?
--
-- READ-ONLY. Run before and after the backfills to see whether the goal is met:
-- a long browse where every card has a cover on the front and a description on
-- the back.
--
-- Since v0.60.2 The Stacks requires BOTH:
--     status <> 'flagged'  AND  cover_url IS NOT NULL  AND  description IS NOT NULL
-- Block 1 is the number that matters. Everything else explains it.


-- ── 1. The pool, and how far it goes ────────────────────────────────────────
-- BATCH_TARGET in useStacks is 20, so `show_more_clicks` is roughly how many
-- times a brand-new reader can press "Show more" before the wall is genuinely
-- exhausted. A returning reader sees fewer, since owned books are filtered out.

select
  count(*)                                                      as total_books,
  count(*) filter (where cover_url is not null)                 as have_cover,
  count(*) filter (where description is not null)               as have_description,
  count(*) filter (where status <> 'flagged'
                     and cover_url is not null
                     and description is not null)               as stacks_pool,
  (count(*) filter (where status <> 'flagged'
                      and cover_url is not null
                      and description is not null)) / 20        as show_more_clicks
from public.books;


-- ── 2. What each backfill still has to gain ─────────────────────────────────
-- `needs_cover` is coverBackfill's queue. `needs_desc_has_cover` is
-- metadataBackfill's — it only considers books that already have a cover, which
-- is why covers run first in the weekly workflow.

select
  coalesce(source, '(null)')                                        as source,
  count(*)                                                          as rows,
  count(*) filter (where cover_url is null)                         as needs_cover,
  count(*) filter (where cover_url is not null
                     and description is null)                       as needs_desc_has_cover,
  count(*) filter (where cover_url is not null
                     and description is not null)                   as complete
from public.books
group by 1
order by rows desc;


-- ── 3. Stub descriptions ────────────────────────────────────────────────────
-- metadataBackfill refuses to write anything under 40 characters, but older
-- rows predate that rule. These pass the NOT NULL filter and still give the
-- reader nothing — the honest fix is to null them so the backfill picks them up
-- on its next run.
--
--   update public.books set description = null
--   where description is not null and length(trim(description)) < 40;

select count(*) as stub_descriptions
from public.books
where description is not null
  and length(trim(description)) < 40;


-- ── 4. Pool by genre ────────────────────────────────────────────────────────
-- Genre-seeded rounds draw from these numbers, not from block 1. A reader whose
-- favourites are all small shelves runs out of *preferred* books quickly — they
-- still see the whole catalog afterwards, but the opening feels thin.
--
-- Only genres present in public.genres can be picked in onboarding, so anything
-- here that isn't in that table is invisible to seeding regardless of size.

select
  coalesce(b.genre, '(null)')                                as genre,
  count(*)                                                   as stacks_pool,
  (exists (select 1 from public.genres g where g.name = b.genre)) as pickable
from public.books b
where b.status <> 'flagged'
  and b.cover_url is not null
  and b.description is not null
group by 1, 3
order by stacks_pool desc;


-- ── 5. Regression check on the two genre migrations ─────────────────────────
-- Expected: zero rows. Any result means a crawl canonical name is still
-- unreachable and genre seeding is silently broken for it again.

select b.genre, count(*) as books
from public.books b
where b.genre in (
  'Epic & Dark Fantasy',
  'Sapphic & Feminist Gothic',
  'Korean, Japanese & East Asian Lit',
  'Latin American Horror & Literary'
)
group by b.genre;
