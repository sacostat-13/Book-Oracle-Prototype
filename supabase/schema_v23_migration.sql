-- schema_v23_migration.sql
-- v0.37: Extended notifications, announcements, notification preferences
--
-- Changes:
--   1. Expand notifications.type constraint to include all new types
--   2. Add announcements table (admin broadcast)
--   3. Replace email_notifications boolean with notification_preferences JSONB
--   4. DB triggers for club events, polls, discussion, replies

-- ── 1. Expand notification types ─────────────────────────────────────────────

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    -- Friends (existing)
    'friend_request',
    'friend_accepted',
    -- Book clubs
    'club_invite',
    -- Polls
    'poll_started',
    'poll_finalized',
    -- Discussions
    'discussion_question',
    'discussion_reply',
    -- Announcements
    'announcement'
  ));

-- ── 2. Announcements table ────────────────────────────────────────────────────

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table public.announcements enable row level security;

-- Anyone authenticated can read announcements
drop policy if exists "announcements readable" on public.announcements;
create policy "announcements readable"
  on public.announcements
  for select using (auth.uid() is not null);

-- Only service role can insert (via admin function)
-- No client INSERT policy — announcements are created server-side only

-- ── 3. notification_preferences JSONB (replaces email_notifications boolean) ──
--
-- Structure:
-- {
--   "book_club":    true,   -- club invites, poll events, discussion questions
--   "friends":      true,   -- friend requests and accepts
--   "announcements": true,  -- site-wide admin announcements (always true, shown greyed out)
--   "email":        true    -- master email toggle (replaces email_notifications column)
-- }

alter table public.profiles
  add column if not exists notification_preferences jsonb
    not null default '{
      "book_club": true,
      "friends": true,
      "announcements": true,
      "email": true
    }'::jsonb;

-- Migrate existing email_notifications value into the new JSONB field
update public.profiles
set notification_preferences = jsonb_build_object(
  'book_club',     true,
  'friends',       true,
  'announcements', true,
  'email',         coalesce(email_notifications, true)
)
where notification_preferences = '{
      "book_club": true,
      "friends": true,
      "announcements": true,
      "email": true
    }'::jsonb;

-- Keep email_notifications column for now (backward compat with send-notification-email.js)
-- We'll read notification_preferences in the new email function

-- ── 4. Trigger: club invite notification ─────────────────────────────────────
--
-- Fires when a user joins a club (INSERT on book_club_members).
-- Notifies the club admin that someone joined — and notifies the new member
-- if they were directly invited (future: invite_id on members row).
-- For now: notify new member when they're added by someone other than themselves.

create or replace function public.handle_club_member_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_name text;
  v_admin_id  uuid;
begin
  -- Only fire when someone else adds the user (invite flow)
  -- Self-join (user_id = added_by or no added_by) is handled by join_club_by_token
  if NEW.user_id = auth.uid() then
    return NEW;
  end if;

  select name into v_club_name from public.book_clubs where id = NEW.club_id;
  select user_id into v_admin_id from public.book_club_members
    where club_id = NEW.club_id and role = 'admin' limit 1;

  -- Notify the invited user
  insert into public.notifications (user_id, type, actor_id, data)
  values (
    NEW.user_id,
    'club_invite',
    coalesce(v_admin_id, NEW.user_id),
    jsonb_build_object('club_id', NEW.club_id, 'club_name', v_club_name)
  )
  on conflict do nothing;

  return NEW;
end;
$$;

drop trigger if exists on_club_member_added on public.book_club_members;
create trigger on_club_member_added
  after insert on public.book_club_members
  for each row execute function public.handle_club_member_notification();

-- ── 5. Trigger: poll started + finalized ─────────────────────────────────────

create or replace function public.handle_poll_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_name   text;
  v_member_id   uuid;
  v_question    text;
  v_winner      text;
begin
  select name into v_club_name from public.book_clubs where id = NEW.club_id;

  -- Poll created → notify all club members
  if TG_OP = 'INSERT' then
    v_question := NEW.question;
    for v_member_id in
      select user_id from public.book_club_members where club_id = NEW.club_id
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (
        v_member_id, 'poll_started', NEW.created_by,
        jsonb_build_object(
          'club_id',   NEW.club_id,
          'club_name', v_club_name,
          'poll_id',   NEW.id,
          'question',  v_question
        )
      )
      on conflict do nothing;
    end loop;
  end if;

  -- Poll closed (status changes to 'closed') → notify all members with winner
  if TG_OP = 'UPDATE' and NEW.status = 'closed' and OLD.status != 'closed' then
    -- Find the winning option label
    select label into v_winner
    from public.poll_options
    where poll_id = NEW.id
    order by votes_count desc
    limit 1;

    for v_member_id in
      select user_id from public.book_club_members where club_id = NEW.club_id
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (
        v_member_id, 'poll_finalized', NEW.created_by,
        jsonb_build_object(
          'club_id',   NEW.club_id,
          'club_name', v_club_name,
          'poll_id',   NEW.id,
          'winner',    v_winner
        )
      )
      on conflict do nothing;
    end loop;
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_poll_change on public.club_polls;
create trigger on_poll_change
  after insert or update on public.club_polls
  for each row execute function public.handle_poll_notification();

