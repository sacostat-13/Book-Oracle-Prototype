-- Retire "unknown", and make sure it cannot come back. 2026-09-22.
--
-- 20260918120000_genre_families_catchup.sql deleted the "unknown" genre. It was
-- back the next morning (created 2026-09-19 11:48) with 12 books, because the
-- thing that created it was never closed: every genre writer creates whatever
-- name it is handed, and the categorization prompt teaches "unknown" as the
-- honest answer for author gender and original language, so the Oracle carries
-- it into the genres array. Deleting the row treats the symptom.
--
-- This migration:
--   1. Drops "unknown" again — links, scalar and row — and lists its books.
--   2. Adds genres_not_placeholder, so no writer (upsert_genre, oracleBatch's
--      direct upsert, splitCompoundGenre, anything written later) can create a
--      placeholder genre. The list is mirrored in src/lib/genrePlaceholders.js,
--      which lets the writers drop them quietly instead of tripping this.
--   3. Files Canadian Literature, the one other genre with no shelf.
--   4. Medieval: describes medieval fiction, not medieval romance.
--   5. A distinctiveness pass over the descriptions — 29 rewrites where two
--      genres were describing the same shelf. The descriptions are what the
--      Oracle matches against (oracleBatch renders "- Name: description"), so
--      two genres that read alike get used interchangeably, and one of them
--      slowly empties. See claude/genre-descriptions-2026-09-22-distinctiveness.md.
--
-- Idempotent: a second run is a no-op. Ends with the families guard.

-- ── 1. "unknown" is not a genre, again ────────────────────────────────────────
-- The 12 books reported on 2026-09-22 are listed so the notice can say whether
-- the set has grown since. Every link to the genre is removed either way.
-- Books left with no genres fall back into books_needing_genres and get real
-- ones on the next nightly run.
do $$
declare
  _gid      uuid;
  _expected uuid[] := array[
    'ded2b96c-aa08-4b17-93cf-3cb13da2dc37',
    '87e1d1aa-79bd-4e9d-bdd0-95e50a439596',
    'bcf94b15-c4b1-47b4-9d69-e5c4bd39c25d',
    'f84f5aec-870a-4b93-a423-9dc7c3c9715a',
    'ad1d7063-44d8-454e-9ba9-fa8ec0eaf383',
    '9bcc8724-8322-4e5e-9636-f831912b0f48',
    '413fcda2-2c63-4d48-a066-b89929964974',
    'b6235cb2-5638-4462-8e30-9157c07f5c9a',
    'a3d8097f-ec90-4579-ab9d-f53f41dd6bd8',
    'f1f90945-8238-4fbb-8db0-3fd6e04e89f6',
    '9df4a2d2-1887-4d47-9c3d-fc9de2aefe2a',
    '68f0ade6-369d-432d-874b-0b0d0f17eac4'
  ]::uuid[];
  _actual   uuid[];
  _extra    uuid[];
  _scalar   int;
begin
  select id into _gid from genres where normalized_name = 'unknown';
  if _gid is null then
    raise notice 'unknown: already retired';
    return;
  end if;

  select coalesce(array_agg(book_id order by book_id), '{}') into _actual
    from book_genres where genre_id = _gid;
  select coalesce(array_agg(x), '{}') into _extra
    from unnest(_actual) x where x <> all (_expected);

  raise notice 'unknown: % linked book(s); % not in the 2026-09-22 list: %',
    cardinality(_actual), cardinality(_extra), _extra;

  delete from book_genres where genre_id = _gid;

  with r as (update books set genre = null where genre = 'unknown' returning 1)
  select count(*)::int into _scalar from r;
  raise notice 'unknown: cleared % books.genre scalar(s)', _scalar;

  delete from genres where id = _gid;
end $$;

