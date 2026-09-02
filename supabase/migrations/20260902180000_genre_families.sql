-- 20260902180000_genre_families.sql
-- The family layer: one curated shelf per genre, above the taxonomy.
--
-- Families are admin-only and live in their own table. The Oracle creates
-- genres nightly — 5 on 2026-09-02 alone — but it cannot reach a table it does
-- not write to, so it can never invent a family or file a book directly against
-- one.
--
-- family_id is nullable in the schema and non-null in practice: a genre created
-- tonight must still render, so the app falls back to a neutral plate and the
-- weekly `family_id is null` check is the curation queue.
--
-- family_id answers "which shelf does a reader find this on?" — total, exactly
-- one per genre, never nested. parent_id answers "is this a kind of that?" —
-- sparse, optional, nests. They are allowed to disagree, and they do: Irish
-- Literature is a child of Literary Fiction and sits on the Place & Period
-- shelf. Do not try to derive one from the other.

create table if not exists genre_families (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  description  text,
  sort_order   int  not null default 0,
  plate_asset  text,          -- the illustrator's plate for this family
  created_at   timestamptz not null default now()
);

alter table genres add column if not exists family_id uuid references genre_families(id);
create index if not exists genres_family_id_idx on genres(family_id);

insert into genre_families (slug, name, description, sort_order) values
  ('fantasy', 'Fantasy & the Invented', 'Magic with rules, and a map in the endpapers.', 0),
  ('scifi', 'Science Fiction & the Future', 'One thing changed, and every consequence followed.', 10),
  ('horror', 'Horror & the Uncanny', 'Something is in the room, and it means it.', 20),
  ('gothic', 'Gothic', 'The past keeps its address and expects visitors.', 30),
  ('crime', 'Crime & Suspense', 'Someone did it; the clock is running.', 40),
  ('romance', 'Love & Desire', 'Two people, and everything in the way.', 50),
  ('literary', 'The Literary Shelf', 'The sentence is the event.', 60),
  ('place', 'Place & Period', 'Fiction that could only have come from where it did.', 70),
  ('society', 'Society & Self', 'The private life, and the public one pressing on it.', 80),
  ('myth', 'Myth & Folklore', 'The stories that were told before anyone wrote them down.', 90),
  ('adventure', 'Adventure & Action', 'Somewhere to go and trouble on the way.', 100),
  ('comedy', 'Comedy & Satire', 'A joke, usually with a target.', 110),
  ('verse', 'Verse & Stage', 'Written to be spoken aloud.', 120),
  ('panel', 'Page & Panel', 'The picture is half the language.', 130),
  ('young', 'Young Readers', 'First everything, at full volume.', 140),
  ('ideas', 'Ideas & Lives', 'The world as it actually is, examined.', 150)
on conflict (slug) do nothing;

-- Assignment by normalized_name, so this reads as an argument rather than UUIDs
-- and survives any id churn.
-- Fantasy & the Invented (21)
update genres set family_id = (select id from genre_families where slug = 'fantasy')
 where normalized_name in (
   'asianinspiredfantasy',
   'contemporaryfantasy',
   'courtintrigue',
   'cozyfantasy',
   'darkfantasy',
   'dragons',
   'dyingearth',
   'epicfantasy',
   'fairytaleretelling',
   'fantasy',
   'flintlockfantasy',
   'grimdark',
   'historicalfantasy',
   'litrpg',
   'militaryfantasy',
   'necromancy',
   'portalfantasy',
   'questfantasy',
   'romaninspiredfantasy',
   'sapphicfantasy',
   'urbanfantasy'
 );

-- Science Fiction & the Future (19)
update genres set family_id = (select id from genre_families where slug = 'scifi')
 where normalized_name in (
   'alieninvasion',
   'apocalyptic',
   'biopunk',
   'classicsciencefiction',
   'climatefiction',
   'cyberpunk',
   'dystopian',
   'ecofiction',
   'firstcontact',
   'hardsciencefiction',
   'militarysciencefiction',
   'pandemicfiction',
   'parallelworlds',
   'postapocalyptic',
   'sciencefiction',
   'spaceopera',
   'speculativefiction',
   'steampunk',
   'timetravel'
 );

-- Horror & the Uncanny (17)
update genres set family_id = (select id from genre_families where slug = 'horror')
 where normalized_name in (
   'bodyhorrortransgressive',
   'cosmichorror',
   'demonsmonsters',
   'eastasianhorror',
   'folkhorror',
   'hauntedhouses',
   'horror',
   'indigenoushorror',
   'paranormal',
   'scandinavianhorror',
   'slasher',
   'technohorror',
   'vampires',
   'weirdfiction',
   'werewolves',
   'witches',
   'zombies'
 );

