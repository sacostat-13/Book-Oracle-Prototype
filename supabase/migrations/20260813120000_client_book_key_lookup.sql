-- 20260813120000_client_book_key_lookup.sql
--
-- ONE DEFINITION OF THE SHARE KEY, AND A WAY TO LOOK A BOOK UP BY IT.
--
-- THE BUG
--
-- A shared book link — https://www.thebooksoracle.com/book/<bookKey> — renders
-- its share card correctly and then 404s when a human clicks it.
--
-- The card is produced by netlify/edge-functions/og-prerender.js, which finds
-- the book by paginating `books` and recomputing the key per row. The page is
-- produced by the SPA, whose BookPage resolves a book from exactly two places:
-- the reader's own shelves, and the `?snap=` snapshot embedded in URLs the app
-- builds itself. A shared link is bare and the recipient does not own the book,
-- so both miss and the page reports "not found". Every shared book link has
-- been broken for every recipient who did not already have the book — and
-- invisibly so, because the sharer's own copy always resolves from their shelf.
--
-- WHY THE CLIENT COULD NOT SIMPLY QUERY FOR IT
--
-- Because the two keys are not the same string:
--
--   URL bookKey      midnighttimetableanovelinghoststories|borachung
--   normalized_key   midnight timetable a novel in ghost stories|bora chung
--
-- `normalized_key` is built by dedupe_title_key/dedupe_author_key, which keep
-- spaces, unaccent, and carry the full author. The client's bookKey() strips
-- every non-alphanumeric and truncates the author to 10 characters. Neither is
-- wrong; they answer different questions (identity vs. addressability). But it
-- means `where normalized_key = :key` cannot work, which is why og-prerender
-- scans instead of querying.
--
-- WHAT THIS MIGRATION ADDS
--
-- The client's algorithm, expressed once in SQL, indexed, with a lookup that
-- tolerates the one part of it that has historically drifted.
--
--   client_title_key(text)   the title half   — exact, no truncation
--   client_author_key(text)  the author half  — FULL, not truncated
--   find_book_by_client_key(text)             — the lookup
--
-- Author truncation is deliberately NOT baked into the index. og-prerender's
-- own comment records that the client's truncation length drifted once already
-- (assumed 10, production was generating 11), and an index on a truncated value
-- would turn that drift into silent 404s. Instead the author is stored whole
-- and compared as a MUTUAL PREFIX, so any truncation length — 10, 11, or a
-- future change — resolves. The title half carries the selectivity and is
-- indexed; the author half only disambiguates.
--
-- After this, og-prerender.js and sitemap.js no longer need their own copies of
-- bookKey(). src/lib/bookHelpers.js keeps its copy because the client must be
-- able to BUILD a URL from a book it holds in memory without a round trip — but
-- it is now the only copy, and this file is the authority it must agree with.

-- ── The key halves ──────────────────────────────────────────────────────────
-- IMMUTABLE, and genuinely so: lower() and regexp_replace() on a text input
-- with no locale- or dictionary-dependent behaviour. Deliberately NOT unaccent()
-- — the client cannot unaccent in the browser, so "Pedro Páramo" becomes
-- "pedropramo" on both sides. Matching the client exactly matters more here
-- than being linguistically tidy; normalized_key remains the accent-aware key
-- for identity.

