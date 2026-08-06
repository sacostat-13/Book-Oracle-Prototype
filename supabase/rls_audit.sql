-- rls_audit.sql (v0.39 Security & QA — audit finding H2)
--
-- The club/list/discussion tables (book_clubs, book_club_members,
-- book_club_sessions, session_comments, session_questions, club_polls,
-- poll_options, lists, list_items, book_club_genres) were created in the
-- Supabase dashboard and have no committed DDL, so their RLS state can't be
-- verified from the repo. Run each section in the Supabase SQL Editor and
-- act on anything flagged.
--
-- After fixing, export the real DDL and commit it so this never drifts again:
--   Dashboard → Database → click table → "..." → "View definition", or
--   `supabase db dump --schema public` with the CLI.

-- ── A. Tables with RLS DISABLED (worst case: fully open to the anon key) ──────
select relname as table_name
from pg_class
where relkind = 'r'
  and relnamespace = 'public'::regnamespace
  and not relrowsecurity
order by relname;
-- Expected result: ZERO rows. Any table listed here is readable AND writable
-- by anyone with the public anon key. Fix immediately:
--   alter table public.<name> enable row level security;
-- ...and then add policies (see section D), or the app will lose access.

-- ── B. Tables with RLS enabled but NO policies (deny-all — app breakage) ─────
select c.relname as table_name
from pg_class c
where c.relkind = 'r'
  and c.relnamespace = 'public'::regnamespace
  and c.relrowsecurity
  and not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname)
order by c.relname;
-- profile_billing (v28) is SUPPOSED to be here. Anything else listed is
-- client-inaccessible — either intentional (RPC-only tables) or a bug.

-- ── C. Full policy inventory for the unverified social tables ─────────────────
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'book_clubs', 'book_club_members', 'book_club_sessions',
    'session_comments', 'session_questions', 'club_polls', 'poll_options',
    'lists', 'list_items', 'book_club_genres', 'book_club_moods',
    'club_join_requests'
  )
order by tablename, policyname;
-- Review line by line. Red flags:
--   * cmd = ALL or INSERT/UPDATE/DELETE with qual/with_check = 'true'
--     → anyone can write anything.
--   * SELECT with qual = 'true' on member-scoped content
--     (session_comments, session_questions, poll votes, private lists)
--     → cross-user reads. Club content should require club membership
--     (the is_club_member(club_id) SECURITY DEFINER helper), and private
--     clubs/lists should not be visible to non-members at all.
--   * Policies missing entirely for a cmd the app performs
--     (e.g. members can comment → INSERT policy on session_comments must
--     exist and check membership + user_id = auth.uid()).

-- ── D. Reference policy shapes (adapt to the real column names) ───────────────
-- Membership-scoped read:
--   create policy "members read sessions" on public.book_club_sessions
--     for select to authenticated
--     using (public.is_club_member(club_id));
--
-- Own-row writes inside a club:
--   create policy "members comment" on public.session_comments
--     for insert to authenticated
--     with check (user_id = auth.uid() and public.is_club_member(
--       (select club_id from public.book_club_sessions s where s.id = session_id)));
--
-- Owner-only private lists, public lists readable:
--   create policy "lists read" on public.lists
--     for select to authenticated
--     using (user_id = auth.uid() or is_public);

-- ── E. Any remaining SECURITY DEFINER views (should be zero after v28) ───────
select c.relname as view_name
from pg_class c
where c.relkind = 'v'
  and c.relnamespace = 'public'::regnamespace
  and coalesce((select option_value
                from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') <> 'true'
order by c.relname;

-- ── F. SECURITY DEFINER functions without a pinned search_path ────────────────
-- A definer function with a mutable search_path can be hijacked via schema
-- shadowing. Everything here should show 'search_path=public' in config.
select p.proname, p.prosecdef, p.proconfig
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosecdef
  and (p.proconfig is null
       or not exists (select 1 from unnest(p.proconfig) cfg
                      where cfg like 'search_path=%'))
order by p.proname;
-- Fix: alter function public.<name>(<args>) set search_path = public;
