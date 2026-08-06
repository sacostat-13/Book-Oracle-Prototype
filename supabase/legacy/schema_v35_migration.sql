-- ============================================================
-- schema_v35_migration.sql — v0.55 Female-Written Books accomplishment
--
-- Adds author_gender to `books`. This is deliberately NOT a genre: it's an
-- attribute of the author, not a thematic/content classification, so it does
-- NOT go through `genres` / `book_genres` (the canonical taxonomy). It lives
-- as its own column on `books`, mirroring the existing `status` provenance
-- pattern (verified_source/verified_at/verified_by) rather than introducing
-- a join table — this is a single value per book, not a many-to-many tag.
--
-- Populated by the Oracle categorization batch call (oracleCategorizationService.js),
-- same pass that already assigns genres/series/description/complexity/depth —
-- no extra API cost. Guardrail (enforced in the Oracle prompt, not the DB):
-- only 'female' | 'male' | 'nonbinary' may be returned when there's a reliable
-- public signal (author's own bio, publisher copy, stated pronouns); anything
-- uncertain must come back 'unknown' rather than guessed from a name alone,
-- so this feature never misgenders an author.
--
-- 'mixed' covers multi-author books whose authors aren't all the same gender
-- (anthologies, co-authored nonfiction). The reading_accomplishments milestone
-- ladder (shareMoments.js / accomplishments.js, added alongside this migration)
-- counts 'female' and 'mixed' toward the "books by women" count, so a
-- co-authored book isn't invisible just because one co-author is male.
--
-- Scope note: this migration only wires up NEW Oracle categorization runs.
-- Books already status = 'verified' / 'oracle_categorized' from before this
-- shipped are NOT retroactively re-enriched here — getBooksNeedingOracle()
-- only ever runs on 'unreviewed' / 'incomplete' books, same as genres. A
-- one-off backfill pass over the existing catalog (re-running Oracle just for
-- author_gender on already-categorized books) is a separate decision — it has
-- real API cost across the ~900-book catalog — and is left for Simon to
-- schedule deliberately rather than firing automatically from this migration.
-- ============================================================

alter table public.books
  add column if not exists author_gender text
    check (author_gender in ('female', 'male', 'nonbinary', 'mixed', 'unknown')),
  add column if not exists author_gender_source text
    check (author_gender_source in ('oracle_inferred', 'verified', 'self_identified')),
  add column if not exists author_gender_checked_at timestamptz;

comment on column public.books.author_gender is
  'Author gender/identity for the "books by women" accomplishment. NOT a genre — kept off the genres/book_genres taxonomy on purpose. NULL = never checked; ''unknown'' = checked, no reliable public signal.';
comment on column public.books.author_gender_source is
  'Provenance: oracle_inferred (Claude, from a public bio/interview/pronoun signal — never guessed from name), verified/self_identified (manual, authoritative — Oracle backfill must skip these).';

-- Index only for the (currently client-side) eligibility/reporting queries
-- that will want "books with author_gender still unchecked" — cheap to add
-- now, before the catalog is large enough for a full-table scan to sting.
create index if not exists books_author_gender_idx
  on public.books(author_gender);

-- ============================================================
-- Verification — run manually after applying
-- ============================================================
-- New columns exist and are constrained correctly:
--   select column_name, data_type from information_schema.columns
--   where table_name = 'books' and column_name like 'author_gender%';
--
-- Nothing has a value yet (expected — populated going forward by the Oracle):
--   select author_gender, count(*) from public.books group by 1;
