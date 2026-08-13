-- Curated Lists — genres, moods, followers, discovery.
--
-- Turns lists from a private organising tool that happens to have a public URL
-- into a distribution surface: something someone can build, post about, and
-- have strangers find, follow, and be told about when it changes.
--
-- The shape follows book clubs deliberately. Clubs already solved public/private
-- visibility, genre and mood tagging, a directory with filters, a membership
-- relation and notifications on activity. A reader who has filtered the club
-- directory by "atmospheric" should not have to learn a second control to filter
-- lists by the same thing, so where this file says it mirrors clubs, it mirrors
-- them exactly — same column names, same filter semantics, same tie-breaks.
--
-- ONE DELIBERATE DIVERGENCE: search_public_lists does NOT require a session.
-- `search_public_clubs` raises when auth.uid() is null. That is right for clubs,
-- which are a members' surface. It is wrong here: the whole premise is that
-- these lists get posted on social media, so Discover is itself a landing page
-- and needs to render for someone who has never signed in. Everything
-- caller-specific degrades instead of failing — see the notes on the function.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Genres and moods
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.list_genres (
  list_id  uuid not null references public.lists(id)  on delete cascade,
  genre_id uuid not null references public.genres(id) on delete cascade,
  primary key (list_id, genre_id)
);

create table if not exists public.list_moods (
  list_id uuid not null references public.lists(id) on delete cascade,
  mood    text not null,
  primary key (list_id, mood)
);

create index if not exists list_genres_genre_idx on public.list_genres (genre_id);
create index if not exists list_moods_mood_idx   on public.list_moods (mood);

alter table public.list_genres enable row level security;
alter table public.list_moods  enable row level security;

-- Readable when the parent list is readable, writable only by its owner.
--
-- Same predicate shape as the existing list_items policies: an `exists` against
-- public.lists. That does not recurse — lists' own policy references no table
-- that references these — so no SECURITY DEFINER helper is needed here.
create policy "Anyone can read genres of a public list" on public.list_genres
  for select using (exists (
    select 1 from public.lists l
    where l.id = list_genres.list_id and (l.is_public or l.user_id = auth.uid())
  ));

create policy "Owner manages list genres" on public.list_genres
  using (exists (
    select 1 from public.lists l
    where l.id = list_genres.list_id and l.user_id = auth.uid()
  ));

create policy "Anyone can read moods of a public list" on public.list_moods
  for select using (exists (
    select 1 from public.lists l
    where l.id = list_moods.list_id and (l.is_public or l.user_id = auth.uid())
  ));

create policy "Owner manages list moods" on public.list_moods
  using (exists (
    select 1 from public.lists l
    where l.id = list_moods.list_id and l.user_id = auth.uid()
  ));

grant select on public.list_genres to anon;
grant all    on public.list_genres to authenticated, service_role;
grant select on public.list_moods  to anon;
grant all    on public.list_moods  to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Followers
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.list_followers (
  list_id      uuid not null references public.lists(id) on delete cascade,
  user_id      uuid not null references auth.users(id)   on delete cascade,
  followed_at  timestamptz not null default now(),
  -- When this follower last opened the list. Drives the "changed since you last
  -- looked" marker on the landing page without needing a second table.
  last_seen_at timestamptz,
  primary key (list_id, user_id)
);

create index if not exists list_followers_user_idx on public.list_followers (user_id);
create index if not exists list_followers_list_idx on public.list_followers (list_id);

alter table public.list_followers enable row level security;

-- A follower may read and delete their own row, and nobody else's. Follower
-- identities are not exposed: the owner gets a count, not a list. Nobody asked
-- for the list, and it is a privacy surface that is easy to add later and
-- impossible to withdraw.
create policy "Read own follows" on public.list_followers
  for select using (user_id = auth.uid());

create policy "Unfollow own" on public.list_followers
  for delete using (user_id = auth.uid());

-- Inserts go through follow_list() only, which enforces the public-list and
-- not-your-own-list rules in one place. No INSERT policy here on purpose.

grant select, delete on public.list_followers to authenticated;
grant all            on public.list_followers to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Change log
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Triggers write here; a scheduled job rolls this up into at most one
-- notification per (list, follower) per day and clears what it processed.
--
-- Not notifying straight from the trigger, and not doing a time-window rollup
-- inside one either. Someone building a fifty-book list adds books one at a
-- time, and fifty notifications per follower is how a follow feature teaches
-- people to unfollow. A trigger also has no way to know whether more edits are
-- coming, and `auth.uid()` is always NULL in trigger context on this project —
-- so the actor has to come off the row, not the session.

