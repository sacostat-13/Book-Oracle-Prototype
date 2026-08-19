-- 20260817140000_book_language.sql
--
-- WHAT LANGUAGE IS THIS ROW, AND WHAT LANGUAGE WAS THE BOOK WRITTEN IN.
--
-- THE BUG THIS IS PART OF FIXING
--
-- "More by this author" (migration 20260817120000) does what it says and
-- immediately exposes something that was always true and never visible: the
-- catalog holds the same novel more than once, once per language. A Spanish
-- reader adds *Cien años de soledad*; compute_book_key builds normalized_key
-- from the title, so it does not collide with *One Hundred Years of Solitude*,
-- and the catalog now holds two rows for one novel. Until now those rows only
-- sat next to each other in search. An author section puts them side by side,
-- twelve covers of the same six books, and the duplication becomes the first
-- thing a reader sees.
--
-- The section fixes the SYMPTOM client-side by collapsing rows it can prove are
-- the same work (see src/lib/workGroups.js). This migration gives that collapse
-- the one thing it cannot infer: which row a reader should be shown.
--
-- TWO COLUMNS, BECAUSE THESE ARE TWO DIFFERENT FACTS
--
--   language           what language THIS ROW is in.        An EDITION fact.
--   original_language  what language the book was WRITTEN.  A WORK fact.
--
-- Conflating them is the same mistake that produced the duplicate rows in the
-- first place — `books` already carries `isbn` and `pages`, which are edition
-- facts, on a row whose identity is a work. Keeping them separate is what lets
-- the rule be stated at all: *the row we show for a work is the one in the
-- language it was written in* (language = original_language), and a translation
-- is shown only when no original-language row exists.
--
-- HONESTY ABOUT WHAT IS POPULATED
--
-- `language` has real writers from day one: googleBooksService already reads
-- volumeInfo.language and threw it away until now, and it flows through
-- upsert_book below.
--
-- `original_language` has exactly one writer — the Oracle categorisation pass
-- (src/lib/oracleCategorizationService.js), which is already making a
-- per-book Claude call and already answers a strictly harder question of the
-- same kind (author_gender). It is NOT backfilled. Every existing row is NULL,
-- and the display rule degrades to "most complete row wins" until a book is
-- enriched. That is deliberate: a guessed original language is worse than an
-- absent one, for the same reason recorded in the author_gender rules.
--
-- NOT A LANGUAGE FILTER
--
-- Nothing here hides books in other languages from anyone, and no query should
-- start doing so. These columns choose a REPRESENTATIVE among rows already
-- known to be the same work. A Spanish edition of a book with no English row is
-- as findable as it was yesterday.

-- ── The columns ─────────────────────────────────────────────────────────────
-- BCP-47 primary subtag, lowercase: 'en', 'es', 'pt', 'zh'. Not a full tag —
-- 'es-MX' vs 'es-ES' is an edition distinction this app has no use for, and
-- storing it would split a group that should collapse. Sources are normalised
-- to the subtag before they get here.
--
-- No CHECK constraint listing valid codes. There are ~184 living two-letter
-- codes, the list changes, and a constraint that rejects a real language would
-- fail an upsert of a real book — a much worse outcome than storing an odd
-- string. The client normalises; this column records.

alter table public.books
  add column if not exists language          text,
  add column if not exists original_language text;

comment on column public.books.language is
  'BCP-47 primary subtag of THIS ROW (an edition fact): the language of this row''s title/description. NULL = unknown. Written by upsert_book from lookup metadata.';
comment on column public.books.original_language is
  'BCP-47 primary subtag the WORK was originally written in (a work fact). NULL = never determined; ''unknown'' = determined to be undeterminable. Written only by the Oracle categorisation pass, never guessed. Used to pick which of several same-work rows a reader is shown.';

-- Partial indexes: both columns are NULL for every pre-existing row, and a
-- plain index would be mostly dead weight. Queries only ever ask for rows where
-- the value is present.
create index if not exists books_language_idx
  on public.books (language) where language is not null;

create index if not exists books_original_language_idx
  on public.books (original_language) where original_language is not null;

-- ── upsert_book gains the columns ───────────────────────────────────────────
--
-- DROP AND RECREATE, not CREATE OR REPLACE. Postgres will not let a replace
-- change a function's argument list, and adding a defaulted parameter creates
-- an OVERLOAD rather than replacing — after which every existing call is
-- ambiguous and fails. Dropping the old signature explicitly is the only way to
-- end up with one function.
--
-- The new parameters go LAST and both default to NULL, so a client running the
-- previously deployed bundle keeps working untouched: all four call sites
-- (DataContext ×2, oracleCategorizationService, catalog-crawl.mjs) pass a named
-- argument object through PostgREST, and named arguments do not care about
-- position or arity.
--
-- The body below is the v0.63 function verbatim apart from the language lines.
-- If you are diffing this against the schema dump, the ONLY intended changes
-- are: two parameters, two coalesce lines in the UPDATE, two columns and two
-- values in the INSERT.

