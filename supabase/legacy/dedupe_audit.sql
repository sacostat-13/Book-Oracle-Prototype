-- dedupe_audit.sql — find likely duplicate rows in public.books
--
-- READ-ONLY. Nothing here modifies data. Run each block in the Supabase SQL
-- editor and review before deciding anything.
--
-- Context: upsert_book dedupes on normalized_key, which includes the author.
-- That means the same work arrives as separate rows whenever sources credit
-- authors differently — Goodreads RSS exposes one author, Hardcover credits the
-- full team. "V for Vendetta / Alan Moore" and
-- "V for Vendetta / Alan Moore y David Lloyd" are two rows, both legitimate by
-- the current key, both showing up as separate books to the reader.
--
-- Four patterns, roughly in order of confidence.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared normalisation
-- ─────────────────────────────────────────────────────────────────────────────
-- norm_title : lowercased, trailing parenthetical stripped ("(Mistborn, #2)"),
--              punctuation removed, whitespace collapsed.
-- first_author: text before the first co-author joiner, in EN and ES.

create or replace function public._dedupe_norm_title(t text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             lower(regexp_replace(coalesce(t,''), '\s*\([^()]*\)\s*$', '', 'g')),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g')
$$;

create or replace function public._dedupe_first_author(a text)
returns text language sql immutable as $$
  select btrim(
           split_part(
             regexp_replace(lower(coalesce(a,'')), '\s+(y|and|with|&|/|;|,)\s+', '|', 'g'),
             '|', 1))
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Same external ID on more than one row  (highest confidence)
-- ─────────────────────────────────────────────────────────────────────────────
-- If two rows carry the same hardcover_id or goodreads_id they are the same
-- work, full stop. These should be zero — a non-zero result means a unique
-- index is missing or was added after the duplicates existed.

select 'hardcover_id' as key_type, hardcover_id::text as key_value,
       count(*) as rows, array_agg(id) as book_ids, array_agg(title) as titles
from public.books
where hardcover_id is not null
group by hardcover_id having count(*) > 1
union all
select 'goodreads_id', goodreads_id::text,
       count(*), array_agg(id), array_agg(title)
from public.books
where goodreads_id is not null
group by goodreads_id having count(*) > 1
order by rows desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Same ISBN  (high confidence, but note the edition caveat)
-- ─────────────────────────────────────────────────────────────────────────────
-- An ISBN identifies an edition, not a work — so a match here is a genuine
-- duplicate row, not merely two editions of one book.

select isbn, count(*) as rows,
       array_agg(id) as book_ids,
       array_agg(distinct title) as titles,
       array_agg(distinct author) as authors
from public.books
where isbn is not null and length(btrim(isbn)) >= 10
group by isbn having count(*) > 1
order by rows desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Same title + same FIRST author, different full author string
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the V for Vendetta case and the one worth acting on first. Review the
-- `authors` column: if it reads like the same person plus collaborators, it's a
-- duplicate. If the first names merely collide, it isn't.

select public._dedupe_norm_title(title)   as norm_title,
       public._dedupe_first_author(author) as first_author,
       count(*) as rows,
       array_agg(id order by created_at)     as book_ids,
       array_agg(distinct author)            as authors,
       array_agg(distinct title)             as titles,
       array_agg(distinct source)            as sources,
       count(*) filter (where cover_url is not null) as with_cover
from public.books
where author is not null and btrim(author) <> ''
group by 1, 2
having count(*) > 1
order by rows desc, norm_title
limit 200;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Same title + same first author, ONE side carrying a series parenthetical
-- ─────────────────────────────────────────────────────────────────────────────
-- The Well of Ascension case: "The Well of Ascension" vs
-- "The Well of Ascension (Mistborn, #2)". Query 3 already catches these, but
-- this narrows to the ones where the titles differ only by the parenthetical,
-- which are the safest merges in the whole audit.

with n as (
  select id, title, author, cover_url, source, created_at,
         public._dedupe_norm_title(title)    as nt,
         public._dedupe_first_author(author)  as fa,
         (title ~ '\([^()]*\)\s*$')           as has_paren
  from public.books
)
select nt as norm_title, fa as first_author,
       array_agg(id order by has_paren desc)    as book_ids,
       array_agg(title order by has_paren desc) as titles
from n
group by nt, fa
having count(*) > 1
   and count(*) filter (where has_paren) > 0
   and count(*) filter (where not has_paren) > 0
order by nt
limit 200;


-- ─────────────────────────────────────────────────────────────────────────────
-- How many readers are affected — check BEFORE merging anything
-- ─────────────────────────────────────────────────────────────────────────────
-- A duplicate nobody has on a shelf is free to delete. One that appears in
-- read_books / wishlist_items / currently_reading / read_next needs its
-- references repointed first, or you will delete somebody's history.
--
-- Substitute the book_ids from a group above.

-- select b.id, b.title, b.author,
--        (select count(*) from public.read_books       r where r.book_id = b.id) as in_libraries,
--        (select count(*) from public.wishlist_items   w where w.book_id = b.id) as in_wishlists,
--        (select count(*) from public.currently_reading c where c.book_id = b.id) as in_progress
-- from public.books b
-- where b.id in ('...', '...');


-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup afterwards
-- ─────────────────────────────────────────────────────────────────────────────
-- drop function if exists public._dedupe_norm_title(text);
-- drop function if exists public._dedupe_first_author(text);


-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE — do not write a bulk merge from these results.
--
-- Merging means: pick a survivor (richest metadata — cover, description,
-- genres), repoint every user reference to it, then delete the losers. Each of
-- those tables has a unique (user_id, book_id) constraint, so a repoint can
-- collide where a reader holds BOTH rows — which is exactly the population this
-- audit is about. That needs ON CONFLICT DO NOTHING plus a delete of the
-- orphan, per table, inside a transaction.
--
-- Worth writing once the queries above show how many groups actually exist.
-- Not worth guessing at blind.
-- ─────────────────────────────────────────────────────────────────────────────
