-- isbn_dupe_audit.sql — read-only. Separates two problems that look identical in a
-- naive "same ISBN, different title" query.
--
-- WHY THE SIMPLE QUERY OVER-REPORTS
-- ---------------------------------
-- The v40 detection query normalised titles by stripping non-alphanumerics only:
--
--   'Shadow of Night'                          → 'shadowofnight'
--   'Shadow of Night (All Souls Trilogy, #2)'  → 'shadowofnightallsoulstrilogy2'
--
-- Two "distinct titles", so the pair gets flagged — but it is ONE book stored as two
-- rows, correctly sharing one ISBN. That is the duplicate-rows problem (real, but
-- separate), not the mismatched-ISBN bug.
--
-- The genuine bug looks different: the titles are not variants of each other.
--
--   'X-Men: Inferno' / 'X-Men: The Dark Phoenix Saga'   ← different books, one ISBN
--   'The Infinity Crusade, Vol. 1' / '… Vol. 2'         ← different books, one ISBN
--
-- The test used below: strip SERIES MARKERS ONLY — parentheticals and brackets, never
-- colon-subtitles (stripping those would collapse every 'X-Men: …' to 'X-Men' and hide
-- exactly the bug we are hunting). Then ask whether every title in the group starts with
-- the shortest one. Variants of the same book do; different books do not.

-- ===========================================================================
-- QUERY A — GENUINELY WRONG. Different books sharing an ISBN.
-- These need their isbn + hardcover_id cleared and re-derived.
-- ===========================================================================
with n as (
  select
    id, title, author, isbn,
    regexp_replace(
      lower(
        regexp_replace(
          regexp_replace(title, '\([^)]*\)', '', 'g'),   -- (All Souls Trilogy, #2)
          '\[[^\]]*\]', '', 'g'                          -- [alt title]
        )
      ),
      '[^a-z0-9]', '', 'g'
    ) as core
  from public.books
  where isbn is not null
),
g as (
  select
    isbn,
    count(*)                                        as rows_n,
    count(distinct core)                            as cores_n,
    (array_agg(core order by length(core), core))[1] as shortest,
    array_agg(distinct core)                        as cores
  from n
  group by isbn
)
select
  g.isbn,
  g.rows_n,
  g.cores_n,
  (select string_agg(distinct b.title, '  |  ' order by b.title)
     from public.books b where b.isbn = g.isbn) as titles
from g
where g.cores_n > 1
  -- at least one title is NOT a variant of the shortest → different books
  and exists (
    select 1 from unnest(g.cores) c
    where position(g.shortest in c) <> 1
  )
order by g.rows_n desc, g.isbn;


-- ===========================================================================
-- QUERY B — DUPLICATE ROWS. Same book, stored more than once, sharing one ISBN
-- correctly. Not an ISBN problem. Candidates for merge_books() (v39).
-- ===========================================================================
-- with n as ( ...same CTE as above... ),
-- g as ( ...same... )
-- select g.isbn, g.rows_n,
--        (select string_agg(distinct b.title, '  |  ' order by b.title)
--           from public.books b where b.isbn = g.isbn) as titles
-- from g
-- where g.rows_n > 1
--   and not exists (
--     select 1 from unnest(g.cores) c where position(g.shortest in c) <> 1
--   )
-- order by g.rows_n desc;


-- ===========================================================================
-- REPAIR for Query A only — clear both fields so the corrected matcher re-derives.
-- Clearing hardcover_id matters as much as the ISBN: with a stale ID the backfill
-- skips search entirely and re-writes the same wrong answer (this is what happened
-- between v40 and v41).
-- ===========================================================================
-- begin;
--
-- create table if not exists public.books_isbn_backup_v42 (
--   book_id uuid primary key, isbn text, hardcover_id bigint, title text,
--   backed_up timestamptz not null default now()
-- );
-- alter table public.books_isbn_backup_v42 enable row level security;
--
-- with n as ( ...CTE... ), g as ( ...CTE... ),
-- bad as (
--   select g.isbn from g
--   where g.cores_n > 1
--     and exists (select 1 from unnest(g.cores) c where position(g.shortest in c) <> 1)
-- )
-- insert into public.books_isbn_backup_v42 (book_id, isbn, hardcover_id, title)
-- select b.id, b.isbn, b.hardcover_id, b.title
-- from public.books b join bad on bad.isbn = b.isbn
-- on conflict (book_id) do nothing;
--
-- update public.books b
-- set isbn = null, hardcover_id = null
-- from public.books_isbn_backup_v42 k
-- where b.id = k.book_id;
--
-- commit;
--
-- then:  node batch-scripts/isbnBackfill.mjs
