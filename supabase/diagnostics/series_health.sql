-- Series health, ranked by Search Console impressions.
--
-- WHAT THIS IS FOR
--
-- Run this in the Supabase SQL editor. It answers "are we getting the right
-- books on the series" for the 175 series pages that actually earned
-- impressions in the 28 days to 2026-09-06, worst-first among the ones people
-- are already being shown. Everything else in the catalog can wait.
--
-- The impressions below are pasted from the Search Console Pages export
-- (Paginas.csv, 28 days to 2026-09-06). They are a fixed snapshot, not live --
-- re-export and regenerate this block when you want fresh numbers.
--
-- READING THE OUTPUT
--
--   held            volumes in the catalog after series_volumes collapses
--                   duplicate editions -- what the page can actually list
--   held_live       of those, how many pass the sitemap's status bar
--                   (verified / oracle_categorized). The series page and the
--                   prerender both filter on this today, so held_live is the
--                   number a visitor sees. held - held_live is how much the
--                   status filter is hiding.
--   total_books     what series.total_books claims the series HAS
--   missing         positions between 1 and the highest we hold that are absent
--                   -- Red Rising rendering 1,2,3,5 shows up here as "4"
--   dup_positions   two volumes still sharing a position AFTER dedupe. Must be
--                   0. Anything else is a bug in series_volumes, not data.
--   collapsed       duplicate edition rows the view absorbed. High numbers are
--                   not a problem, they are the fix working -- Wicked should
--                   show several.
--   verdict         the one-word summary. Fix INCOMPLETE and MISLABELLED first:
--                   those are pages promising "every book" and not delivering.
--
-- The three worst offenders as sampled by hand on 2026-09-08 were Crescent
-- City (says 3, listed the same book twice), Dragonlance Chronicles (says 3,
-- listed 1) and Red Rising Saga (says 6, listed 1/2/3/5). If this query does
-- not flag those three, it is not measuring what it claims to.