create table if not exists public.list_change_log (
  id        bigserial primary key,
  list_id   uuid not null references public.lists(id) on delete cascade,
  change    text not null check (change in ('books_added','books_removed','renamed','described')),
  qty       integer not null default 1,
  at        timestamptz not null default now(),
  processed boolean not null default false
);

create index if not exists list_change_log_pending_idx
  on public.list_change_log (list_id) where not processed;

alter table public.list_change_log enable row level security;
-- No policies: this is machinery. Only the service role and the SECURITY
-- DEFINER functions below ever touch it.
grant all on public.list_change_log to service_role;
grant usage, select on sequence public.list_change_log_id_seq to service_role;

-- Only log for lists that are actually public. A private list has no followers
-- to tell, and logging its edits would write a row per book for every reader
-- quietly organising their own shelves.
create or replace function public.log_list_change()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_list_id uuid;
  v_change  text;
begin
  if tg_table_name = 'list_items' then
    v_list_id := coalesce(new.list_id, old.list_id);
    v_change  := case when tg_op = 'INSERT' then 'books_added' else 'books_removed' end;
  else
    v_list_id := new.id;
    if new.title is distinct from old.title then
      v_change := 'renamed';
    elsif new.description is distinct from old.description then
      v_change := 'described';
    else
      return coalesce(new, old);
    end if;
  end if;

  if not exists (select 1 from public.lists l where l.id = v_list_id and l.is_public) then
    return coalesce(new, old);
  end if;

  insert into public.list_change_log (list_id, change) values (v_list_id, v_change);
  return coalesce(new, old);
end;
$$;

drop trigger if exists list_items_change_log on public.list_items;
create trigger list_items_change_log
  after insert or delete on public.list_items
  for each row execute function public.log_list_change();

drop trigger if exists lists_change_log on public.lists;
create trigger lists_change_log
  after update on public.lists
  for each row execute function public.log_list_change();

-- Going private drops the followers.
--
-- Keeping them dormant means holding a relationship to something the person can
-- no longer read, which is a question nobody wants to answer later. No
-- notification is sent either: telling someone they have lost access to
-- something is worse than silence.
create or replace function public.clear_followers_on_private()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
begin
  if old.is_public and not new.is_public then
    delete from public.list_followers where list_id = new.id;
    delete from public.list_change_log where list_id = new.id and not processed;
  end if;
  return new;
end;
$$;