-- Gothic (7)
update genres set family_id = (select id from genre_families where slug = 'gothic')
 where normalized_name in (
   'americangothic',
   'australiangothic',
   'classicoldergothic',
   'darkacademia',
   'feministsapphicgothic',
   'gothic',
   'southerngothic'
 );

-- Crime & Suspense (9)
update genres set family_id = (select id from genre_families where slug = 'crime')
 where normalized_name in (
   'crimefiction',
   'crimenoir',
   'espionage',
   'heist',
   'legalthriller',
   'mystery',
   'suspense',
   'technothriller',
   'thriller'
 );

-- Love & Desire (7)
update genres set family_id = (select id from genre_families where slug = 'romance')
 where normalized_name in (
   'contemporaryromance',
   'fantasyromance',
   'historicalromance',
   'intimatefiction',
   'lgbtqromance',
   'romance',
   'smuttycorner'
 );

-- The Literary Shelf (18)
update genres set family_id = (select id from genre_families where slug = 'literary')
 where normalized_name in (
   'anthology',
   'classics',
   'contemporaryfiction',
   'cultfiction',
   'epistolaryfiction',
   'existential',
   'experimentalavantgarde',
   'hopefulfiction',
   'literaryfiction',
   'magicalrealism',
   'metafiction',
   'modernist',
   'philosophicalfiction',
   'postmodern',
   'psychologicalfiction',
   'shortfiction',
   'surrealism',
   'symbolist'
 );

-- Place & Period (17)
update genres set family_id = (select id from genre_families where slug = 'place')
 where normalized_name in (
   'americanliterature',
   'chicanolatinxfiction',
   'eastasianliteraryfiction',
   'frenchliterature',
   'historicalfiction',
   'internationalfiction',
   'irishliterature',
   'italianliterature',
   'koreanliterature',
   'latinamericanfiction',
   'mexicanliterature',
   'russianliterature',
   'scottishliterature',
   'southernfiction',
   'spanishliterature',
   'victorianfiction',
   'western'
 );

-- Society & Self (10)
update genres set family_id = (select id from genre_families where slug = 'society')
 where normalized_name in (
   'comingofage',
   'familydrama',
   'feministfiction',
   'identitybelonging',
   'lgbtqfiction',
   'musicfiction',
   'parentingmotherhood',
   'politicalfiction',
   'socialcommentary',
   'warfiction'
 );

-- Myth & Folklore (6)
update genres set family_id = (select id from genre_families where slug = 'myth')
 where normalized_name in (
   'arthurian',
   'celticfantasy',
   'folklore',
   'mythologicalfantasy',
   'mythology',
   'vikingsnorse'
 );

-- Adventure & Action (6)
update genres set family_id = (select id from genre_families where slug = 'adventure')
 where normalized_name in (
   'action',
   'adventure',
   'aviation',
   'martialarts',
   'sportsfiction',
   'survivalfiction'
 );

-- Comedy & Satire (3)
update genres set family_id = (select id from genre_families where slug = 'comedy')
 where normalized_name in (
   'comedywit',
   'darkcomedy',
   'satire'
 );

-- Verse & Stage (4)
update genres set family_id = (select id from genre_families where slug = 'verse')
 where normalized_name in (
   'drama',
   'epicpoetry',
   'poetry',
   'tragedy'
 );

-- Page & Panel (4)
update genres set family_id = (select id from genre_families where slug = 'panel')
 where normalized_name in (
   'graphicnovel',
   'illustrated',
   'manga',
   'superheroepic'
 );

-- Young Readers (3)
update genres set family_id = (select id from genre_families where slug = 'young')
 where normalized_name in (
   'childrensfiction',
   'childrenspicturebook',
   'youngadult'
 );

-- Ideas & Lives (16)
update genres set family_id = (select id from genre_families where slug = 'ideas')
 where normalized_name in (
   'anthropology',
   'arthistory',
   'biography',
   'business',
   'culturalstudies',
   'feministtheory',
   'griefmemoir',
   'inspirational',
   'leadership',
   'literarycriticism',
   'medicalnarrative',
   'memoir',
   'nonfiction',
   'philosophy',
   'politicaltheory',
   'theology'
 );

-- Guard: every genre must land on exactly one shelf.
do $$ declare n int; begin
  select count(*) into n from genres where family_id is null;
  if n > 0 then raise exception 'genre_families: % genre(s) unassigned', n; end if;
end $$;