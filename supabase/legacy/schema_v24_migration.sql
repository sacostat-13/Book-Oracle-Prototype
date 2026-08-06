-- schema_v24_migration.sql
-- Fix: club invite trigger used auth.uid() which is always NULL in a DB trigger
-- context (no authenticated session). Replace with NEW.added_by check so
-- self-joins via join_club_by_token are correctly skipped, and admin-added
-- invites correctly fire a notification.
--
-- IMPORTANT — email delivery requires a Supabase Database Webhook:
--   Table:  public.notifications
--   Event:  INSERT
--   URL:    https://readingoracle.com/.netlify/functions/send-notification-email
--   Header: x-webhook-secret: <value of WEBHOOK_SECRET env var in Netlify>
-- If this webhook is not configured, in-app notifications will still appear
-- but no email will be sent.
--
-- Also requires these Netlify env vars to be set:
--   RESEND_API_KEY, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

create or replace function public.handle_club_member_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_name text;
  v_actor_id  uuid;
begin
  -- Skip self-joins: when added_by is null or equals the joining user,
  -- this is a voluntary join via join link — no invite notification needed.
  -- (auth.uid() is always NULL in trigger context, so we use NEW.added_by instead.)
  if NEW.added_by is null or NEW.added_by = NEW.user_id then
    return NEW;
  end if;

  select name into v_club_name from public.book_clubs where id = NEW.club_id;

  -- Use the admin who added them as the actor
  v_actor_id := NEW.added_by;

  -- Notify the invited user
  insert into public.notifications (user_id, type, actor_id, data)
  values (
    NEW.user_id,
    'club_invite',
    v_actor_id,
    jsonb_build_object('club_id', NEW.club_id, 'club_name', v_club_name)
  )
  on conflict do nothing;

  return NEW;
end;
$$;

-- Re-create the trigger (function is already replaced above)
drop trigger if exists on_club_member_added on public.book_club_members;
create trigger on_club_member_added
  after insert on public.book_club_members
  for each row execute function public.handle_club_member_notification();
