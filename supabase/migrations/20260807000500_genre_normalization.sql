-- Fold non-canonical genre spellings into the canonical 15, and clear the
-- pseudo-genres that were never genres at all.
--
-- Background: books.genre is free text. upsert_book writes whatever its caller
-- passes, so three different writers have been filling it with three different
-- vocabularies:
--
--   catalog-crawl.mjs   writes GENRE_MAP.canonical      — the 15 real genres
--   Goodreads import    writes 'Imported'               — a source, not a genre
--   Oracle / manual     writes whatever Claude returned — 'Horror', 'Fantasy',
--                                                         'Fantasía oscura', …
--
-- The audit (legacy/stacks_catalog_audit.sql, block 3) measured the damage: of
-- 1729 browsable books, only 443 carry a canonical genre. 1070 are null or
-- 'Imported', and the rest are scattered across 20-odd one-off spellings.
--
-- SCOPE — deliberately narrow. This migration only touches values whose mapping
-- is unambiguous, plus two pseudo-genres. It does NOT guess. 'Horror' (57 rows)
-- could reasonably be Folk Horror, Body Horror or Gothic & Haunted Houses;
-- 'Fantasy' (44) could be Epic & Dark or Cozy. Picking one would be inventing
-- data to make a number look better, and the number it improves — genre-seeded
-- coverage — no longer gates what a reader can see now that The Stacks draws
-- from the whole catalog. Those rows are reported at the end and left alone.

-- ── 1. Snapshot, so this is reversible ──────────────────────────────────────
-- Unlike a merge, nothing here deletes rows, so a full restore is just an
-- update joined back against this table. Kept permanently: it is one small row
-- per changed book and it is the only record of what the value used to be.

create table if not exists public.books_genre_backup_v60 (
  book_id    uuid                     not null,
  genre      text,
  backed_up  timestamp with time zone not null default now()
);

alter table public.books_genre_backup_v60 enable row level security;

-- ── 2. The alias map ────────────────────────────────────────────────────────
-- `to_genre = null` means "this was never a genre, clear it". A null genre is
-- honest and — since v0.60 of useStacks — costs the book nothing: it is still
-- fully browsable, it just can't be genre-seeded.

create temporary table _genre_alias (from_genre text primary key, to_genre text)
on commit drop;

insert into _genre_alias (from_genre, to_genre) values
  -- Literal translations and exact synonyms of canonical names.
  ('Science Fiction',                          'Sci-Fi & Speculative'),
  ('Speculative Fiction',                      'Sci-Fi & Speculative'),
  ('Ficción especulativa / Cuento corto',      'Sci-Fi & Speculative'),
  ('Ciencia ficción ecofeminista / Distopía',  'Sci-Fi & Speculative'),
  ('Fantasía oscura',                          'Epic & Dark Fantasy'),
  ('Fantasía épica',                           'Epic & Dark Fantasy'),
  ('Erotica / Literary Fiction',               'Literary Fiction'),
  -- Pseudo-genres. 'Imported' is a provenance label that leaked into the genre
  -- column; books.source already records that properly.
  ('Imported',                                 null),
  ('Uncategorized',                            null);

-- ── 3. Guard: every target must be a real canonical genre ───────────────────
-- Cheap insurance against a typo in the map above silently creating a 16th
-- genre that nothing seeds on and no profile can match.

do $$
declare _bad text;
begin
  select string_agg(distinct a.to_genre, ', ')
    into _bad
  from _genre_alias a
  where a.to_genre is not null
    and a.to_genre not in (
      'Epic & Dark Fantasy', 'Sci-Fi & Speculative', 'Literary Fiction',
      'Gothic & Haunted Houses', 'Classic & Older Gothic',
      'Southern & American Gothic', 'Folk Horror',
      'Body Horror & Transgressive', 'Vampires', 'Witches', 'Cozy Fantasy',
      'Sapphic & Feminist Gothic', 'Korean, Japanese & East Asian Lit',
      'Latin American Horror & Literary', 'Parenting & Motherhood'
    );

  if _bad is not null then
    raise exception
      'Alias map targets non-canonical genre(s): %. Fix the map — do not add a genre here.', _bad;
  end if;
end $$;

-- ── 4. Snapshot then apply ──────────────────────────────────────────────────
-- Replayable: the `is distinct from` filter means a second run matches nothing,
-- so no duplicate backup rows and no redundant writes.

insert into public.books_genre_backup_v60 (book_id, genre)
select b.id, b.genre
from public.books b
join _genre_alias a on a.from_genre = b.genre
where b.genre is distinct from a.to_genre;

update public.books b
set genre = a.to_genre
from _genre_alias a
where a.from_genre = b.genre
  and b.genre is distinct from a.to_genre;

-- ── 5. Report what was deliberately left alone ──────────────────────────────
-- Not a failure. These are either ambiguous (see SCOPE above) or genuinely
-- outside the taxonomy — 'Mystery', 'Romance', 'Biography' have no canonical
-- equivalent because The Books Oracle's shelf is not a general bookshop.
--
-- Read this in the migration output. If a value here grows large enough to be
-- worth seeding on, the answer is to add a canonical genre to GENRE_MAP in
-- netlify/functions/catalog-crawl.mjs and re-run a targeted update — not to
-- widen this map.

do $$
declare _row record;
begin
  for _row in
    select b.genre, count(*) as n
    from public.books b
    where b.genre is not null
      and b.genre not in (
        'Epic & Dark Fantasy', 'Sci-Fi & Speculative', 'Literary Fiction',
        'Gothic & Haunted Houses', 'Classic & Older Gothic',
        'Southern & American Gothic', 'Folk Horror',
        'Body Horror & Transgressive', 'Vampires', 'Witches', 'Cozy Fantasy',
        'Sapphic & Feminist Gothic', 'Korean, Japanese & East Asian Lit',
        'Latin American Horror & Literary', 'Parenting & Motherhood'
      )
    group by b.genre
    order by n desc
  loop
    raise notice 'unmapped genre: % (% books)', _row.genre, _row.n;
  end loop;
end $$;

-- ── Reverting ───────────────────────────────────────────────────────────────
-- Restores every value this migration changed, most recent snapshot wins:
--
--   update public.books b
--   set genre = s.genre
--   from (
--     select distinct on (book_id) book_id, genre
--     from public.books_genre_backup_v60
--     order by book_id, backed_up desc
--   ) s
--   where s.book_id = b.id;
