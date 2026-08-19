-- 20260818120000_reader_editions.sql
--
-- WHICH EDITION DID *YOU* READ.
--
-- Spec: docs/reader-editions-v1-spec.md. Read that first; this is the data half.
--
-- THE PROBLEM, IN ONE SENTENCE
--
-- `books` is a WORK table carrying EDITION facts (isbn, pages) on a row whose
-- identity is title + author — which is invisible in English and immediately
-- visible in Spanish, where a reader either tracks progress against a page
-- count they are not reading, or adds a second `books` row and silently splits
-- one novel's ratings, genres and categorisation in two.
--
-- WHY A NEW TABLE AND NOT COLUMNS ON THE SHELF TABLES
--
-- The edition is a fact about THIS READER and THIS WORK, and it has to survive
-- the book moving between shelves. Putting it on `currently_reading` is exactly
-- the mistake already in production: `user_page_count` lives there, so the
-- moment a reader finishes the book the row is deleted and the app forgets that
-- their copy was 512 pages. Putting it on all three of `read_books`,
-- `wishlist_items` and `currently_reading` would mean every shelf transition in
-- DataContext has to copy it, and one that forgets is a silent data loss.
--
-- One row per (reader, work), independent of which shelf the book is on.
--
-- WHAT THIS IS NOT
--
-- Not a translations table. The catalog still holds one row per work, and a
-- translation still does not get its own page, cover, or URL. This records what
-- the READER is holding; it makes no claim about what exists.

create table if not exists public.reader_editions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users(id) on delete cascade,
  book_id       uuid not null
                  references public.books(id) on delete cascade,

  -- BCP-47 primary subtag ('es', 'en', 'pt'), matching books.language so the
  -- two are comparable without normalising. Not a full tag: es-MX vs es-ES is
  -- an edition distinction this app has no use for and storing it would split
  -- rows that should compare equal.
  language      text,

  -- The edition's OWN ISBN — the point of the whole feature. Distinct from
  -- books.isbn, which editionPicker.js chooses to make a purchase link work and
  -- which isbnFallback.mjs actively rewrites toward English editions.
  isbn          text,

  -- Only when it differs from books.title: 'Cien años de soledad'. Null means
  -- "same as the catalog title", so the UI has a cheap test for whether to show
  -- a second line at all.
  edition_title text,
  translator    text,

  -- Supersedes currently_reading.user_page_count. Backfilled below.
  page_count    integer,

  -- 'print' | 'ebook' | 'audio'. Present because an audiobook has no page count
  -- at all, and without knowing that the progress bar has to pretend: a null
  -- page count on a print book means "unknown", on an audiobook it means "not
  -- applicable", and those want different UI.
  format        text,

  source        text not null default 'manual',   -- manual | isbn_lookup | import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One edition per reader per work. A reader who owns both the English
  -- hardback and the Spanish paperback records the one they READ; re-reads in
  -- another language are a v2 problem and should not buy complexity now.
  unique (user_id, book_id)
);

comment on table public.reader_editions is
  'Which edition of a work a given reader actually read. Per-reader, survives shelf moves. See docs/reader-editions-v1-spec.md.';
comment on column public.reader_editions.isbn is
  'The edition the READER holds. Deliberately NOT books.isbn, which is chosen for purchase links and is rewritten toward English editions by isbnFallback.mjs.';
comment on column public.reader_editions.page_count is
  'Supersedes currently_reading.user_page_count, which was lost when a book was finished.';

create index if not exists reader_editions_user_idx on public.reader_editions (user_id);
create index if not exists reader_editions_book_idx on public.reader_editions (book_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Owner-only, and no public read. This is the first thing to get right rather
-- than the last: SECURITY_AUDIT_v0.39.md finding C3 is a table made
-- world-readable to serve one small feature, which then leaked billing columns
-- to anyone holding the anon key. reader_editions has NO cross-user use case in
-- v1, so it gets no cross-user access — not "restricted", none.
--
-- And note this migration exists as committed SQL at all because of finding H2:
-- ten tables in this project were created in the Supabase dashboard and their
-- RLS cannot be audited from the repo. Do not create the next one that way.

alter table public.reader_editions enable row level security;

drop policy if exists "reader_editions owner all" on public.reader_editions;
create policy "reader_editions owner all" on public.reader_editions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.reader_editions to authenticated;
-- Deliberately nothing for anon.

-- ── Backfill from currently_reading ─────────────────────────────────────────
--
-- Every override a reader has already entered, preserved. Without this, shipping
-- the feature would silently discard the page counts they took the trouble to
-- type in — the exact loss the feature exists to prevent, caused by the fix.
--
-- 'manual' because that is what these were: a human typed the number.

insert into public.reader_editions (user_id, book_id, page_count, source)
select cr.user_id, cr.book_id, cr.user_page_count, 'manual'
  from public.currently_reading cr
 where cr.user_page_count is not null
   and cr.user_page_count > 0
on conflict (user_id, book_id) do nothing;

-- currently_reading.user_page_count is NOT dropped here. A client running the
-- previously deployed bundle still writes and reads it, and dropping the column
-- under it would break progress updates for anyone who has not reloaded. The
-- new client writes reader_editions and reads user_page_count only as a
-- fallback; drop the column one release after this ships.

-- ── Verification ────────────────────────────────────────────────────────────
--
-- 1. Owner isolation. RUN THIS — do not assume it (audit H2 is a list of tables
--    where somebody assumed). As an authenticated user, expect only your rows:
--
--      select count(*) from public.reader_editions;
--
--    With the anon key, expect 0 rows and no error:
--
--      select count(*) from public.reader_editions;
--
-- 2. The backfill moved every override across:
--
--      select
--        (select count(*) from public.currently_reading where user_page_count > 0) as had_override,
--        (select count(*) from public.reader_editions where page_count is not null) as carried;
--
-- 3. The census this makes possible — readers whose edition is not the
--    catalog's. This is the number the work/edition split is really about:
--
--      select re.language, count(*)
--        from public.reader_editions re
--        join public.books b on b.id = re.book_id
--       where re.language is not null
--         and b.language is not null
--         and re.language <> b.language
--       group by 1 order by 2 desc;
