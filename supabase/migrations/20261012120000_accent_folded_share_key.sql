-- 20261012120000_accent_folded_share_key.sql
--
-- Fold accents in the share/address key instead of dropping them.
--
-- WHY
-- client_title_key / client_author_key strip everything outside [a-z0-9], so an
-- accented letter vanished: "Cien años de soledad" addressed as `cienaosdesoledad`,
-- "García Márquez" as `garcamrquez`. Everywhere else the app FOLDS accents —
-- compute_book_key (identity) via unaccent, workGroups.titleVariantKey via NFD —
-- and for a bilingual catalog the dropped-letter keys are both uglier URLs and a
-- source of collisions. Decision recorded in docs/MATH.md §1 (2026-10-12).
--
-- THE RULE (identical in src/lib/bookHelpers.js addressKey):
--   NFD-normalise → strip combining marks U+0300–U+036F → lower → keep [a-z0-9]
-- NOT unaccent(): unaccent also maps ø→o, ß→ss, æ→ae, which String.normalize
-- cannot reproduce in the browser. NFD + the combining-mark range is the subset
-- both sides compute identically; letters without a decomposition are still
-- removed, on both sides, exactly as before.
--
-- OLD LINKS KEEP WORKING
-- The previous functions survive as client_title_key_legacy /
-- client_author_key_legacy, and find_book_by_client_key tries the new key first
-- and the legacy key second. og-prerender takes the canonical from
-- books_share_key, so an old URL resolves and declares the new one canonical.
--
-- WHAT CHANGES WITH IT (no edits needed — they call the functions by name)
--   books_share_key / series_volumes views → sitemap.js, og-prerender internal links
--   author_works RPC → "More by this author" now also groups "Garcia" with "García"
--
-- Requires a UTF8 database (normalize() is UTF8-only). Supabase is.

-- ── 1. Keep the old behaviour under a new name ──────────────────────────────

create or replace function public.client_title_key_legacy(_title text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(coalesce(_title, '')), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.client_author_key_legacy(_author text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(coalesce(_author, '')), '[^a-z0-9]', '', 'g');
$$;

comment on function public.client_title_key_legacy(text) is
  'Pre-2026-10-12 title key (accents dropped). Only for resolving share links minted before the change; do not use for new keys.';
comment on function public.client_author_key_legacy(text) is
  'Pre-2026-10-12 author key (accents dropped). Only for resolving share links minted before the change; do not use for new keys.';

-- ── 2. The new, accent-folding keys ─────────────────────────────────────────
-- Same names and signatures, so every view and RPC that calls them picks this
-- up without being redefined.

create or replace function public.client_title_key(_title text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           lower(regexp_replace(normalize(coalesce(_title, ''), NFD), '[\u0300-\u036f]', '', 'g')),
           '[^a-z0-9]', '', 'g');
$$;

create or replace function public.client_author_key(_author text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
           lower(regexp_replace(normalize(coalesce(_author, ''), NFD), '[\u0300-\u036f]', '', 'g')),
           '[^a-z0-9]', '', 'g');
$$;

comment on function public.client_title_key(text) is
  'Title half of the shareable /book/:key URL. Mirrors addressKey() in src/lib/bookHelpers.js: NFD, strip U+0300–U+036F, lower, keep [a-z0-9]. Accent-folding since 2026-10-12.';
comment on function public.client_author_key(text) is
  'Author half of the share key, stored FULL. Same rule as client_title_key. The client truncates to 10 chars when building URLs; find_book_by_client_key compares as a mutual prefix so any truncation length resolves.';

-- ── 3. Rebuild the expression indexes ───────────────────────────────────────
-- Replacing an IMMUTABLE function does not rebuild indexes built on it; without
-- this they would hold the old keys and lookups would silently miss.

reindex index public.books_client_title_key_idx;
reindex index public.books_client_author_key_idx;

create index if not exists books_client_title_key_legacy_idx
  on public.books (public.client_title_key_legacy(title));

-- ── 4. Lookup: new key first, legacy key second ─────────────────────────────

create or replace function public.find_book_by_client_key(_key text)
returns setof public.books
language sql
stable
parallel safe
as $$
  with wanted as (
    select
      split_part(coalesce(_key, ''), '|', 1) as t,
      split_part(coalesce(_key, ''), '|', 2) as a
  ),
  candidates as (
    -- pass 0: the current key
    select b.id, 0 as pass, public.client_author_key(b.author) as akey
    from public.books b, wanted w
    where w.t <> ''
      and public.client_title_key(b.title) = w.t
    union all
    -- pass 1: a link shared before 2026-10-12
    select b.id, 1 as pass, public.client_author_key_legacy(b.author) as akey
    from public.books b, wanted w
    where w.t <> ''
      and public.client_title_key_legacy(b.title) = w.t
  )
  select b.*
  from candidates c
  join public.books b on b.id = c.id
  cross join wanted w
  where
    -- No author on one side or the other: the title alone has to carry it.
    w.a = ''
    or c.akey = ''
    -- Mutual prefix, so a client-side truncation of any length still matches.
    or c.akey like w.a || '%'
    or w.a like c.akey || '%'
  order by
    c.pass asc,
    (c.akey = w.a) desc,
    (b.cover_url is not null) desc,
    b.created_at asc
  limit 1;
$$;

comment on function public.find_book_by_client_key(text) is
  'Resolve a shared /book/:key URL to a book row. Tries the accent-folding key, then the pre-2026-10-12 legacy key so old links keep working.';

grant execute on function public.client_title_key(text)          to anon, authenticated, service_role;
grant execute on function public.client_author_key(text)         to anon, authenticated, service_role;
grant execute on function public.client_title_key_legacy(text)   to anon, authenticated, service_role;
grant execute on function public.client_author_key_legacy(text)  to anon, authenticated, service_role;
grant execute on function public.find_book_by_client_key(text)   to anon, authenticated, service_role;
