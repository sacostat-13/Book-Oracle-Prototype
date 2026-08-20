-- Follows replace friendships.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Book Oracle already shipped a follow: list_followers (20260812150000) is
-- asymmetric, needs no approval, and notifies on change. This migration extends
-- that primitive from lists to people and retires the friendship, which was the
-- only relationship in the app that required a negotiation.
--
-- The friendship was doing one job that a follow does not do for free: it was
-- the CONSENT BOUNDARY. read_books' SELECT policy reads "mine, or a friend's",
-- and "friend" meant "this person accepted me". Deleting friendships without
-- replacing that boundary would silently open every reader's shelf, so the
-- replacement — profiles.shelf_visibility — lands in this same migration rather
-- than after it. That is the whole reason this file is one migration and not
-- three.
--
-- Friendship rows are DROPPED, not migrated: there are two in production, both
-- belonging to the same account, and both parties would be re-following inside
-- a minute. Migrating four rows was not worth the code that would do it.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. The relationship
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_follows (
  follower_id uuid        not null references auth.users(id) on delete cascade,
  followee_id uuid        not null references auth.users(id) on delete cascade,
  -- Whose updates I have chosen not to see without unfollowing them. A mute is
  -- a property of MY follow of them, so it lives here rather than in its own
  -- table: there is exactly one row per (me, them) and this is it.
  muted       boolean     not null default false,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint user_follows_no_self check (follower_id <> followee_id)
);

comment on table public.user_follows is
  'Asymmetric follow between readers. A mutual pair (rows in both directions) is what used to be a friendship; it is derived, never stored. Structural sibling of list_followers.';

-- follower_id is the primary key''s leading column, so "who do I follow" is
-- already indexed. This is the other direction: "who follows this person",
-- which every visibility check runs.
create index if not exists user_follows_followee_idx
  on public.user_follows (followee_id);

alter table public.user_follows enable row level security;

-- A follow is not a secret from either side of it: I can see who I follow, and
-- I can see who follows me. I can only create and destroy my own.
create policy "Read follows I am part of" on public.user_follows
  for select using (follower_id = auth.uid() or followee_id = auth.uid());

create policy "Follow as myself" on public.user_follows
  for insert with check (follower_id = auth.uid());

create policy "Unfollow and mute my own follows" on public.user_follows
  for update using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

create policy "Unfollow my own" on public.user_follows
  for delete using (follower_id = auth.uid());

grant select, insert, update, delete on public.user_follows to authenticated;
grant all                           on public.user_follows to service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. The profile
-- ══════════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists bio text,
  add column if not exists favorite_genres text[] not null default '{}',
  add column if not exists shelf_visibility text not null default 'followers';

alter table public.profiles
  drop constraint if exists profiles_shelf_visibility_check;

alter table public.profiles
  add constraint profiles_shelf_visibility_check
  check (shelf_visibility in ('public', 'followers', 'private'));

comment on column public.profiles.shelf_visibility is
  'Who may read this reader''s shelves and reading activity: public | followers | private. Replaces the accepted-friendship check that read_books'' SELECT policy used before follows. Default ''followers'' preserves the old behaviour — visible to people you have a relationship with, not to the open web. Lists are NOT governed by this; they carry their own per-list visibility.';

comment on column public.profiles.bio is
  'Short self-description shown on the reader''s profile. Plain text, capped in the client at 280 characters.';

comment on column public.profiles.favorite_genres is
  'Promoted out of preferences->favoriteGenres so it can be queried — the curator directory filters on it. The client writes both for now; preferences is the one to retire.';

-- Backfill from where these already live, so nobody loses a setting they made.
update public.profiles p
set favorite_genres = coalesce(
  (select array_agg(value::text)
     from jsonb_array_elements_text(p.preferences -> 'favoriteGenres') as value),
  '{}'
)
where p.preferences ? 'favoriteGenres'
  and p.favorite_genres = '{}';