-- ── 2. And cannot be created again ────────────────────────────────────────────
-- On normalized_name, so "Unknown", "UNKNOWN", "N/A" and "the unknown" are all
-- caught. Keep in step with GENRE_PLACEHOLDERS in src/lib/genrePlaceholders.js.
-- The same step also clears any other placeholder that slipped in, so the
-- constraint can never fail to apply.
do $$
declare r record;
begin
  for r in
    select id, name from genres where normalized_name in (
    'unknown', 'unknowngenre', 'other', 'others', 'misc', 'miscellaneous',
    'na', 'none', 'null', 'undefined', 'uncategorized', 'uncategorised',
    'unclassified', 'unsorted', 'tbd', 'various', 'genre', 'nogenre',
    'notapplicable'
    )
  loop
    delete from book_genres where genre_id = r.id;
    update books set genre = null where genre = r.name;
    delete from genres where id = r.id;
    raise notice 'dropped placeholder genre %', r.name;
  end loop;
end $$;

alter table genres drop constraint if exists genres_not_placeholder;
alter table genres add constraint genres_not_placeholder check (
  normalized_name not in (
    'unknown', 'unknowngenre', 'other', 'others', 'misc', 'miscellaneous',
    'na', 'none', 'null', 'undefined', 'uncategorized', 'uncategorised',
    'unclassified', 'unsorted', 'tbd', 'various', 'genre', 'nogenre',
    'notapplicable'
  )
);

-- ── 3. Canadian Literature: Place & Period, under Literary Fiction ────────────
-- Same shelf and parent as Irish, Scottish, Spanish and American Literature.
-- parent_id only where null, so a hand-chosen parent is never overwritten.
update genres g
   set family_id = f.id,
       parent_id = coalesce(g.parent_id, p.id)
  from genre_families f, genres p
 where g.normalized_name = 'canadianliterature'
   and f.slug = 'place'
   and p.normalized_name = 'literaryfiction';

-- ── 4 + 5. Descriptions ───────────────────────────────────────────────────────
-- By normalized_name. Each line's comment is the overlap it removes. The house
-- rules are the ones in batch-scripts/manual/genreDescriptions.mjs: a judgment
-- first, then the territory; ≤45 words; draw the boundary in the genre's own
-- terms, never by naming the neighbour. The one-line voice examples in that
-- file (French Literature, Pandemic Fiction, Parallel Worlds, Mythology, Dark
-- Comedy) are deliberately untouched.
do $$
declare
  _n int;
  _pair text[];
