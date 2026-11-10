-- Oracle teaser on public book pages. 2026-11-10.
-- Function: netlify/functions/book-teaser.js · Component: src/components/OracleTeaser.jsx
--
-- A signed-out visitor on /book/:key can ask the Oracle, once, what might
-- follow this book. The answer is about the BOOK, not the visitor, so it is
-- generated once per book and language and served from here to everyone after.
-- That keeps the cost to one small model call per book ever asked about, and
-- it means no visitor data goes into the prompt at all.
--
-- picks: [{ title, author, cover_url, share_key, why }] — only books that
-- resolved to a row in our own catalogue are kept, so every pick links to a
-- real page and nothing the model invented is shown.
--
-- Read and written only by the Netlify function (service role).
--
-- Idempotent.

create table if not exists public.book_teasers (
  book_id    uuid        not null references public.books(id) on delete cascade,
  lang       text        not null,
  picks      jsonb       not null default '[]'::jsonb,
  model      text,
  created_at timestamptz not null default now(),
  primary key (book_id, lang),
  constraint book_teasers_lang_check check (lang in ('en', 'es')),
  constraint book_teasers_picks_array check (jsonb_typeof(picks) = 'array'),
  constraint book_teasers_picks_size check (pg_column_size(picks) <= 8192)
);

create index if not exists book_teasers_created_idx on public.book_teasers (created_at desc);

alter table public.book_teasers enable row level security;
revoke all on public.book_teasers from anon, authenticated;

comment on table public.book_teasers is
  '2026-11-10: cached Oracle picks for the signed-out book-page teaser, one row per book and language. Contains no visitor data.';

-- ── Resolve the model's picks against the catalogue ──────────────────────────
-- In: [{ "title": "...", "author": "..." }, ...]
-- Out: the same order, only the ones that resolve, with the catalogue's own
-- title/author/cover and the share key the site links with. Uses the same
-- key rules as /book/:key (find_book_by_client_key), so a pick resolves exactly
-- when its page would.
create or replace function public.resolve_teaser_picks(p_picks jsonb)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with wanted as (
    select ord, elem ->> 'title' as title, elem ->> 'author' as author
    from jsonb_array_elements(case when jsonb_typeof(p_picks) = 'array' then p_picks else '[]'::jsonb end)
         with ordinality as x(elem, ord)
    where ord <= 10
      and coalesce(elem ->> 'title', '') <> ''
  ),
  found as (
    select distinct on (b.id)
      w.ord, b.id, b.title, b.author, b.cover_url
    from wanted w
    cross join lateral public.find_book_by_client_key(
      public.client_title_key(w.title) || '|' || substr(public.client_author_key(w.author), 1, 10)
    ) b
    -- Same bar as the sitemap: no author-less rows, no placeholders, nothing
    -- a curator flagged.
    where coalesce(b.author, '') <> ''
      and lower(coalesce(b.title, '')) <> 'untitled'
      and coalesce(b.status::text, '') <> 'flagged'
    order by b.id, w.ord
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ord',       f.ord,
           'book_id',   f.id,
           'title',     f.title,
           'author',    f.author,
           'cover_url', f.cover_url,
           'share_key', public.client_title_key(f.title) || '|' || substr(public.client_author_key(f.author), 1, 10)
         ) order by f.ord), '[]'::jsonb)
  from found f;
$function$;

revoke execute on function public.resolve_teaser_picks(jsonb) from public, anon, authenticated;
grant  execute on function public.resolve_teaser_picks(jsonb) to service_role;
