-- 20260819120000_original_language_source.sql
--
-- WHY THIS EXISTS
--
-- 20260817140000 added books.original_language and named exactly one writer for
-- it: the Oracle categorisation pass. That was true for one release. It stops
-- being true the moment batch-scripts/scheduled/originalLanguageBackfill.mjs
-- runs, because that script fills the column for the ~3.4k rows that predate
-- v0.64 and that the nightly pass will never revisit.
--
-- Once a column has more than one writer, "who said this?" becomes a question
-- the row has to be able to answer. books.author_gender learnt this in v0.55
-- and grew author_gender_source for it; oracleBatch.mjs now reads that column
-- to decide whether it is allowed to overwrite a value (HUMAN_SOURCES). Without
-- the equivalent here, a fact taken from Wikidata, a fact inferred by a model
-- and a fact corrected by hand are indistinguishable, and the next bulk pass
-- has no way to know which of them it must leave alone.
--
-- It also matters for a reason specific to this app right now. The ISBNdb
-- evaluation (docs/isbndb-evaluation.md) established that ISBNdb's terms
-- require deleting cached data if the subscription lapses — an obligation that
-- is only satisfiable if the catalog records which values came from where.
-- ISBNdb cannot answer this particular column at all (it has `language`, the
-- printing's language, and no original-language or translated-from field), so
-- no ISBNdb-derived value will ever land here. The column is still the right
-- shape to have in place before the next paid source is considered.
--
-- VALUES
--
--   'wikidata'         P364 on a work whose P50 author matched the row's author
--   'openlibrary'      translated_from / translation_of on the edition record
--   'catalog_sibling'  copied from another row provably the same work
--   'oracle_inferred'  the nightly Claude pass
--   'self_stated'      stated by the author or publisher, recorded by hand
--   'verified'         checked by a human against a source
--
-- The last two are the human tier and are never written by a script. They exist
-- so that the precedence guard below has something to protect.
--
-- No CHECK constraint, for the same reason 20260817140000 declined one on the
-- language codes themselves: a constraint that rejects a legitimate new source
-- fails a write that should have succeeded, and the set of sources is expected
-- to grow. The comment is the contract.

alter table public.books
  add column if not exists original_language_source text;

comment on column public.books.original_language_source is
  'Provenance for books.original_language: wikidata | openlibrary | catalog_sibling | oracle_inferred | self_stated | verified. NULL on rows written before v0.64 or by upsert_book. Scripts must not overwrite a value whose source is self_stated or verified.';

-- Partial index, matching the pattern set by books_original_language_idx: the
-- column is NULL for most of the catalog and the only queries that touch it ask
-- for rows where it is present ("what did the backfill write?", "what still
-- needs a human?").
create index if not exists books_original_language_source_idx
  on public.books (original_language_source) where original_language_source is not null;

-- ── Backfill the one source we can infer retroactively ──────────────────────
--
-- Every original_language value that exists at the moment this migration runs
-- was written by oracleBatch.mjs, because until now nothing else could write
-- the column. Stamping them is not a guess — it is recording a fact the schema
-- guaranteed. Doing it here rather than leaving them NULL means the precedence
-- guard has complete information from its first run; a NULL source would be
-- read as "unknown provenance" and treated more cautiously than it deserves.

update public.books
   set original_language_source = 'oracle_inferred'
 where original_language is not null
   and original_language_source is null;

-- ── Verification ────────────────────────────────────────────────────────────
--
--   select original_language_source, count(*)
--     from public.books
--    where original_language is not null
--    group by 1 order by 2 desc;
--
--   -- must return 0: a source without a value is a bug in whatever wrote it
--   select count(*) from public.books
--    where original_language_source is not null and original_language is null;