begin
  foreach _pair slice 1 in array array[
    -- Medieval: Described Medieval romance (courtship, the wedding) while filed under Historical Fiction in Place & Period. Now medieval themes only.
    ['medieval', 'Castles, oaths, and a faith that ordered everything. Fiction set in the Middle Ages — feudal loyalty, plague, crusade and cloister, in a world where the church and the lord between them decided most of a life.'],
    -- Canadian Literature: New genre; tightened from three sentences to the house two, and the defining-by-negation clause (neither British nor American) dropped.
    ['canadianliterature', 'A country too large to summarize, written region by region. Fiction from Canada — Indigenous voices, settler reckoning, and a wilderness treated as fact rather than metaphor.'],
    -- Weird Fiction: Said 'the wrongness is cosmic' — Cosmic Horror's exact territory. Now anchored on strangeness, not scale or fear.
    ['weirdfiction', 'Not a ghost, not a monster — something there is no word for yet. Strangeness rather than fright: impossible cities, wrong biologies, and a logic that is never explained and never quite hostile.'],
    -- Eco-Fiction: 'The land is … not well' read as Climate Fiction. Now about place and ecology, with the climate boundary drawn.
    ['ecofiction', 'The land is a character, not a backdrop. Fiction rooted in a particular ecology — rivers, forests, other species — where the bond between people and place carries the story, whatever the weather is doing.'],
    -- Science Fiction: 'Changes one thing and follows the consequences' was word-for-word Speculative Fiction's premise. SF now owns the science-and-technology shelf; Speculative keeps 'one rule changed'.
    ['sciencefiction', 'The future, argued rather than assumed. Ships, machines, other worlds and the societies they produce — the broad shelf for fiction whose premise rests on science and technology, however loosely.'],
    -- Folklore: 'Collected, retold' overlapped Mythology ('before the retellings'). Now local and oral, with gods left to Mythology.
    ['folklore', 'What a village tells itself after dark. Tales, charms and superstitions from oral tradition — the small, local stories of cunning folk and household spirits, rather than of gods.'],
    -- Dark Fantasy: 'Moral rot' was Grimdark's ground (morally compromised characters). Dark Fantasy now stays on horror and dread.
    ['darkfantasy', 'Magic that costs more than it gives. Fantasy written in the register of horror — dread, monstrous things, and a supernatural that is a threat rather than a wonder.'],
    -- Intimate Fiction: Could not be told apart from Smutty Corner or Romance. Now: not explicit, and no guaranteed happy ending.
    ['intimatefiction', 'Desire as the subject, not the subplot. Sensual adult fiction about attraction and the charged space between people — frank without being graphic, and under no obligation to end happily.'],
    -- Contemporary Romance: Three sentences, ~55 words (flagged in the families spec). Same content, house length.
    ['contemporaryromance', 'Love stories set now, in the world as it is. Coffee shops, shared flats and small towns, where the obstacles are emotional rather than historical and the happy ending feels within reach.'],
    -- Philosophical Fiction: 'Free will, what it means to live a life' overlapped Existential ('meaning, freedom and absurdity'). Existential keeps meaning; this keeps ideas.
    ['philosophicalfiction', 'Novels that want to think. Ideas about mind, ethics and knowledge worked out through character and plot — the argument carried by the story rather than stated beside it.'],
    -- Psychological Fiction: 'Dread from the inside out' pulled it toward Suspense/Thriller. It's on The Literary Shelf; now reads that way.
    ['psychologicalfiction', 'The interior as the true battleground. Unreliable minds, shifting perceptions and obsession examined closely — fiction where what the narrator believes is the thing most in question.'],
    -- Postmodern: 'The novel, aware it is a novel' is the definition of Metafiction. Postmodern is now the period and sensibility.
    ['postmodern', 'After the grand narratives stopped being believed. Late twentieth-century fiction of pastiche, irony and high and low culture collapsed together — suspicious of the straight line, and of anyone claiming the last word.'],
    -- Experimental & Avant-Garde: 'Fragmenting form, dissolving narrative' was Modernist's description. Now period-free and about form. Also cut from four sentences.
    ['experimentalavantgarde', 'Form as the first question, not the last. Work that distrusts the conventional novel in any decade — constraint, collage and language pushed forward until reading becomes part of the labour.'],
    -- Social Commentary: 'Power' was also Political Fiction's first word. Now ordinary lives vs. the machinery of government.
    ['socialcommentary', 'Fiction with an argument. Novels that hold class, race, gender and the everyday arrangements of a society up for inspection — critique carried by ordinary lives rather than by governments.'],
    -- Political Thriller: Listed 'espionage' as its own content, which is the Espionage genre. Replaced with elections and coups.
    ['politicalthriller', 'The threat comes from the office, not the street. Thrillers set in the corridors of power — elections, cabinets and coups, where the plot turns on policy as much as on violence.'],
    -- Action: One line that read as either Thriller (pace) or Adventure (movement). Second sentence draws both edges.
    ['action', 'The plot arrives at a run. Fights, firefights and set pieces staged for their own sake — the body in motion as the whole point, with no destination or ticking clock required.'],
    -- Biography: Explicitly included memoir ('memoir's inward turn … together'), which is its own genre now. Biography is outside-in only.
    ['biography', 'A life reconstructed from the outside. Written from letters, archives and interviews by someone who was not there — a real person given the shape and attention of a novel.'],
    -- Illustrated: 'The pictures are not decoration' was nearly Graphic Novel's 'The image is never decoration here'.
    ['illustrated', 'The text came first; the pictures answer it. Illustrated editions, art books and visual essays — prose with images alongside, rather than stories told panel by panel.'],
    -- Comedy & Wit: Claimed 'darkly comic literary fiction', which is Dark Comedy. Now the light end only; also cut to house length.
    ['comedywit', 'Sharp tongues, absurd situations, and the risk of laughing out loud on public transport. Comic writing at its lightest and cleverest — farce, repartee, and fools with excellent tailoring.'],
    -- International Fiction: Named Latin American and Celtic, both of which now have their own shelves (Latin American Fiction, Irish, Scottish). Now the catch-all it actually is.
    ['internationalfiction', 'The world beyond the English-language default. Literary fiction from places without a narrower shelf here yet — read in translation or in its own English, and never flattened into a postcard of its region.'],
    -- Korean Literature: Korean, Japanese and East Asian Literary Fiction all opened on 'restraint'. The umbrella keeps it; Korean now has its own history.
    ['koreanliterature', 'A small country carrying a very heavy century. Fiction from Korea — division and dictatorship, family obligation, and a society that expects a great deal and forgives little.'],
    -- Japanese Literature: Same 'restraint/precision' as its parent. Now names what is particular to the Japanese shelf.
    ['japaneseliterature', 'Seasons, silences, and the moment before something breaks. Writing from Japan — the puzzle-box detective novel, quiet domestic drama, and the uncanny sitting politely at the table.'],
    -- American Gothic: Nothing separated it from Southern Gothic. Now explicitly the rest of the country.
    ['americangothic', 'Old sins keep their addresses in the new world. Decay and inherited guilt from New England to the plains — small towns, family land, and the violence underneath the founding story.'],
    -- Latin American Fiction: 'Realism optional … the miraculous' described Magical Realism. Now the politics and history that are this shelf's own.
    ['latinamericanfiction', 'Dictators, exile, and cities arguing with their own history. Fiction from Latin America, from the Boom to the present — a literature that has always treated politics as a family matter.'],
    -- Spanish Literature: 'The Spanish language' swallowed Latin American, Mexican and Chicano writing. Now Spain only.
    ['spanishliterature', 'Written in Spanish, and not translated into blandness. The literature of Spain itself — the Golden Age and the picaresque, through the Civil War and the long silence after it.'],
    -- Scandinavian Horror: 'Folklore' is Folk Horror's word. Swapped for Nordic specifics.
    ['scandinavianhorror', 'Long dark, deep forest, small town. Nordic horror — winter isolation, trolls and the drowned, and the particular dread of a landscape that can simply absorb a person.'],
    -- Celtic Fantasy: 'Fae bargains' is the Fae genre's first idea. Replaced with the Celtic material only this shelf has.
    ['celticfantasy', 'The old country, where the hills are hollow. Standing stones, selkies and the heroes of the old cycles, rooted in Irish, Scottish and Welsh tradition and its thin places between worlds.'],
    -- Contemporary Fiction: 'More interested in … than in genre convention' is Literary Fiction's line. Now defined by the present tense alone.
    ['contemporaryfiction', 'Life as it is lived right now. Fiction set in the recognizable present — work, rent, phones and families — where the ordinary texture of the day is the subject.'],
    -- Surrealism: 'The impossible treated with a straight face' is Magical Realism's 'no one finds this strange'. Now dream logic, not domesticated wonder.
    ['surrealism', 'Dream logic, followed rigorously. Fiction built from the unconscious — dislocated images, impossible sequences, and scenes that make sense only the way dreams do.']
  ] loop
    update genres set description = _pair[2]
     where normalized_name = _pair[1]
       and description is distinct from _pair[2];
    get diagnostics _n = row_count;
    if not exists (select 1 from genres where normalized_name = _pair[1]) then
      raise notice 'description: % not found — renamed or merged since?', _pair[1];
    end if;
  end loop;
end $$;

-- ── Guard: every genre on exactly one shelf ───────────────────────────────────
do $$ declare n int; names text; begin
  select count(*), string_agg(name, ', ' order by name) into n, names
    from genres where family_id is null;
  if n > 0 then raise exception 'retire_unknown_genre: % genre(s) unassigned: %', n, names; end if;
end $$;

-- ── Verification ──────────────────────────────────────────────────────────────
-- select count(*) from genres where normalized_name = 'unknown';        -- 0
-- select name from genres where family_id is null;                      -- none
-- insert into genres (name, normalized_name, source)
--   values ('Unknown', 'unknown', 'oracle');                            -- fails: genres_not_placeholder
-- select count(*) from book_genres bg
--   where bg.book_id in (<the 12 ids>);                                 -- whatever real genres they had