-- notification_preferences carried a `friends` key. Rename in place rather than
-- dropping it, so a reader who turned friend notifications OFF is not opted
-- back IN to the thing that replaced them.
update public.profiles
set notification_preferences =
  (notification_preferences - 'friends')
  || jsonb_build_object('follows', coalesce(notification_preferences -> 'friends', 'true'::jsonb))
where notification_preferences ? 'friends';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Visibility helpers
-- ══════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER on purpose. The check has to read the OWNER's profile row to
-- learn their shelf_visibility, and the viewer has no business being able to
-- select that row directly. Definer lets the policy ask the question without
-- granting the ability to ask it any other way.
--
-- `stable` (not `volatile`) so Postgres can cache it within a statement rather
-- than re-running it per row of a shelf — this sits in a policy that filters
-- potentially hundreds of read_books rows for one owner.
--
-- search_path is pinned because a SECURITY DEFINER function without one is how
-- you get a privilege-escalation bug.

create or replace function public.can_view_shelf(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select
    owner = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = owner
        and (
          p.shelf_visibility = 'public'
          or (
            p.shelf_visibility = 'followers'
            and auth.uid() is not null
            and exists (
              select 1 from public.user_follows f
              where f.follower_id = auth.uid()
                and f.followee_id = owner
            )
          )
        )
    );
$function$;

comment on function public.can_view_shelf(uuid) is
  'May the current session read this reader''s shelves? Own shelf always; otherwise governed by profiles.shelf_visibility. Note a follow is enough — it is not required to be mutual, which is the point of the model.';

create or replace function public.follows_me(candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.user_follows f
    where f.follower_id = candidate
      and f.followee_id = auth.uid()
  );
$function$;

grant execute on function public.can_view_shelf(uuid) to anon, authenticated, service_role;
grant execute on function public.follows_me(uuid)     to anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Lists gain a followers-only tier
-- ══════════════════════════════════════════════════════════════════════════════
--
-- lists.is_public is a boolean, and "private / followers / public" is not a
-- boolean. Rather than rewrite the fourteen places that read is_public, this
-- adds `visibility` as the source of truth and keeps is_public in sync from a
-- trigger — so every existing policy, query and function stays correct and
-- means exactly what it meant before ("is this on the open web?").
--
-- is_public is now derived. Write to visibility.

alter table public.lists
  add column if not exists visibility text not null default 'private';

update public.lists
set visibility = case when is_public then 'public' else 'private' end
where visibility = 'private' and is_public;

alter table public.lists drop constraint if exists lists_visibility_check;
alter table public.lists
  add constraint lists_visibility_check
  check (visibility in ('private', 'followers', 'public'));

comment on column public.lists.visibility is
  'private | followers | public. THE source of truth. is_public is derived from it by lists_sync_is_public and exists only so the pre-follows policies and functions keep working unchanged; never write is_public directly.';

create or replace function public.sync_list_is_public()
returns trigger
language plpgsql
as $function$
begin
  new.is_public := (new.visibility = 'public');
  return new;
end;
$function$;

drop trigger if exists lists_sync_is_public on public.lists;
create trigger lists_sync_is_public
  before insert or update on public.lists
  for each row
  execute function public.sync_list_is_public();

-- Readable to followers as well as to the owner and the public.
--
-- The existing "Anyone can read public lists" policy is left in place: policies
-- are OR-ed, so this only ever ADDS reach. Deleting it and folding both cases
-- into one policy would be tidier and is a worse idea — it would mean a window
-- during the migration where public lists were unreadable.
drop policy if exists "Followers can read followers-only lists" on public.lists;
create policy "Followers can read followers-only lists" on public.lists
  for select using (
    visibility = 'followers'
    and auth.uid() is not null
    and exists (
      select 1 from public.user_follows f
      where f.follower_id = auth.uid()
        and f.followee_id = lists.user_id
    )
  );

-- Going private drops followers — but "not public" is no longer the same as
-- "private", and the original trigger fired on the boolean. A list moving from
-- public to followers-only should KEEP its followers; that is the entire point
-- of the tier.
create or replace function public.clear_followers_on_private()
returns trigger
language plpgsql
as $function$
begin
  if new.visibility = 'private' and old.visibility <> 'private' then
    delete from public.list_followers where list_id = new.id;
  end if;
  return new;
