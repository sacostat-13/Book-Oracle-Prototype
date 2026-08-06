-- schema_v34_migration.sql — v0.49 Vault Source Upgrade
--
-- The Vault becomes curator-fed for real. v11 created get_curated_catalog()
-- (curator wishlists only) but the client never switched to it — loadVault()
-- kept querying books where source='curated' (the ~426 seeded rows), and
-- guests kept the bundled ~280-book booksData.js. This migration widens the
-- RPC to union BOTH curator sources; the v0.49 client calls it for guests
-- and signed-in users alike.
--
-- Sources:
--   - wishlist_items of any profile with is_curator = true
--     (a wishlist entry is a deliberate act of taste — no rating exists yet)
--   - read_books of any curator, EXCLUDING explicit low ratings (< 3).
--     NULL ratings are kept: unrated means "no signal", not "disliked".
--     (rating is numeric(2,1), 1–5; the client normalizes 0 → NULL on
--     Goodreads import, so 0 never reaches this filter.)
--
-- Each book also reports where it came from:
--   vault_source   'wishlist' | 'library' | 'both'  (across all curators)
--   curator_rating highest curator rating, when any curator rated it
-- The client currently just stores these; they're future ranking signal
-- ("a curator read and loved this" > "a curator has this on their list").
--
-- Quality floor: only status verified / oracle_categorized rows are served —
-- same "enriched content only" line the sitemap draws. A curator adding a
-- book surfaces it in the Vault as soon as the Oracle has categorized it.
--
-- NOTE: the return type changes (two new columns), so CREATE OR REPLACE
-- would fail — the function is dropped and recreated, and grants re-applied
-- (DROP discards them). search_path is pinned inline, which also keeps the
-- v29 security audit green for this function.

drop function if exists public.get_curated_catalog();

create function public.get_curated_catalog()
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
  series              jsonb,
  vault_source        text,
  curator_rating      numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with curators as (
    select p.id
    from public.profiles p
    where p.is_curator = true
  ),
  candidate as (
    -- Curator wishlists: taste signal, no rating dimension.
    select wi.book_id, 'wishlist'::text as src, null::numeric as rating
    from public.wishlist_items wi
    join curators c on c.id = wi.user_id
    union all
    -- Curator libraries: experience signal. Explicit low ratings are
    -- excluded (the one negative signal we have); unrated reads stay.
    select rb.book_id, 'library'::text as src, rb.rating
    from public.read_books rb
    join curators c on c.id = rb.user_id
    where rb.rating is null or rb.rating >= 3
  ),
  rolled as (
    select
      cd.book_id,
      case
        when bool_or(cd.src = 'wishlist') and bool_or(cd.src = 'library') then 'both'
        when bool_or(cd.src = 'library') then 'library'
        else 'wishlist'
      end as vault_source,
      max(cd.rating) as curator_rating
    from candidate cd
    group by cd.book_id
  )
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
    end as series,
    r.vault_source,
    r.curator_rating
  from rolled r
  join public.books b on b.id = r.book_id
  left join public.series s on s.id = b.series_id
  where b.status in ('verified', 'oracle_categorized')
  order by b.title asc;
$$;

-- Re-apply grants (lost with the DROP). anon keeps guest mode working —
-- the function reads only curator catalog links, no PII.
grant execute on function public.get_curated_catalog() to authenticated;
grant execute on function public.get_curated_catalog() to anon;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Row count should land well above the old 426 (Simon's wishlist alone is ~901;
-- filtered to verified/oracle_categorized):
--   select count(*) from get_curated_catalog();
-- Source split:
--   select vault_source, count(*) from get_curated_catalog() group by 1;
-- Low-rated curator reads must NOT appear:
--   select count(*) from get_curated_catalog() g
--   join read_books rb on rb.book_id = g.id
--   join profiles p on p.id = rb.user_id and p.is_curator
--   where rb.rating < 3 and rb.rating is not null
--     and not exists (select 1 from wishlist_items wi
--                     join profiles cp on cp.id = wi.user_id and cp.is_curator
--                     where wi.book_id = g.id);
--   -- (a low-rated read can still appear if another curator wishlisted it)
