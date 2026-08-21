-- Make the shelf-visibility check cheap, and give currently_reading one at all.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Why the reader profile was slow
-- ══════════════════════════════════════════════════════════════════════════════
--
-- v0.66 wrote the read_books SELECT policy as:
--
--     using (public.can_view_shelf(user_id))
--
-- which reads well and performs badly, for a reason that is not obvious:
-- **a SECURITY DEFINER function is never inlined by the planner.** An ordinary
-- `stable` SQL function can be folded into the surrounding query and turned
-- into a join; a definer one cannot, because its whole purpose is to run under
-- different privileges. So it stays an opaque call.
--
-- And its argument is a COLUMN, not a constant. The planner therefore has to
-- assume the answer varies per row, and calls it once for every candidate row
-- of read_books — each call running two correlated subqueries. Opening the
-- profile of someone with a few hundred books meant a few hundred function
-- invocations before the first byte came back.
--
-- Marking it `stable` did not save us: that permits caching within a statement
-- for *identical arguments*, which the planner cannot prove here.
--
-- The fix is to inline the predicate so the planner can see it and turn the
-- lookups into semi-joins. That is only safe if the viewer is allowed to read
-- profiles.shelf_visibility directly — and they are: public.profiles already
-- carries "Anyone can read curator flag" (FOR SELECT USING (true)) and
-- "public profile read". Inlining leaks nothing that was not already readable;
-- the definer wrapper was buying us nothing but the cost of not being inlined.
--
-- auth.uid() is wrapped in a scalar subselect so it is evaluated once per
-- statement rather than per row — the standard Supabase RLS idiom, and the
-- other half of the win.

drop policy if exists "read_books select" on public.read_books;
create policy "read_books select" on public.read_books
  for select using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = read_books.user_id
        and (
          p.shelf_visibility = 'public'
          or (
            p.shelf_visibility = 'followers'
            and exists (
              select 1
              from public.user_follows f
              where f.follower_id = (select auth.uid())
                and f.followee_id = read_books.user_id
            )
          )
        )
    )
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. currently_reading was never readable by anyone else — including friends
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Its only policy is "Users can manage their own currently_reading", scoped to
-- auth.uid() = user_id, with no SELECT policy beside it. So the "Currently
-- reading" section on another reader's profile has returned an empty array
-- since the day it was written — under friendships too. It failed silently and
-- rendered as "nothing on the shelf" rather than as an error, which is why it
-- was never noticed.
--
-- Same rule as read_books, written the same way and for the same reasons.
create policy "currently_reading select" on public.currently_reading
  for select using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = currently_reading.user_id
        and (
          p.shelf_visibility = 'public'
          or (
            p.shelf_visibility = 'followers'
            and exists (
              select 1
              from public.user_follows f
              where f.follower_id = (select auth.uid())
                and f.followee_id = currently_reading.user_id
            )
          )
        )
    )
  );

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. can_view_shelf() stays, but it is no longer in the hot path
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Still useful for a one-off question about a single reader ("may I see THIS
-- profile's shelves?"), where it is called once and the definer wrapper costs
-- nothing. It must not go back into a row-level policy.

comment on function public.can_view_shelf(uuid) is
  'May the current session read this reader''s shelves? For ONE-OFF checks about a single reader. Do NOT use in a row-level policy: SECURITY DEFINER blocks planner inlining, so a policy calling this evaluates it once per row. The read_books and currently_reading policies inline the same predicate instead — see 20260821090000_shelf_policy_perf.sql.';

-- The EXISTS above probes user_follows by (follower_id, followee_id), which the
-- primary key already covers, and profiles by id, which is its PK. No new
-- indexes needed — worth stating so the next person does not go looking.