with gsc (series_name, norm, impressions) as (
  values
    ('Crescent City', 'crescentcity', 75),
    ('Dragonlance Chronicles', 'dragonlancechronicles', 74),
    ('Wicked', 'wicked', 50),
    ('Fablehaven', 'fablehaven', 40),
    ('Hyperion Cantos', 'hyperioncantos', 33),
    ('Marvel Zombies', 'marvelzombies', 33),
    ('Red Rising Saga', 'redrisingsaga', 32),
    ('The Godfather', 'godfather', 30),
    ('Robert Langdon', 'robertlangdon', 27),
    ('Malazan Book of the Fallen', 'malazanbookofthefallen', 24),
    ('The Shepherd King', 'shepherdking', 22),
    ('Hellboy', 'hellboy', 21),
    ('Night Lords', 'nightlords', 21),
    ('Discworld: Tiffany Aching', 'discworldtiffanyaching', 20),
    ('The Bloodsworn Saga', 'bloodswornsaga', 18),
    ('Dungeon Crawler Carl', 'dungeoncrawlercarl', 17),
    ('The Witcher', 'witcher', 17),
    ('Howl''s Moving Castle', 'howlsmovingcastle', 16),
    ('The Locked Tomb', 'lockedtomb', 16),
    ('Chronicles of Narnia', 'chroniclesofnarnia', 15),
    ('John Dies at the End', 'johndiesattheend', 14),
    ('Ring', 'ring', 14),
    ('The Icewind Dale', 'icewinddale', 14),
    ('Hannibal Lecter', 'hanniballecter', 13),
    ('The Inheritance Trilogy', 'inheritancetrilogy', 12),
    ('The Licanius Trilogy', 'licaniustrilogy', 11),
    ('Y: The Last Man', 'ythelastman', 11),
    ('Dune Chronicles', 'dunechronicles', 10),
    ('Lorien Legacies', 'lorienlegacies', 10),
    ('Overlord (Light Novel)', 'overlordlightnovel', 10),
    ('The Crowns of Nyaxia', 'crownsofnyaxia', 10),
    ('Jonathan Strange & Mr Norrell', 'jonathanstrangemrnorrell', 9),
    ('Priest', 'priest', 9),
    ('The Belgariad', 'belgariad', 9),
    ('The Chronicles of Narnia', 'chroniclesofnarnia', 9),
    ('The Lunar Chronicles', 'lunarchronicles', 9),
    ('Cormoran Strike', 'cormoranstrike', 8),
    ('JoJo''s Bizarre Adventure: Stone Ocean', 'jojosbizarreadventurestoneocean', 8),
    ('The Agent', 'agent', 8),
    ('The Captive''s War', 'captiveswar', 8),
    ('Empire of the Vampire', 'empireofthevampire', 7),
    ('Fate/strange fake', 'fatestrangefake', 7),
    ('Infected', 'infected', 7),
    ('The Legend of the Condor Heroes', 'legendofthecondorheroes', 7),
    ('The Second Formic War', 'secondformicwar', 7),
    ('Belladonna', 'belladonna', 6),
    ('Regency Faerie Tales', 'regencyfaerietales', 6),
    ('The Reckoners', 'reckoners', 6),
    ('Wonder', 'wonder', 6),
    ('Earthseed', 'earthseed', 5),
    ('Hainish Cycle', 'hainishcycle', 5),
    ('Rat', 'rat', 5),
    ('Seraphina', 'seraphina', 5),
    ('Song of the Damned', 'songofthedamned', 5),
    ('Tales of the Otori', 'talesoftheotori', 5),
    ('The Hollow Kingdom', 'hollowkingdom', 5),
    ('Will Trent', 'willtrent', 5),
    ('Bird Box', 'birdbox', 4),
    ('British Library Tales of the Weird', 'britishlibrarytalesoftheweird', 4),
    ('Commonwealth Saga', 'commonwealthsaga', 4),
    ('Dollanganger', 'dollanganger', 4),
    ('Gunmetal Gods', 'gunmetalgods', 4),
    ('Love Hina', 'lovehina', 4),
    ('Magic 2.0', 'magic20', 4),
    ('Parasol Protectorate', 'parasolprotectorate', 4),
    ('Raven of the Inner Palace', 'ravenoftheinnerpalace', 4),
    ('Redwall', 'redwall', 4),
    ('Ripley', 'ripley', 4),
    ('Shadow of the Leviathan', 'shadowoftheleviathan', 4),
    ('The Rithmatist', 'rithmatist', 4),
    ('Winter''s Orbit', 'wintersorbit', 4),
    ('Analog', 'analog', 3),
    ('Caster Chronicles', 'casterchronicles', 3),
    ('Chobits', 'chobits', 3),
    ('Crimson Crown', 'crimsoncrown', 3),
    ('Daemon', 'daemon', 3),
    ('First Law World', 'firstlawworld', 3),
    ('Flame Tree Collector''s Editions Mythology', 'flametreecollectorseditionsmythology', 3),
    ('Fred, the Vampire Accountant', 'fredthevampireaccountant', 3),
    ('Gentleman Bastard', 'gentlemanbastard', 3),
    ('Ghosted', 'ghosted', 3),
    ('Gwendy', 'gwendy', 3),
    ('Heartstrings', 'heartstrings', 3),
    ('The Age of Madness', 'ageofmadness', 3),
    ('The Broken Earth', 'brokenearth', 3),
    ('The Chaos Constellation', 'chaosconstellation', 3),
    ('The Fionavar Tapestry', 'fionavartapestry', 3),
    ('The Iron Druid Chronicles', 'irondruidchronicles', 3),
    ('The Seraphina Parrish Trilogy', 'seraphinaparrishtrilogy', 3),
    ('Thursday Next', 'thursdaynext', 3),
    ('Warbreaker', 'warbreaker', 3),
    ('Bardic Voices', 'bardicvoices', 2),
    ('Beneath the Mask', 'beneaththemask', 2),
    ('Blackwater', 'blackwater', 2),
    ('Blood and Ash', 'bloodandash', 2),
    ('Crave', 'crave', 2),
    ('Dune', 'dune', 2),
    ('Fae & Alchemy', 'faealchemy', 2),
    ('Green Creek', 'greencreek', 2),
    ('Hierarchy', 'hierarchy', 2),
    ('Inkworld', 'inkworld', 2),
    ('Isis', 'isis', 2),
    ('JoJo''s Bizarre Adventure: Vento Aureo', 'jojosbizarreadventureventoaureo', 2),
    ('Joe Ledger', 'joeledger', 2),
    ('Kate Daniels', 'katedaniels', 2),
    ('Locke & Key', 'lockekey', 2),
    ('Magnus Chase and the Gods of Asgard', 'magnuschaseandthegodsofasgard', 2),
    ('Marvel Graphic Novel', 'marvelgraphicnovel', 2),
    ('Miss Peregrine''s Peculiar Children', 'missperegrinespeculiarchildren', 2),
    ('Rolling in the Deep', 'rollinginthedeep', 2),
    ('The Charm Offensive', 'charmoffensive', 2),
    ('The Gideon Testaments', 'gideontestaments', 2),
    ('The Infinity Engines', 'infinityengines', 2),
    ('The Inheritance Cycle', 'inheritancecycle', 2),
    ('The Last Binding', 'lastbinding', 2),
    ('The Murderbot Diaries', 'murderbotdiaries', 2),
    ('The Shadow Series', 'shadowseries', 2),
    ('These Hollow Vows', 'thesehollowvows', 2),
    ('Zig Zag Don', 'zigzagdon', 2),
    ('A Lady''s Guide', 'aladysguide', 1),
    ('Adrian Mole', 'adrianmole', 1),
    ('Ahriman', 'ahriman', 1),
    ('Alice''s Adventures in Wonderland', 'alicesadventuresinwonderland', 1),
    ('Angels', 'angels', 1),
    ('Anne of Green Gables', 'anneofgreengables', 1),
    ('Barry''s Bay', 'barrysbay', 1),
    ('Borne', 'borne', 1),
    ('Chronicles of the Imaginarium Geographica', 'chroniclesoftheimaginariumgeographica', 1),
    ('Coles Notes', 'colesnotes', 1),
    ('Crown of Stars', 'crownofstars', 1),
    ('Dead Djinn Universe', 'deaddjinnuniverse', 1),
    ('Demon Accords', 'demonaccords', 1),
    ('Detective Kyoichiro Kaga', 'detectivekyoichirokaga', 1),
    ('Dos amigas', 'dosamigas', 1),
    ('Fitz and the Fool', 'fitzandthefool', 1),
    ('Great Cities', 'greatcities', 1),
    ('Hardy Boys', 'hardyboys', 1),
    ('Hellequin Chronicles', 'hellequinchronicles', 1),
    ('Jaws', 'jaws', 1),
    ('JoJo''s Bizarre Adventure Part 7: Steel Ball Run', 'jojosbizarreadventurepart7steelballrun', 1),
    ('Kingsbridge', 'kingsbridge', 1),
    ('Lacy Stoltz', 'lacystoltz', 1),
    ('Lovelight', 'lovelight', 1),
    ('Memory, Sorrow, and Thorn', 'memorysorrowandthorn', 1),
    ('Monster Hunter International', 'monsterhunterinternational', 1),
    ('Ms. Marvel', 'msmarvel', 1),
    ('Nena Knight', 'nenaknight', 1),
    ('Nightside', 'nightside', 1),
    ('Out', 'out', 1),
    ('Overlord: The Half Elf God-kin', 'overlordthehalfelfgodkin', 1),
    ('Pax', 'pax', 1),
    ('Rain Wild Chronicles', 'rainwildchronicles', 1),
    ('Reboot', 'reboot', 1),
    ('Saga', 'saga', 1),
    ('Salacious Players Club', 'salaciousplayersclub', 1),
    ('Scared Sexy', 'scaredsexy', 1),
    ('Stillhouse Lake', 'stillhouselake', 1),
    ('Stone Maidens', 'stonemaidens', 1),
    ('Sword Catcher', 'swordcatcher', 1),
    ('The Amazing Spider-Man', 'amazingspiderman', 1),
    ('The Chemical Garden Trilogy', 'chemicalgardentrilogy', 1),
    ('The Dark Elf Trilogy', 'darkelftrilogy', 1),
    ('The Echoes Saga', 'echoessaga', 1),
    ('The Hanged God Trilogy', 'hangedgodtrilogy', 1),
    ('The Last Apprentice', 'lastapprentice', 1),
    ('The Secrets of the Immortal Nicholas Flamel', 'secretsoftheimmortalnicholasflamel', 1),
    ('The Strain Trilogy', 'straintrilogy', 1),
    ('The World of the White Rat', 'worldofthewhiterat', 1),
    ('Themis Files', 'themisfiles', 1),
    ('Transformers IDW', 'transformersidw', 1),
    ('Vampyria', 'vampyria', 1),
    ('Wayfarer Redemption', 'wayfarerredemption', 1),
    ('Winternight Trilogy', 'winternighttrilogy', 1),
    ('Witch Walker', 'witchwalker', 1),
    ('Zatanna', 'zatanna', 1)
),
matched as (
  select
    g.series_name  as gsc_name,
    g.impressions,
    s.id           as series_id,
    s.name         as catalog_name,
    s.total_books,
    s.publication_status,
    length(coalesce(s.description, '')) as description_len
  from gsc g
  left join public.series s on s.normalized_name = g.norm
),
vols as (
  select
    v.series_id,
    count(*)                                                              as held,
    count(*) filter (where v.status in ('verified','oracle_categorized')) as held_live,
    count(*) filter (where v.position_in_series is null)                  as unnumbered,
    max(v.position_in_series)                                             as max_pos,
    sum(v.edition_count - 1)                                              as collapsed,
    sum(coalesce(v.pages, 0))                                             as total_pages,
    min(v.author) filter (where v.author is not null)                     as an_author
  from public.series_volumes v
  group by v.series_id
),
dupes as (
  -- Must come back empty for every series. Kept in the output rather than as a
  -- separate assertion so a regression is visible in the same table you are
  -- already reading.
  select series_id, count(*) as dup_positions from (
    select series_id, position_in_series
      from public.series_volumes
     where position_in_series is not null
     group by 1, 2
    having count(*) > 1
  ) d group by series_id
),
-- ONE ROW PER SERIES, not per GSC row.
--
-- 2026-09-08: this CTE selected from `matched` and was keyed on series_id. Two
-- GSC URLs can resolve to the SAME series -- /series/Chronicles of Narnia and
-- /series/The Chronicles of Narnia both normalise to 'chroniclesofnarnia' --
-- so `matched` held two rows with one series_id, and the final join on
-- series_id then fanned each of them out again. Narnia came back four times,
-- which read like duplicate rows in public.series. There are none, and there
-- cannot be: series_normalized_name_idx is UNIQUE on normalized_name. The
-- duplication was this query's, not the data's.
--
-- (That two URLs answer to one series IS a real finding -- both serve identical
-- content and each declares itself canonical -- but it is a canonicalisation
-- bug, not a data one. See the series canonical fix in og-prerender.js.)
sids as (
  select distinct series_id from matched where series_id is not null
),
gaps as (
  select
    s.series_id,
    (select string_agg(n::text, ',' order by n)
       from generate_series(1, coalesce(v.max_pos::int, 0)) n
      where not exists (
        select 1 from public.series_volumes x
         where x.series_id = s.series_id
           and x.position_in_series = n
      )) as missing
  from sids s
  left join vols v on v.series_id = s.series_id
)
select
  m.impressions,
  m.gsc_name,
  case when m.catalog_name is distinct from m.gsc_name then m.catalog_name end as catalog_name_differs,
  coalesce(v.held, 0)      as held,
  coalesce(v.held_live, 0) as held_live,
  m.total_books,
  g.missing,
  coalesce(d.dup_positions, 0) as dup_positions,
  coalesce(v.collapsed, 0)     as collapsed,
  coalesce(v.unnumbered, 0)    as unnumbered,
  m.description_len,
  v.an_author,
  v.total_pages,
  case
    when m.series_id is null                                    then 'NO SUCH SERIES'
    when coalesce(d.dup_positions, 0) > 0                       then 'DUPLICATES (view bug)'
    when coalesce(v.held_live, 0) = 0                           then 'EMPTY WHEN FILTERED'
    when g.missing is not null                                  then 'INCOMPLETE (gaps)'
    when m.total_books is not null
     and coalesce(v.held, 0) < m.total_books                    then 'MISLABELLED (claims more)'
    when m.total_books is not null
     and coalesce(v.held, 0) > m.total_books                    then 'MISLABELLED (holds more)'
    when coalesce(v.held_live, 0) < coalesce(v.held, 0)         then 'STATUS FILTER HIDING ROWS'
    when m.description_len = 0                                  then 'OK, NO DESCRIPTION'
    else 'OK'
  end as verdict
