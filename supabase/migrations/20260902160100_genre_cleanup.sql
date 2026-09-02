-- Genre cleanup after the 2026-09-02 full-catalogue curation.
--
-- Context: oracleBatch had never seen a single genre description (search_genres
-- does not return the column), so it matched on bare names and invented rather
-- than reused. That is fixed, and the effect is measurable — 40 books produced
-- 11 new genres before the fix; 251 books produced 5 after it. What remains is
-- the debris from before.
--
-- Everything here is by normalized_name, so it reads as an argument rather than
-- a list of UUIDs. Idempotent: every statement is a no-op on a second run.

-- ── 1. Two rows, one shelf ────────────────────────────────────────────────────
-- "Japanese & East Asian Literary Fiction" (oracle, Aug 25) and "East Asian
-- Literary Fiction" (admin, Jul 15) describe the same books. The admin row is
-- older, larger and already parented, so it wins the id. The oracle row has the
-- better sentence, so it wins the description — take the good half of each.
update genres set description =
  'Restraint carrying the weight the sentence won''t. Literary writing from Japan, Korea, China and Taiwan — quiet exteriors, precise observation, and enormous things left unsaid.'
 where normalized_name = 'eastasianliteraryfiction';

do $$
declare l uuid; w uuid; r record;
begin
  select id into l from genres where normalized_name = 'japaneseeastasianliteraryfiction';
  select id into w from genres where normalized_name = 'eastasianliteraryfiction';
  if l is not null and w is not null then
    select * into r from merge_genres(l, w);
    raise notice 'merged Japanese & East Asian Literary Fiction: moved=% dropped=% kids=% scalar=%',
      r.links_moved, r.links_dropped, r.children_repointed, r.books_rescalared;
  end if;
end $$;

-- "Anthology" KEPT — reversing an earlier call. A multi-author collection is not
-- the same object as a single-author one: the editor's selection is part of what
-- the reader is buying, which is why anthologies are shelved separately in every
-- bookshop that has the space. What it needed was not a merge but a boundary,
-- so both sides get one.
update genres set description =
  'Many hands, one binding. Multi-author collections gathered around a theme, a year or an argument — where the editor''s choices are part of the reading.'
 where normalized_name = 'anthology' and description is null;

update genres set description =
  'The whole thing, in one sitting. Stories and single-author collections built for compression, where nothing is allowed to be merely furniture.'
 where normalized_name = 'shortfiction';

-- ── 1b. Two genres nobody can tell apart ──────────────────────────────────────
-- Supernatural (80) and Paranormal (182). The descriptions worked hard at a
-- distinction — "forces beyond the natural order act on the story" against "the
-- supernatural as a fixture of the world rather than an intrusion into it" —
-- that is real in criticism and invisible to a reader choosing a shelf.
-- Paranormal is more than twice the size and the more common bookshop word.
do $$
declare l uuid; w uuid; r record;
begin
  select id into l from genres where normalized_name = 'supernatural';
  select id into w from genres where normalized_name = 'paranormal';
  if l is not null and w is not null then
    select * into r from merge_genres(l, w);
    raise notice 'merged Supernatural into Paranormal: moved=% dropped=% kids=% scalar=%',
      r.links_moved, r.links_dropped, r.children_repointed, r.books_rescalared;
  end if;
end $$;

-- Classic Literary Fiction: created 2026-08-11, zero books after two full
-- catalogue sweeps, while Classics holds 305. Merged rather than deleted so any
-- link created between this being written and being run is carried across
-- instead of dropped on the floor.
do $$
declare l uuid; w uuid; r record;
begin
  select id into l from genres where normalized_name = 'classicliteraryfiction';
  select id into w from genres where normalized_name = 'classics';
  if l is not null and w is not null then
    select * into r from merge_genres(l, w);
    raise notice 'merged Classic Literary Fiction into Classics: moved=% kids=%',
      r.links_moved, r.children_repointed;
  end if;