drop function if exists public.upsert_book(
  text, text, text, bigint, text, numeric, integer, text, text, text,
  integer, integer, text, boolean, jsonb, uuid, text, text, text
);

create function public.upsert_book (
  _title            text,
  _author           text,
  _isbn             text    default null::text,
  _hardcover_id     bigint  default null::bigint,
  _series_name      text    default null::text,
  _series_position  numeric default null::numeric,
  _pages            integer default null::integer,
  _description      text    default null::text,
  _cover_url        text    default null::text,
  _genre            text    default null::text,
  _complexity       integer default null::integer,
  _depth            integer default null::integer,
  _source           text    default 'user_manual'::text,
  _verified         boolean default false,
  _metadata         jsonb   default '{}'::jsonb,
  _series_id        uuid    default null::uuid,
  _series_source    text    default null::text,
  _status           text    default null::text,
  _verified_source  text    default null::text,
  _language         text    default null::text,
  _original_language text   default null::text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
declare
  _key text;
  _id uuid;
  _existing record;
  _resolved_series_id uuid := _series_id;
  _resolved_status text;
begin
  if _title is null or length(trim(_title)) = 0 then
    raise exception 'title is required';
  end if;

  if _status is not null then
    _resolved_status := _status;
  elsif _verified is true then
    _resolved_status := 'verified';
  else
    _resolved_status := 'unreviewed';
  end if;

  if _resolved_series_id is null and _series_name is not null and length(trim(_series_name)) > 0 then
    _resolved_series_id := upsert_series(
      _series_name,
      _author,
      null, null,
      coalesce(_series_source, _source, 'user_manual'),
      null, null,
      (_resolved_status = 'verified'),
      '{}'::jsonb,
      _resolved_status,
      _verified_source
    );
  end if;

  _key := compute_book_key(_title, _author);

  select * into _existing from books where normalized_key = _key limit 1;
  if found then
    update books set
      isbn               = coalesce(_existing.isbn, _isbn),
      hardcover_id       = coalesce(_existing.hardcover_id, _hardcover_id),
      series_id          = coalesce(_existing.series_id, _resolved_series_id),
      position_in_series = coalesce(_existing.position_in_series, _series_position),
      pages              = coalesce(_existing.pages, _pages),
      description        = coalesce(_existing.description, _description),
      cover_url          = coalesce(_existing.cover_url, _cover_url),
      genre              = coalesce(_existing.genre, _genre),
      complexity         = case when _existing.status = 'verified' then _existing.complexity else coalesce(_existing.complexity, _complexity) end,
      depth              = case when _existing.status = 'verified' then _existing.depth else coalesce(_existing.depth, _depth) end,
      -- Same coalesce(existing, incoming) merge as every other field here:
      -- first writer wins and nothing already known is clobbered. That matters
      -- more for these two than for most — a row's language is a fact about
      -- the row, so a later lookup returning a different one means the lookup
      -- matched a different edition, not that the row changed language.
      language           = coalesce(_existing.language, _language),
      original_language  = coalesce(_existing.original_language, _original_language),
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_id, position_in_series, pages, description, cover_url,
    genre, complexity, depth, source,
    status, verified_source, verified_at, verified_by,
    metadata, created_by, language, original_language
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _resolved_series_id, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid(), _language, _original_language
  )
  returning id into _id;
  return _id;
end;
$function$;

-- Grants do NOT survive a drop. Re-issued to match the previous signature's
-- grants exactly; omitting these makes every write path fail with "permission
-- denied for function upsert_book" the moment this deploys.
grant all on function public.upsert_book(
  text, text, text, bigint, text, numeric, integer, text, text, text,
  integer, integer, text, boolean, jsonb, uuid, text, text, text, text, text
) to anon, authenticated, service_role;

-- ── Verification ────────────────────────────────────────────────────────────
--
-- 1. Exactly ONE upsert_book exists (an overload here means the drop above
--    matched nothing and callers are now ambiguous — the failure this
--    migration's drop is written to prevent):
--
--      select oid::regprocedure from pg_proc
--       where proname = 'upsert_book' and pronamespace = 'public'::regnamespace;
--
-- 2. The write path still works and now carries language:
--
--      select public.upsert_book(
--        _title => 'Cien años de soledad',
--        _author => 'Gabriel García Márquez',
--        _language => 'es', _original_language => 'es');
--
--      select title, language, original_language from public.books
--       where title = 'Cien años de soledad';
--
-- 3. The duplication this is part of fixing, made visible. Rows that share a
--    work-level id but differ in title are the same book held twice:
--
--      select hardcover_id, count(*) as rows,
--             array_agg(title order by title) as titles,
--             array_agg(coalesce(language, '?') order by title) as langs
--        from public.books
--       where hardcover_id is not null
--       group by hardcover_id
--      having count(*) > 1
--       order by rows desc
--       limit 20;
--
--    Run this BEFORE announcing the feature — it is the size of the problem,
--    and the client-side collapse is sized to it.
