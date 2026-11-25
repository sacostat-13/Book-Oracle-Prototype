-- share_report.sql — v0.74 share tracking. Run in the Supabase SQL editor.
-- Tables: migration 20261125120000_share_tracking.sql. Spec: claude/share-tracking-v1-spec.md.
--
-- Vocabulary:
--   share   — a reader (or signed-out visitor) used a button in a share window
--   posted  — at least one link-preview crawler fetched that share's link
--   click   — someone opened the link in a browser (the sharer's own opens are dropped)
--   visitor/signup — joined through funnel_events, whose landing source is 'share:<token>'
--
-- Expect small numbers for months; §1 starts to mean something at ~30–50 shares.

-- ── 1. Shares, posts and clicks by channel (last 90 days) ────────────────────
with s as (
  select * from public.shares where created_at > now() - interval '90 days'
), h as (
  select share_id,
         count(distinct agent) filter (where kind = 'unfurl') as previews,
         count(*)              filter (where kind = 'click')  as clicks
    from public.share_hits group by 1
)
select s.channel,
       count(*)                                     as shares,
       count(*) filter (where h.previews > 0)       as posted,
       coalesce(sum(h.clicks), 0)                   as clicks,
       round(coalesce(sum(h.clicks), 0)::numeric / nullif(count(*), 0), 2) as clicks_per_share,
       count(*) filter (where s.sharer_id is null)  as by_signed_out
  from s left join h on h.share_id = s.id
 group by 1 order by shares desc;

-- ── 2. By surface: page share windows vs. accomplishment cards ───────────────
select s.surface, s.entity_type,
       count(distinct s.id)                         as shares,
       count(h.id) filter (where h.kind = 'click')  as clicks
  from public.shares s left join public.share_hits h on h.share_id = s.id
 where s.created_at > now() - interval '90 days'
 group by 1, 2 order by shares desc;

-- ── 3. What gets shared, and what earns clicks ──────────────────────────────
select s.entity_type, s.entity_key,
       count(distinct s.id)                         as shares,
       count(h.id) filter (where h.kind = 'click')  as clicks
  from public.shares s left join public.share_hits h on h.share_id = s.id
 where s.created_at > now() - interval '90 days'
 group by 1, 2 order by clicks desc, shares desc limit 50;

-- ── 4. Where "copy" and "native" shares actually went ────────────────────────
-- The OS share sheet and the clipboard don't say where a link went; the
-- preview crawler and the click's referrer often do.
select s.channel,
       coalesce(h.agent, h.referrer_host, '(no referrer)') as went_to,
       h.kind,
       count(*)
  from public.shares s join public.share_hits h on h.share_id = s.id
 where s.channel in ('copy', 'native')
 group by 1, 2, 3 order by 4 desc;

-- ── 5. Preview apps: where shared links were posted ─────────────────────────
select agent, count(distinct share_id) as shares_previewed, count(*) as fetches
  from public.share_hits where kind = 'unfurl'
 group by 1 order by 2 desc;

-- ── 6. Shares that brought visitors and readers (joins the v0.73 funnel) ─────
-- Landing: signed-out tab that arrived with ?s=. Signup: first-touch source
-- carried on signup_completed (props.src), so a magic-link signup in a new tab
-- still counts.
with landings as (
  select substring(source from 7) as share_id, session
    from public.funnel_events
   where event = 'landing' and source like 'share:%'
), signups as (
  select substring(props->>'src' from 7) as share_id, user_id
    from public.funnel_events
   where event = 'signup_completed' and props->>'src' like 'share:%'
)
select s.channel, s.entity_type,
       count(distinct l.session)  as visitors,
       count(distinct u.user_id)  as signups
  from public.shares s
  left join landings l on l.share_id = s.id
  left join signups  u on u.share_id = s.id
 group by 1, 2
having count(distinct l.session) > 0 or count(distinct u.user_id) > 0
 order by signups desc, visitors desc;

-- ── 7. Readers whose shares bring people back (internal only) ───────────────
select p.username,
       count(distinct s.id)                         as shares,
       count(h.id) filter (where h.kind = 'click')  as clicks
  from public.shares s
  join public.profiles p on p.id = s.sharer_id
  left join public.share_hits h on h.share_id = s.id
 group by 1 order by clicks desc, shares desc limit 20;

-- ── 8. Weekly trend ─────────────────────────────────────────────────────────
select date_trunc('week', s.created_at)::date      as week,
       count(distinct s.id)                         as shares,
       count(h.id) filter (where h.kind = 'click')  as clicks
  from public.shares s left join public.share_hits h on h.share_id = s.id
 group by 1 order by 1 desc limit 26;
