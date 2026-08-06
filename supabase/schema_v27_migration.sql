-- ============================================================
-- v0.42-ish: Dashboard Book Clubs widget extension
-- ============================================================
-- The dashboard's ClubsWidget previously rendered only name + member count
-- from the lightweight `state.clubs` index (no sessions/members — see v0.28
-- notes in DataContext.jsx). Showing current session + book + who's reading
-- along, per the updated design spec, needs that data — but calling
-- get_club_detail() once per club on the dashboard would be an N+1 fan-out.
--
-- This RPC aggregates everything the widget needs for ALL of the caller's
-- clubs in one round trip: member count, the "current" session (active >
-- most recent past > soonest upcoming), that session's book, and up to 4
-- member avatars (admins first).
--
-- NOTE: assumes `book_club_members` has a `created_at` column, consistent
-- with the created_at convention used elsewhere in this schema. If that
-- column doesn't exist on your actual table, swap the ordering below to
-- whatever timestamp/ordering column you do have (or drop the ordering —
-- role-admin-first will still work on its own).

create or replace function public.get_dashboard_clubs_summary()
returns table (
  id                   uuid,
  name                 text,
  member_count         bigint,
  session_number       bigint,
  session_status       text,   -- 'active' | 'past' | 'upcoming' | null (no sessions yet)
  current_book_title   text,
  current_book_author  text,
  current_book_cover   text,
  member_avatars       jsonb   -- [{display_name, avatar_url}, ...] — up to 4, admins first
) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return query
  with my_clubs as (
    select bc.id, bc.name
    from public.book_clubs bc
    join public.book_club_members m on m.club_id = bc.id
    where m.user_id = auth.uid()
  ),
  counted as (
    select
      c.*,
      (select count(*) from public.book_club_members m where m.club_id = c.id) as member_count
    from my_clubs c
  ),
  numbered_sessions as (
    select
      bcs.id, bcs.club_id, bcs.starts_at, bcs.ends_at, bcs.book_id,
      row_number() over (partition by bcs.club_id order by bcs.starts_at asc) as session_number
    from public.book_club_sessions bcs
  ),
  chosen as (
    select distinct on (ns.club_id)
      ns.club_id, ns.session_number, ns.book_id,
      case
        when now() between ns.starts_at and ns.ends_at then 'active'
        when ns.ends_at < now()                         then 'past'
        else 'upcoming'
      end as session_status
    from numbered_sessions ns
    order by
      ns.club_id,
      case
        when now() between ns.starts_at and ns.ends_at then 0  -- active wins
        when ns.ends_at < now()                         then 1  -- else most recent past
        else 2                                                  -- else soonest upcoming
      end,
      case when ns.ends_at < now() then ns.ends_at end desc,
      case when ns.ends_at >= now() then ns.starts_at end asc
  )
  select
    c.id, c.name, c.member_count,
    ch.session_number, ch.session_status,
    bk.title, bk.author, bk.cover_url,
    coalesce((
      select jsonb_agg(jsonb_build_object('display_name', p.display_name, 'avatar_url', p.avatar_url)
               order by mm.is_admin desc, mm.created_at asc)
      from (
        select m.user_id, (m.role = 'admin') as is_admin, m.created_at
        from public.book_club_members m
        where m.club_id = c.id
        order by is_admin desc, m.created_at asc
        limit 4
      ) mm
      join public.profiles p on p.id = mm.user_id
    ), '[]'::jsonb) as member_avatars
  from counted c
  left join chosen ch on ch.club_id = c.id
  left join public.books bk on bk.id = ch.book_id
  order by c.name;
end;
$$;

grant execute on function public.get_dashboard_clubs_summary() to authenticated;
