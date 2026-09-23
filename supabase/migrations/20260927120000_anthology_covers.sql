-- v0.71.1 — Anthology covers (Pro). 2026-09-23.
-- Spec: docs/pro-tier-v1-spec.md §5 ("custom cover").
--
--   1. lists.cover_image_url — the uploaded cover, a public Storage URL.
--   2. Storage bucket `anthology-covers`: public read; a reader may write only
--      under their own folder (<uid>/...), and only while Pro. 2 MB, images.
--   3. lists_cover_guard: a client may SET a cover only while Pro and only to a
--      URL inside their own folder of that bucket. REMOVING a cover is always
--      allowed, and a cover set while Pro survives a downgrade — same
--      grandfathering rule as the creation limits.
--   4. search_public_lists / get_followed_lists: when a cover is set, it is the
--      whole preview strip (cover_urls = [cover]); otherwise unchanged. Same
--      signatures, so no client change is needed for the cards to show it.
--      get_public_list already returns row_to_json(l), so it carries the column.
--
-- Depends on 20260924120000 (is_pro, request_is_client). Idempotent.

-- ── 1. Column ─────────────────────────────────────────────────────────────────
alter table public.lists add column if not exists cover_image_url text;

alter table public.lists drop constraint if exists lists_cover_image_url_len;
alter table public.lists add constraint lists_cover_image_url_len
  check (cover_image_url is null or length(cover_image_url) <= 500);

-- ── 2. Storage ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anthology-covers', 'anthology-covers', true, 2097152,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anthology covers: public read"  on storage.objects;
drop policy if exists "anthology covers: pro write"    on storage.objects;
drop policy if exists "anthology covers: pro update"   on storage.objects;
drop policy if exists "anthology covers: owner delete" on storage.objects;

create policy "anthology covers: public read" on storage.objects
  for select using (bucket_id = 'anthology-covers');

create policy "anthology covers: pro write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'anthology-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_pro(auth.uid())
  );

create policy "anthology covers: pro update" on storage.objects
  for update to authenticated
  using (bucket_id = 'anthology-covers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'anthology-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_pro(auth.uid())
  );

-- Deleting your own upload is always allowed, Pro or not.
create policy "anthology covers: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'anthology-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 3. Guard ──────────────────────────────────────────────────────────────────
create or replace function public.lists_cover_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.request_is_client() then return new; end if;
  if new.cover_image_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.cover_image_url is not distinct from old.cover_image_url then
    return new;
  end if;

  if not public.is_pro(new.user_id) then
    raise exception 'pro_required:cover'
      using errcode = 'P0001', detail = 'A custom Anthology cover is part of Pro.', hint = 'upgrade';
  end if;

  if position('/storage/v1/object/public/anthology-covers/' || new.user_id::text || '/' in new.cover_image_url) = 0 then
    raise exception 'lists.cover_image_url must point at the owner''s anthology-covers folder'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists lists_cover_guard on public.lists;
create trigger lists_cover_guard
  before insert or update of cover_image_url on public.lists
  for each row execute function public.lists_cover_guard();

-- ── 4. Cards ──────────────────────────────────────────────────────────────────
-- Bodies copied from 20260812150000_curated_lists.sql; only the cover_urls
-- expression changed.

create or replace function public.search_public_lists(
  p_query     text   default null,
  p_genre_ids uuid[] default null,
  p_moods     text[] default null,
  p_sort      text   default 'followers'
)
  returns table (
    id             uuid,
    title          text,
    description    text,
    created_at     timestamptz,
    owner_username text,
    owner_display  text,
    owner_avatar   text,
    book_count     bigint,
    follower_count bigint,
    genre_names    text[],
    moods          text[],
    cover_urls     text[],
    caller_follows boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  with base as (
    select l.*
    from public.lists l
    where l.is_public
      and (p_query is null
           or l.title ilike '%' || p_query || '%'
           or l.description ilike '%' || p_query || '%')
      and (p_genre_ids is null or exists (
            select 1 from public.list_genres lg
            where lg.list_id = l.id and lg.genre_id = any(p_genre_ids)))
      and (p_moods is null or exists (
            select 1 from public.list_moods lm
            where lm.list_id = l.id and lm.mood = any(p_moods)))
  )
  select
    b.id,
    b.title,
    b.description,
    b.created_at,
    p.username,
    p.display_name,
    p.avatar_url,
    (select count(*) from public.list_items li where li.list_id = b.id),
    (select count(*) from public.list_followers lf where lf.list_id = b.id),
    coalesce((
      select array_agg(g.name order by g.name)
      from public.list_genres lg join public.genres g on g.id = lg.genre_id
      where lg.list_id = b.id
    ), '{}'),
    coalesce((
      select array_agg(lm.mood order by lm.mood)
      from public.list_moods lm where lm.list_id = b.id
    ), '{}'),
    -- First six covers, in list order, for the preview strip. Books without a
    -- cover are skipped rather than leaving a gap.
    -- v0.71.1: a custom cover (Pro) stands alone; otherwise the first six book covers.
    case when b.cover_image_url is not null then array[b.cover_image_url]
    else coalesce((
      select array_agg(c.cover_url)
      from (
        select bk.cover_url
        from public.list_items li join public.books bk on bk.id = li.book_id
        where li.list_id = b.id and bk.cover_url is not null
        order by li.position asc
        limit 6
      ) c
    ), '{}') end,
    -- False for anonymous callers; auth.uid() is null and the exists cannot match.
    exists (
      select 1 from public.list_followers lf
      where lf.list_id = b.id and lf.user_id = auth.uid()
    )
  from base b
  join public.profiles p on p.id = b.user_id
  order by
    case when p_sort = 'followers'
      then (select count(*) from public.list_followers lf where lf.list_id = b.id) end desc nulls last,
    case when p_sort = 'books'
      then (select count(*) from public.list_items li where li.list_id = b.id) end desc nulls last,
    b.created_at desc;
$$;

create or replace function public.get_followed_lists()
  returns table (
    id             uuid,
    title          text,
    description    text,
    owner_username text,
    owner_display  text,
    owner_avatar   text,
    book_count     bigint,
    follower_count bigint,
    cover_urls     text[],
    has_updates    boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select
    l.id, l.title, l.description,
    p.username, p.display_name, p.avatar_url,
    (select count(*) from public.list_items li where li.list_id = l.id),
    (select count(*) from public.list_followers x where x.list_id = l.id),
    -- v0.71.1: a custom cover (Pro) stands alone; otherwise the first six book covers.
    case when l.cover_image_url is not null then array[l.cover_image_url]
    else coalesce((
      select array_agg(c.cover_url)
      from (
        select bk.cover_url
        from public.list_items li join public.books bk on bk.id = li.book_id
        where li.list_id = l.id and bk.cover_url is not null
        order by li.position asc limit 6
      ) c
    ), '{}') end,
    -- Changed since this follower last opened it. `lists.updated_at` alone is
    -- not enough: adding a book touches list_items, not lists.
    (lf.last_seen_at is null or exists (
      select 1 from public.list_change_log cl
      where cl.list_id = l.id and cl.at > lf.last_seen_at
    ))
  from public.list_followers lf
  join public.lists l    on l.id = lf.list_id and l.is_public
  join public.profiles p on p.id = l.user_id
  where lf.user_id = auth.uid()
  order by lf.followed_at desc;
$$;

grant execute on function public.search_public_lists(text, uuid[], text[], text) to anon, authenticated;
grant execute on function public.get_followed_lists() to authenticated;

do $$ begin
  raise notice 'v0.71.1: anthology covers ready.';
end $$;
