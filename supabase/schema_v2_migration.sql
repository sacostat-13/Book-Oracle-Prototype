-- ============================================================
-- The Wishlist Oracle — Supabase schema v2
--
-- Run this in your Supabase SQL Editor IN ORDER, one step at a time.
-- Each step prints what it did. Stop if any step fails.
--
-- This is a destructive migration from v1: old wishlist_items and
-- read_books rows are migrated into the new shape, then the old
-- columns are dropped. Existing user profiles + auth survive.
-- ============================================================

-- ============================================================
-- STEP 1: Create the shared `books` table.
-- ============================================================
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  normalized_key text not null,            -- lowercase title|author for dedup
  isbn text,
  hardcover_id bigint,                     -- if sourced from Hardcover
  series_name text,
  series_position numeric,
  pages int,
  description text,
  cover_url text,
  genre text,
  complexity int,                          -- prose complexity 1-5 (curated only)
  depth int,                               -- thematic depth 1-5 (curated only)
  source text not null default 'user_manual',
                                           -- 'curated' | 'hardcover' | 'openlibrary'
                                           -- | 'goodreads_import' | 'user_manual'
  verified boolean not null default false, -- true = curated/admin-checked
  metadata jsonb default '{}'::jsonb,      -- escape hatch for source-specific extras
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists books_normalized_key_idx
  on public.books(normalized_key);
create index if not exists books_title_idx on public.books(title);
create index if not exists books_author_idx on public.books(author);
create index if not exists books_genre_idx on public.books(genre);
create index if not exists books_source_idx on public.books(source);
create index if not exists books_isbn_idx on public.books(isbn) where isbn is not null;

-- ============================================================
-- STEP 2: Helper function to normalize a key consistently.
-- Mirror of the JS `bookKey` so client and server agree.
-- ============================================================
create or replace function public.compute_book_key(_title text, _author text)
returns text language sql immutable as $$
  select
    regexp_replace(lower(coalesce(_title, '')), '[^a-z0-9]', '', 'g')
    || '|' ||
    substr(regexp_replace(lower(coalesce(_author, '')), '[^a-z0-9]', '', 'g'), 1, 10);
$$;

-- ============================================================
-- STEP 3: Safe-insert RPC. Use this from the client instead of a raw
-- insert. It dedupes by normalized_key, returning the existing row
-- if one already matches.
-- ============================================================
create or replace function public.upsert_book(
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
  _verified boolean default false,
  _metadata jsonb default '{}'::jsonb
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
begin
  if _title is null or length(trim(_title)) = 0 then
    raise exception 'title is required';
  end if;

  _key := compute_book_key(_title, _author);

  -- If a row exists, fill in any null fields from the incoming data but
  -- never overwrite a verified row's curated fields.
  select * into _existing from books where normalized_key = _key limit 1;
  if found then
    update books set
      isbn            = coalesce(_existing.isbn, _isbn),
      hardcover_id    = coalesce(_existing.hardcover_id, _hardcover_id),
      series_name     = coalesce(_existing.series_name, _series_name),
      series_position = coalesce(_existing.series_position, _series_position),
      pages           = coalesce(_existing.pages, _pages),
      description     = coalesce(_existing.description, _description),
      cover_url       = coalesce(_existing.cover_url, _cover_url),
      genre           = coalesce(_existing.genre, _genre),
      complexity      = case when _existing.verified then _existing.complexity else coalesce(_existing.complexity, _complexity) end,
      depth           = case when _existing.verified then _existing.depth else coalesce(_existing.depth, _depth) end,
      updated_at      = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_name, series_position, pages, description, cover_url,
    genre, complexity, depth, source, verified, metadata, created_by
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _series_name, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source, _verified, _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$$;

-- ============================================================
-- STEP 4: Migrate existing wishlist_items rows into books, then add
-- a book_id column referencing them.
-- ============================================================

-- 4a) Pre-create the new column
alter table public.wishlist_items
  add column if not exists book_id uuid references public.books(id) on delete cascade;

-- 4b) Insert any unique books referenced by existing wishlist rows
insert into public.books (title, author, normalized_key, source, metadata, created_by)
select distinct on (compute_book_key(book_title, book_author))
  book_title,
  book_author,
  compute_book_key(book_title, book_author),
  'user_manual',
  coalesce(book_metadata, '{}'::jsonb),
  user_id
from public.wishlist_items
where book_title is not null
on conflict (normalized_key) do nothing;

-- 4c) Link wishlist rows to their book row
update public.wishlist_items wi
set book_id = b.id
from public.books b
where b.normalized_key = compute_book_key(wi.book_title, wi.book_author)
  and wi.book_id is null;

-- ============================================================
-- STEP 5: Same for read_books.
-- ============================================================
alter table public.read_books
  add column if not exists book_id uuid references public.books(id) on delete cascade;

insert into public.books (title, author, normalized_key, source, metadata, created_by)
select distinct on (compute_book_key(book_title, book_author))
  book_title,
  book_author,
  compute_book_key(book_title, book_author),
  case when source = 'goodreads_import' then 'goodreads_import' else 'user_manual' end,
  coalesce(book_metadata, '{}'::jsonb),
  user_id
from public.read_books
where book_title is not null
on conflict (normalized_key) do nothing;

update public.read_books rb
set book_id = b.id
from public.books b
where b.normalized_key = compute_book_key(rb.book_title, rb.book_author)
  and rb.book_id is null;

-- ============================================================
-- STEP 6: Drop the old denormalized columns. Comment this section
-- out if you want to keep them around as a safety net during testing.
-- ============================================================
alter table public.wishlist_items
  drop column if exists book_title,
  drop column if exists book_author,
  drop column if exists book_isbn,
  drop column if exists book_metadata;

alter table public.read_books
  drop column if exists book_title,
  drop column if exists book_author,
  drop column if exists book_isbn,
  drop column if exists book_metadata;

-- After dropping book_title we have to redo the unique constraints
alter table public.wishlist_items
  drop constraint if exists wishlist_items_user_id_book_title_key;
alter table public.read_books
  drop constraint if exists read_books_user_id_book_title_key;

alter table public.wishlist_items
  add constraint wishlist_items_user_book_unique unique (user_id, book_id);
alter table public.read_books
  add constraint read_books_user_book_unique unique (user_id, book_id);

-- Require book_id going forward
alter table public.wishlist_items alter column book_id set not null;
alter table public.read_books alter column book_id set not null;

-- ============================================================
-- STEP 7: Row Level Security for books table.
-- Anyone authenticated can read all books. Inserts/updates only
-- through the upsert_book function (which uses security definer).
-- ============================================================
alter table public.books enable row level security;

drop policy if exists "Anyone can read books" on public.books;
create policy "Anyone can read books"
  on public.books for select
  using (true);

-- No direct insert/update/delete policies → only the SECURITY DEFINER
-- function can write. This keeps the catalog quality controllable.

grant execute on function public.upsert_book to authenticated;
grant execute on function public.compute_book_key to authenticated;
