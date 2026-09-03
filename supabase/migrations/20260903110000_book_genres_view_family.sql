-- Carry the family onto book_genres_view.
--
-- Every genre-aware surface in the app reads this view: the shelf filters, the
-- book pill, the taste profile. Grouping the filter by family without this means
-- a second query per shelf load, or a client-side join against the catalogue —
-- both of which put the family in two places and let them drift.
--
-- CREATE OR REPLACE cannot add columns to an existing view in Postgres, so this
-- drops and recreates. Nothing depends on the view except the app's own selects,
-- which name their columns explicitly and are unaffected by the additions.
--
-- security_invoker=true is preserved: the view must keep answering as the caller,
-- not as its owner.

drop view if exists public.book_genres_view;

create view public.book_genres_view with (security_invoker = true) as
select
  bg.book_id,
  bg.genre_id,
  g.name              as genre_name,
  g.normalized_name,
  g.source            as genre_source,
  g.usage_count,
  g.description       as genre_description,
  bg.assigned_by_source,
  -- Family is nullable by design: a genre the Oracle invents tonight has none
  -- until curation assigns one, and the UI groups those under a fallback rather
  -- than hiding them.
  g.family_id,
  f.slug              as family_slug,
  f.name              as family_name,
  f.sort_order        as family_sort
from public.book_genres bg
  join public.genres g on g.id = bg.genre_id
  left join public.genre_families f on f.id = g.family_id;

grant select on public.book_genres_view to anon, authenticated, service_role;
