-- series.volumes_stale: the queue, and why it is a boolean and not a timestamp.
--
-- WHAT THIS REPLACES
--
-- series_completeness.needs_check was defined, on 2026-09-09, as:
--
--   s.volumes_checked_at is null or s.volumes_checked_at < s.updated_at
--
-- and the spec that shipped it named the risk out loud: "One thing to verify
-- first: whether series.updated_at is maintained by a trigger. If it is not,
-- use an explicit volumes_stale boolean set by the writer instead, which
-- depends on nothing."
--
-- It is not. Measured 2026-09-10:
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.series'::regclass and not tgisinternal;
--   → 0 rows
--
--   select count(*) filter (where updated_at = created_at), count(*)
--     from public.series;
--   → 542 of 790
--
-- Nothing maintains it, and for 69% of series it has never moved off
-- created_at. So the moment a series had been checked once, needs_check would
-- have gone false and stayed false forever, and the queue would have reported
-- "nothing due" every night while the catalog rotted. An empty queue looks
-- exactly like a finished one: the empty-result-versus-failure trap this
-- codebase keeps paying for, this time wearing a scheduler.
--
-- A boolean somebody sets on purpose cannot fail that way.
--
-- WHY A TRIGGER AND NOT A LINE IN oracleBatch.mjs
--
-- The plan was one line in the nightly curation, where series membership is
-- already assigned. A trigger is strictly better and no more expensive: it
-- catches EVERY writer -- upsert_book, seriesBackfill --apply, the curation
-- pass, a human in the Supabase dashboard -- rather than the one path we
-- remembered to edit. The whole point of this column is that it cannot go
-- quietly stale, and a hook in one script is exactly how it would.
--
-- It fires on status too, deliberately. A book flipping to oracle_categorized
-- changes what the series page LISTS without changing what the catalog holds,
-- and that is the single biggest event in this system: on 2026-09-09, 41
-- volumes sat invisible across 15 series waiting for exactly that flip. The
-- queue should notice it.
--
-- The work is one boolean write on one row, skipped when it is already true.

alter table public.series
  add column if not exists volumes_stale boolean not null default true;

comment on column public.series.volumes_stale is
  'This series needs a volume-completeness pass. Set by the books trigger whenever a volume arrives, moves, changes status or leaves; cleared by batch-scripts/manual/seriesBackfill.mjs --propose once it has looked. Defaults true so a new series is due immediately. A boolean rather than a timestamp comparison because series.updated_at is maintained by nothing (verified 2026-09-10: no triggers, 542 of 790 rows never moved off created_at).';

-- Partial: the queue only ever asks for the true ones, and in steady state
-- that is a handful out of hundreds.
create index if not exists series_volumes_stale_idx
  on public.series (volumes_stale)
  where volumes_stale;

-- -- The writer ---------------------------------------------------------------

create or replace function public.mark_series_volumes_stale()
returns trigger
language plpgsql
-- SECURITY DEFINER because the caller is usually a reader touching their own
-- book row and has no business holding UPDATE on the shared series table. The
-- function's whole surface is one boolean on one row, and search_path is
-- pinned so it cannot be redirected.
security definer
set search_path = public
as $$
begin
  -- The series a volume arrived in, moved to, or changed inside.
  if tg_op in ('INSERT', 'UPDATE') and new.series_id is not null then
    update public.series
       set volumes_stale = true
     where id = new.series_id and volumes_stale is distinct from true;
  end if;

  -- And the one it LEFT. A volume moving between series makes both of them
  -- wrong -- the source now has a gap it did not have a moment ago. Missing
  -- this is how Dungeon Crawler Carl looked complete while position 6 was
  -- empty.
  if tg_op in ('UPDATE', 'DELETE') and old.series_id is not null
     and (tg_op = 'DELETE' or old.series_id is distinct from new.series_id) then
    update public.series
       set volumes_stale = true
     where id = old.series_id and volumes_stale is distinct from true;
  end if;

  return null; -- AFTER trigger; the return value is discarded.
end $$;

comment on function public.mark_series_volumes_stale() is
  'Marks a series as needing a volume-completeness pass when its books change. Fires on series_id, position_in_series and status -- status because a book becoming visible to the series page changes the page without changing the catalog.';

drop trigger if exists books_mark_series_volumes_stale on public.books;

create trigger books_mark_series_volumes_stale
  after insert or delete or update of series_id, position_in_series, status
  on public.books
  for each row
  execute function public.mark_series_volumes_stale();

-- -- The reader ---------------------------------------------------------------
--
-- create or replace view is append-only in the columns it may change, so every
-- existing column keeps its name, type and position. needs_check changes its
-- EXPRESSION -- which is allowed -- and volumes_stale is appended at the end.

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
  coalesce(v.held, 0)        as held,
  coalesce(v.held_live, 0)   as held_live,
  coalesce(v.unnumbered, 0)  as unnumbered,
  v.max_position,
  coalesce(v.total_pages, 0) as total_pages,
  g.missing_positions,
  coalesce(g.gap_count, 0)   as gap_count,
  case when s.total_books is not null and coalesce(v.held, 0) < s.total_books
       then s.total_books - coalesce(v.held, 0) end as volumes_owed,

  -- Due for a pass. Was `volumes_checked_at < updated_at`, against a column
  -- nothing maintains -- see the header. Now: never looked at, or something
  -- changed since we did.
  (s.volumes_checked_at is null or s.volumes_stale) as needs_check,

  -- Appended, not inserted: create or replace view cannot reorder.
  s.volumes_stale
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
  'One row per series: how many volumes it holds, what it claims, which positions are missing, and whether it is due another look. Facts only -- the index floor is policy and lives in the three application files tests/contracts.test.js checks. needs_check reads series.volumes_stale, which a trigger on books maintains; it deliberately does NOT read series.updated_at, which nothing maintains.';

grant select on public.series_completeness to anon, authenticated, service_role;

-- -- Verification ------------------------------------------------------------
--
--   -- 1. Everything is due, because nothing has been checked yet.
--   select count(*) filter (where needs_check) as due, count(*) as total
--     from public.series_completeness;
--
--   -- 2. The trigger fires. Pick a series, clear it, touch one of its books.
--   --    (Run inside a transaction and roll back if you would rather not.)
--   --    update public.series set volumes_stale = false where id = '<id>';
--   --    update public.books set position_in_series = position_in_series
--   --     where series_id = '<id>' limit 1;
--   --    select volumes_stale from public.series where id = '<id>';  -- → true
--
--   -- 3. After a --propose --stale run, the queue should be shorter than it
--   --    was, and the series it looked at should carry a timestamp.
--   select count(*) filter (where volumes_stale)            as still_stale,
--          count(*) filter (where volumes_checked_at is not null) as ever_checked,
--          count(*)                                          as total
--     from public.series;