drop trigger if exists lists_clear_followers on public.lists;
create trigger lists_clear_followers
  after update of is_public on public.lists
  for each row execute function public.clear_followers_on_private();

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Follow / unfollow / seen
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.follow_list(p_list_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_public boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select user_id, is_public into v_owner, v_public
  from public.lists where id = p_list_id;

  if v_owner is null then
    raise exception 'List not found';
  end if;

  -- Enforced here rather than only in the UI. A list that went private must not
  -- keep acquiring followers who cannot read it.
  if not v_public then
    raise exception 'List is not public';
  end if;

  -- Following your own list would put it on the landing page twice and notify
  -- you about your own edits.
  if v_owner = auth.uid() then
    return false;
  end if;

  insert into public.list_followers (list_id, user_id, last_seen_at)
  values (p_list_id, auth.uid(), now())
  on conflict (list_id, user_id) do nothing;

  return true;
end;
$$;

create or replace function public.unfollow_list(p_list_id uuid)
  returns boolean
  language sql
  security definer
  set search_path to 'public'
as $$
  delete from public.list_followers
  where list_id = p_list_id and user_id = auth.uid();
  select true;
$$;

-- Called when a follower opens the list, so the "updated since you looked"
-- marker can clear. Silently does nothing for a non-follower.
create or replace function public.mark_list_seen(p_list_id uuid)
  returns void
  language sql
  security definer
  set search_path to 'public'
as $$
  update public.list_followers
  set last_seen_at = now()
  where list_id = p_list_id and user_id = auth.uid();
$$;

grant execute on function public.follow_list(uuid)   to authenticated;
grant execute on function public.unfollow_list(uuid) to authenticated;
grant execute on function public.mark_list_seen(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Discovery
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Modelled on search_public_clubs, with the session requirement removed.
--
-- `caller_follows` is computed here rather than client-side so the Follow button
-- renders in the right state on first paint; deriving it in the client makes it
-- flicker from "Follow" to "Following" on every load, which reads as a bug. For
-- an anonymous caller it is simply false.
--
-- Genre and mood filters are `exists` subqueries, not joins — same as clubs. A
-- join multiplies rows when a list carries three genres and the duplicates then
-- have to be removed before sorting.

create or replace function public.search_public_lists(
  p_query     text   default null,
  p_genre_ids uuid[] default null,
  p_moods     text[] default null,
  p_sort      text   default 'followers'
)
  returns table (
    id             uuid,
    title          text,
    description    text,
    created_at     timestamptz,
    owner_username text,
    owner_display  text,
    owner_avatar   text,
    book_count     bigint,
    follower_count bigint,
    genre_names    text[],
    moods          text[],
    cover_urls     text[],
    caller_follows boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  with base as (
    select l.*
    from public.lists l
    where l.is_public
      and (p_query is null
           or l.title ilike '%' || p_query || '%'
           or l.description ilike '%' || p_query || '%')
      and (p_genre_ids is null or exists (
            select 1 from public.list_genres lg
            where lg.list_id = l.id and lg.genre_id = any(p_genre_ids)))
      and (p_moods is null or exists (
            select 1 from public.list_moods lm
            where lm.list_id = l.id and lm.mood = any(p_moods)))
  )
  select
    b.id,
    b.title,
    b.description,
    b.created_at,
    p.username,
    p.display_name,
    p.avatar_url,
    (select count(*) from public.list_items li where li.list_id = b.id),
    (select count(*) from public.list_followers lf where lf.list_id = b.id),
    coalesce((
      select array_agg(g.name order by g.name)
      from public.list_genres lg join public.genres g on g.id = lg.genre_id
      where lg.list_id = b.id
    ), '{}'),
    coalesce((
      select array_agg(lm.mood order by lm.mood)
      from public.list_moods lm where lm.list_id = b.id
    ), '{}'),
    -- First six covers, in list order, for the preview strip. Books without a
    -- cover are skipped rather than leaving a gap.
    coalesce((
      select array_agg(c.cover_url)
      from (
        select bk.cover_url
        from public.list_items li join public.books bk on bk.id = li.book_id
        where li.list_id = b.id and bk.cover_url is not null
        order by li.position asc
        limit 6
      ) c
    ), '{}'),
    -- False for anonymous callers; auth.uid() is null and the exists cannot match.
    exists (
      select 1 from public.list_followers lf
      where lf.list_id = b.id and lf.user_id = auth.uid()
    )
  from base b
  join public.profiles p on p.id = b.user_id
  order by
    case when p_sort = 'followers'
      then (select count(*) from public.list_followers lf where lf.list_id = b.id) end desc nulls last,
    case when p_sort = 'books'
      then (select count(*) from public.list_items li where li.list_id = b.id) end desc nulls last,
    b.created_at desc;
$$;

grant execute on function public.search_public_lists(text, uuid[], text[], text) to anon, authenticated;

-- Lists the caller follows, for the Curated Lists landing page.
create or replace function public.get_followed_lists()
  returns table (
    id             uuid,
    title          text,
    description    text,
    owner_username text,
    owner_display  text,
    owner_avatar   text,
    book_count     bigint,
    follower_count bigint,
    cover_urls     text[],
    has_updates    boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select
    l.id, l.title, l.description,
    p.username, p.display_name, p.avatar_url,
    (select count(*) from public.list_items li where li.list_id = l.id),
    (select count(*) from public.list_followers x where x.list_id = l.id),
    coalesce((
      select array_agg(c.cover_url)
      from (
        select bk.cover_url
        from public.list_items li join public.books bk on bk.id = li.book_id
        where li.list_id = l.id and bk.cover_url is not null
        order by li.position asc limit 6
      ) c
    ), '{}'),
    -- Changed since this follower last opened it. `lists.updated_at` alone is
    -- not enough: adding a book touches list_items, not lists.
    (lf.last_seen_at is null or exists (
      select 1 from public.list_change_log cl
      where cl.list_id = l.id and cl.at > lf.last_seen_at
    ))
  from public.list_followers lf
  join public.lists l    on l.id = lf.list_id and l.is_public
  join public.profiles p on p.id = l.user_id
  where lf.user_id = auth.uid()
  order by lf.followed_at desc;
$$;

grant execute on function public.get_followed_lists() to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. get_public_list — carry the new metadata
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Replaced rather than supplemented: ListView already calls this on every
-- public list view, and a second round-trip for four scalars is not worth the
-- request. Shape is additive, so the existing client keeps working unchanged.

create or replace function public.get_public_list(p_list_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select jsonb_build_object(
    'list', row_to_json(l),
    'owner', jsonb_build_object(
      'display_name', p.display_name,
      'username',     p.username,
      'avatar_url',   p.avatar_url
    ),
    'genre_names', coalesce((
      select jsonb_agg(g.name order by g.name)
      from public.list_genres lg join public.genres g on g.id = lg.genre_id
      where lg.list_id = l.id
    ), '[]'::jsonb),
    'moods', coalesce((
      select jsonb_agg(lm.mood order by lm.mood)
      from public.list_moods lm where lm.list_id = l.id
    ), '[]'::jsonb),
    'follower_count', (
      select count(*) from public.list_followers lf where lf.list_id = l.id
    ),
    'caller_follows', exists (
      select 1 from public.list_followers lf
      where lf.list_id = l.id and lf.user_id = auth.uid()
    ),
    'books', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position',  li.position,
          'note',      li.note,
          'added_at',  li.added_at,
          'book',      row_to_json(b)
        ) order by li.position asc
      )
      from public.list_items li
      join public.books b on b.id = li.book_id
      where li.list_id = p_list_id
    ), '[]'::jsonb)
  )
  from public.lists   l
  join public.profiles p on p.id = l.user_id
  where l.id = p_list_id
    and l.is_public;
$$;

grant execute on function public.get_public_list(uuid) to anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. Notification rollup
-- ══════════════════════════════════════════════════════════════════════════════
--
-- One notification per (list, follower) per run, summarising everything logged
-- since the last run. Invoked by batch-scripts/scheduled/listNotifications.mjs,
-- which is free and therefore allowed on a timer per batch-scripts/README.md.
--
-- The owner is never notified about their own list — they cannot follow it, but
-- the join is written to make that explicit rather than incidental.
--
-- Respects profiles.notification_preferences->>'curated_lists'. Missing is
-- treated as true: the key does not exist on rows created before this
-- migration, and defaulting those to off would make the feature look broken for
-- every existing account.

create or replace function public.rollup_list_notifications()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_sent integer := 0;
begin
  -- Claim and aggregate in ONE statement.
  --
  -- The obvious shape — read the pending rows, insert notifications, then
  -- `update ... set processed = true where not processed` — has a gap. A book
  -- added between the read and the update is marked processed without anyone
  -- having been told about it, and the change is then lost for good. Doing the
  -- UPDATE first with RETURNING makes the claim atomic: whatever this run marks
  -- is exactly what this run summarises, and anything logged a microsecond
  -- later is simply left for the next run.
  with claimed as (
    update public.list_change_log
    set processed = true
    where not processed
    returning list_id, change, qty
  ),
  pending as (
    select
      c.list_id,
      sum(case when c.change = 'books_added'   then c.qty else 0 end) as added,
      sum(case when c.change = 'books_removed' then c.qty else 0 end) as removed,
      bool_or(c.change in ('renamed','described'))                    as edited
    from claimed c
    group by c.list_id
  ),
  targets as (
    select
      lf.user_id,
      pd.list_id,
      l.title,
      l.user_id as owner_id,
      pd.added, pd.removed, pd.edited
    from pending pd
    join public.lists l          on l.id = pd.list_id and l.is_public
    join public.list_followers lf on lf.list_id = pd.list_id
    join public.profiles pr       on pr.id = lf.user_id
    where lf.user_id <> l.user_id
      and coalesce((pr.notification_preferences->>'curated_lists')::boolean, true)
  ),
  ins as (
    insert into public.notifications (user_id, type, actor_id, data)
    select
      t.user_id,
      'list_updated',
      t.owner_id,
      jsonb_build_object(
        'list_id',    t.list_id,
        'list_title', t.title,
        'added',      t.added,
        'removed',    t.removed,
        'edited',     t.edited
      )
    from targets t
    returning 1
  )
  select count(*) into v_sent from ins;

  return v_sent;
end;
$$;

grant execute on function public.rollup_list_notifications() to service_role;

-- Housekeeping: processed rows have no further use once they are older than the
-- "has_updates" window anyone could care about.
create or replace function public.prune_list_change_log()
  returns integer
  language sql
  security definer
  set search_path to 'public'
as $$
  with d as (
    delete from public.list_change_log
    where processed and at < now() - interval '90 days'
    returning 1
  ) select coalesce(count(*), 0)::integer from d;
$$;

grant execute on function public.prune_list_change_log() to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- Revert
-- ══════════════════════════════════════════════════════════════════════════════
-- drop trigger if exists list_items_change_log on public.list_items;
-- drop trigger if exists lists_change_log      on public.lists;
-- drop trigger if exists lists_clear_followers on public.lists;
-- drop function if exists public.log_list_change();
-- drop function if exists public.clear_followers_on_private();
-- drop function if exists public.follow_list(uuid);
-- drop function if exists public.unfollow_list(uuid);
-- drop function if exists public.mark_list_seen(uuid);
-- drop function if exists public.search_public_lists(text, uuid[], text[], text);
-- drop function if exists public.get_followed_lists();
-- drop function if exists public.rollup_list_notifications();
-- drop function if exists public.prune_list_change_log();
-- drop table if exists public.list_change_log;
-- drop table if exists public.list_followers;
-- drop table if exists public.list_moods;
-- drop table if exists public.list_genres;
-- NOTE: get_public_list must be restored from the previous definition in
-- 20260806212127_remote_schema.sql — this migration replaced it in place.
