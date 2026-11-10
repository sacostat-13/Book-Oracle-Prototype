-- Visitor funnel report. Run in the Supabase SQL editor.
-- Table + definitions: supabase/migrations/20261110120000_visitor_funnel.sql
-- Change the interval on each query to widen or narrow the window.

-- ── 1. The funnel, last 30 days ──────────────────────────────────────────────
-- Of the signed-out visits, how many reached each step?
select
  count(*)                                    as visits,
  count(*) filter (where pages_after > 0)     as viewed_another_page,
  count(*) filter (where asked_oracle)        as asked_oracle,
  count(*) filter (where clicked_cta)         as clicked_cta,
  count(*) filter (where opened_auth)         as opened_sign_in,
  count(*) filter (where submitted_auth)      as submitted_sign_in,
  count(*) filter (where got_account)         as got_account_same_tab
from public.funnel_sessions
where day > current_date - 30;

-- ── 2. By source and landing page ────────────────────────────────────────────
select
  source,
  landing_type,
  count(*)                                    as visits,
  round(avg(pages_after), 1)                  as avg_pages_after,
  count(*) filter (where clicked_cta)         as cta,
  count(*) filter (where opened_auth)         as sign_in_opened,
  count(*) filter (where got_account)         as accounts,
  percentile_cont(0.5) within group (order by extract(epoch from time_on_site)) as median_seconds
from public.funnel_sessions
where day > current_date - 30
group by 1, 2
order by visits desc;

-- ── 3. Landing pages that bring visits — and what happened next ─────────────
select
  landing_path,
  count(*)                                    as visits,
  count(*) filter (where pages_after = 0 and not clicked_cta and not asked_oracle) as left_without_acting,
  count(*) filter (where asked_oracle)        as asked_oracle,
  count(*) filter (where clicked_cta)         as cta
from public.funnel_sessions
where day > current_date - 30 and landing_path is not null
group by 1
order by visits desc
limit 50;

-- ── 4. Accounts, by where the visitor first came from ────────────────────────
-- Includes signups finished in another tab (magic link), via first touch.
select
  event,
  coalesce(props ->> 'src', '(no first touch)')  as first_source,
  coalesce(props ->> 'land', '?')                as first_landing,
  count(*)
from public.funnel_events
where event in ('signup_completed', 'signin_completed', 'onboarding_completed')
  and day > current_date - 30
group by 1, 2, 3
order by 1, 4 desc;

-- ── 5. Which calls to action get clicked ─────────────────────────────────────
select props ->> 'cta' as cta, page_type, count(*)
from public.funnel_events
where event = 'cta_click' and day > current_date - 30
group by 1, 2
order by 3 desc;

-- ── 6. Where the sign-in window loses people ─────────────────────────────────
select event, props ->> 'method' as method, props ->> 'kind' as kind, count(*)
from public.funnel_events
where event in ('auth_open', 'auth_submit', 'auth_error') and day > current_date - 30
group by 1, 2, 3
order by 1, 4 desc;

-- ── 7. The Oracle teaser on book pages ───────────────────────────────────────
select
  count(*) filter (where event = 'teaser_open')                                  as opened,
  count(*) filter (where event = 'teaser_result')                                as got_picks,
  count(*) filter (where event = 'teaser_result' and (props ->> 'cached')::boolean) as from_cache,
  count(*) filter (where event = 'teaser_save')                                  as saved_a_pick
from public.funnel_events
where day > current_date - 30;

-- ── 8. One visit, step by step (paste a session id from §2/§3) ───────────────
-- select created_at, event, page_type, path, props
--   from public.funnel_events where session = '<session id>' order by created_at;

-- ── 9. Daily volume ──────────────────────────────────────────────────────────
select day, count(*) filter (where event = 'landing') as visits,
       count(*) filter (where event = 'cta_click')    as cta,
       count(*) filter (where event = 'signup_completed') as signups
from public.funnel_events
where day > current_date - 30
group by 1 order by 1;