create or replace function public.client_title_key(_title text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(coalesce(_title, '')), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.client_author_key(_author text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(coalesce(_author, '')), '[^a-z0-9]', '', 'g');
$$;

comment on function public.client_title_key(text) is
  'Title half of the shareable /book/:key URL. Mirrors bookKey() in src/lib/bookHelpers.js. Not accent-aware by design: the browser cannot unaccent.';
comment on function public.client_author_key(text) is
  'Author half of the share key, stored FULL. The client truncates to 10 chars when building URLs; find_book_by_client_key compares as a mutual prefix so any truncation length resolves.';

-- ── The index ───────────────────────────────────────────────────────────────
-- Functional index on the title half, which is where all the selectivity is.
-- CONCURRENTLY is not used: it cannot run inside a transaction block, and the
-- migration runner wraps this file in one. The table is ~3.3k rows; the brief
-- lock is not worth the complication.

create index if not exists books_client_title_key_idx
  on public.books (public.client_title_key(title));

-- ── The lookup ──────────────────────────────────────────────────────────────
-- Returns at most one book. Ordering makes the choice deterministic when a
-- title genuinely has several rows (which it does — see the duplicate work in
-- v0.63.2): prefer an exact author match, then the row a reader is more likely
-- to have meant — one with a cover, then the oldest.
--
-- STABLE, not VOLATILE, so PostgREST will plan it sensibly. No SECURITY DEFINER:
-- `books` already carries "Anyone can read books" FOR SELECT USING (true), so
-- this adds no reach that an anonymous client does not already have. Wrapping it
-- in a definer would be granting privilege for no reason.

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
  )
  select b.*
  from public.books b, wanted w
  where w.t <> ''
    and public.client_title_key(b.title) = w.t
    and (
      -- No author on one side or the other: the title alone has to carry it.
      w.a = ''
      or public.client_author_key(b.author) = ''
      -- Mutual prefix, so a client-side truncation of any length still matches.
      or public.client_author_key(b.author) like w.a || '%'
      or w.a like public.client_author_key(b.author) || '%'
    )
  order by
    (public.client_author_key(b.author) = w.a) desc,
    (b.cover_url is not null) desc,
    b.created_at asc
  limit 1;
$$;

comment on function public.find_book_by_client_key(text) is
  'Resolve a shared /book/:key URL to a book row. Fixes shared links 404ing for recipients who do not own the book (v0.63.3).';

-- PostgREST needs execute for the roles that will call it. Anonymous included:
-- a shared link must open for someone with no account, which is the entire
-- point of sharing one.
grant execute on function public.client_title_key(text)        to anon, authenticated, service_role;
grant execute on function public.client_author_key(text)       to anon, authenticated, service_role;
grant execute on function public.find_book_by_client_key(text) to anon, authenticated, service_role;

-- ── The third copy: sitemap.js ──────────────────────────────────────────────
-- sitemap.js does not look keys up, it GENERATES them — one per book, into
-- <loc> entries — so the RPC above is the wrong shape for it and it kept its
-- own copy of the algorithm. A view removes that copy: it can select the key
-- rather than compute it.
--
-- Note the substr(...,1,10) here, which the INDEX above deliberately avoids.
-- Generation has to commit to a length; lookup must not. Ten is what
-- src/lib/bookHelpers.js emits, so ten is what the sitemap advertises, and
-- find_book_by_client_key's mutual-prefix comparison resolves it either way.

-- series_name is joined in so sitemap.js can build its /series/ entries from
-- this one view rather than selecting from books with an embedded join and
-- computing the key itself.
create or replace view public.books_share_key as
  select
    b.id,
    b.title,
    b.author,
    b.status,
    b.cover_url,
    b.updated_at,
    s.name as series_name,
    public.client_title_key(b.title)
      || '|' ||
      substr(public.client_author_key(b.author), 1, 10) as share_key
  from public.books b
  left join public.series s on s.id = b.series_id;

comment on view public.books_share_key is
  'books with the shareable /book/:key URL precomputed. Lets sitemap.js emit URLs without carrying its own copy of bookKey().';

grant select on public.books_share_key to anon, authenticated, service_role;

-- ── Verification ────────────────────────────────────────────────────────────
-- Run after applying. The first should return the Bora Chung row; the second
-- should return 0, proving no shareable URL the sitemap emits can 404.
--
--   select id, title, author
--     from public.find_book_by_client_key('midnighttimetableanovelinghoststories|borachung');
--
--   select count(*) from public.books b
--    where not exists (
--      select 1 from public.find_book_by_client_key(
--        public.client_title_key(b.title) || '|' ||
--        substr(public.client_author_key(b.author), 1, 10)
--      )
--    );
