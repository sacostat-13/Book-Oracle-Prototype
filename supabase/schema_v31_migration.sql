-- ============================================================================
-- schema_v31 — Repair upsert_book / upsert_series overloads
--              (fixes RPC 404 on add / mark-read, then the "verified" 42703)
-- ============================================================================
-- Two problems, one migration:
--
--  1) 404 (PGRST202): the client calls upsert_book with the v0.14 arg set
--     (`_status` + `_verified_source`), but prod carried only older overloads,
--     and several stray copies at that (so a plain GRANT was "not unique").
--
--  2) 42703 `column "verified" ... does not exist`: the v6-era function bodies
--     still wrote the deprecated `verified` boolean, but the live books/series
--     tables dropped it in favour of `status` (+ verified_at/by/source).
--
-- Fix: dynamically drop EVERY overload of both functions, then create the one
-- canonical definition that writes ONLY the columns that exist on prod
-- (status, verified_source, verified_at, verified_by — no `verified`). The
-- `_verified` PARAMETER is kept for back-compat but is only used to derive
-- status when `_status` is null; it is never written to a column.
-- Idempotent; safe to run repeatedly. No table changes.
-- ============================================================================

-- 1) Drop every existing overload of both functions, whatever their signatures.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('upsert_book', 'upsert_series')
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig || ';';
  END LOOP;
END
$do$;

-- 2) Canonical upsert_series. Writes status/verified_source/verified_at/
--    verified_by — NOT `verified`.
CREATE OR REPLACE FUNCTION public.upsert_series(
  _name text,
  _author text default null,
  _total_books int default null,
  _publication_status text default 'unknown',
  _source text default 'user_manual',
  _hardcover_id bigint default null,
  _description text default null,
  _verified boolean default false,                  -- DEPRECATED: derives _status only
  _metadata jsonb default '{}'::jsonb,
  _status text default null,                        -- review status
  _verified_source text default null                -- 'curated_seed' | 'oracle' | 'admin'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _norm text;
  _id uuid;
  _existing record;
  _resolved_status text;
begin
  if _name is null or length(trim(_name)) = 0 then
    raise exception 'series name is required';
  end if;
  _norm := normalize_series_name(_name);
  if length(_norm) = 0 then
    raise exception 'series name normalizes to empty string';
  end if;

  if _status is not null then
    _resolved_status := _status;
  elsif _verified is true then
    _resolved_status := 'verified';
  else
    _resolved_status := 'unreviewed';
  end if;

  select * into _existing from series where normalized_name = _norm limit 1;
  if found then
    update series set
      author             = coalesce(_existing.author, _author),
      total_books        = coalesce(_existing.total_books, _total_books),
      publication_status = case when _existing.publication_status = 'unknown'
                                then coalesce(_publication_status, 'unknown')
                                else _existing.publication_status end,
      hardcover_id       = coalesce(_existing.hardcover_id, _hardcover_id),
      description        = coalesce(_existing.description, _description),
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into series (
    name, normalized_name, author, total_books, publication_status,
    source, hardcover_id, description,
    status, verified_source, verified_at, verified_by,
    metadata, created_by
  ) values (
    _name, _norm, _author, _total_books, coalesce(_publication_status, 'unknown'),
    coalesce(_source, 'user_manual'), _hardcover_id, _description,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;

-- 3) Canonical upsert_book. Writes status/verified_source/verified_at/
--    verified_by — NOT `verified`. Existing-row "don't overwrite curated
--    fields" test now keys off status='verified' instead of the old boolean.
CREATE OR REPLACE FUNCTION public.upsert_book(
  _title text,
  _author text,
  _isbn text default null,
  _hardcover_id bigint default null,
  _series_name text default null,
  _series_position numeric default null,
  _pages int default null,
  _description text default null,
  _cover_url text default null,
  _genre text default null,
  _complexity int default null,
  _depth int default null,
  _source text default 'user_manual',
  _verified boolean default false,                  -- DEPRECATED: derives _status only
  _metadata jsonb default '{}'::jsonb,
  _series_id uuid default null,
  _series_source text default null,
  _status text default null,                        -- review status
  _verified_source text default null                -- 'curated_seed' | 'oracle' | 'admin'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _key text;
  _id uuid;
  _existing record;
  _resolved_series_id uuid := _series_id;
  _resolved_status text;
begin
  if _title is null or length(trim(_title)) = 0 then
    raise exception 'title is required';
  end if;

  if _status is not null then
    _resolved_status := _status;
  elsif _verified is true then
    _resolved_status := 'verified';
  else
    _resolved_status := 'unreviewed';
  end if;

  if _resolved_series_id is null and _series_name is not null and length(trim(_series_name)) > 0 then
    _resolved_series_id := upsert_series(
      _series_name,
      _author,
      null, null,
      coalesce(_series_source, _source, 'user_manual'),
      null, null,
      (_resolved_status = 'verified'),
      '{}'::jsonb,
      _resolved_status,
      _verified_source
    );
  end if;

  _key := compute_book_key(_title, _author);

  select * into _existing from books where normalized_key = _key limit 1;
  if found then
    update books set
      isbn               = coalesce(_existing.isbn, _isbn),
      hardcover_id       = coalesce(_existing.hardcover_id, _hardcover_id),
      series_id          = coalesce(_existing.series_id, _resolved_series_id),
      position_in_series = coalesce(_existing.position_in_series, _series_position),
      pages              = coalesce(_existing.pages, _pages),
      description        = coalesce(_existing.description, _description),
      cover_url          = coalesce(_existing.cover_url, _cover_url),
      genre              = coalesce(_existing.genre, _genre),
      complexity         = case when _existing.status = 'verified' then _existing.complexity else coalesce(_existing.complexity, _complexity) end,
      depth              = case when _existing.status = 'verified' then _existing.depth else coalesce(_existing.depth, _depth) end,
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_id, position_in_series, pages, description, cover_url,
    genre, complexity, depth, source,
    status, verified_source, verified_at, verified_by,
    metadata, created_by
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _resolved_series_id, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;

-- 4) Permissions (explicit arg lists) + reload PostgREST schema cache.
GRANT EXECUTE ON FUNCTION public.upsert_series(
  text, text, int, text, text, bigint, text, boolean, jsonb, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_book(
  text, text, text, bigint, text, numeric, int, text, text, text,
  int, int, text, boolean, jsonb, uuid, text, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verify afterwards — expect exactly ONE row each:
--   select oid::regprocedure from pg_proc where proname in ('upsert_book','upsert_series');
-- ============================================================================
