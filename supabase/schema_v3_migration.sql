-- ============================================================
-- The Wishlist Oracle — Supabase schema v3
-- Adds a `series` table as the single source of truth.
--
-- PREREQ: schema_v2_migration.sql must already be applied.
--
-- Run each step in order, one at a time, in Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- STEP 1: Create the series table.
-- ============================================================
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,             -- lowercase, alphanumeric only
  author text,                                -- nullable; some series are multi-author
  total_books int,                            -- null = unknown
  status text default 'unknown',              -- 'ongoing' | 'complete' | 'unknown'
  source text default 'user_manual',          -- 'hardcover' | 'openlibrary' | 'curated' | 'user_manual'
  hardcover_id bigint,
  description text,
  verified boolean not null default false,
  metadata jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists series_normalized_name_idx
  on public.series(normalized_name);
create index if not exists series_name_idx on public.series(name);
create index if not exists series_verified_idx on public.series(verified);

-- ============================================================
-- STEP 2: Helper to normalize series names.
-- Strict: lowercase, strip punctuation/whitespace, strip leading "the ".
-- This is what de-dups "The Stormlight Archive" / "Stormlight Archive".
-- ============================================================
create or replace function public.normalize_series_name(_name text)
returns text language sql immutable as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(_name, '')), '^the\s+', '', 'g'),
    '[^a-z0-9]', '', 'g'
  );
$$;

-- ============================================================
-- STEP 3: upsert_series RPC. Dedupes by normalized_name.
-- Returns the series UUID.
-- ============================================================
create or replace function public.upsert_series(
  _name text,
  _author text default null,
  _total_books int default null,
  _status text default 'unknown',
  _source text default 'user_manual',
  _hardcover_id bigint default null,
  _description text default null,
  _verified boolean default false,
  _metadata jsonb default '{}'::jsonb
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
begin
  if _name is null or length(trim(_name)) = 0 then
    raise exception 'series name is required';
  end if;
  _norm := normalize_series_name(_name);
  if length(_norm) = 0 then
    raise exception 'series name normalizes to empty string';
  end if;

  select * into _existing from series where normalized_name = _norm limit 1;
  if found then
    -- Fill in nulls without overwriting curated/verified data
    update series set
      author        = coalesce(_existing.author, _author),
      total_books   = coalesce(_existing.total_books, _total_books),
      status        = case when _existing.status = 'unknown' then coalesce(_status, 'unknown') else _existing.status end,
      hardcover_id  = coalesce(_existing.hardcover_id, _hardcover_id),
      description   = coalesce(_existing.description, _description),
      updated_at    = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into series (
    name, normalized_name, author, total_books, status,
    source, hardcover_id, description, verified, metadata, created_by
  ) values (
    _name, _norm, _author, _total_books, coalesce(_status, 'unknown'),
    coalesce(_source, 'user_manual'), _hardcover_id, _description, _verified, _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;

-- ============================================================
-- STEP 4: Add series_id to books, backfill from existing data.
-- ============================================================
alter table public.books
  add column if not exists series_id uuid references public.series(id) on delete set null,
  add column if not exists position_in_series numeric;

-- Backfill: for every distinct (series_name, author) tuple in books, create a series row
insert into public.series (name, normalized_name, author, source, verified)
select distinct on (normalize_series_name(series_name))
  series_name,
  normalize_series_name(series_name),
  author,
  case when source in ('hardcover', 'curated') then source else 'user_manual' end,
  source = 'curated'  -- verified iff it came from the curated seed
from public.books
where series_name is not null
  and length(trim(series_name)) > 0
on conflict (normalized_name) do nothing;

-- Link each book to its series row
update public.books b
set series_id = s.id,
    position_in_series = b.series_position
from public.series s
where s.normalized_name = normalize_series_name(b.series_name)
  and b.series_id is null
  and b.series_name is not null;

-- ============================================================
-- STEP 5: Drop the denormalized columns. Comment this section
-- out during testing if you want a safety net.
-- ============================================================
alter table public.books
  drop column if exists series_name,
  drop column if exists series_position;

-- ============================================================
-- STEP 6: Update upsert_book to take series_id (and optionally
-- accept a series name to upsert-and-link in one go).
-- ============================================================
create or replace function public.upsert_book(
  _title text,
  _author text,
  _isbn text default null,
  _hardcover_id bigint default null,
  _series_name text default null,            -- legacy name → we'll upsert series ourselves
  _series_position numeric default null,
  _pages int default null,
  _description text default null,
  _cover_url text default null,
  _genre text default null,
  _complexity int default null,
  _depth int default null,
  _source text default 'user_manual',
  _verified boolean default false,
  _metadata jsonb default '{}'::jsonb,
  _series_id uuid default null,              -- pass explicitly if you already have it
  _series_source text default null           -- e.g. 'hardcover' so series source matches
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
begin
  if _title is null or length(trim(_title)) = 0 then
    raise exception 'title is required';
  end if;

  -- Resolve series_id from the name if not given explicitly
  if _resolved_series_id is null and _series_name is not null and length(trim(_series_name)) > 0 then
    _resolved_series_id := upsert_series(
      _series_name,
      _author,
      null, null,
      coalesce(_series_source, _source, 'user_manual'),
      null, null, false, '{}'::jsonb
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
      complexity         = case when _existing.verified then _existing.complexity else coalesce(_existing.complexity, _complexity) end,
      depth              = case when _existing.verified then _existing.depth else coalesce(_existing.depth, _depth) end,
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_id, position_in_series, pages, description, cover_url,
    genre, complexity, depth, source, verified, metadata, created_by
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _resolved_series_id, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source, _verified, _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;

-- ============================================================
-- STEP 7: RLS for series. Anyone can read; only the RPC can write.
-- ============================================================
alter table public.series enable row level security;

drop policy if exists "Anyone can read series" on public.series;
create policy "Anyone can read series"
  on public.series for select
  using (true);

grant execute on function public.upsert_series to authenticated;
grant execute on function public.normalize_series_name to authenticated;
