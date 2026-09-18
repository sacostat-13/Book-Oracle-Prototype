-- Genre families catch-up, 2026-09-18.
--
-- 18 genres had family_id = null: the Oracle creates genres, and nothing
-- assigns them a shelf until someone looks. This resolves every one of them,
-- either as a duplicate of a genre we already have (merge) or as a real genre
-- that needs a shelf (assign).
--
-- By normalized_name and family slug, so it reads as an argument, same as
-- 20260902180000_genre_families.sql. Idempotent: a second run is a no-op.
-- Ends with the same guard as the families migration.
--
-- NOT in here: Feminist & Sapphic Gothic. Retiring it depends on every one of
-- its books being on a half first, which only the data can say. That is
-- `splitCompoundGenre.mjs --retire`, which checks and then merges.

-- ── 1. Duplicates: merge into the genre that already exists ───────────────────
-- Supernatural was merged into Paranormal on 2026-09-02 and came back with 78
-- books. The Oracle's genre writers create any name they are given, so one of
-- them recreated the row; and the keyword rule in genreRules.mjs still named
-- Supernatural, so once the row existed metadataBackfill filed books against
-- it too. That rule now targets Paranormal.
do $$
declare
  pair text[];
  l uuid; w uuid; r record;
begin
  foreach pair slice 1 in array array[
    ['supernatural',    'paranormal'],
    ['theological',     'theology'],
    ['lovecraftian',    'cosmichorror'],
    ['militaryfiction', 'warfiction'],
    ['paranoia',        'psychologicalfiction']   -- a register, not a shelf; 1 book
  ] loop
    select id into l from genres where normalized_name = pair[1];
    select id into w from genres where normalized_name = pair[2];
    if l is not null and w is not null then
      select * into r from merge_genres(l, w);
      raise notice 'merged % into %: moved=% dropped=% kids=% scalar=%',
        pair[1], pair[2], r.links_moved, r.links_dropped, r.children_repointed, r.books_rescalared;
    elsif l is not null then
      raise exception 'cannot merge %: winner % not found', pair[1], pair[2];
    end if;
  end loop;
end $$;

-- ── 2. "unknown" is not a genre ───────────────────────────────────────────────
-- The categorization prompt teaches "unknown" as the honest answer for author
-- gender and original language, and the Oracle carried it into the genres
-- array. Both genre writers create any name they are given, so it became a row.
-- Nothing to merge it into: drop the links and the row. Books left with no
-- genres go back into books_needing_genres and are curated on the next run.
update books set genre = null where genre = 'unknown';
delete from book_genres where genre_id in (select id from genres where normalized_name = 'unknown');
delete from genres where normalized_name = 'unknown';

-- ── 3. Real genres: a shelf, and a parent where one is clear ──────────────────
-- parent_id is only set where it was null, so a parent someone chose by hand
-- is never overwritten.
with m(genre, family, parent) as (values
  ('politicalthriller',         'crime',     'thriller'),
  ('cozymystery',               'crime',     'mystery'),
  ('fae',                       'fantasy',   'fantasy'),
  ('japaneseliterature',        'place',     'eastasianliteraryfiction'),
  ('africanamericanliterature', 'place',     'americanliterature'),
  ('caribbeanliterature',       'place',     'literaryfiction'),
  ('appalachian',               'place',     'southernfiction'),
  ('medieval',                  'place',     'historicalfiction'),
  ('regency',                   'romance',   'historicalromance'),  -- Regency on a shelf is Regency romance
  ('sapphicfiction',            'society',   'lgbtqfiction'),
  ('addiction',                 'society',   null),
  ('biblical',                  'myth',      null)                  -- retellings; Theology is the non-fiction shelf
)
update genres g
   set family_id = f.id,
       parent_id = coalesce(g.parent_id, p.id)
  from m
  join genre_families f on f.slug = m.family
  left join genres p    on p.normalized_name = m.parent
 where g.normalized_name = m.genre
   and g.family_id is null;

-- ── Guard: every genre on exactly one shelf ───────────────────────────────────
do $$ declare n int; names text; begin
  select count(*), string_agg(name, ', ' order by name) into n, names
    from genres where family_id is null;
  if n > 0 then raise exception 'genre_families catch-up: % genre(s) unassigned: %', n, names; end if;
end $$;

-- ── Verification ──────────────────────────────────────────────────────────────
-- select count(*) from genres;                          -- 187 before; expect 181
--                                                       -- (180 once the compound is retired)
-- select name from genres where family_id is null;      -- expect none
-- select name from genres where description is null;    -- expect none
-- node batch-scripts/probes/checkGenreDrift.mjs         -- expect OK: rules still point at real genres
