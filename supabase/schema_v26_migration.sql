-- schema_v26_migration.sql
-- v0.40: Public Club Directory
--
-- Book clubs can now be discovered and joined from inside the app without an
-- invite link. This is still fully auth-gated — there is no unauthenticated
-- access anywhere in this migration, just a searchable in-app directory.
--
-- Summary of changes:
--   1. book_clubs gains visibility / join_mode / max_members
--   2. book_club_moods — same shape as the existing book_club_genres, but
--      against the onboarding mood taxonomy, so clubs can be tagged and
--      filtered by vibe as well as genre
--   3. club_join_requests — a single queue table that covers both
--      "awaiting admin approval" and "waitlisted, club is full" states
--   4. join_public_club() RPC — the only way a client joins a public club;
--      locks the club row so two people can't race the last open seat
--   5. approve_join_request() / reject_join_request() RPCs — admin actions
--   6. promote_from_waitlist() trigger — when a member leaves, the oldest
--      waitlisted request moves up (straight to member if join_mode is
--      'auto', or into pending_approval if 'approval')
--   7. search_public_clubs() RPC — powers the directory UI: text search,
--      genre/mood filters, open-only filter, sort by activity/members/newest
--   8. notifications.type check constraint extended with the four new types

-- ── 1. book_clubs: visibility, join mode, member cap ────────────────────────

alter table public.book_clubs
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  add column if not exists join_mode text not null default 'auto'
    check (join_mode in ('auto', 'approval')),
  add column if not exists max_members int
    check (max_members is null or max_members > 0);

-- ── 2. book_club_moods — mirrors book_club_genres against the mood taxonomy ─
-- Mood ids match MOODS in src/views/Onboarding.jsx / Profile.jsx exactly, so
-- the same chip set used in onboarding can tag and filter clubs.

create table if not exists public.book_club_moods (
  club_id uuid not null references public.book_clubs(id) on delete cascade,
  mood    text not null check (mood in (
    'comfort', 'challenge', 'escapism', 'mind-bending',
    'character-driven', 'atmospheric', 'fast-paced', 'short-read'
  )),
  primary key (club_id, mood)
);

alter table public.book_club_moods enable row level security;

drop policy if exists "club moods readable" on public.book_club_moods;
create policy "club moods readable"
  on public.book_club_moods
  for select using (auth.uid() is not null);

drop policy if exists "club admins manage moods" on public.book_club_moods;
create policy "club admins manage moods"
  on public.book_club_moods
  for all using (
    exists (
      select 1 from public.book_club_members bcm
      where bcm.club_id = book_club_moods.club_id
        and bcm.user_id = auth.uid()
        and bcm.role = 'admin'
    )
  );

-- ── 3. club_join_requests — approval queue + waitlist, same table ──────────
-- status:
--   pending_approval — awaiting admin decision (join_mode = 'approval')
--   waitlisted       — club was full at request time
--   approved         — terminal: admin approved (member row now exists)
--   rejected         — terminal: admin rejected
-- Only one *active* (pending_approval / waitlisted) request per user per
-- club — the partial unique index below allows a fresh request after a
-- past one was resolved.