end $$;

-- ── 2. A compound that the prompt's own rule forbids ──────────────────────────
-- oracleBatch's GENRE RULES: "Prefer a single clear concept over a compound
-- name joined with '&': a book can carry several genres, so two ideas belong in
-- two genres." "Historical Horror" is that violation without the ampersand, and
-- the same prompt already assigns umbrellas alongside specifics — so these books
-- want Horror AND Historical Fiction, which is strictly more discoverable than
-- one shelf neither reader browses.
--
-- Order matters: add the Historical Fiction links BEFORE the merge, or the
-- historical half is lost when the row goes.
insert into book_genres (book_id, genre_id)
select bg.book_id, (select id from genres where normalized_name = 'historicalfiction')
  from book_genres bg
 where bg.genre_id = (select id from genres where normalized_name = 'historicalhorror')
   and (select id from genres where normalized_name = 'historicalfiction') is not null
on conflict do nothing;

do $$
declare l uuid; w uuid; r record;
begin
  select id into l from genres where normalized_name = 'historicalhorror';
  select id into w from genres where normalized_name = 'horror';
  if l is not null and w is not null then
    select * into r from merge_genres(l, w);
    raise notice 'merged Historical Horror into Horror: moved=% dropped=%', r.links_moved, r.links_dropped;
  end if;
end $$;

-- Recount Historical Fiction after the inserts above.
update genres g set usage_count = (select count(*) from book_genres bg where bg.genre_id = g.id)
 where g.normalized_name = 'historicalfiction';

-- ── 3. Parents for the genres curation created without one ────────────────────
-- Every one of these is unambiguously a kind of its parent. This is the
-- taxonomic axis only — which shelf a reader browses is the family layer's job,
-- and the two do not have to agree (Irish Fiction is a child of Literary Fiction
-- and belongs on the Place & Period shelf).
update genres c set parent_id = p.id
  from genres p
 where c.parent_id is null
   and (c.normalized_name, p.normalized_name) in (
     ('koreanliterature',      'eastasianliteraryfiction'),
     ('mexicanliterature',     'latinamericanliterature'),
     ('contemporaryromance',   'romance'),
     ('contemporaryfantasy',   'fantasy'),
     ('romaninspiredfantasy',  'fantasy'),
     ('necromancy',            'darkfantasy'),
     ('hardsciencefiction',    'sciencefiction'),
     ('biopunk',               'sciencefiction'),
     ('symbolist',             'literaryfiction'),
     ('latinamericanliterature','literaryfiction'),
     ('russianliterature',     'literaryfiction'),
     ('frenchliterature',      'literaryfiction'),
     ('italianliterature',     'literaryfiction'),
     ('scottishfiction',       'literaryfiction'),
     ('feministtheory',        'nonfiction'),
     ('politicaltheory',       'nonfiction'),
     ('anthropology',          'nonfiction'),
     ('business',              'nonfiction'),
     ('leadership',            'nonfiction')
   );

-- ── 4. Two descriptions that are wrong rather than merely old ─────────────────
-- Folk Horror cited The Wicker Man and The Ruins. Both are films. A book
-- catalogue should not illustrate a book genre with cinema.
update genres set description =
  'Rooted in the land, the old ways, and the community that keeps terrible secrets. Horror that grows from soil and ritual — the village that has its own calendar, and a reason for it.'
 where normalized_name = 'folkhorror';

-- Missing full stop.
update genres set description = rtrim(description) || '.'
 where normalized_name = 'poetry' and description not like '%.';

-- ── Verification ──────────────────────────────────────────────────────────────
-- select count(*) from genres;                        -- expect 168
--   171 - Japanese & East Asian Literary Fiction - Historical Horror
--       - Supernatural - Classic Literary Fiction = 167
-- select name from genres where description is null;  -- the 5 from tonight, until
--                                                     -- genreDescriptions.mjs runs
