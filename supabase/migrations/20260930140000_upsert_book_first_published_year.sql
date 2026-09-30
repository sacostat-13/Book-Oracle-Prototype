-- upsert_book gains _first_published_year.
--
-- 20260930120000 added books.first_published_year and a backfill for the rows
-- already there. This closes the other end: every write path now carries the
-- year the lookup already had in hand — Hardcover `release_year`, OpenLibrary
-- `first_publish_year` — so new books arrive dated instead of waiting for the
-- nightly sweep (catalog-maintenance runs publicationYearBackfill.mjs as the
-- safety net for anything that still arrives without one).
--
-- Merge rule: coalesce(existing, incoming), first writer wins. See the UPDATE.
--
-- Same drop/create/regrant shape as 20260817140000, for the same reason: a
-- new parameter is a new signature, and `create or replace` would leave the
-- old 21-argument function beside it as an overload that makes every named-
-- argument call ambiguous. The body is 20260817140000's verbatim apart from
-- the lines marked first_published_year / _fy.
--
-- integer, not smallint, for the parameter: PostgREST resolves named RPC
-- arguments from JSON numbers, and an integer parameter is the path every
-- existing numeric argument here already takes. It is narrowed to smallint
-- (with a range check) inside.

drop function if exists public.upsert_book(
  text, text, text, bigint, text, numeric, integer, text, text, text,
  integer, integer, text, boolean, jsonb, uuid, text, text, text, text, text
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
  _original_language text   default null::text,
  _first_published_year integer default null::integer
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
  -- Out-of-range years are dropped here rather than raised: books has a check
  -- constraint on the column, and one bad upstream value must not fail the
  -- whole write — the reader's "add to wishlist" would silently do nothing.
  _fy smallint := case when _first_published_year between -800 and 2100
                        and _first_published_year <> 0
                       then _first_published_year::smallint end;
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
      -- First writer wins, like every other field here. least() was
      -- considered — a reissue can only make a year later — but both sources
      -- already report the WORK's year, and the client's OpenLibrary title
      -- search matches loosely enough that "the smaller year wins" would let
      -- one bad match permanently backdate a book. The guarded backfill is the
      -- place to correct years, not every page view.
      first_published_year = coalesce(_existing.first_published_year, _fy),
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_id, position_in_series, pages, description, cover_url,
    genre, complexity, depth, source,
    status, verified_source, verified_at, verified_by,
    metadata, created_by, language, original_language, first_published_year
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _resolved_series_id, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid(), _language, _original_language, _fy
  )
  returning id into _id;
  return _id;
end;
$function$;

-- Grants do NOT survive a drop.
grant all on function public.upsert_book(
  text, text, text, bigint, text, numeric, integer, text, text, text,
  integer, integer, text, boolean, jsonb, uuid, text, text, text, text, text, integer
) to anon, authenticated, service_role;

-- ── Verification ────────────────────────────────────────────────────────────
--
-- 1. Exactly ONE upsert_book exists:
--      select oid::regprocedure from pg_proc
--       where proname = 'upsert_book' and pronamespace = 'public'::regnamespace;
--
-- 2. The year is written, and a second write does not overwrite it:
--      select public.upsert_book(_title => 'Year Merge Test', _author => 'Nobody',
--                                _first_published_year => 2016);
--      select public.upsert_book(_title => 'Year Merge Test', _author => 'Nobody',
--                                _first_published_year => 2015);
--      select title, first_published_year from public.books where title = 'Year Merge Test';
--      -- expect 2016
--      delete from public.books where title = 'Year Merge Test';
--
-- 3. An impossible year is dropped, not raised:
--      select public.upsert_book(_title => 'Year Guard Test', _author => 'Nobody',
--                                _first_published_year => 99999);   -- succeeds, year NULL
--      delete from public.books where title = 'Year Guard Test';
