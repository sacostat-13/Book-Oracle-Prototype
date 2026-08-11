-- oracle_eligibility_audit.sql — what oracleBatch.mjs would actually process.
--
-- Written because a manual run reported "1000 found". That is not a count: it
-- is PostgREST's default max-rows cap. fetchEligibleBooks() issues a select
-- with no .range() and no .limit(), so 1000 is the most it can ever report,
-- whether the true backlog is 1,000 or 40,000.
--
-- Every query below mirrors the script's eligibility predicate exactly:
--
--   status IN ('unreviewed','incomplete')
--   OR (status = 'oracle_categorized' AND (complexity IS NULL OR depth IS NULL))
--
-- If that predicate changes in the script, change it here. Run in the Supabase
-- SQL editor.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The real number, and which of the two eligible groups it comes from.
-- ─────────────────────────────────────────────────────────────────────────────
select
  count(*)                                                    as total_eligible,
  count(*) filter (where status in ('unreviewed','incomplete'))
                                                              as never_processed,
  count(*) filter (where status = 'oracle_categorized')
                                                              as backfill_complexity_depth
from public.books
where status in ('unreviewed','incomplete')
   or (status = 'oracle_categorized' and (complexity is null or depth is null));


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Age profile. The question behind the question: is this yesterday's 150,
--    or a backlog that accumulated while nightly-curation was crashing?
-- ─────────────────────────────────────────────────────────────────────────────
select
  status,
  count(*)                                                          as books,
  count(*) filter (where created_at >= now() - interval '2 days')    as added_last_2d,
  count(*) filter (where created_at >= now() - interval '14 days')   as added_last_14d,
  count(*) filter (where created_at <  now() - interval '90 days')   as older_than_90d,
  min(created_at)::date                                             as oldest,
  max(created_at)::date                                             as newest
from public.books
where status in ('unreviewed','incomplete')
   or (status = 'oracle_categorized' and (complexity is null or depth is null))
group by status
order by books desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. What is actually missing on the eligible rows.
--
--    Eligibility is status-based, so a book can be eligible while already
--    having everything the Oracle would write. Those are pure waste — the run
--    pays for them and changes nothing. This is the query that says how much
--    of the backlog is real work.
-- ─────────────────────────────────────────────────────────────────────────────
select
  count(*)                                                            as eligible,
  count(*) filter (where complexity is null)                          as missing_complexity,
  count(*) filter (where depth is null)                               as missing_depth,
  count(*) filter (where author_gender_checked_at is null)            as missing_gender,
  count(*) filter (where description is null)                         as missing_description,
  count(*) filter (
    where not exists (select 1 from public.book_genres bg where bg.book_id = b.id)
  )                                                                   as missing_genres,
  count(*) filter (
    where complexity is not null
      and depth is not null
      and author_gender_checked_at is not null
      and description is not null
      and exists (select 1 from public.book_genres bg where bg.book_id = b.id)
  )                                                                   as nothing_to_do
from public.books b
where status in ('unreviewed','incomplete')
   or (status = 'oracle_categorized' and (complexity is null or depth is null));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. How much of the backlog is yours.
--    Replace the email, or swap in your user_id directly.
-- ─────────────────────────────────────────────────────────────────────────────
select
  count(*)                                                            as eligible_on_my_wishlist,
  count(*) filter (where b.created_at >= now() - interval '2 days')    as of_which_added_last_2d
from public.books b
join public.wishlist_items w on w.book_id = b.id
where w.user_id = (select id from auth.users where email = 'simont@mozillafoundation.org')
  and (b.status in ('unreviewed','incomplete')
       or (b.status = 'oracle_categorized' and (b.complexity is null or b.depth is null)));


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Full status census — including the statuses the script never touches.
--    'discovered' is excluded by design: nobody has added those to a
--    collection, so spending tokens on them is not warranted.
-- ─────────────────────────────────────────────────────────────────────────────
select
  status,
  count(*)                                                  as books,
  count(*) filter (where complexity is null)                as no_complexity,
  count(*) filter (where depth is null)                     as no_depth,
  count(*) filter (where author_gender_checked_at is null)  as no_gender_check,
  count(*) filter (where author_gender = 'unknown')         as gender_unknown
from public.books
group by status
order by books desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Cost of draining it, at oracleBatch's ~$0.007/book.
-- ─────────────────────────────────────────────────────────────────────────────
select
  count(*)                                    as eligible,
  round((count(*) * 0.007)::numeric, 2)       as est_usd_to_drain,
  ceil(count(*) / 40.0)                       as nights_at_limit_40
from public.books
where status in ('unreviewed','incomplete')
   or (status = 'oracle_categorized' and (complexity is null or depth is null));
