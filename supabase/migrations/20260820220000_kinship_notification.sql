-- kinship_formed — the notification for a follow becoming mutual.
--
-- A new follower is a small event: one-way, costless, and it arrives in bursts.
-- A KINSHIP is not. It means two readers each independently decided the other
-- was worth following, which on this app is the closest thing to a friendship
-- that survived the model change — and unlike a follower, it cannot arrive
-- fifty times in an evening, because it takes two people.
--
-- So: new_follower notifies one person, in-app only. kinship_formed notifies
-- BOTH, and is the only social event allowed to become an email (see
-- netlify/functions/send-notification-email.js, which hard-refuses to email a
-- plain new_follower whatever the reader's preferences say).

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type = any (array[
    'new_follower'::text,
    'kinship_formed'::text,
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

-- Replaces the v0.66 handle_new_follower_notification. Same job, plus the
-- reciprocity check.
create or replace function public.handle_new_follower_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  is_mutual boolean;
begin
  select exists (
    select 1 from public.user_follows f
    where f.follower_id = new.followee_id
      and f.followee_id = new.follower_id
  ) into is_mutual;

  if is_mutual then
    -- Both sides, because a Kinship is the one event where the news is
    -- genuinely news to each of them: the person followed back just learned
    -- it is reciprocal, and the original follower never knew they had been
    -- followed back until now.
    --
    -- Preference-gated per recipient, so one reader opting out does not
    -- silence the other.
    insert into public.notifications (user_id, type, actor_id)
    select v.recipient, 'kinship_formed', v.actor
    from (values
      (new.followee_id, new.follower_id),
      (new.follower_id, new.followee_id)
    ) as v(recipient, actor)
    where coalesce(
      (select (p.notification_preferences ->> 'follows')::boolean
         from public.profiles p where p.id = v.recipient),
      true
    );
  else
    if coalesce(
         (select (p.notification_preferences ->> 'follows')::boolean
            from public.profiles p where p.id = new.followee_id),
         true
       )
    then
      insert into public.notifications (user_id, type, actor_id)
      values (new.followee_id, 'new_follower', new.follower_id);
    end if;
  end if;

  return new;
end;
$function$;

comment on function public.handle_new_follower_notification() is
  'Fires on user_follows insert. A follow that completes a mutual pair notifies BOTH readers with kinship_formed; otherwise the followee gets new_follower. Gated per recipient on notification_preferences.follows.';

-- Trigger definition is unchanged; recreated so a fresh database gets it even
-- if the v0.66 migration is replayed out of order.
drop trigger if exists on_new_follower on public.user_follows;
create trigger on_new_follower
  after insert on public.user_follows
  for each row
  execute function public.handle_new_follower_notification();
