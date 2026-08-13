-- genre_audit.sql — what the genre data actually looks like.
--
-- READ THIS FIRST: THERE ARE TWO GENRE STORES AND THEY ARE NOT THE SAME THING.
--
--   books.genre        a single TEXT column. Legacy, from when a book could
--                      only have one genre. It holds the ONE top-scoring pick
--                      and nothing else. If you are looking at the `books`
--                      table in the Supabase editor, this is what you see, and
--                      it will ALWAYS show one genre no matter how many the
--                      book really has.
--
--   book_genres        the real many-to-many. One row per (book, genre). This
--                      is what the app reads — DataContext loads it into
--                      `genresByBookId`, and every genre chip, filter and
--                      Discover query is driven from here.
--
-- So "the DB still shows one genre" is expected if you were reading
-- books.genre. Query 2 below shows the difference on a single title.
--
-- Everything here is read-only. Safe to run against production.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. THE HEADLINE: how many genres does each book carry?
-- ══════════════════════════════════════════════════════════════════════════════
-- This is the number that says whether the re-genre pass changed the shape of
-- the site. Before it, essentially every book was at 1.

select
  coalesce(g.n, 0)              as genres_on_book,
  count(*)                      as books,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from public.books b
left join (
  select book_id, count(*)::int as n
  from public.book_genres
  group by book_id
) g on g.book_id = b.id
where b.status <> 'flagged'
group by coalesce(g.n, 0)
order by genres_on_book;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. ONE BOOK, BOTH STORES, PLUS THE EVIDENCE
-- ══════════════════════════════════════════════════════════════════════════════
-- Change the title. Shows the scalar column, the real genre list, and the raw
-- subjects the rules read — so a surprising result can be explained rather
-- than guessed at.

select
  b.title,
  b.genre                                             as books_genre_scalar,
  (select array_agg(g.name order by g.name)
     from public.book_genres bg
     join public.genres g on g.id = bg.genre_id
    where bg.book_id = b.id)                          as book_genres_real,
  (select count(*) from public.book_genres bg where bg.book_id = b.id) as genre_count,
  b.subjects_fetched_at,
  b.source_subjects                                   as evidence
from public.books b
where b.title ilike '%Arctic Patrol%';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. BOOKS WHERE THE TWO STORES DISAGREE
-- ══════════════════════════════════════════════════════════════════════════════
-- books.genre should always be one of the book's real genres. A mismatch means
-- something wrote one store and not the other.

select
  b.title,
  b.genre                                     as scalar,
  (select array_agg(g.name)
     from public.book_genres bg
     join public.genres g on g.id = bg.genre_id
    where bg.book_id = b.id)                  as real_genres
from public.books b
where b.genre is not null
  and not exists (
    select 1 from public.book_genres bg
    join public.genres g on g.id = bg.genre_id
    where bg.book_id = b.id and g.name = b.genre
  )
limit 50;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. SHELF SIZES — what a reader browsing genres actually finds
-- ══════════════════════════════════════════════════════════════════════════════
-- Counted from book_genres, not from genres.usage_count, because usage_count is
-- a trigger-maintained running total and can drift. This is the truth.

select
  g.name,
  p.name                       as umbrella,
  count(bg.book_id)            as books
from public.genres g
left join public.genres p        on p.id = g.parent_id
left join public.book_genres bg  on bg.genre_id = g.id
group by g.name, p.name
order by books desc, g.name;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. IS usage_count LYING?
-- ══════════════════════════════════════════════════════════════════════════════
-- The genre picker and some UI read usage_count. If it has drifted from the
-- real count, that is worth knowing — and the taxonomy migration recomputed it
-- once, but nothing keeps it honest through bulk writes.

select
  g.name,
  g.usage_count                            as claimed,
  count(bg.book_id)                        as actual,
  count(bg.book_id) - g.usage_count        as drift
from public.genres g
left join public.book_genres bg on bg.genre_id = g.id
group by g.name, g.usage_count
having count(bg.book_id) <> g.usage_count
order by abs(count(bg.book_id) - g.usage_count) desc;

-- Fix, if it has drifted:
-- update public.genres g set usage_count = coalesce(c.n, 0)
-- from (select genre_id, count(*)::int n from public.book_genres group by genre_id) c
-- where c.genre_id = g.id;
-- update public.genres g set usage_count = 0
-- where not exists (select 1 from public.book_genres bg where bg.genre_id = g.id);


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. THE RESIDUE — books with nothing, split by whether they have evidence
-- ══════════════════════════════════════════════════════════════════════════════
-- Distinguishes "the rules could not read the subjects" from "there are no
-- subjects". Only the first is fixable with a rule; the second needs a better
-- lookup or Claude.

select
  case
    when b.source_subjects is null                 then 'never fetched'
    when cardinality(b.source_subjects) = 0        then 'fetched, sources had nothing'
    when cardinality(b.source_subjects) <= 2       then 'fetched, almost nothing (1-2 subjects)'
    else                                                'has subjects, rules could not read them'
  end                                              as why,
  count(*)                                         as books
from public.books b
where b.status <> 'flagged'
  and not exists (select 1 from public.book_genres bg where bg.book_id = b.id)
group by 1
order by books desc;


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. UMBRELLA COVERAGE — is the specific+parent pairing actually happening?
-- ══════════════════════════════════════════════════════════════════════════════
-- A book on a subgenre should normally also be on its umbrella. Rows here are
-- books that got the specific but NOT the parent, which means either the cap
-- bit or the umbrella was never attached.

select
  child.name                as specific,
  parent.name               as missing_umbrella,
  count(*)                  as books
from public.book_genres bg
join public.genres child   on child.id = bg.genre_id
join public.genres parent  on parent.id = child.parent_id
where not exists (
  select 1 from public.book_genres bg2
  where bg2.book_id = bg.book_id and bg2.genre_id = parent.id
)
group by child.name, parent.name
order by books desc
limit 30;


-- ══════════════════════════════════════════════════════════════════════════════
-- 8. ONE-LINE SUMMARY, for pasting into a release note
-- ══════════════════════════════════════════════════════════════════════════════

select
  (select count(*) from public.books where status <> 'flagged')            as books,
  (select count(*) from public.book_genres)                                as genre_links,
  round((select count(*)::numeric from public.book_genres)
      / nullif((select count(*) from public.books where status <> 'flagged'), 0), 2)
                                                                           as avg_genres_per_book,
  (select count(distinct genre_id) from public.book_genres)                as shelves_with_books,
  (select count(*) from public.genres)                                     as shelves_total,
  (select count(*) from public.books b
    where b.status <> 'flagged'
      and not exists (select 1 from public.book_genres bg where bg.book_id = b.id))
                                                                           as books_with_no_genre;