from matched m
left join vols  v on v.series_id = m.series_id
left join dupes d on d.series_id = m.series_id
left join gaps  g on g.series_id = m.series_id
order by m.impressions desc, m.gsc_name;


-- ---------------------------------------------------------------------------
-- FOLLOW-UP 1 — what the dedupe actually collapsed. Run on its own.
--
-- Every row here is a position that had more than one edition. Skim it once
-- after applying the migration: if the surviving title looks wrong (an omnibus
-- where a single volume belongs, say), the preference order in
-- 20260908120000_series_volumes.sql is what to change.
-- ---------------------------------------------------------------------------
-- select v.series_name, v.position_in_series, v.title, v.edition_count, v.status
--   from public.series_volumes v
--  where v.edition_count > 1
--  order by v.edition_count desc, v.series_name, v.position_in_series
--  limit 100;


-- ---------------------------------------------------------------------------
-- FOLLOW-UP 2 — one series, in full, both before and after dedupe.
--
-- The per-series view when the table above flags something. Swap the
-- normalized name: 'crescentcity', 'dragonlancechronicles', 'redrisingsaga',
-- 'wicked'. Note the leading "the " is stripped -- 'godfather', not
-- 'thegodfather'.
-- ---------------------------------------------------------------------------
-- with s as (select id, name, total_books from public.series where normalized_name = 'crescentcity')
-- select 'raw' as src, b.position_in_series, b.title, b.author, b.status,
--        b.pages, (b.cover_url is not null) as has_cover
--   from public.books b join s on b.series_id = s.id
-- union all
-- select 'deduped', v.position_in_series, v.title, v.author, v.status,
--        v.pages, (v.cover_url is not null)
--   from public.series_volumes v join s on v.series_id = s.id
--  order by 1 desc, 2 nulls last, 3;
