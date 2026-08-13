-- fix-sapphic-gothic-links.sql
--
-- The surgical alternative to `regenreCatalog --apply --replace`.
--
-- WHY NOT --replace
--
-- Its dry run on this catalogue projected:
--
--     links that would be ADDED      44
--     links that would be REMOVED  1944
--     books LOSING a genre         1158
--
-- The 44 is roughly the true effect of the v0.63.2 rule correction. The 1944 is
-- collateral, and the cause is that three different writers stamp the same
-- provenance value:
--
--     oracleBatch.mjs:437        assigned_by_source: 'oracle'   <- CLAUDE's judgement
--     metadataBackfill.mjs:677   assigned_by_source: 'oracle'   <- rule-derived
--     regenreCatalog.mjs:522     assigned_by_source: 'oracle'   <- rule-derived
--
-- `--replace` deletes every 'oracle' row for a book and re-adds only what the
-- rule table can reproduce. Claude's genres are not reproducible from a keyword
-- table — that is the entire reason the nightly pass is worth paying for — so
-- they are deleted and never come back. The catalogue would lose about a fifth
-- of its genre links, most of them the ones you paid for, to correct a few
-- dozen mis-shelvings.
--
-- The schema cannot currently tell the two apart:
--     CHECK (assigned_by_source = ANY (ARRAY['seed','oracle','admin']))
-- There is no fourth value to give the rule-written rows. Until there is,
-- --replace is not a safe instrument and this file is the way to fix a bad rule.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PREVIEW. Books shelved as 'Feminist & Sapphic Gothic' whose stored
--    subjects do not satisfy the CORRECTED pattern — i.e. the ones the old
--    unqualified /sapphic|lesbian fiction/ rule swept in. Read this list before
--    deleting anything; it should be dozens, not hundreds.
-- ═══════════════════════════════════════════════════════════════════════════
select
  b.id,
  b.title,
  b.author,
  b.genre                                       as scalar_genre,
  b.source_subjects,
  (select array_agg(g2.name order by g2.name)
     from public.book_genres bg2
     join public.genres g2 on g2.id = bg2.genre_id
    where bg2.book_id = b.id)                   as all_genres_now
from public.books b
join public.book_genres bg on bg.book_id = b.id
join public.genres g       on g.id = bg.genre_id
where g.name = 'Feminist & Sapphic Gothic'
  and bg.assigned_by_source = 'oracle'
  and not (coalesce(b.source_subjects::text, '')
           ~* 'sapphic gothic|lesbian gothic|feminist gothic|queer gothic')
order by b.title;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE DELETE. Same predicate, nothing else touched. Every other genre link
--    on these books — including anything Claude assigned — survives.
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
--
-- delete from public.book_genres bg
--  using public.books b, public.genres g
--  where bg.book_id = b.id
--    and bg.genre_id = g.id
--    and g.name = 'Feminist & Sapphic Gothic'
--    and bg.assigned_by_source = 'oracle'
--    and not (coalesce(b.source_subjects::text, '')
--             ~* 'sapphic gothic|lesbian gothic|feminist gothic|queer gothic');
--
-- -- Should match the row count from section 1. If it does not, ROLLBACK.
-- commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. The scalar column. books.genre holds a single top pick that other code
--    still reads, and for these books it may also say 'Feminist & Sapphic
--    Gothic'. Null it so the next metadataBackfill pass refills it from the
--    corrected rules — that pass only writes the scalar when it is absent.
-- ═══════════════════════════════════════════════════════════════════════════
-- update public.books b
--    set genre = null, updated_at = now()
--  where b.genre = 'Feminist & Sapphic Gothic'
--    and not (coalesce(b.source_subjects::text, '')
--             ~* 'sapphic gothic|lesbian gothic|feminist gothic|queer gothic');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. AFTERWARDS. The corrected rules still need to ADD the right genres to
--    these books (Sports Fiction, LGBTQ+ Fiction, Romance and so on). That is
--    purely additive, so a plain --apply does it safely:
--
--        node batch-scripts/manual/regenreCatalog.mjs --apply
--
--    No --replace. The weekly job runs exactly this.
-- ═══════════════════════════════════════════════════════════════════════════
