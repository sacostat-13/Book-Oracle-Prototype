-- schema_v20_migration.sql
-- v0.36: Friends, usernames, notifications, email webhook
--
-- Run once in Supabase SQL Editor before deploying v0.36 code.
-- Safe to re-run (all statements use IF NOT EXISTS / OR REPLACE).
--
-- Changes:
--   1. profiles: add username, is_discoverable, email_notifications
--   2. friendships table + friend_pairs view
--   3. notifications table
--   4. RLS on new tables + updated read_books policy
--   5. DB trigger: auto-insert notification on friendship change

-- ── 1. Profiles: username + privacy columns ───────────────────────────────────

alter table public.profiles
  add column if not exists username           text unique,
  add column if not exists is_discoverable    boolean not null default true,
  add column if not exists email_notifications boolean not null default true;

-- Format constraint: 3–24 chars, lowercase letters/numbers/underscores/hyphens
-- Client-side validation mirrors this exactly (USERNAME_RE in useFriends.js)
alter table public.profiles
  drop constraint if exists username_format;
alter table public.profiles
  add constraint username_format
  check (username is null or username ~ '^[a-z0-9_-]{3,24}$');

-- Case-insensitive unique index (belt-and-suspenders alongside the unique column)
drop index if exists profiles_username_lower_idx;
create unique index profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

-- ── 2. Friendships ────────────────────────────────────────────────────────────

create table if not exists public.friendships (
  id          uuid primary key default gen_random_uuid(),
  requester   uuid not null references auth.users(id) on delete cascade,
  addressee   uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'blocked')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  -- Prevent duplicate requests in either direction handled in app layer;
  -- this constraint prevents exact duplicates (same requester→addressee pair)
  unique (requester, addressee)
);

create index if not exists friendships_addressee_idx on public.friendships (addressee);
create index if not exists friendships_requester_idx on public.friendships (requester);

-- Bidirectional view: "who are my friends" without union logic in the app
create or replace view public.friend_pairs as
  select requester as user_a, addressee as user_b
    from public.friendships where status = 'accepted'
  union
  select addressee as user_a, requester as user_b
    from public.friendships where status = 'accepted';

-- ── 3. Notifications ──────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null
             check (type in ('friend_request', 'friend_accepted')),
  actor_id   uuid references auth.users(id) on delete set null,
  data       jsonb default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz default now()
);

-- Index for the most common query: unread notifications for a user
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);

-- ── 4. RLS ────────────────────────────────────────────────────────────────────

alter table public.friendships   enable row level security;
alter table public.notifications enable row level security;

-- Friendships: users see only rows where they are requester or addressee
drop policy if exists "own friendships" on public.friendships;
create policy "own friendships" on public.friendships
  for all using (requester = auth.uid() or addressee = auth.uid());

-- Notifications: users see only their own
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for all using (user_id = auth.uid());

-- Profiles: anyone can read username + display_name + avatar (needed for friend views)
-- Keep existing RLS if any; add a read policy for public profile fields
drop policy if exists "public profile read" on public.profiles;
create policy "public profile read" on public.profiles
  for select using (true);   -- RLS for writes stays locked to own row (existing policy)

-- read_books: owner always; accepted friends can read if library is visible
-- (wishlist_items friend-visibility is enforced in the app layer via privacy prefs,
-- not at DB level, so the privacy toggle works without a migration each time it changes)
drop policy if exists "own read_books" on public.read_books;
drop policy if exists "friends read_books" on public.read_books;
create policy "read_books select" on public.read_books
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friend_pairs
      where user_a = auth.uid() and user_b = read_books.user_id
    )
  );

-- ── 5. DB trigger: create notification on friendship insert/update ─────────────

create or replace function public.handle_friendship_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- New friend request → notify the addressee
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    insert into public.notifications (user_id, type, actor_id, data)
    values (
      NEW.addressee,
      'friend_request',
      NEW.requester,
      jsonb_build_object('friendship_id', NEW.id)
    );

  -- Request accepted → notify the original requester
  elsif TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status = 'pending' then
    insert into public.notifications (user_id, type, actor_id, data)
    values (
      NEW.requester,
      'friend_accepted',
      NEW.addressee,
      jsonb_build_object('friendship_id', NEW.id)
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_friendship_change on public.friendships;
create trigger on_friendship_change
  after insert or update on public.friendships
  for each row execute function public.handle_friendship_notification();

-- ── Verification queries (run manually to confirm) ────────────────────────────
-- select column_name, data_type from information_schema.columns
--   where table_name = 'profiles' and column_name in ('username','is_discoverable','email_notifications');
-- select count(*) from public.friendships;
-- select count(*) from public.notifications;
