-- Align compute_book_key with the dedupe normalisation, and re-key the catalog.
--
-- Follow-up to the manual catalog merge (legacy/schema_v47_migration.sql), which
-- removed 452 duplicate rows. That cleaned up the past; this stops it recurring.
--
-- Background: books_normalized_key_idx is a working UNIQUE index, so upsert_book
-- never created a true duplicate. What it did create was rows for variant
-- SPELLINGS of the same book, because the key was built from raw title+author:
--
--   "Howl's Moving Castle"  vs  "Howl's Moving Castle (Howl's Moving Castle, #1)"
--   "Ender's Game"          vs  "Ender’s Game"          (curly apostrophe)
--   "Michael Scott"         vs  "Michael  Scott"        (double space)
--   "Ryu Murakami"          vs  "Ryū Murakami"          (diacritic)
--   "Alan Moore"            vs  "Alan Moore y David Lloyd"
--
-- Folding those into one key makes future imports and crawl runs collapse
-- variants instead of adding rows.
--
-- SAFETY: this must run AFTER the merge. Before it, re-keying collides with the
-- unique index. Guards below refuse to run if that's the case.

-- ── 1. Normalisation helpers ────────────────────────────────────────────────
-- Recreated here (rather than assumed present from the ad-hoc audit session) so
-- this migration is self-contained and replayable on a fresh database.

create extension if not exists unaccent;

-- Strips a trailing parenthetical ONLY when it contains "#", i.e. a series
-- marker. "(Spanish Edition)" and "(novel)" survive deliberately — a Spanish
-- edition is a different book to us.
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

-- ── 2. Guard: refuse to run if it would break the unique index ──────────────
-- Re-keying is only safe once no two surviving rows share the new key. If this
-- raises, the merge was incomplete — fix that first, do not weaken this check.

do $$
declare
  collisions int;
begin
  select count(*) into collisions from (
    select public.dedupe_title_key(title) as tk,
           public.dedupe_author_key(author) as ak
    from public.books
    group by 1, 2
    having count(*) > 1
  ) x;

  if collisions > 0 then
    raise exception
      'Refusing to re-key: % groups still collide under the new normalisation. Run the catalog merge first.',
      collisions;
  end if;
end $$;

-- ── 3. Guard: confirm compute_book_key's signature before replacing it ──────
-- A `create or replace` with the wrong argument types silently creates an
-- OVERLOAD instead of replacing, leaving upsert_book calling the old function
-- and this migration appearing to succeed while changing nothing.

do $$
declare
  sig text;
begin
  select pg_get_function_identity_arguments(p.oid) into sig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'compute_book_key';

  if sig is null then
    raise exception 'compute_book_key not found in schema public.';
  end if;

  if sig not in ('text, text', '_title text, _author text') then
    raise exception
      'compute_book_key has unexpected signature (%). Update this migration to match rather than creating an overload.',
      sig;
  end if;
end $$;

-- ── 4. Replace the key function ─────────────────────────────────────────────
-- Keep the argument NAMES identical to the existing definition — upsert_book
-- may call it with named notation.

create or replace function public.compute_book_key(_title text, _author text)
returns text language sql immutable as $$
  select public.dedupe_title_key(_title) || '|' || public.dedupe_author_key(_author)
$$;

comment on function public.compute_book_key(text, text) is
  'Dedupe key for books. Folds typography, diacritics, whitespace, trailing series parentheticals and co-author suffixes. Changed 2026-08-06 after 452 variant-spelling duplicates were merged out of the catalog.';

-- ── 5. Re-key every existing row ────────────────────────────────────────────

update public.books
set normalized_key = public.compute_book_key(title, author);

-- ── 6. Verify ───────────────────────────────────────────────────────────────
-- Both must be zero. The unique index enforces the first, but assert anyway so
-- a failure is legible rather than an index error.

do $$
declare
  dupes int;
  empties int;
begin
  select count(*) into dupes from (
    select normalized_key from public.books group by 1 having count(*) > 1
  ) x;
  if dupes > 0 then
    raise exception 'Post-rekey: % duplicate normalized_key values.', dupes;
  end if;

  select count(*) into empties from public.books
  where coalesce(btrim(normalized_key), '') in ('', '|');
  if empties > 0 then
    raise warning
      'Post-rekey: % rows have an empty key (missing title and author). Review these.',
      empties;
  end if;
end $$;
