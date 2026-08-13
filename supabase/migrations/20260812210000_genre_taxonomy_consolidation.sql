-- Genre taxonomy: split the compounds, merge the duplicates, declare the hierarchy.
--
-- WHY NOW
--
-- The taxonomy was designed when a book could realistically only carry one
-- genre, so compound names did the work of two: "Southern & American Gothic"
-- existed because a book had to be filed under exactly one thing and neither
-- half alone would do. Multi-genre linking now works (it had been failing
-- silently — see the note in batch-scripts/manual/oracleBatch.mjs), which
-- removes the reason those compounds existed.
--
-- With more than one genre per book, specific beats broad, and a book can carry
-- BOTH: "Horror" and "Folk Horror" together, so a reader who follows the broad
-- shelf and a reader who follows the narrow one both find it.
--
-- THREE CHANGES
--
--   1. Split five compound genres into halves that already exist as empty rows.
--   2. Merge three zero-usage duplicates into their canonical twin.
--   3. Add genres.parent_id, so "Folk Horror" knows its umbrella is "Horror"
--      and the curation scripts can attach the umbrella automatically instead
--      of hoping a keyword rule happens to fire.
--
-- EXISTING LINKS ARE REMAPPED, NEVER DROPPED. Each split sends its books to the
-- likelier half — "Southern & American Gothic" is overwhelmingly Southern
-- Gothic in practice — and the full re-genre pass corrects and extends
-- afterwards. Nothing browses as genre-less at any point.

begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- 0. Umbrella hierarchy
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Self-referencing, nullable: an umbrella has no parent, a subgenre points at
-- one. Deliberately one level deep. A deeper tree invites "Folk Horror ->
-- British Folk Horror -> Cornish Folk Horror", and nobody browsing wants that.
--
-- ON DELETE SET NULL rather than CASCADE: removing the "Horror" row must not
-- take twelve subgenres and their book links with it.

alter table public.genres
  add column if not exists parent_id uuid references public.genres(id) on delete set null;

create index if not exists genres_parent_idx on public.genres (parent_id);

comment on column public.genres.parent_id is
  'The broader genre this one sits under (one level only). NULL for umbrella '
  'genres and for genres with no natural parent. Curation attaches the parent '
  'alongside the specific genre so a book appears on both shelves.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Rows that must exist before anything can point at them
-- ══════════════════════════════════════════════════════════════════════════════
--
-- normalized_name mirrors the DB's normalize_genre_name(): lowercase, strip
-- everything that is not a letter or digit. Computed here rather than trusting
-- a default, because the column is NOT NULL and is what every lookup joins on.

insert into public.genres (name, normalized_name, description, source)
values
  ('Gothic',
   'gothic',
   'Dread built from place and inheritance. The mode rather than any one setting — ruin, secrecy and the past refusing to stay past, whatever century it is wearing.',
   'admin'),
  ('Climate Fiction',
   'climatefiction',
   'The weather stopped being background. Fiction that takes a changing climate as its subject — near-future, present-tense, and decreasingly speculative.',
   'admin')
on conflict (normalized_name) do nothing;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Splits
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Each compound's books move to the half they most likely belong to. The other
-- half exists and is empty, waiting for the re-genre pass to populate it
-- properly from source subjects.
--
-- `on conflict do nothing` on every move: a book already carrying the
-- destination genre must not raise, it is simply already where it is going.

-- Southern & American Gothic (76) -> Southern Gothic
--   The shelf was built for Faulkner/O'Connor/McCullers. American Gothic in the
--   non-Southern sense (Shirley Jackson, Poe) is the minority case and the
--   re-genre pass is better placed to find it than a blanket rule here.
with src as (select id from public.genres where normalized_name = 'southernamericangothic'),
     dst as (select id from public.genres where normalized_name = 'southerngothic')
insert into public.book_genres (book_id, genre_id, assigned_by_source)
select bg.book_id, (select id from dst), 'oracle'
from public.book_genres bg
where bg.genre_id = (select id from src)
on conflict (book_id, genre_id) do nothing;

-- Dark & Epic Fantasy (292) -> Epic Fantasy
--   "Epic" is the load-bearing half: the shelf is dominated by long secondary-
--   world series. Dark Fantasy is a tonal claim that needs reading the book,
--   which is exactly what the re-genre pass does and this migration cannot.
with src as (select id from public.genres where normalized_name = 'darkepicfantasy'),
     dst as (select id from public.genres where normalized_name = 'epicfantasy')
