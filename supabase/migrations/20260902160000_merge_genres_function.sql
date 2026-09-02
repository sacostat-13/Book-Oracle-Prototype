-- merge_genres(loser, winner) — fold one genre into another, safely.
--
-- Merging by hand is four statements and three of them have a trap:
--   * `update book_genres set genre_id = winner where genre_id = loser` violates
--     the (book_id, genre_id) primary key for any book tagged with BOTH.
--   * deleting the loser fails on the self-referencing parent_id foreign key if
--     anything is parented to it.
--   * books.genre is a scalar the app still writes. Leaving it pointing at a
--     deleted name is how a merged genre reappears in a later report.
--   * usage_count has to be recomputed from book_genres, not added up.
--
-- Returns what it actually did, so a merge run is auditable rather than silent.

create or replace function public.merge_genres(_loser uuid, _winner uuid)
returns table (links_moved int, links_dropped int, children_repointed int, books_rescalared int)
language plpgsql as $$
declare _loser_name text; _winner_name text; _moved int; _dropped int; _kids int; _scalar int;
begin
  if _loser = _winner then raise exception 'merge_genres: loser and winner are the same row'; end if;
  select name into _loser_name  from genres where id = _loser;
  select name into _winner_name from genres where id = _winner;
  if _loser_name is null then raise exception 'merge_genres: loser % not found', _loser; end if;
  if _winner_name is null then raise exception 'merge_genres: winner % not found', _winner; end if;

  with moved as (
    update book_genres bg set genre_id = _winner
     where bg.genre_id = _loser
       and not exists (select 1 from book_genres w
                        where w.book_id = bg.book_id and w.genre_id = _winner)
    returning 1)
  select count(*)::int into _moved from moved;

  with dropped as (delete from book_genres where genre_id = _loser returning 1)
  select count(*)::int into _dropped from dropped;

  with kids as (update genres set parent_id = _winner where parent_id = _loser returning 1)
  select count(*)::int into _kids from kids;

  with rescalared as (
    update books set genre = _winner_name where genre = _loser_name returning 1)
  select count(*)::int into _scalar from rescalared;

  delete from genres where id = _loser;

  update genres g set usage_count =
    (select count(*) from book_genres bg where bg.genre_id = g.id)
   where g.id = _winner;

  return query select _moved, _dropped, _kids, _scalar;
end $$;

comment on function public.merge_genres(uuid, uuid) is
  'Fold the loser genre into the winner: move links, drop duplicates, repoint '
  'children, repoint books.genre, recount, delete. Returns what it did.';

revoke all on function public.merge_genres(uuid, uuid) from public, anon, authenticated;
