-- schema_v47 — book catalog dedupe (v0.60)
--
-- RUN THE STAGES IN ORDER. Stages 0–2 are read-only. Stage 3 mutates.
--
-- ── What the audit found ────────────────────────────────────────────────────
-- books_normalized_key_idx is a working UNIQUE index and there are zero
-- normalized_key collisions. So this is NOT an integrity failure — every
-- duplicate row is a NORMALIZATION GAP: two spellings of the same book produce
-- two different keys, and upsert_book correctly treats them as distinct.
--
-- Four gaps, in order of volume:
--   1. Series parenthetical  "Howl's Moving Castle (Howl's Moving Castle, #1)"
--                            vs "Howl's Moving Castle"        (216 rows carry one)
--   2. Typographic variants  curly vs straight apostrophe — "Ender's Game" vs
--                            "Ender’s Game". Invisible in query output, which
--                            is why these looked like exact duplicates.
--   3. Whitespace            "Michael  Scott" (double space)
--   4. Diacritics + author   "Ryu" vs "Ryū"; "Mary Shelley" vs
--      completeness          "Mary Wollstonecraft Shelley"
--
-- hardcover_id is NOT a safe merge key on its own: id 2524473 maps to three
-- genuinely different books (an omnibus plus two volumes). It is used only as
-- corroboration below, never as the sole grouping key.
--
-- ── Order of operations ─────────────────────────────────────────────────────
-- Merge FIRST, then re-key. Rebuilding normalized_key before merging would
-- violate the unique index the moment two rows collapse to the same key.


-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE 0 — enumerate what references books. READ ONLY.
-- ═══════════════════════════════════════════════════════════════════════════
-- Do not skip this. Stage 3 repoints the tables listed in REPOINT_TABLES below;
-- if this returns a table that isn't in that list, STOP and add it, or the
-- delete at the end will cascade or fail.

select tc.table_name, kcu.column_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_name = 'books'
order by tc.table_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE 1 — the new normalisation. READ ONLY.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists unaccent;