insert into public.book_genres (book_id, genre_id, assigned_by_source)
select bg.book_id, (select id from dst), 'oracle'
from public.book_genres bg
where bg.genre_id = (select id from src)
on conflict (book_id, genre_id) do nothing;

-- Sci-Fi & Speculative (169) -> Science Fiction
with src as (select id from public.genres where normalized_name = 'scifispeculative'),
     dst as (select id from public.genres where normalized_name = 'sciencefiction')
insert into public.book_genres (book_id, genre_id, assigned_by_source)
select bg.book_id, (select id from dst), 'oracle'
from public.book_genres bg
where bg.genre_id = (select id from src)
on conflict (book_id, genre_id) do nothing;

-- Gothic & Haunted Houses (200) -> Gothic
--   Gothic is the umbrella and the safer landing place; Haunted Houses is the
--   specific claim, and only some of these 200 have an actual house in them.
with src as (select id from public.genres where normalized_name = 'gothichauntedhouses'),
     dst as (select id from public.genres where normalized_name = 'gothic')
insert into public.book_genres (book_id, genre_id, assigned_by_source)
select bg.book_id, (select id from dst), 'oracle'
from public.book_genres bg
where bg.genre_id = (select id from src)
on conflict (book_id, genre_id) do nothing;

-- Cli-Fi & Eco-Fiction (0) -> Climate Fiction. No links to move.
-- Listed for symmetry so the retirement below is not the only trace of it.

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Merges — zero-usage duplicates
-- ══════════════════════════════════════════════════════════════════════════════
--
-- All three have usage_count = 0, so nothing moves and nothing can be lost.
-- They are removed because two names for one shelf splits discovery: a reader
-- filtering "Satire" should not miss books filed under "Satirical Fiction".
--
-- The link-moving statement is kept anyway rather than assuming the counts hold
-- at apply time — the nightly job may have run since the CSV was exported.

with pairs(dup, keep) as (values
  ('romanticfiction',                  'romance'),
  ('satiricalfiction',                 'satire'),
  ('japaneseeastasianliteraryfiction', 'eastasianliteraryfiction')
)
insert into public.book_genres (book_id, genre_id, assigned_by_source)
select bg.book_id, k.id, 'oracle'
from pairs p
join public.genres d on d.normalized_name = p.dup
join public.genres k on k.normalized_name = p.keep
join public.book_genres bg on bg.genre_id = d.id
on conflict (book_id, genre_id) do nothing;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Retire the replaced rows
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Deleted, not flagged. book_genres cascades on genre delete, so the old links
-- go with them — which is correct, because step 2 and 3 already copied every
-- one of those books onto its destination genre. Anything still pointing here
-- is a duplicate of a link that now exists elsewhere.
--
-- Verify BEFORE running in production if you want certainty:
--   select g.name, count(*) from public.book_genres bg
--   join public.genres g on g.id = bg.genre_id
--   where g.normalized_name in (...) group by g.name;
-- then re-run the same query after, expecting the destinations to have grown by
-- the same amounts.

delete from public.genres
where normalized_name in (
  'southernamericangothic',
  'darkepicfantasy',
  'scifispeculative',
  'gothichauntedhouses',
  'clifiecofiction',
  'romanticfiction',
  'satiricalfiction',
  'japaneseeastasianliteraryfiction'
);

-- usage_count is maintained by the bump_genre_usage trigger on INSERT/DELETE of
-- book_genres, and a cascade delete fires it — but the copies in steps 2-3 and
-- the cascade happen in an order the trigger cannot reason about. Recount from
-- the source of truth rather than trusting the running total.
update public.genres g
set usage_count = coalesce(c.n, 0)
from (
  select genre_id, count(*)::int as n from public.book_genres group by genre_id
) c
where c.genre_id = g.id;

