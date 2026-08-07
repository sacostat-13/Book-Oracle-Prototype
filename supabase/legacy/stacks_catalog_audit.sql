-- stacks_catalog_audit.sql — how much catalog The Stacks can actually show
--
-- READ-ONLY. Nothing here modifies data. Run each block in the Supabase SQL
-- editor.
--
-- Context: readers were reaching "You've reached the end" quickly on a catalog
-- reported as ~2.5K books. Two candidate causes, and these queries separate
-- them: either the wall's filters shrink 2.5K to something much smaller, or the
-- windowing was declaring exhaustion prematurely. The second was fixed in
-- useStacks v0.60; this file measures the first.
--
-- The wall serves `books` with exactly two filters:
--     status <> 'flagged'  AND  cover_url IS NOT NULL
-- A book failing either can never appear, no matter how long someone scrolls.


-- ── 1. Browsable size vs total ──────────────────────────────────────────────
-- The headline number. `browsable` is the real denominator for exhaustion —
-- if it is a few hundred, no windowing fix will keep a reader busy for long
-- and the answer is more crawling, not more code.

select
  count(*)                                                          as total_books,
  count(*) filter (where cover_url is not null)                     as with_cover,
  count(*) filter (where status = 'flagged')                        as flagged,
  count(*) filter (where status <> 'flagged'
                     and cover_url is not null)                     as browsable,
  round(100.0 * count(*) filter (where status <> 'flagged'
                                   and cover_url is not null)
        / nullif(count(*), 0), 1)                                   as browsable_pct
from public.books;


-- ── 2. Where the losses are ─────────────────────────────────────────────────
-- Missing covers are the likelier culprit: the crawl skips coverless books at
-- write time, but Goodreads imports and Oracle-created rows do not, and those
-- rows sit in the catalog forever without ever being showable.

select
  coalesce(source, '(null)')                          as source,
  count(*)                                            as rows,
  count(*) filter (where cover_url is null)           as missing_cover,
  count(*) filter (where status = 'flagged')          as flagged
from public.books
group by 1
order by rows desc;


-- ── 3. Genre distribution across the browsable set ──────────────────────────
-- The Stacks seeds its opening rounds on books.genre matched against the
-- reader's profile favourites. A genre with a handful of browsable books can
-- not fill six genre-scoped rounds, and a genre name in a profile that appears
-- in NO row here matches nothing at all — which is why the genre phase now
-- gives up after one empty round instead of six.

select
  coalesce(genre, '(null)')  as genre,
  count(*)                   as browsable
from public.books
where status <> 'flagged'
  and cover_url is not null
group by 1
order by browsable desc;


-- ── 4. Genres the crawl writes vs genres readers actually have ──────────────
-- Any row returned here is a profile favourite that matches no book. Each one
-- silently wastes the genre-seeded phase for that reader. Expect this to be
-- empty; if it is not, the profile taxonomy has drifted from GENRE_MAP's
-- `canonical` names in netlify/functions/catalog-crawl.mjs.

select distinct fav as unmatched_profile_genre
from public.profiles p,
     lateral jsonb_array_elements_text(
       case jsonb_typeof(p.favorite_genres)
         when 'array' then p.favorite_genres
         else '[]'::jsonb
       end
     ) as fav
where not exists (
  select 1 from public.books b
  where b.genre = fav
    and b.status <> 'flagged'
    and b.cover_url is not null
)
order by 1;


-- ── 5. Wishlist integrity ───────────────────────────────────────────────────
-- Expected to return zero rows, always.
--
-- wishlist_items.book_id carries `references books(id) on delete cascade`, so a
-- wishlist row pointing at a deleted book cannot survive — the delete takes the
-- wishlist row with it. And the books SELECT policy is USING (true), so no book
-- is ever hidden from the embedded join in loadFromSupabase.
--
-- Kept as a standing assertion rather than a fix: if this ever returns rows,
-- one of those two guarantees has been dropped, and the client will silently
-- drop those books from the wishlist (DataContext filters null joins), making
-- them re-offerable in The Stacks and un-addable at the same time.

select w.id, w.user_id, w.book_id
from public.wishlist_items w
left join public.books b on b.id = w.book_id
where b.id is null;
