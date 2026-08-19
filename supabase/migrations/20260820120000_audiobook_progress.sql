-- 20260820120000_audiobook_progress.sql
--
-- Spec: docs/audiobook-progress-v1-spec.md. Read that first; this is the data
-- half.
--
-- THE PROBLEM, IN ONE LINE
--
-- Dashboard.jsx sums effectivePages() across the library. An audiobook has no
-- page count, so it contributes ZERO, and a reader who finished forty
-- audiobooks this year is told they read nothing. That is already in
-- production, and it is the reason this is a correctness fix rather than only
-- a new feature.
--
-- v0.64 gave reader_editions a `format` column and then gave an audiobook
-- nothing to put anywhere. These three columns are that somewhere.
--
-- WHY MINUTES AND NOT HOURS
--
-- An audiobook is 11h 47m. As hours that is 11.783, a float that every render
-- has to un-round and that accumulates error when summed across a library.
-- Minutes is 707, an integer, and the formatting is one function. The INPUT is
-- still hours-and-minutes — nobody types 707.
--
-- WHY PROGRESS IS A SECOND COLUMN AND NOT A UNIT FLAG ON THE FIRST
--
-- One `progress` number whose unit is decided by `format` is tempting and
-- wrong. reader_editions is unique per (user_id, book_id), so a reader CAN
-- change format part-way through a book — started the paperback, switched to
-- the audiobook for a commute. With one column, page 143 silently becomes 143
-- minutes. Two nullable integers make that impossible.
--
-- WHY DURATION LIVES HERE AND PROGRESS LIVES ON currently_reading
--
-- The same split reader_editions was created for. Progress is transient and
-- correctly disappears when the book is finished; the DURATION is a fact about
-- the reader's copy and must survive the shelf move, because it is what the
-- finished book contributes to the hours-listened total. Putting duration on
-- currently_reading would repeat the user_page_count mistake exactly.

alter table public.reader_editions
  add column if not exists duration_minutes integer,
  add column if not exists narrator         text;

comment on column public.reader_editions.duration_minutes is
  'Total length of THIS reader''s audio edition, in minutes. NULL is a supported, common state: cumulative hours-listened works without it and only the progress bar needs a total, so the field is never required. Minutes rather than hours because 11h 47m is 707, not 11.783.';

comment on column public.reader_editions.narrator is
  'Who reads this audio edition. The audio counterpart of translator — free to capture at the moment the reader is already telling us about their copy, and expensive to ask for later. Displayed nowhere in v1 beyond the reader''s own edition line.';

alter table public.currently_reading
  add column if not exists progress_minutes integer;

comment on column public.currently_reading.progress_minutes is
  'How far into an audio edition this reader is, in minutes. Parallel to pages_read, never a replacement: the unit is decided by reader_editions.format, and a reader who switches format mid-book must not have their old number reinterpreted. Deleted with the row when the book is finished, which is correct — part-way position stops being interesting; the DURATION on reader_editions is what the finished book contributes to the stat.';

-- No index on either. Both are read only as part of a row already being
-- fetched by (user_id, book_id) — there is no "find me all audiobooks over ten
-- hours" query and adding an index for one that does not exist is the kind of
-- dead weight 20260817140000 declined for the same reason.

-- No CHECK constraints, matching the house rule from 20260817140000: a
-- constraint that rejects a real value fails a write that should have
-- succeeded. A 90-hour audiobook exists (the unabridged *Les Misérables* is
-- over 60), and a reader who fat-fingers 9999 has made a typo they can fix,
-- not corrupted anything. The client validates; the column records.

-- ── Verification ────────────────────────────────────────────────────────────
--
--   -- an audio edition with a duration, and one without: both are valid
--   select format, count(*) filter (where duration_minutes is not null) as with_total,
--          count(*) filter (where duration_minutes is null)     as without_total
--     from public.reader_editions group by format;
--
--   -- must return 0: minutes on a row that is not an audio edition means the
--   -- format switch wrote into the wrong unit
--   select count(*)
--     from public.currently_reading cr
--     join public.reader_editions re
--       on re.user_id = cr.user_id and re.book_id = cr.book_id
--    where cr.progress_minutes is not null
--      and coalesce(re.format, 'print') <> 'audio';
--
--   -- hours listened, for one reader — the number the Dashboard tile must match
--   select round(sum(m) / 60.0, 1) as hours from (
--     select cr.progress_minutes as m
--       from public.currently_reading cr
--       join public.reader_editions re
--         on re.user_id = cr.user_id and re.book_id = cr.book_id
--      where cr.user_id = '<uuid>' and re.format = 'audio'
--     union all
--     select re.duration_minutes
--       from public.read_books rb
--       join public.reader_editions re
--         on re.user_id = rb.user_id and re.book_id = rb.book_id
--      where rb.user_id = '<uuid>' and re.format = 'audio'
--   ) s;
