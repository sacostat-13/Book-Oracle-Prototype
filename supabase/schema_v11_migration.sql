-- schema_v11_migration.sql
-- Replaces the static booksData.js curated catalog with the wishlist of any
-- user flagged as a curator. One or more curators can exist; the Vault shows
-- the union of their wishlist items.
--
-- Steps:
--   1. Add is_curator column to profiles.
--   2. Create get_curated_catalog() RPC (SECURITY DEFINER so it can read any
--      curator's wishlist_items regardless of RLS).
--   3. Allow all authenticated users to read profiles.is_curator via a policy.
--
-- After running this migration, mark yourself as curator:
--   update profiles set is_curator = true where id = '<your-user-uuid>';


-- 1. Add is_curator flag to profiles
alter table public.profiles
  add column if not exists is_curator boolean not null default false;

-- Index for the curator lookup (tiny table, but keeps the RPC fast)
create index if not exists profiles_is_curator_idx
  on public.profiles(is_curator)
  where is_curator = true;


-- 2. RPC: get_curated_catalog()
--    Returns all books wishlisted by any curator, joined with their series.
--    Called from DataContext.loadVault() instead of the old source='curated' query.
--    Returns the same columns as the old query so bookRowToClient() works unchanged.
create or replace function public.get_curated_catalog()
returns table (
  id                  uuid,
  title               text,
  author              text,
  description         text,
  genre               text,
  complexity          text,
  depth               text,
  pages               integer,
  cover_url           text,
  isbn                text,
  source              text,
  status              text,
  verified_source     text,
  verified_at         timestamptz,
  verified_by         text,
  position_in_series  integer,
  series              jsonb
)
language sql
security definer
stable
as $$
  select
    b.id,
    b.title,
    b.author,
    b.description,
    b.genre,
    b.complexity,
    b.depth,
    b.pages,
    b.cover_url,
    b.isbn,
    b.source,
    b.status,
    b.verified_source,
    b.verified_at,
    b.verified_by,
    b.position_in_series,
    case
      when s.id is not null then jsonb_build_object(
        'id',                 s.id,
        'name',               s.name,
        'total_books',        s.total_books,
        'status',             s.status,
        'publication_status', s.publication_status,
        'verified_source',    s.verified_source,
        'verified_at',        s.verified_at,
        'verified_by',        s.verified_by,
        'source',             s.source
      )
      else null
    end as series
  from public.wishlist_items wi
  join public.profiles        p  on p.id = wi.user_id and p.is_curator = true
  join public.books           b  on b.id = wi.book_id
  left join public.series     s  on s.id = b.series_id
  order by b.title asc;
$$;

-- Allow any authenticated user to call this function
grant execute on function public.get_curated_catalog() to authenticated;
-- Also allow anon so guest mode can call it (reads only curator wishlist, no PII)
grant execute on function public.get_curated_catalog() to anon;


-- 3. Let users (and guests) read is_curator on any profile
--    (needed only if you ever want to surface "curated by" attribution in the UI;
--     safe to add now since it exposes no PII)
drop policy if exists "Anyone can read curator flag" on public.profiles;
create policy "Anyone can read curator flag"
  on public.profiles
  for select
  using (true);

-- NOTE: the existing "Users can view own profile" policy already covers the
-- curator's own row. This new policy opens all rows for SELECT so the frontend
-- could display curator info if desired. If you prefer to keep profiles private,
-- drop this policy — get_curated_catalog() is SECURITY DEFINER and doesn't need it.
