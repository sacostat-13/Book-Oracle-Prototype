-- schema_v43: catalog version stamp, so a client cache can tell it is out of date.
--
-- THE PROBLEM
-- -----------
-- DataContext caches the whole user state in sessionStorage and treats it as
-- authoritative, deliberately:
--
--     supabaseLoadedRef.current = true; // treat cache as authoritative
--     // No background refresh — mutations keep cache fresh via saveSessionCache
--     // in the persist effect. This avoids race conditions where a stale
--     // Supabase read overwrites in-memory mutations.
--
-- That reasoning is sound for changes the APP makes. It breaks for changes made from
-- OUTSIDE the app — the weekly maintenance job, fixBook.mjs, a merge_books() call. The
-- client keeps serving pre-change data for the whole browser session (or 30 minutes,
-- whichever ends first).
--
-- For an ISBN top-up that is harmless: the link is only read when clicked. For a MERGE it
-- is not — the cache still holds a book_id that no longer exists, so opening that book
-- hits a deleted row. That is a real error, not stale text, which is why this matters
-- before 1.0.
--
-- THE FIX
-- -------
-- One integer that changes whenever public.books changes. The client caches it alongside
-- the state and re-checks just that integer on load — one tiny query, not a full refetch,
-- so it does NOT reintroduce the race the comment above warns about. A version check
-- overwrites nothing; it only decides whether the cache is still usable.
--
-- The trigger is FOR EACH STATEMENT, not FOR EACH ROW: a 2,500-book backfill bumps the
-- counter once per statement rather than 2,500 times.

begin;

create table if not exists public.catalog_meta (
  id         boolean primary key default true check (id),  -- single-row table
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.catalog_meta (id) values (true) on conflict (id) do nothing;

-- Readable by anyone signed in — it is a bare integer, no user data. No write policy:
-- only the trigger (SECURITY DEFINER) and service_role touch it.
alter table public.catalog_meta enable row level security;
drop policy if exists "Anyone can read catalog version" on public.catalog_meta;
create policy "Anyone can read catalog version"
  on public.catalog_meta for select
  using (true);

create or replace function public.bump_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.catalog_meta
  set version = version + 1, updated_at = now()
  where id = true;
  return null;   -- statement-level triggers ignore the return value
end;
$$;

drop trigger if exists books_bump_catalog_version on public.books;
create trigger books_bump_catalog_version
  after insert or update or delete on public.books
  for each statement
  execute function public.bump_catalog_version();

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
--   select * from public.catalog_meta;
--
--   -- bump it and confirm the counter moves:
--   update public.books set updated_at = updated_at where id = (select id from public.books limit 1);
--   select * from public.catalog_meta;
--
-- The client reads this with:
--   supabase.from('catalog_meta').select('version').single()
--
-- ===========================================================================
-- TROUBLESHOOTING A STALE CLIENT (the reason this exists)
-- ===========================================================================
-- If a user reports seeing a book that was merged away, or not seeing a fix:
--
--   1. Ask for the value of `catalogVersion` in their cached payload:
--        JSON.parse(sessionStorage.getItem('wishlist_oracle_session_v1')).catalogVersion
--   2. Compare to  select version from public.catalog_meta;
--   3. If they differ, the invalidation did not fire — that is a bug in DataContext,
--      not in the data. If they match, the data really is what they are seeing.
--
-- Manual escape hatch, still valid:
--   sessionStorage.clear(); location.reload();