-- ── 6. Trigger: new discussion question ──────────────────────────────────────

create or replace function public.handle_discussion_question_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_id   uuid;
  v_club_name text;
  v_member_id uuid;
  v_session_title text;
begin
  -- Get club_id from the session
  select s.club_id, b.title, bcs.title
  into v_club_id, v_session_title, v_session_title
  from public.book_club_sessions bcs
  left join public.books b on b.id = bcs.book_id
  where bcs.id = NEW.session_id
  limit 1;

  if v_club_id is null then return NEW; end if;

  select name into v_club_name from public.book_clubs where id = v_club_id;

  for v_member_id in
    select user_id from public.book_club_members where club_id = v_club_id
  loop
    -- Don't notify the person who posted the question
    if v_member_id != NEW.created_by then
      insert into public.notifications (user_id, type, actor_id, data)
      values (
        v_member_id, 'discussion_question', NEW.created_by,
        jsonb_build_object(
          'club_id',      v_club_id,
          'club_name',    v_club_name,
          'session_id',   NEW.session_id,
          'question',     NEW.question
        )
      )
      on conflict do nothing;
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists on_discussion_question on public.session_questions;
create trigger on_discussion_question
  after insert on public.session_questions
  for each row execute function public.handle_discussion_question_notification();

-- ── 7. Trigger: reply on a thread you started ────────────────────────────────

create or replace function public.handle_discussion_reply_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_thread_owner uuid;
  v_question     text;
  v_session_id   uuid;
  v_club_id      uuid;
  v_club_name    text;
begin
  -- Only notify on replies (parent_id is set), not top-level answers
  if NEW.parent_id is null then return NEW; end if;

  -- Find the owner of the parent comment/answer
  select user_id into v_thread_owner
  from public.session_comments
  where id = NEW.parent_id;

  if v_thread_owner is null or v_thread_owner = NEW.user_id then
    return NEW;
  end if;

  -- Get context
  select sq.question, sq.session_id
  into v_question, v_session_id
  from public.session_questions sq
  where sq.id = NEW.question_id;

  select s.club_id into v_club_id
  from public.book_club_sessions s where s.id = v_session_id;

  select name into v_club_name
  from public.book_clubs where id = v_club_id;

  insert into public.notifications (user_id, type, actor_id, data)
  values (
    v_thread_owner, 'discussion_reply', NEW.user_id,
    jsonb_build_object(
      'club_id',    v_club_id,
      'club_name',  v_club_name,
      'session_id', v_session_id,
      'question',   v_question,
      'preview',    left(NEW.body, 120)
    )
  );

  return NEW;
end;
$$;

drop trigger if exists on_discussion_reply on public.session_comments;
create trigger on_discussion_reply
  after insert on public.session_comments
  for each row execute function public.handle_discussion_reply_notification();

-- ── 8. RPC: broadcast_announcement (service role only) ───────────────────────
--
-- Creates an announcement row and inserts one notification per user.
-- Called from a future admin panel or directly from Supabase SQL editor.

create or replace function public.broadcast_announcement(
  p_title text,
  p_body  text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement_id uuid;
  v_user_id         uuid;
begin
  insert into public.announcements (title, body, created_by)
  values (p_title, p_body, p_admin_id)
  returning id into v_announcement_id;

  -- Fan out to all users
  for v_user_id in select id from public.profiles loop
    insert into public.notifications (user_id, type, actor_id, data)
    values (
      v_user_id, 'announcement', p_admin_id,
      jsonb_build_object(
        'announcement_id', v_announcement_id,
        'title',           p_title,
        'preview',         left(p_body, 200)
      )
    );
  end loop;

  return v_announcement_id;
end;
$$;

-- Only authenticated users can call it (actual admin check happens in the app layer)
grant execute on function public.broadcast_announcement(text, text, uuid) to authenticated;
