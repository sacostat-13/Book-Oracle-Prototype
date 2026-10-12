-- wrong-genre-audit.sql — READ ONLY.
--
-- How far did the unqualified /sapphic|lesbian fiction/ rule reach?
--
-- Until v0.63.2, GENRE_RULES filed ANY book whose subjects mentioned "sapphic"
-- or "lesbian fiction" under 'Feminist & Sapphic Gothic' at SPECIFIC weight.
-- A hit in the first six subjects scores 9, which beats nearly anything else
-- the table produces — so the wrong genre did not merely apply, it won.
--
-- Run 1 to see the blast radius, then decide whether the --replace pass is
-- worth it. Run 2 after the re-genre to confirm it worked.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Books currently shelved as Feminist & Sapphic Gothic, with the stored
--    subjects that put them there. Anything whose subjects do NOT mention
--    gothic/horror was mis-shelved by the old rule.
-- ─────────────────────────────────────────────────────────────────────────────
select
  b.id,
  b.title,
  b.author,
  b.genre                                as scalar_genre,
  (select array_agg(g2.name order by g2.name)
     from public.book_genres bg2
     join public.genres g2 on g2.id = bg2.genre_id
    where bg2.book_id = b.id)            as all_linked_genres,
  b.source_subjects,
  -- The tell: does anything about this book actually say gothic?
  (b.source_subjects::text ~* 'gothic|horror')  as looks_genuinely_gothic
from public.books b
join public.book_genres bg on bg.book_id = b.id
join public.genres g       on g.id = bg.genre_id
where g.name = 'Feminist & Sapphic Gothic'
order by (b.source_subjects::text ~* 'gothic|horror'), b.title;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The headline number: how many are probably wrong.
-- ─────────────────────────────────────────────────────────────────────────────
select
  count(*)                                                          as shelved_here,
  count(*) filter (where b.source_subjects::text ~* 'gothic|horror') as probably_correct,
  count(*) filter (where not (b.source_subjects::text ~* 'gothic|horror')
                      or b.source_subjects is null)                  as probably_wrong
from public.books b
join public.book_genres bg on bg.book_id = b.id
join public.genres g       on g.id = bg.genre_id
where g.name = 'Feminist & Sapphic Gothic';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Same question for every genre, not just this one. Books whose stored
--    subjects share no vocabulary with the genre they are filed under are the
--    candidates for the next rule audit. Rough heuristic, not a verdict — read
--    it as "worth a look", not "these are wrong".
-- ─────────────────────────────────────────────────────────────────────────────
select
  g.name                          as genre,
  count(*)                        as books,
  count(*) filter (
    where b.source_subjects is not null
      and not (b.source_subjects::text ~* split_part(lower(g.name), ' ', 1))
  )                               as no_subject_overlap
from public.books b
join public.book_genres bg on bg.book_id = b.id
join public.genres g       on g.id = bg.genre_id
where b.source_subjects is not null
group by g.name
having count(*) filter (
    where b.source_subjects is not null
      and not (b.source_subjects::text ~* split_part(lower(g.name), ' ', 1))
  ) > 0
order by 3 desc, 1
limit 40;