end;
$function$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Curator requests
-- ══════════════════════════════════════════════════════════════════════════════
--
-- profiles.is_curator stays a GRANTED flag — it gates the Vault and the
-- exempt Oracle quota, so it is not something to hand out on request. This
-- table is the request, not the grant: a reader asks, and someone flips
-- is_curator by hand. No admin UI yet, deliberately. At current numbers the
-- honest tool is the SQL editor, and building an approval queue for a decision
-- made a handful of times would be building the wrong thing carefully.

create table if not exists public.curator_requests (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  message    text,
  status     text        not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint curator_requests_status_check
    check (status in ('pending', 'granted', 'denied'))
);

-- One open request per reader. Re-asking while a request is pending is not a
-- second request, it is the same one.
create unique index if not exists curator_requests_one_open
  on public.curator_requests (user_id)
  where status = 'pending';

alter table public.curator_requests enable row level security;

create policy "Read own curator requests" on public.curator_requests
  for select using (user_id = auth.uid());

create policy "Request curator as myself" on public.curator_requests
  for insert with check (user_id = auth.uid());

grant select, insert on public.curator_requests to authenticated;
grant all           on public.curator_requests to service_role;

-- Reviewing is service_role only — there is no policy letting a reader change
-- their own status, which would otherwise be a self-grant.

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Retire friendships
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Order matters: the read_books policy depends on the friend_pairs view, which
-- depends on the friendships table. Repoint the policy first, then drop
-- downward. Doing this in the other order fails, and doing it without the
-- replacement policy in place would leave read_books with no SELECT policy at
-- all — which under RLS denies everything, including the reader's own shelf.

drop policy if exists "read_books select" on public.read_books;
create policy "read_books select" on public.read_books
  for select using (public.can_view_shelf(user_id));

drop view if exists public.friend_pairs;

drop trigger if exists on_friendship_change on public.friendships;
drop function if exists public.handle_friendship_notification() cascade;
drop table if exists public.friendships cascade;

-- Any notification rows pointing at the retired relationship. Left until last
-- so a failure above rolls back with the notifications still intact.
delete from public.notifications
where type in ('friend_request', 'friend_accepted');

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. Notification types
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Drops the two friendship types and adds 'new_follower'.
--
-- NOTE, and this is a pre-existing bug this migration happens to fix:
-- 'list_updated' is inserted by the curated-lists digest (20260812150000, line
-- ~567) but was never added to this CHECK. Either the constraint was altered on
-- the live database outside migrations, or every list-follower notification has
-- been failing its insert since that feature shipped. It is in the list below
-- either way — worth confirming which, because if it is the latter then list
-- follows have never notified anyone.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type = any (array[
    'new_follower'::text,
    'club_invite'::text,
    'poll_started'::text,
    'poll_finalized'::text,
    'discussion_question'::text,
    'discussion_reply'::text,
    'announcement'::text,
    'join_request'::text,
    'join_approved'::text,
    'join_rejected'::text,
    'waitlist_promoted'::text,
    'list_updated'::text
  ]));

-- A follow notifies the followee once. Not digested: unlike a list changing,
-- this cannot fire fifty times in an evening for one reader, and "someone is
-- reading alongside you" is the one social event worth arriving on its own.
--
-- Respects notification_preferences.follows, which section 2 carried over from
-- the old `friends` key.
create or replace function public.handle_new_follower_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(
       (select (p.notification_preferences ->> 'follows')::boolean
          from public.profiles p where p.id = new.followee_id),
       true
     )
  then
    insert into public.notifications (user_id, type, actor_id)
    values (new.followee_id, 'new_follower', new.follower_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists on_new_follower on public.user_follows;
create trigger on_new_follower
  after insert on public.user_follows
  for each row
  execute function public.handle_new_follower_notification();
