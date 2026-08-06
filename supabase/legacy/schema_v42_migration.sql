-- schema_v42: reset the serialized-work rows that collapsed onto shared ISBNs.
--
-- WHAT THIS FIXES
-- ---------------
-- Query A of isbn_dupe_audit.sql found 17 ISBNs shared across genuinely different books
-- — roughly 65 rows, every one of them comics, manga or serialized fiction:
--
--   9781591167549   15 JoJo's Bizarre Adventure volumes
--   9781421530543    8 Pokémon Adventures volumes
--   9780785122135    5 X-Men arcs
--   9781401215149    6 Hellblazer collections
--   …plus Mistborn, Fabius Bile, Belisarius Cawl, Infinity Crusade, Galactic Storm
--
-- The cause was in the title matcher, not the data. Two gaps, both specific to
-- serialized works, now closed in src/lib/titleMatch.js:
--
--   1. "X-Men: Inferno" and "X-Men: Days of Future Past" both reduce to the same
--      subtitle-stripped variant, "X-Men". Where a work is titled "Series: Instalment",
--      the subtitle IS the title and the part before the colon is just the banner. The
--      matcher now rejects a pair whose subtitles both exist and differ.
--
--   2. "The Infinity Crusade, Vol. 1" matched a bare "The Infinity Crusade" record
--      because the bounded prefix rule allows a 4-character remainder — and "vol1" is
--      exactly 4. Volume/tome/part numbers are now extracted and must agree.
--
-- Both fixes are verified against all 17 groups plus 20 regression cases.
--
-- Run in the Supabase SQL editor as postgres. Same RLS notes as v38/v40/v41.

begin;

create table if not exists public.books_isbn_backup_v42 (
  book_id      uuid primary key,
  isbn         text,
  hardcover_id bigint,
  title        text,
  backed_up    timestamptz not null default now()
);

alter table public.books_isbn_backup_v42 enable row level security;

with n as (
  select
    id, isbn,
    regexp_replace(
      lower(
        regexp_replace(
          regexp_replace(title, '\([^)]*\)', '', 'g'),
          '\[[^\]]*\]', '', 'g'
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
    count(distinct core)                             as cores_n,
    (array_agg(core order by length(core), core))[1] as shortest,
    array_agg(distinct core)                         as cores
  from n
  group by isbn
),
bad as (
  select isbn from g
  where cores_n > 1
    and exists (select 1 from unnest(cores) c where position(shortest in c) <> 1)
)
insert into public.books_isbn_backup_v42 (book_id, isbn, hardcover_id, title)
select b.id, b.isbn, b.hardcover_id, b.title
from public.books b
join bad on bad.isbn = b.isbn
on conflict (book_id) do nothing;

-- Clear BOTH fields. Clearing hardcover_id matters as much as the ISBN: with a stale ID
-- the backfill takes the cheap known-ID path and skips search entirely, re-deriving the
-- identical wrong answer. That is exactly what happened between v40 and v41, and why
-- "hardcover_ids learnt" came back as 1 instead of ~150.
update public.books b
set isbn = null,
    hardcover_id = null
from public.books_isbn_backup_v42 k
where b.id = k.book_id;

commit;

-- ===========================================================================
-- VERIFY, then re-run
-- ===========================================================================
--   select count(*) from public.books_isbn_backup_v42;        -- rows queued (~65)
--   select count(*) from public.books where isbn is null;     -- should rise by that much
--
--   node batch-scripts/isbnBackfill.mjs --dry-run --limit 25 --verbose
--   node batch-scripts/isbnBackfill.mjs
--
-- Then re-run Query A of isbn_dupe_audit.sql — expect 0 rows.
--
-- Expect MORE unresolved afterwards, not fewer: a Pokémon volume that Hardcover has no
-- separate record for should now come back empty rather than borrowing volume 1's ISBN.
-- An honest search link beats a confident link to the wrong volume.
--
-- ROLLBACK:
--   update public.books b
--   set isbn = k.isbn, hardcover_id = k.hardcover_id
--   from public.books_isbn_backup_v42 k
--   where b.id = k.book_id and b.isbn is null;
