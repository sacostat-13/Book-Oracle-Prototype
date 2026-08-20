-- read_books.updated_at — so the client can tell a stale shelf cache from a fresh one.
--
-- WHY
--
-- DataContext keeps a sessionStorage cache of the reader's whole state, and on
-- load it treats that cache as authoritative. Exactly one thing invalidates it:
-- public.catalog_meta.version, bumped by a statement trigger on public.books.
--
-- That covers changes to the CATALOGUE (the maintenance job, fixBook.mjs, a
-- merge_books call). It covers nothing about the reader's own SHELF. So a
-- change to read_books made anywhere other than the tab's own React state --
-- another tab, another device, a hand-run UPDATE in the SQL editor, a batch
-- script -- is invisible to that tab for the full 30-minute cache lifetime.
--
-- And it survives a hard refresh, because sessionStorage is designed to: it
-- dies with the tab, not with F5. Which is why "I corrected the read date and
-- the reading stats still count it in this month, even after a hard reset" is
-- a completely reasonable thing to observe while the database is correct.
--
-- WHAT THIS GIVES US
--
-- A monotonic stamp the client can compare in one cheap request, in the same
-- shape as the catalog_meta check: it decides whether the cache is USABLE and
-- never overwrites in-memory state, so it does not reintroduce the
-- background-refresh race that the no-background-refresh comment in
-- DataContext.jsx guards against.
--
-- created_at cannot do this job. Editing a read date does not create a row.

alter table public.read_books
  add column if not exists updated_at timestamptz not null default now();

comment on column public.read_books.updated_at is
  'Bumped on every update by read_books_set_updated_at. Read by the client as half of a shelf fingerprint (max(updated_at) + row count) that decides whether its sessionStorage cache is still trustworthy. Not shown anywhere in the UI.';

create or replace function public.set_read_books_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

grant all on function public.set_read_books_updated_at() to anon;
grant all on function public.set_read_books_updated_at() to authenticated;
grant all on function public.set_read_books_updated_at() to service_role;

drop trigger if exists read_books_set_updated_at on public.read_books;
create trigger read_books_set_updated_at
  before update on public.read_books
  for each row
  execute function public.set_read_books_updated_at();

-- The fingerprint query orders by this per user, so it should not seq-scan.
create index if not exists read_books_user_updated_idx
  on public.read_books (user_id, updated_at desc);

-- Existing rows all take the migration timestamp. That is fine: the stamp only
-- has to be monotonic and to change when something changes. It does not need to
-- describe history.