create table if not exists public.club_join_requests (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.book_clubs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null check (status in ('pending_approval', 'waitlisted', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create unique index if not exists uq_club_join_requests_active
  on public.club_join_requests (club_id, user_id)
  where status in ('pending_approval', 'waitlisted');

alter table public.club_join_requests enable row level security;

drop policy if exists "own join requests visible" on public.club_join_requests;
create policy "own join requests visible"
  on public.club_join_requests
  for select using (user_id = auth.uid());

drop policy if exists "admins view club join requests" on public.club_join_requests;
create policy "admins view club join requests"
  on public.club_join_requests
  for select using (
    exists (
      select 1 from public.book_club_members bcm
      where bcm.club_id = club_join_requests.club_id
        and bcm.user_id = auth.uid()
        and bcm.role = 'admin'
    )
  );

-- No client insert/update policy — all writes go through the RPCs below,
-- which run as security definer so they can enforce the seat-count race
-- check and write the notification atomically with the request/member row.

-- ── 4. join_public_club() — the only way a client joins a public club ──────

create or replace function public.join_public_club(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_club        record;
  v_member_ct   int;
  v_has_room    boolean;
  v_admin_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Lock the club row so two concurrent joins against the last open seat
  -- are serialized rather than both reading the same "room available" count.
  select id, visibility, join_mode, max_members
    into v_club
    from public.book_clubs
    where id = p_club_id
    for update;

  if v_club.id is null then
    raise exception 'Club not found';
  end if;
  if v_club.visibility <> 'public' then
    raise exception 'This club is invite-only';
  end if;

  if exists (select 1 from public.book_club_members where club_id = p_club_id and user_id = auth.uid()) then
    return jsonb_build_object('status', 'already_member');
  end if;

  if exists (
    select 1 from public.club_join_requests
    where club_id = p_club_id and user_id = auth.uid()
      and status in ('pending_approval', 'waitlisted')
  ) then
    return (
      select jsonb_build_object('status', status)
      from public.club_join_requests
      where club_id = p_club_id and user_id = auth.uid()
        and status in ('pending_approval', 'waitlisted')
    );
  end if;

  select count(*) into v_member_ct from public.book_club_members where club_id = p_club_id;
  v_has_room := v_club.max_members is null or v_member_ct < v_club.max_members;

  if v_has_room and v_club.join_mode = 'auto' then
    insert into public.book_club_members (club_id, user_id, role, added_by)
    values (p_club_id, auth.uid(), 'member', auth.uid());
    return jsonb_build_object('status', 'joined');
  end if;

  if v_has_room then
    -- room available, but this club reviews requests
    insert into public.club_join_requests (club_id, user_id, status)
    values (p_club_id, auth.uid(), 'pending_approval');

    for v_admin_id in
      select user_id from public.book_club_members where club_id = p_club_id and role = 'admin'
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (v_admin_id, 'join_request', auth.uid(), jsonb_build_object('club_id', p_club_id))
      on conflict do nothing;
    end loop;

    return jsonb_build_object('status', 'pending_approval');
  end if;

  -- no room either way — waitlist
  insert into public.club_join_requests (club_id, user_id, status)
  values (p_club_id, auth.uid(), 'waitlisted');
  return jsonb_build_object('status', 'waitlisted');
end;
$$;

-- ── 5. approve_join_request() / reject_join_request() — admin actions ──────

create or replace function public.approve_join_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req       record;
  v_member_ct int;
  v_max       int;
begin
  select * into v_req
    from public.club_join_requests
    where id = p_request_id and status in ('pending_approval', 'waitlisted')
    for update;

  if v_req.id is null then
    raise exception 'Request not found or already resolved';
  end if;

  if not exists (
    select 1 from public.book_club_members
    where club_id = v_req.club_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;

  select max_members into v_max from public.book_clubs where id = v_req.club_id;
  select count(*) into v_member_ct from public.book_club_members where club_id = v_req.club_id;

  if v_max is not null and v_member_ct >= v_max then
    -- club filled up since the request was made — hold on the waitlist
    -- instead of approving into an over-capacity club
    update public.club_join_requests set status = 'waitlisted' where id = p_request_id;
    return jsonb_build_object('status', 'waitlisted');
  end if;

  insert into public.book_club_members (club_id, user_id, role, added_by)
  values (v_req.club_id, v_req.user_id, 'member', auth.uid());

  update public.club_join_requests
    set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;

  insert into public.notifications (user_id, type, actor_id, data)
  values (v_req.user_id, 'join_approved', auth.uid(), jsonb_build_object('club_id', v_req.club_id))
  on conflict do nothing;

  return jsonb_build_object('status', 'approved');
end;
$$;

create or replace function public.reject_join_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req record;
begin
  select * into v_req
    from public.club_join_requests
    where id = p_request_id and status in ('pending_approval', 'waitlisted')
    for update;

  if v_req.id is null then
    raise exception 'Request not found or already resolved';
  end if;

  if not exists (
    select 1 from public.book_club_members
    where club_id = v_req.club_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;

  update public.club_join_requests
    set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;

  insert into public.notifications (user_id, type, actor_id, data)
  values (v_req.user_id, 'join_rejected', auth.uid(), jsonb_build_object('club_id', v_req.club_id))
  on conflict do nothing;

  return jsonb_build_object('status', 'rejected');
end;
$$;

-- ── 6. promote_from_waitlist() — fires when a member leaves ────────────────
-- Frees exactly one seat, so promotes exactly one request: the oldest
-- waitlisted row for that club. 'auto' clubs promote straight to member;
-- 'approval' clubs move it back to pending_approval since a freed seat
-- doesn't waive the admin's review.

create or replace function public.promote_from_waitlist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_next      record;
  v_join_mode text;
  v_admin_id  uuid;
begin
  select id into v_next
    from public.club_join_requests
    where club_id = OLD.club_id and status = 'waitlisted'
    order by created_at asc
    limit 1
    for update;

  if v_next.id is null then
    return OLD;
  end if;

  select join_mode into v_join_mode from public.book_clubs where id = OLD.club_id;

  if v_join_mode = 'auto' then
    insert into public.book_club_members (club_id, user_id, role, added_by)
    select OLD.club_id, cjr.user_id, 'member', null
    from public.club_join_requests cjr where cjr.id = v_next.id;

    update public.club_join_requests
      set status = 'approved', resolved_at = now()
      where id = v_next.id;

    insert into public.notifications (user_id, type, actor_id, data)
    select user_id, 'waitlist_promoted', null, jsonb_build_object('club_id', OLD.club_id)
    from public.club_join_requests where id = v_next.id
    on conflict do nothing;
  else
    update public.club_join_requests set status = 'pending_approval' where id = v_next.id;

    for v_admin_id in
      select user_id from public.book_club_members where club_id = OLD.club_id and role = 'admin'
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (v_admin_id, 'join_request', null, jsonb_build_object('club_id', OLD.club_id))
      on conflict do nothing;
    end loop;
  end if;

  return OLD;
end;
$$;

drop trigger if exists on_club_member_removed on public.book_club_members;
create trigger on_club_member_removed
  after delete on public.book_club_members
  for each row execute function public.promote_from_waitlist();

-- ── 7. search_public_clubs() — powers the directory UI ──────────────────────
-- security definer: a member browsing the directory needs to see public
-- clubs they haven't joined yet, which plain book_clubs RLS wouldn't allow.

create or replace function public.search_public_clubs(
  p_query      text default null,
  p_genre_ids  uuid[] default null,
  p_moods      text[] default null,
  p_open_only  boolean default false,
  p_sort       text default 'activity' -- 'activity' | 'members' | 'newest'
)
returns table (
  id               uuid,
  name             text,
  description      text,
  join_mode        text,
  max_members      int,
  member_count     bigint,
  created_at       timestamptz,
  genre_names      text[],
  moods            text[],
  current_book_title  text,
  current_book_author text,
  current_book_cover  text,
  caller_status    text -- 'none' | 'member' | 'pending_approval' | 'waitlisted'
) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return query
  with base as (
    select bc.*
    from public.book_clubs bc
    where bc.visibility = 'public'
      and (p_query is null or bc.name ilike '%' || p_query || '%' or bc.description ilike '%' || p_query || '%')
      and (
        p_genre_ids is null or exists (
          select 1 from public.book_club_genres bcg
          where bcg.club_id = bc.id and bcg.genre_id = any(p_genre_ids)
        )
      )
      and (
        p_moods is null or exists (
          select 1 from public.book_club_moods bcm
          where bcm.club_id = bc.id and bcm.mood = any(p_moods)
        )
      )
  ),
  counted as (
    select
      b.*,
      (select count(*) from public.book_club_members m where m.club_id = b.id) as member_count
    from base b
  ),
  active_session as (
    select distinct on (bcs.club_id)
      bcs.club_id, bk.title, bk.author, bk.cover_url
    from public.book_club_sessions bcs
    join public.books bk on bk.id = bcs.book_id
    where now() between bcs.starts_at and bcs.ends_at
    order by bcs.club_id, bcs.starts_at desc
  )
  select
    c.id, c.name, c.description, c.join_mode, c.max_members, c.member_count, c.created_at,
    coalesce((
      select array_agg(g.name order by g.name)
      from public.book_club_genres bcg join public.genres g on g.id = bcg.genre_id
      where bcg.club_id = c.id
    ), '{}') as genre_names,
    coalesce((
      select array_agg(bcm.mood order by bcm.mood)
      from public.book_club_moods bcm where bcm.club_id = c.id
    ), '{}') as moods,
    a.title, a.author, a.cover_url,
    case
      when exists (select 1 from public.book_club_members m where m.club_id = c.id and m.user_id = auth.uid())
        then 'member'
      when exists (
        select 1 from public.club_join_requests r
        where r.club_id = c.id and r.user_id = auth.uid() and r.status = 'pending_approval'
      ) then 'pending_approval'
      when exists (
        select 1 from public.club_join_requests r
        where r.club_id = c.id and r.user_id = auth.uid() and r.status = 'waitlisted'
      ) then 'waitlisted'
      else 'none'
    end as caller_status
  from counted c
  left join active_session a on a.club_id = c.id
  where (not p_open_only) or c.max_members is null or c.member_count < c.max_members
  order by
    case when p_sort = 'members'  then c.member_count end desc nulls last,
    case when p_sort = 'newest'   then c.created_at end desc nulls last,
    case when p_sort = 'activity' or p_sort is null
      then coalesce(a.title, '') end desc nulls last, -- has an active session = more active, coarse but cheap
    c.created_at desc;
end;
$$;

-- ── 8. notifications.type — extend with the four new join-flow types ───────

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'friend_request',
    'friend_accepted',
    'club_invite',
    'poll_started',
    'poll_finalized',
    'discussion_question',
    'discussion_reply',
    'announcement',
    -- v0.40: public club directory
    'join_request',
    'join_approved',
    'join_rejected',
    'waitlist_promoted'
  ));
