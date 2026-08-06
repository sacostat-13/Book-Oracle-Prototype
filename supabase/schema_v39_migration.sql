-- schema_v39: merge_books() — fold a duplicate book row into a canonical one.
--
-- WHY
-- ---
-- Manually-added rows ("a darker act", "-when i sing, mountains dance") are titles a user
-- typed when lookup failed. Correcting them to the real title recomputes normalized_key,
-- which is UNIQUE — so whenever the correct book already exists in the catalog, the
-- correction is not an update but a merge: user list entries pointing at the manual row
-- have to be repointed at the canonical one before it can go.
--
-- Called by batch-scripts/curateManualBooks.mjs --apply-titles.
--
-- DESIGN NOTES
-- ------------
-- 1. References are discovered from pg_constraint at runtime, not hardcoded. book_id FKs
--    are spread across a dozen migrations (wishlist_items, read_books, currently_reading,
--    book_categories, user_book_categories, club sessions, accomplishments…) and a list
--    written today would silently rot the next time a table is added. Anything with a FK
--    to books(id) is handled automatically.
--
-- 2. Repointing is row-by-row inside a savepoint that catches unique_violation. Several
--    of these tables carry unique(user_id, book_id) — if a user holds BOTH the manual row
--    and the canonical row, the update collides. Catching per row and deleting the
--    now-redundant duplicate handles every such constraint without this function needing
--    to know which columns each one covers.
--
-- 3. Everything is logged to book_merge_log, including the full JSON of the deleted row,
--    so a bad merge can be reconstructed.

begin;

create table if not exists public.book_merge_log (
  id            bigserial primary key,
  merged_at     timestamptz not null default now(),
  from_book_id  uuid not null,
  to_book_id    uuid not null,
  from_snapshot jsonb not null,       -- the deleted row, in full
  refs_moved    jsonb not null default '{}'::jsonb,
  refs_deduped  jsonb not null default '{}'::jsonb
);

-- Same reasoning as books_isbn_backup_v38: a new public-schema table is exposed through
-- PostgREST, and this one contains user-linked history. RLS on, no policies — postgres
-- and service_role reach it, nobody else.
alter table public.book_merge_log enable row level security;

create or replace function public.merge_books(_from uuid, _to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _fk        record;
  _row       record;
  _snapshot  jsonb;
  _moved     jsonb := '{}'::jsonb;
  _deduped   jsonb := '{}'::jsonb;
  _m         int;
  _d         int;
  _sql       text;
begin
  if _from is null or _to is null then
    raise exception 'merge_books: both ids are required';
  end if;
  if _from = _to then
    raise exception 'merge_books: refusing to merge a row into itself (%)', _from;
  end if;

  select to_jsonb(b) into _snapshot from public.books b where b.id = _from;
  if _snapshot is null then
    raise exception 'merge_books: source book % not found', _from;
  end if;
  if not exists (select 1 from public.books where id = _to) then
    raise exception 'merge_books: target book % not found', _to;
  end if;

  -- Every column in every table holding a foreign key to books(id).
  for _fk in
    select
      src_ns.nspname  as schema_name,
      src_tbl.relname as table_name,
      src_col.attname as column_name
    from pg_constraint c
    join pg_class     src_tbl on src_tbl.oid = c.conrelid
    join pg_namespace src_ns  on src_ns.oid  = src_tbl.relnamespace
    join pg_class     tgt_tbl on tgt_tbl.oid = c.confrelid
    join pg_attribute src_col on src_col.attrelid = c.conrelid
                             and src_col.attnum   = c.conkey[1]
    where c.contype = 'f'
      and tgt_tbl.relname = 'books'
      and array_length(c.conkey, 1) = 1
  loop
    _m := 0;
    _d := 0;

    -- Row-by-row so a unique_violation kills only the offending row, not the merge.
    _sql := format('select ctid from %I.%I where %I = $1',
                   _fk.schema_name, _fk.table_name, _fk.column_name);
    for _row in execute _sql using _from loop
      begin
        execute format('update %I.%I set %I = $1 where ctid = $2',
                       _fk.schema_name, _fk.table_name, _fk.column_name)
          using _to, _row.ctid;
        _m := _m + 1;
      exception when unique_violation then
        -- The user already has the canonical book here; this row is redundant.
        execute format('delete from %I.%I where ctid = $1',
                       _fk.schema_name, _fk.table_name)
          using _row.ctid;
        _d := _d + 1;
      end;
    end loop;

    if _m > 0 then
      _moved := _moved || jsonb_build_object(_fk.table_name || '.' || _fk.column_name, _m);
    end if;
    if _d > 0 then
      _deduped := _deduped || jsonb_build_object(_fk.table_name || '.' || _fk.column_name, _d);
    end if;
  end loop;

  delete from public.books where id = _from;

  insert into public.book_merge_log (from_book_id, to_book_id, from_snapshot, refs_moved, refs_deduped)
  values (_from, _to, _snapshot, _moved, _deduped);

  return jsonb_build_object(
    'from', _from, 'to', _to,
    'refs_moved', _moved, 'refs_deduped', _deduped
  );
end;
$$;

-- Service role only. This deletes rows and rewrites user references, so it must never be
-- reachable from the client. Postgres grants EXECUTE to PUBLIC on new functions by
-- default, which would otherwise hand every logged-in user a way to delete catalog rows —
-- revoke first, then grant back narrowly. The explicit service_role grant matters: the
-- revoke strips the PUBLIC grant it would otherwise have inherited, so without this line
-- the backfill script's own RPC call fails with "permission denied for function".
revoke all on function public.merge_books(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_books(uuid, uuid) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- INSPECT what a merge did:
--   select merged_at, from_book_id, to_book_id, refs_moved, refs_deduped
--   from public.book_merge_log order by merged_at desc;
--
-- RECOVER a deleted row (references are NOT restored — read refs_moved first):
--   insert into public.books
--   select * from jsonb_populate_record(null::public.books,
--     (select from_snapshot from public.book_merge_log where id = <log id>));
-- ---------------------------------------------------------------------------