-- Title: fold typography, strip a trailing series parenthetical, drop
-- punctuation, collapse whitespace.
--
-- Only a parenthetical containing "#" is stripped — that is a series marker.
-- "(Spanish Edition)" and "(novel)" are left alone, because a Spanish edition
-- genuinely is a different book to us.
create or replace function public.dedupe_title_key(t text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             lower(unaccent(
               regexp_replace(
                 translate(coalesce(t,''), '’‘‛`´“”„–—‑', '''''''''""" --'),
                 '\s*\([^()]*#[^()]*\)\s*$', '', 'g')
             )),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

-- Author: first credited name only, folded the same way. Splitting on the
-- co-author joiners collapses "Alan Moore" and "Alan Moore y David Lloyd".
create or replace function public.dedupe_author_key(a text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             lower(unaccent(
               split_part(
                 regexp_replace(
                   translate(coalesce(a,''), '’‘`´', ''''''''),
                   '\s+(y|and|with|&|/|;|,)\s+', '|', 'g'),
                 '|', 1))),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

-- Preview. Run this and eyeball it before Stage 3 — especially any group where
-- `distinct_hardcover_ids > 1`, which means the members disagree about what
-- book they are.
create or replace view public.v_dedupe_groups as
select public.dedupe_title_key(title)   as tkey,
       public.dedupe_author_key(author)  as akey,
       count(*)                          as rows,
       count(distinct hardcover_id) filter (where hardcover_id is not null)
                                         as distinct_hardcover_ids,
       array_agg(id)                     as book_ids,
       array_agg(distinct title)         as titles,
       array_agg(distinct author)        as authors
from public.books
where coalesce(btrim(title), '') <> ''
group by 1, 2
having count(*) > 1;

-- How much collapses:
select count(*) as groups, sum(rows) as rows_involved, sum(rows) - count(*) as rows_removed
from public.v_dedupe_groups;

-- Groups whose members disagree on hardcover_id — review these by hand.
-- Expect the Nicholas Flamel omnibus among them.
select * from public.v_dedupe_groups where distinct_hardcover_ids > 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE 2 — pick survivors. READ ONLY.
-- ═══════════════════════════════════════════════════════════════════════════
-- Richest row wins: verified status, then cover, description, hardcover_id,
-- genre, pages; oldest row breaks ties so the longest-standing id survives and
-- existing shares/links keep working.

create or replace view public.v_dedupe_plan as
with ranked as (
  select b.id, b.title, b.author,
         public.dedupe_title_key(b.title)  as tkey,
         public.dedupe_author_key(b.author) as akey,
         row_number() over (
           partition by public.dedupe_title_key(b.title),
                        public.dedupe_author_key(b.author)
           order by
             (b.status in ('verified','oracle_categorized')) desc,
             (b.cover_url   is not null) desc,
             (b.description is not null) desc,
             (b.hardcover_id is not null) desc,
             (b.genre       is not null) desc,
             (b.pages       is not null) desc,
             b.created_at asc
         ) as rn
  from public.books b
  where coalesce(btrim(b.title), '') <> ''
)
select r.id as loser_id, s.id as survivor_id, r.title as loser_title
from ranked r
join ranked s on s.tkey = r.tkey and s.akey = r.akey and s.rn = 1
where r.rn > 1;

select count(*) as rows_to_remove from public.v_dedupe_plan;


-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE 3 — merge. MUTATES. Take a backup first.
-- ═══════════════════════════════════════════════════════════════════════════
-- REPOINT_TABLES (all 13 confirmed by Stage 0 against the live schema):
--   CASCADE  : read_books, wishlist_items, currently_reading, book_genres,
--              book_categories, user_book_categories, book_reports,
--              list_items, reading_memories, book_club_sessions
--   SET NULL : oracle_recommendations, poll_options, reading_accomplishments
--
-- read_next has NO foreign key to books and needs nothing.
--
-- RUN STAGE 0b FIRST if you haven't. Two blocks below assume a unique
-- constraint — list_items on (list_id, book_id) and poll_options on
-- (poll_id, book_id). If those tuples are wrong the UPDATE will either throw
-- (safe, transaction rolls back) or under-collapse (harmless). Verify with:
--
--   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where contype in ('u','p')
--     and conrelid::regclass::text in
--       ('list_items','poll_options','read_books','wishlist_items',
--        'currently_reading','book_genres','book_categories',
--        'user_book_categories','reading_memories');
--
-- Every repoint is UPDATE ... WHERE NOT EXISTS followed by DELETE. The bare
-- UPDATE would violate the unique (user_id, book_id) constraints wherever a
-- reader holds BOTH rows — which is exactly the population being cleaned up.
-- So: move the reference only if the survivor isn't already there, otherwise
-- drop the now-redundant loser row.

begin;

create temp table _plan as select * from public.v_dedupe_plan;

-- ── Per-user tables (unique on user_id + book_id) ──────────────────────────
update public.read_books r set book_id = p.survivor_id
from _plan p
where r.book_id = p.loser_id
  and not exists (select 1 from public.read_books x
                  where x.user_id = r.user_id and x.book_id = p.survivor_id);
delete from public.read_books r using _plan p where r.book_id = p.loser_id;

update public.wishlist_items w set book_id = p.survivor_id
from _plan p
where w.book_id = p.loser_id
  and not exists (select 1 from public.wishlist_items x
                  where x.user_id = w.user_id and x.book_id = p.survivor_id);
delete from public.wishlist_items w using _plan p where w.book_id = p.loser_id;

update public.currently_reading c set book_id = p.survivor_id
from _plan p
where c.book_id = p.loser_id
  and not exists (select 1 from public.currently_reading x
                  where x.user_id = c.user_id and x.book_id = p.survivor_id);
delete from public.currently_reading c using _plan p where c.book_id = p.loser_id;

-- NOTE: read_next has NO foreign key to books (confirmed by Stage 0), so there
-- is nothing to repoint. It stores books by key, not by id.

-- ── Catalog link tables ────────────────────────────────────────────────────
update public.book_genres g set book_id = p.survivor_id
from _plan p
where g.book_id = p.loser_id
  and not exists (select 1 from public.book_genres x
                  where x.book_id = p.survivor_id and x.genre_id = g.genre_id);
delete from public.book_genres g using _plan p where g.book_id = p.loser_id;

update public.book_categories bc set book_id = p.survivor_id
from _plan p
where bc.book_id = p.loser_id
  and not exists (select 1 from public.book_categories x
                  where x.book_id = p.survivor_id and x.category_id = bc.category_id);
delete from public.book_categories bc using _plan p where bc.book_id = p.loser_id;

update public.user_book_categories ubc set book_id = p.survivor_id
from _plan p
where ubc.book_id = p.loser_id
  and not exists (select 1 from public.user_book_categories x
                  where x.user_id = ubc.user_id
                    and x.book_id = p.survivor_id
                    and x.category_id = ubc.category_id);
delete from public.user_book_categories ubc using _plan p where ubc.book_id = p.loser_id;

update public.book_reports br set book_id = p.survivor_id
from _plan p where br.book_id = p.loser_id;

-- ── Tables Stage 0 found that the first draft of this migration MISSED ─────
--
-- The three CASCADE ones below are why Stage 0 is not optional. Without these
-- repoints, `delete from books` at the end would have silently destroyed:
--   • list_items          — entries in readers' custom lists
--   • reading_memories    — post-session notes
--   • book_club_sessions  — whole club sessions
-- across all 452 merged rows, with no error and no way back.
--
-- The SET NULL ones would not have deleted anything, but would have quietly
-- orphaned recommendation provenance, poll options and earned accomplishments.

-- list_items — assumed unique (list_id, book_id).
update public.list_items li set book_id = p.survivor_id
from _plan p
where li.book_id = p.loser_id
  and not exists (select 1 from public.list_items x
                  where x.list_id = li.list_id and x.book_id = p.survivor_id);
delete from public.list_items li using _plan p where li.book_id = p.loser_id;

-- poll_options — assumed unique (poll_id, book_id). A poll offering the same
-- book twice would be nonsense, so collapse rather than duplicate.
update public.poll_options po set book_id = p.survivor_id
from _plan p
where po.book_id = p.loser_id
  and not exists (select 1 from public.poll_options x
                  where x.poll_id = po.poll_id and x.book_id = p.survivor_id);
delete from public.poll_options po using _plan p where po.book_id = p.loser_id;

-- The rest hold many rows per book, so a plain repoint is correct — there is
-- no uniqueness to collide with and nothing should be dropped.
update public.reading_memories rm set book_id = p.survivor_id
from _plan p where rm.book_id = p.loser_id;

update public.book_club_sessions s set book_id = p.survivor_id
from _plan p where s.book_id = p.loser_id;

update public.oracle_recommendations orc set book_id = p.survivor_id
from _plan p where orc.book_id = p.loser_id;

update public.reading_accomplishments ra set book_id = p.survivor_id
from _plan p where ra.book_id = p.loser_id;

-- ── Backfill anything the survivor is missing from its losers ──────────────
update public.books s set
  cover_url    = coalesce(s.cover_url,    l.cover_url),
  description  = coalesce(s.description,  l.description),
  isbn         = coalesce(s.isbn,         l.isbn),
  pages        = coalesce(s.pages,        l.pages),
  genre        = coalesce(s.genre,        l.genre),
  hardcover_id = coalesce(s.hardcover_id, l.hardcover_id),
  goodreads_id = coalesce(s.goodreads_id, l.goodreads_id)
from _plan p
join public.books l on l.id = p.loser_id
where s.id = p.survivor_id;

delete from public.books b using _plan p where b.id = p.loser_id;

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE 4 — stop it refilling. MUTATES.
-- ═══════════════════════════════════════════════════════════════════════════
-- Without this the crawl and the next round of imports rebuild the pile within
-- days. Rebuild normalized_key using the same normalisation the merge used, so
-- future upserts collapse variants instead of creating rows.
--
-- Run AFTER Stage 3 — before it, this violates books_normalized_key_idx.
--
-- compute_book_key is called by upsert_book; align it with dedupe_*_key. Check
-- its current definition first and preserve the signature:
--   select prosrc from pg_proc where proname = 'compute_book_key';

-- create or replace function public.compute_book_key(_title text, _author text)
-- returns text language sql immutable as $$
--   select public.dedupe_title_key(_title) || '|' || public.dedupe_author_key(_author)
-- $$;
--
-- update public.books set normalized_key = public.compute_book_key(title, author);

-- Must return 0 afterwards:
-- select count(*) from (
--   select normalized_key from public.books group by 1 having count(*) > 1
-- ) x;


-- ═══════════════════════════════════════════════════════════════════════════
-- Cleanup
-- ═══════════════════════════════════════════════════════════════════════════
-- drop view if exists public.v_dedupe_plan;
-- drop view if exists public.v_dedupe_groups;