update public.genres g
set usage_count = 0
where not exists (select 1 from public.book_genres bg where bg.genre_id = g.id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Declare the umbrellas
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Only genres with a genuine broader parent are listed. A genre absent from
-- this table keeps parent_id NULL, which is a valid answer — "Magical Realism"
-- has no umbrella in this taxonomy and inventing one would be worse than
-- leaving it alone.
--
-- Umbrellas themselves: Horror, Fantasy, Science Fiction, Romance, Mystery,
-- Literary Fiction, Non-Fiction, Gothic. These stay parentless.

with rel(child, parent) as (values
  -- Horror
  ('folkhorror','horror'), ('cosmichorror','horror'), ('bodyhorrortransgressive','horror'),
  ('slasher','horror'), ('japaneseeastasianhorror','horror'), ('indigenoushorror','horror'),
  ('scandinavianhorror','horror'), ('technohorror','horror'), ('vampires','horror'),
  ('zombies','horror'), ('werewolves','horror'), ('demonsmonsters','horror'),
  ('hauntedhouses','horror'), ('witches','horror'),
  -- Gothic
  ('southerngothic','gothic'), ('americangothic','gothic'), ('australiangothic','gothic'),
  ('classicoldergothic','gothic'), ('feministsapphicgothic','gothic'),
  -- Fantasy
  ('epicfantasy','fantasy'), ('darkfantasy','fantasy'), ('cozyfantasy','fantasy'),
  ('urbanfantasy','fantasy'), ('historicalfantasy','fantasy'), ('celticfantasy','fantasy'),
  ('asianinspiredfantasy','fantasy'), ('mythologicalfantasy','fantasy'),
  ('portalfantasy','fantasy'), ('questfantasy','fantasy'), ('militaryfantasy','fantasy'),
  ('flintlockfantasy','fantasy'), ('sapphicfantasy','fantasy'), ('grimdark','fantasy'),
  ('dragons','fantasy'), ('arthurian','fantasy'), ('fairytaleretelling','fantasy'),
  ('litrpg','fantasy'), ('dyingearth','fantasy'),
  -- Science Fiction
  ('spaceopera','sciencefiction'), ('militarysciencefiction','sciencefiction'),
  ('classicsciencefiction','sciencefiction'), ('cyberpunk','sciencefiction'),
  ('steampunk','sciencefiction'), ('firstcontact','sciencefiction'),
  ('alieninvasion','sciencefiction'), ('timetravel','sciencefiction'),
  ('dystopian','sciencefiction'), ('postapocalyptic','sciencefiction'),
  ('apocalyptic','sciencefiction'), ('climatefiction','sciencefiction'),
  ('speculativefiction','sciencefiction'),
  -- Romance
  ('historicalromance','romance'), ('fantasyromance','romance'),
  ('lgbtqromance','romance'), ('smuttycorner','romance'), ('intimatefiction','romance'),
  -- Mystery
  ('crimefiction','mystery'), ('crimenoir','mystery'), ('legalthriller','mystery'),
  ('espionage','mystery'), ('heist','mystery'), ('thriller','mystery'),
  ('suspense','mystery'),
  -- Literary Fiction
  ('classicliteraryfiction','literaryfiction'), ('modernist','literaryfiction'),
  ('postmodern','literaryfiction'), ('metafiction','literaryfiction'),
  ('experimentalavantgarde','literaryfiction'), ('surrealism','literaryfiction'),
  ('existential','literaryfiction'), ('epistolaryfiction','literaryfiction'),
  ('magicalrealism','literaryfiction'), ('philosophicalfiction','literaryfiction'),
  ('psychologicalfiction','literaryfiction'), ('eastasianliteraryfiction','literaryfiction'),
  ('internationalfiction','literaryfiction'), ('americanliterature','literaryfiction'),
  ('victorianfiction','literaryfiction'), ('irishfiction','literaryfiction'),
  ('spanishliterature','literaryfiction'), ('chicanolatinxfiction','literaryfiction'),
  -- Non-Fiction
  ('biography','nonfiction'), ('memoir','nonfiction'), ('griefmemoir','nonfiction'),
  ('medicalnarrative','nonfiction'), ('philosophy','nonfiction'), ('theology','nonfiction'),
  ('literarycriticism','nonfiction'), ('culturalstudies','nonfiction'),
  ('arthistory','nonfiction')
)
update public.genres g
set parent_id = p.id
from rel r
join public.genres p on p.normalized_name = r.parent
where g.normalized_name = r.child
  and g.id <> p.id;

commit;

-- ══════════════════════════════════════════════════════════════════════════════
-- Verify
-- ══════════════════════════════════════════════════════════════════════════════
-- select count(*) from public.genres;                      -- expect 136
-- select count(*) from public.genres where parent_id is not null;
-- select g.name, g.usage_count from public.genres g
--   where g.normalized_name in ('southerngothic','epicfantasy','sciencefiction','gothic')
--   order by g.usage_count desc;                           -- expect 76 / 292 / 169 / 200
-- select name from public.genres where normalized_name like '%%&%%';  -- sanity
