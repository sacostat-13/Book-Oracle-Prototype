-- Align books.genre with the names the genre picker can actually offer.
--
-- Follow-up to 20260807000500_genre_normalization.sql, which is already applied.
-- That migration folded stray spellings into the crawl's canonical names. This
-- one fixes the canonical names themselves, four of which were never valid.
--
-- THE BUG
--
-- The chain that decides whether a book can be genre-seeded in The Stacks:
--
--   Onboarding / Profile genre picker  ← reads public.genres
--   profiles.favorite_genres           ← stores the picked NAME as text
--   useStacks baseQuery                → .in('genre', favoriteGenres)
--   books.genre                        ← written by catalog-crawl.mjs
--
-- Every link is by name, so a books.genre value absent from public.genres can
-- never be selected by a reader and can never be seeded on. Four of the crawl's
-- fifteen canonical names were in exactly that state — three differing from the
-- real genre by word order alone, which is why it went unnoticed:
--
--   Epic & Dark Fantasy                → Dark & Epic Fantasy
--   Sapphic & Feminist Gothic          → Feminist & Sapphic Gothic
--   Korean, Japanese & East Asian Lit  → East Asian Literary Fiction
--   Latin American Horror & Literary   → Magical Realism
--
-- Roughly 114 browsable books were stranded under names nobody could pick,
-- while four pickable genres matched no book at all.
--
-- 'Magical Realism' is the destination for the Latin American shelf because no
-- Latin American genre exists in public.genres, and Magical Realism is both a
-- real genre there and what the crawl's tags for that shelf actually match on.
--
-- catalog-crawl.mjs now writes the right-hand names, so this is a one-time
-- repair of rows already written. It also catches rows the previous migration
-- created: its Spanish aliases ('Fantasía oscura', 'Fantasía épica') pointed at
-- 'Epic & Dark Fantasy', so those books need the same correction.

-- ── 1. Snapshot ─────────────────────────────────────────────────────────────
-- Same table as the previous migration, deliberately. It already holds one row
-- per changed book with a timestamp, so the revert query at the bottom of
-- 20260807000500 restores through both migrations with `distinct on (book_id)
-- ... order by backed_up desc`.

create table if not exists public.books_genre_backup_v60 (
  book_id    uuid                     not null,
  genre      text,
  backed_up  timestamp with time zone not null default now()
);

alter table public.books_genre_backup_v60 enable row level security;

-- ── 2. The renames ──────────────────────────────────────────────────────────

create temporary table _genre_rename (from_genre text primary key, to_genre text not null)
on commit drop;

insert into _genre_rename (from_genre, to_genre) values
  ('Epic & Dark Fantasy',               'Dark & Epic Fantasy'),
  ('Sapphic & Feminist Gothic',         'Feminist & Sapphic Gothic'),
  ('Korean, Japanese & East Asian Lit', 'East Asian Literary Fiction'),
  ('Latin American Horror & Literary',  'Magical Realism');

-- ── 3. Guard: read public.genres, do not trust a pasted list ────────────────
--
-- The previous migration hardcoded its canonical list. That was already wrong
-- in principle and is the reason this migration exists: a list written down in
-- a file cannot notice that the table says something different.
--
-- It is wrong in practice too, because the taxonomy is not static. Oracle
-- categorisation creates genres on demand — it prefers an existing name but
-- invents one when the catalog has a real gap (resolveGenreId in
-- src/lib/oracleCategorizationService.js). Any list embedded here starts
-- rotting the moment the Oracle next runs.
--
-- So: check the table. If a target is missing, stop rather than write another
-- unreachable name.

do $$
declare _bad text;
begin
  select string_agg(distinct r.to_genre, ', ')
    into _bad
  from _genre_rename r
  where not exists (select 1 from public.genres g where g.name = r.to_genre);

  if _bad is not null then
    raise exception
      'Rename targets absent from public.genres: %. Add the genre row first, or retarget the rename.', _bad;
  end if;
end $$;

-- ── 4. Snapshot then apply ──────────────────────────────────────────────────
-- Replayable: `is distinct from` means a second run matches nothing.

insert into public.books_genre_backup_v60 (book_id, genre)
select b.id, b.genre
from public.books b
join _genre_rename r on r.from_genre = b.genre
where b.genre is distinct from r.to_genre;

update public.books b
set genre = r.to_genre
from _genre_rename r
where r.from_genre = b.genre
  and b.genre is distinct from r.to_genre;

-- ── 5. Report any remaining unreachable values ──────────────────────────────
-- After this runs, every value listed here is a books.genre that no reader can
-- select. Some are expected and harmless — 'Horror', 'Fantasy', 'Mystery' and
-- the other free-text leftovers the previous migration deliberately did not
-- guess at, plus anything null. What should NOT appear is one of the crawl's
-- canonical names; if one does, GENRE_MAP has drifted again.

do $$
declare _row record;
begin
  for _row in
    select b.genre, count(*) as n
    from public.books b
    where b.genre is not null
      and not exists (select 1 from public.genres g where g.name = b.genre)
    group by b.genre
    order by n desc
  loop
    raise notice 'unreachable books.genre: % (% books)', _row.genre, _row.n;
  end loop;
end $$;

-- ── Reverting ───────────────────────────────────────────────────────────────
--   update public.books b
--   set genre = s.genre
--   from (
--     select distinct on (book_id) book_id, genre
--     from public.books_genre_backup_v60
--     order by book_id, backed_up desc
--   ) s
--   where s.book_id = b.id;
