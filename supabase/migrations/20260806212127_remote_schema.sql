-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE EXTENSION pg_trgm WITH SCHEMA public;

CREATE EXTENSION unaccent WITH SCHEMA public;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

CREATE SEQUENCE public.book_merge_log_id_seq;

CREATE SEQUENCE public.oracle_call_log_id_seq;

CREATE SEQUENCE public.oracle_recommendations_id_seq;

CREATE FUNCTION public._dedupe_first_author (
  a text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select btrim(
           split_part(
             regexp_replace(lower(coalesce(a,'')), '\s+(y|and|with|&|/|;|,)\s+', '|', 'g'),
             '|', 1))
$function$;

GRANT ALL ON FUNCTION public._dedupe_first_author(text) TO anon;

GRANT ALL ON FUNCTION public._dedupe_first_author(text) TO authenticated;

GRANT ALL ON FUNCTION public._dedupe_first_author(text) TO service_role;

CREATE FUNCTION public._dedupe_norm_title (
  t text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select regexp_replace(
           regexp_replace(
             lower(regexp_replace(coalesce(t,''), '\s*\([^()]*\)\s*$', '', 'g')),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g')
$function$;

GRANT ALL ON FUNCTION public._dedupe_norm_title(text) TO anon;

GRANT ALL ON FUNCTION public._dedupe_norm_title(text) TO authenticated;

GRANT ALL ON FUNCTION public._dedupe_norm_title(text) TO service_role;

CREATE FUNCTION public.approve_join_request (
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_req       record;
  v_member_ct int;
  v_max       int;
begin
  select * into v_req
    from public.club_join_requests
    where id = p_request_id and status in ('pending_approval', 'waitlisted')
    for update;

  if v_req.id is null then
    raise exception 'Request not found or already resolved';
  end if;

  if not exists (
    select 1 from public.book_club_members
    where club_id = v_req.club_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;

  select max_members into v_max from public.book_clubs where id = v_req.club_id;
  select count(*) into v_member_ct from public.book_club_members where club_id = v_req.club_id;

  if v_max is not null and v_member_ct >= v_max then
    -- club filled up since the request was made — hold on the waitlist
    -- instead of approving into an over-capacity club
    update public.club_join_requests set status = 'waitlisted' where id = p_request_id;
    return jsonb_build_object('status', 'waitlisted');
  end if;

  insert into public.book_club_members (club_id, user_id, role, added_by)
  values (v_req.club_id, v_req.user_id, 'member', auth.uid());

  update public.club_join_requests
    set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;

  insert into public.notifications (user_id, type, actor_id, data)
  values (v_req.user_id, 'join_approved', auth.uid(), jsonb_build_object('club_id', v_req.club_id))
  on conflict do nothing;

  return jsonb_build_object('status', 'approved');
end;
$function$;

GRANT ALL ON FUNCTION public.approve_join_request(uuid) TO anon;

GRANT ALL ON FUNCTION public.approve_join_request(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.approve_join_request(uuid) TO service_role;

CREATE FUNCTION public.broadcast_announcement (
  p_title    text,
  p_body     text,
  p_admin_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_announcement_id uuid;
  v_user_id         uuid;
begin
  insert into public.announcements (title, body, created_by)
  values (p_title, p_body, p_admin_id)
  returning id into v_announcement_id;

  -- Fan out to all users. Store the FULL body so the modal/email render it in
  -- full; keep a short `preview` for any surface that wants a summary line.
  for v_user_id in select id from public.profiles loop
    insert into public.notifications (user_id, type, actor_id, data)
    values (
      v_user_id, 'announcement', p_admin_id,
      jsonb_build_object(
        'announcement_id', v_announcement_id,
        'title',           p_title,
        'body',            p_body,
        'preview',         left(p_body, 200)
      )
    );
  end loop;

  return v_announcement_id;
end;
$function$;

GRANT ALL ON FUNCTION public.broadcast_announcement(text, text, uuid) TO anon;

GRANT ALL ON FUNCTION public.broadcast_announcement(text, text, uuid) TO authenticated;

GRANT ALL ON FUNCTION public.broadcast_announcement(text, text, uuid) TO service_role;

CREATE FUNCTION public.bump_catalog_version()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  update public.catalog_meta
  set version = version + 1, updated_at = now()
  where id = true;
  return null;   -- statement-level triggers ignore the return value
end;
$function$;

GRANT ALL ON FUNCTION public.bump_catalog_version() TO anon;

GRANT ALL ON FUNCTION public.bump_catalog_version() TO authenticated;

GRANT ALL ON FUNCTION public.bump_catalog_version() TO service_role;

CREATE FUNCTION public.bump_category_usage()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE categories SET usage_count = usage_count + 1 WHERE id = NEW.category_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE categories SET usage_count = greatest(usage_count - 1, 0) WHERE id = OLD.category_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

GRANT ALL ON FUNCTION public.bump_category_usage() TO anon;

GRANT ALL ON FUNCTION public.bump_category_usage() TO authenticated;

GRANT ALL ON FUNCTION public.bump_category_usage() TO service_role;

CREATE FUNCTION public.bump_genre_usage()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE genres SET usage_count = usage_count + 1 WHERE id = NEW.genre_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE genres SET usage_count = greatest(usage_count - 1, 0) WHERE id = OLD.genre_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

GRANT ALL ON FUNCTION public.bump_genre_usage() TO anon;

GRANT ALL ON FUNCTION public.bump_genre_usage() TO authenticated;

GRANT ALL ON FUNCTION public.bump_genre_usage() TO service_role;

CREATE FUNCTION public.cast_vote (
  p_poll_id   uuid,
  p_option_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_club_id uuid;
BEGIN
  SELECT club_id INTO v_club_id FROM public.club_polls WHERE id = p_poll_id;
  IF v_club_id IS NULL OR NOT public.is_club_member(v_club_id, auth.uid()) THEN
    RETURN NULL;
  END IF;

  -- Verify option belongs to this poll
  IF NOT EXISTS (SELECT 1 FROM public.poll_options WHERE id = p_option_id AND poll_id = p_poll_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.poll_votes (poll_id, user_id, option_id)
  VALUES (p_poll_id, auth.uid(), p_option_id)
  ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = p_option_id, voted_at = now();

  -- Return updated counts for all options
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'vote_count', (SELECT count(*) FROM public.poll_votes WHERE option_id = o.id)
    ))
    FROM public.poll_options o WHERE o.poll_id = p_poll_id
  );
END;
$function$;

GRANT ALL ON FUNCTION public.cast_vote(uuid, uuid) TO anon;

GRANT ALL ON FUNCTION public.cast_vote(uuid, uuid) TO authenticated;

GRANT ALL ON FUNCTION public.cast_vote(uuid, uuid) TO service_role;

CREATE FUNCTION public.compute_book_key (
  _title  text,
  _author text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select
    regexp_replace(lower(coalesce(_title, '')), '[^a-z0-9]', '', 'g')
    || '|' ||
    substr(regexp_replace(lower(coalesce(_author, '')), '[^a-z0-9]', '', 'g'), 1, 10);
$function$;

GRANT ALL ON FUNCTION public.compute_book_key(text, text) TO anon;

GRANT ALL ON FUNCTION public.compute_book_key(text, text) TO authenticated;

GRANT ALL ON FUNCTION public.compute_book_key(text, text) TO service_role;

CREATE FUNCTION public.consume_oracle_call (
  p_user_id uuid,
  p_run_id  uuid DEFAULT NULL::uuid,
  p_feature text DEFAULT NULL::text,
  p_source  text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_status          text;
  v_is_curator      boolean;
  v_calls_month     integer;
  v_calls_day       integer;
  v_month_start_at  timestamptz;
  v_day_start_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_exempt          boolean;
  v_already_charged boolean;
  v_source          text;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  v_source := coalesce(nullif(btrim(p_source), ''), 'unknown');

  select subscription_status, is_curator,
         oracle_calls_this_month, oracle_calls_month_start,
         oracle_calls_today,      oracle_calls_day_start
  into   v_status, v_is_curator,
         v_calls_month, v_month_start_at,
         v_calls_day,   v_day_start_at
  from   public.profiles
  where  id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Profile not found');
  end if;

  v_month_start := date_trunc('month', now() at time zone 'utc');
  v_day_start   := date_trunc('day',   now() at time zone 'utc');

  -- The exemption: curator AND catalog work. Not curator alone.
  v_exempt := coalesce(v_is_curator, false) and p_feature = 'categorization';

  -- ── Exempt: count for cost visibility, enforce nothing ─────────────────────
  if v_exempt then
    update public.profiles
      set oracle_calls_exempt_total = oracle_calls_exempt_total + 1
      where id = p_user_id;

    insert into public.oracle_call_log(user_id, source, charged, period, run_id)
      values (p_user_id, v_source, false, 'exempt', p_run_id);

    return jsonb_build_object(
      'status', 'ok', 'period', 'exempt',
      'calls_used', v_calls_day, 'calls_limit', null,
      'reset_at', null, 'unlimited', true,
      'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  -- ── Already paid for this run? ─────────────────────────────────────────────
  -- Checked before the limit tests: a run that has been charged must be
  -- allowed to finish even if it crosses the wall mid-way, otherwise a large
  -- shelf half-categorizes and stops.
  if p_run_id is not null then
    select true into v_already_charged
    from public.oracle_call_runs
    where user_id = p_user_id and run_id = p_run_id;

    if coalesce(v_already_charged, false) then
      insert into public.oracle_call_log(user_id, source, charged, period, run_id)
        values (p_user_id, v_source, false, 'run', p_run_id);

      return jsonb_build_object(
        'status', 'ok', 'period', 'run',
        'calls_used', v_calls_day, 'calls_limit', null,
        'reset_at', null, 'unlimited', false,
        'is_curator', v_is_curator, 'run_charged', true
      );
    end if;
  end if;

  -- ── Free tier: monthly ─────────────────────────────────────────────────────
  if v_status != 'active' then
    if v_month_start_at < v_month_start then
      v_calls_month := 0;
      update public.profiles
        set oracle_calls_this_month = 0, oracle_calls_month_start = v_month_start
        where id = p_user_id;
    end if;

    -- Refusals are not logged: no call was made, so there is nothing to
    -- account for. The wall UI already explains itself.
    if v_calls_month >= v_free_limit then
      return jsonb_build_object(
        'status', 'quota_exceeded', 'period', 'month',
        'calls_used', v_calls_month, 'calls_limit', v_free_limit,
        'reset_at', v_month_start + interval '1 month',
        'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
      );
    end if;

    update public.profiles
      set oracle_calls_this_month = v_calls_month + 1
      where id = p_user_id;

    if p_run_id is not null then
      insert into public.oracle_call_runs(user_id, run_id)
        values (p_user_id, p_run_id) on conflict do nothing;
    end if;

    insert into public.oracle_call_log(user_id, source, charged, period, run_id)
      values (p_user_id, v_source, true, 'month', p_run_id);

    return jsonb_build_object(
      'status', 'ok', 'period', 'month',
      'calls_used', v_calls_month + 1, 'calls_limit', v_free_limit,
      'reset_at', v_month_start + interval '1 month',
      'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  -- ── Pro tier: daily ────────────────────────────────────────────────────────
  if v_day_start_at < v_day_start then
    v_calls_day := 0;
    update public.profiles
      set oracle_calls_today = 0, oracle_calls_day_start = v_day_start
      where id = p_user_id;
  end if;

  if v_month_start_at < v_month_start then
    v_calls_month := 0;
    update public.profiles
      set oracle_calls_this_month = 0, oracle_calls_month_start = v_month_start
      where id = p_user_id;
  end if;

  if v_calls_day >= v_pro_day_limit then
    return jsonb_build_object(
      'status', 'quota_exceeded', 'period', 'day',
      'calls_used', v_calls_day, 'calls_limit', v_pro_day_limit,
      'reset_at', v_day_start + interval '1 day',
      'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
    );
  end if;

  update public.profiles
    set oracle_calls_today      = v_calls_day + 1,
        oracle_calls_this_month = v_calls_month + 1
    where id = p_user_id;

  if p_run_id is not null then
    insert into public.oracle_call_runs(user_id, run_id)
      values (p_user_id, p_run_id) on conflict do nothing;
  end if;

  insert into public.oracle_call_log(user_id, source, charged, period, run_id)
    values (p_user_id, v_source, true, 'day', p_run_id);

  return jsonb_build_object(
    'status', 'ok', 'period', 'day',
    'calls_used', v_calls_day + 1, 'calls_limit', v_pro_day_limit,
    'reset_at', v_day_start + interval '1 day',
    'unlimited', false, 'is_curator', v_is_curator, 'run_charged', false
  );
end;
$function$;

GRANT ALL ON FUNCTION public.consume_oracle_call(uuid, uuid, text, text) TO anon;

GRANT ALL ON FUNCTION public.consume_oracle_call(uuid, uuid, text, text) TO authenticated;

GRANT ALL ON FUNCTION public.consume_oracle_call(uuid, uuid, text, text) TO service_role;

CREATE FUNCTION public.dedupe_author_key (
  a text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select regexp_replace(
           regexp_replace(
             lower(unaccent(
               split_part(
                 regexp_replace(
                   translate(coalesce(a,''), '’‘`´', ''''''''),
                   '\s+(y|and|with|&|/|;|,)\s+', '|', 'g'),
                 '|', 1))),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g')
$function$;

GRANT ALL ON FUNCTION public.dedupe_author_key(text) TO anon;

GRANT ALL ON FUNCTION public.dedupe_author_key(text) TO authenticated;

GRANT ALL ON FUNCTION public.dedupe_author_key(text) TO service_role;

CREATE FUNCTION public.dedupe_title_key (
  t text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select regexp_replace(
           regexp_replace(
             lower(unaccent(
               regexp_replace(
                 translate(coalesce(t,''), '’‘‛`´“”„–—‑', '''''''''""" --'),
                 '\s*\([^()]*#[^()]*\)\s*$', '', 'g')
             )),
             '[^a-z0-9 ]', '', 'g'),
           '\s+', ' ', 'g')
$function$;

GRANT ALL ON FUNCTION public.dedupe_title_key(text) TO anon;

GRANT ALL ON FUNCTION public.dedupe_title_key(text) TO authenticated;

GRANT ALL ON FUNCTION public.dedupe_title_key(text) TO service_role;

CREATE FUNCTION public.get_club_detail (
  p_club_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_is_member boolean;
  v_result    jsonb;
BEGIN
  -- Verify caller is a member
  SELECT EXISTS (
    SELECT 1 FROM public.book_club_members
    WHERE club_id = p_club_id AND user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'club', row_to_json(c)::jsonb,
    'genres', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name))
      FROM public.book_club_genres bcg
      JOIN public.genres g ON g.id = bcg.genre_id
      WHERE bcg.club_id = p_club_id
    ), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',          m.id,
        'user_id',     m.user_id,
        'role',        m.role,
        'joined_at',   m.joined_at,
        'display_name', p.display_name,
        'avatar_url',  p.avatar_url
      ) ORDER BY m.joined_at)
      FROM public.book_club_members m
      JOIN public.profiles p ON p.id = m.user_id
      WHERE m.club_id = p_club_id
    ), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',          s.id,
        'title',       COALESCE(s.title, b.title),
        'admin_notes', s.admin_notes,
        'starts_at',   s.starts_at,
        'ends_at',     s.ends_at,
        'created_at',  s.created_at,
        'book', jsonb_build_object(
          'id',        b.id,
          'title',     b.title,
          'author',    b.author,
          'cover_url', b.cover_url,
          'pages',     b.pages,
          'isbn',      b.isbn
        )
      ) ORDER BY s.starts_at DESC)
      FROM public.book_club_sessions s
      JOIN public.books b ON b.id = s.book_id
      WHERE s.club_id = p_club_id
    ), '[]'::jsonb),
    'caller_role', (
      SELECT role FROM public.book_club_members
      WHERE club_id = p_club_id AND user_id = auth.uid()
    )
  )
  INTO v_result
  FROM public.book_clubs c
  WHERE c.id = p_club_id;

  RETURN v_result;
END;
$function$;

GRANT ALL ON FUNCTION public.get_club_detail(uuid) TO anon;

GRANT ALL ON FUNCTION public.get_club_detail(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_club_detail(uuid) TO service_role;

CREATE FUNCTION public.get_club_polls (
  p_club_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  IF NOT public.is_club_member(p_club_id, auth.uid()) THEN
    RETURN NULL;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',               p.id,
        'question',         p.question,
        'closes_at',        p.closes_at,
        'closed',           p.closed,
        'is_oracle_pick',   p.is_oracle_pick,
        'result_session_id',p.result_session_id,
        'created_at',       p.created_at,
        'my_vote',          (
          SELECT option_id FROM public.poll_votes
          WHERE poll_id = p.id AND user_id = auth.uid()
        ),
        'options', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id',          o.id,
              'label',       o.label,
              'book_id',     o.book_id,
              'book_author', o.book_author,
              'cover_url',   o.cover_url,
              'position',    o.position,
              'vote_count', (
                SELECT count(*) FROM public.poll_votes
                WHERE option_id = o.id
              )
            ) ORDER BY o.position
          )
          FROM public.poll_options o
          WHERE o.poll_id = p.id
        ), '[]'::jsonb)
      ) ORDER BY p.created_at DESC
    )
    FROM public.club_polls p
    WHERE p.club_id = p_club_id
  ), '[]'::jsonb);
END;
$function$;

GRANT ALL ON FUNCTION public.get_club_polls(uuid) TO anon;

GRANT ALL ON FUNCTION public.get_club_polls(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_club_polls(uuid) TO service_role;

CREATE FUNCTION public.get_curated_catalog()
  RETURNS TABLE (
    id                 uuid,
    title              text,
    author             text,
    description        text,
    genre              text,
    complexity         text,
    depth              text,
    pages              integer,
    cover_url          text,
    isbn               text,
    source             text,
    status             text,
    verified_source    text,
    verified_at        timestamp with time zone,
    verified_by        text,
    position_in_series integer,
    series             jsonb,
    vault_source       text,
    curator_rating     numeric
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with curators as (
    select p.id
    from public.profiles p
    where p.is_curator = true
  ),
  candidate as (
    -- Curator wishlists: taste signal, no rating dimension.
    select wi.book_id, 'wishlist'::text as src, null::numeric as rating
    from public.wishlist_items wi
    join curators c on c.id = wi.user_id
    union all
    -- Curator libraries: experience signal. Explicit low ratings are
    -- excluded (the one negative signal we have); unrated reads stay.
    select rb.book_id, 'library'::text as src, rb.rating
    from public.read_books rb
    join curators c on c.id = rb.user_id
    where rb.rating is null or rb.rating >= 3
  ),
  rolled as (
    select
      cd.book_id,
      case
        when bool_or(cd.src = 'wishlist') and bool_or(cd.src = 'library') then 'both'
        when bool_or(cd.src = 'library') then 'library'
        else 'wishlist'
      end as vault_source,
      max(cd.rating) as curator_rating
    from candidate cd
    group by cd.book_id
  )
  select
    b.id,
    b.title,
    b.author,
    b.description,
    b.genre,
    b.complexity,
    b.depth,
    b.pages,
    b.cover_url,
    b.isbn,
    b.source,
    b.status,
    b.verified_source,
    b.verified_at,
    b.verified_by,
    b.position_in_series,
    case
      when s.id is not null then jsonb_build_object(
        'id',                 s.id,
        'name',               s.name,
        'total_books',        s.total_books,
        'status',             s.status,
        'publication_status', s.publication_status,
        'verified_source',    s.verified_source,
        'verified_at',        s.verified_at,
        'verified_by',        s.verified_by,
        'source',             s.source
      )
      else null
    end as series,
    r.vault_source,
    r.curator_rating
  from rolled r
  join public.books b on b.id = r.book_id
  left join public.series s on s.id = b.series_id
  where b.status in ('verified', 'oracle_categorized')
  order by b.title asc;
$function$;

GRANT ALL ON FUNCTION public.get_curated_catalog() TO anon;

GRANT ALL ON FUNCTION public.get_curated_catalog() TO authenticated;

GRANT ALL ON FUNCTION public.get_curated_catalog() TO service_role;

CREATE FUNCTION public.get_dashboard_clubs_summary()
  RETURNS TABLE (
    id                  uuid,
    name                text,
    member_count        bigint,
    session_number      bigint,
    session_status      text,
    current_book_title  text,
    current_book_author text,
    current_book_cover  text,
    member_avatars      jsonb
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return query
  with my_clubs as (
    select bc.id, bc.name
    from public.book_clubs bc
    join public.book_club_members m on m.club_id = bc.id
    where m.user_id = auth.uid()
  ),
  counted as (
    select
      c.*,
      (select count(*) from public.book_club_members m where m.club_id = c.id) as member_count
    from my_clubs c
  ),
  numbered_sessions as (
    select
      bcs.id, bcs.club_id, bcs.starts_at, bcs.ends_at, bcs.book_id,
      row_number() over (partition by bcs.club_id order by bcs.starts_at asc) as session_number
    from public.book_club_sessions bcs
  ),
  chosen as (
    select distinct on (ns.club_id)
      ns.club_id, ns.session_number, ns.book_id,
      case
        when now() between ns.starts_at and ns.ends_at then 'active'
        when ns.ends_at < now()                         then 'past'
        else 'upcoming'
      end as session_status
    from numbered_sessions ns
    order by
      ns.club_id,
      case
        when now() between ns.starts_at and ns.ends_at then 0  -- active wins
        when ns.ends_at < now()                         then 1  -- else most recent past
        else 2                                                  -- else soonest upcoming
      end,
      case when ns.ends_at < now() then ns.ends_at end desc,
      case when ns.ends_at >= now() then ns.starts_at end asc
  )
  select
    c.id, c.name, c.member_count,
    ch.session_number, ch.session_status,
    bk.title, bk.author, bk.cover_url,
    coalesce((
      select jsonb_agg(jsonb_build_object('display_name', p.display_name, 'avatar_url', p.avatar_url)
               order by mm.is_admin desc, mm.user_id asc)
      from (
        select m.user_id, (m.role = 'admin') as is_admin
        from public.book_club_members m
        where m.club_id = c.id
        order by is_admin desc, m.user_id asc
        limit 4
      ) mm
      join public.profiles p on p.id = mm.user_id
    ), '[]'::jsonb) as member_avatars
  from counted c
  left join chosen ch on ch.club_id = c.id
  left join public.books bk on bk.id = ch.book_id
  order by c.name;
end;
$function$;

GRANT ALL ON FUNCTION public.get_dashboard_clubs_summary() TO anon;

GRANT ALL ON FUNCTION public.get_dashboard_clubs_summary() TO authenticated;

GRANT ALL ON FUNCTION public.get_dashboard_clubs_summary() TO service_role;

CREATE FUNCTION public.get_oracle_call_history (
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  AS $function$
declare
  v_uid           uuid := auth.uid();
  v_status        text;
  v_period_start  timestamptz;
  v_limit         integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset        integer := greatest(coalesce(p_offset, 0), 0);
  v_total         integer;
  v_entries       jsonb;
  v_period_totals jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'message', 'Not authenticated');
  end if;

  select subscription_status into v_status
  from public.profiles where id = v_uid;

  -- Pro meters daily, everyone else monthly — the "this period" summary has to
  -- match whichever cycle the user is actually being charged on, or the panel
  -- contradicts the quota bar sitting directly above it.
  v_period_start := case
    when v_status = 'active' then date_trunc('day',   now() at time zone 'utc')
    else                          date_trunc('month', now() at time zone 'utc')
  end;

  select count(*) into v_total
  from public.oracle_call_log where user_id = v_uid;

  select coalesce(jsonb_agg(e order by e_created_at desc), '[]'::jsonb)
  into v_entries
  from (
    select jsonb_build_object(
             'id',         l.id,
             'source',     l.source,
             'charged',    l.charged,
             'period',     l.period,
             'run_id',     l.run_id,
             'created_at', l.created_at
           ) as e,
           l.created_at as e_created_at
    from public.oracle_call_log l
    where l.user_id = v_uid
    order by l.created_at desc, l.id desc
    limit v_limit offset v_offset
  ) page;

  -- Per-surface breakdown of the current period. Only charged rows count:
  -- these numbers must reconcile with the quota bar, and free calls do not
  -- move it.
  select coalesce(jsonb_object_agg(source, n), '{}'::jsonb)
  into v_period_totals
  from (
    select source, count(*)::int as n
    from public.oracle_call_log
    where user_id = v_uid
      and charged
      and created_at >= v_period_start
    group by source
  ) s;

  return jsonb_build_object(
    'status',        'ok',
    'entries',       v_entries,
    'total',         v_total,
    'limit',         v_limit,
    'offset',        v_offset,
    'has_more',      v_offset + v_limit < v_total,
    'period',        case when v_status = 'active' then 'day' else 'month' end,
    'period_start',  v_period_start,
    'period_totals', v_period_totals
  );
end;
$function$;

GRANT ALL ON FUNCTION public.get_oracle_call_history(integer, integer) TO anon;

GRANT ALL ON FUNCTION public.get_oracle_call_history(integer, integer) TO authenticated;

GRANT ALL ON FUNCTION public.get_oracle_call_history(integer, integer) TO service_role;

CREATE FUNCTION public.get_oracle_quota (
  p_user_id uuid,
  p_run_id  uuid DEFAULT NULL::uuid,
  p_feature text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_status          text;
  v_is_curator      boolean;
  v_calls_month     integer;
  v_calls_day       integer;
  v_exempt_total    integer;
  v_month_start_at  timestamptz;
  v_day_start_at    timestamptz;
  v_month_start     timestamptz;
  v_day_start       timestamptz;
  v_run_charged     boolean;
  v_free_limit      constant integer := 5;
  v_pro_day_limit   constant integer := 5;
begin
  select subscription_status, is_curator,
         oracle_calls_this_month, oracle_calls_month_start,
         oracle_calls_today,      oracle_calls_day_start,
         oracle_calls_exempt_total
  into   v_status, v_is_curator,
         v_calls_month, v_month_start_at,
         v_calls_day,   v_day_start_at,
         v_exempt_total
  from   public.profiles
  where  id = p_user_id;

  if not found then
    return jsonb_build_object('status', 'error', 'message', 'Profile not found');
  end if;

  v_month_start := date_trunc('month', now() at time zone 'utc');
  v_day_start   := date_trunc('day',   now() at time zone 'utc');

  -- Zeroed in memory only; persisting is consume_oracle_call's job.
  if v_month_start_at < v_month_start then v_calls_month := 0; end if;
  if v_day_start_at   < v_day_start   then v_calls_day   := 0; end if;

  -- Exempt: curator doing catalog work.
  if coalesce(v_is_curator, false) and p_feature = 'categorization' then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'exempt',
      'calls_used',      v_exempt_total,
      'calls_limit',     null,
      'calls_remaining', null,
      'reset_at',        null,
      'unlimited',       true,
      'is_curator',      v_is_curator,
      'run_charged',     false
    );
  end if;

  if p_run_id is not null then
    select true into v_run_charged
    from public.oracle_call_runs
    where user_id = p_user_id and run_id = p_run_id;
  end if;

  if v_status = 'active' then
    return jsonb_build_object(
      'subscription_status', v_status, 'period', 'day',
      'calls_used',      v_calls_day,
      'calls_limit',     v_pro_day_limit,
      'calls_remaining', greatest(0, v_pro_day_limit - v_calls_day),
      'reset_at',        v_day_start + interval '1 day',
      'unlimited',       false,
      'is_curator',      v_is_curator,
      'run_charged',     coalesce(v_run_charged, false)
    );
  end if;

  return jsonb_build_object(
    'subscription_status', v_status, 'period', 'month',
    'calls_used',      v_calls_month,
    'calls_limit',     v_free_limit,
    'calls_remaining', greatest(0, v_free_limit - v_calls_month),
    'reset_at',        v_month_start + interval '1 month',
    'unlimited',       false,
    'is_curator',      v_is_curator,
    'run_charged',     coalesce(v_run_charged, false)
  );
end;
$function$;

GRANT ALL ON FUNCTION public.get_oracle_quota(uuid, uuid, text) TO anon;

GRANT ALL ON FUNCTION public.get_oracle_quota(uuid, uuid, text) TO authenticated;

GRANT ALL ON FUNCTION public.get_oracle_quota(uuid, uuid, text) TO service_role;

CREATE FUNCTION public.get_public_list (
  p_list_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'list', row_to_json(l),
    'owner', jsonb_build_object(
      'display_name', p.display_name,
      'avatar_url',   p.avatar_url
    ),
    'books', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position',  li.position,
          'note',      li.note,
          'added_at',  li.added_at,
          'book',      row_to_json(b)
        ) order by li.position asc
      )
      from public.list_items li
      join public.books b on b.id = li.book_id
      where li.list_id = p_list_id
    ), '[]'::jsonb)
  )
  from public.lists   l
  join public.profiles p on p.id = l.user_id
  where l.id = p_list_id
    and l.is_public = true;
$function$;

GRANT ALL ON FUNCTION public.get_public_list(uuid) TO anon;

GRANT ALL ON FUNCTION public.get_public_list(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_public_list(uuid) TO service_role;

CREATE FUNCTION public.get_public_plan (
  p_plan_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'plan', jsonb_build_object(
      'id',         pl.id,
      'title',      pl.title,
      'content',    pl.content,
      'created_at', pl.created_at
    ),
    'owner', jsonb_build_object(
      'display_name', p.display_name,
      'avatar_url',   p.avatar_url
    )
  )
  from public.plans    pl
  join public.profiles p on p.id = pl.user_id
  where pl.id = p_plan_id;
$function$;

GRANT ALL ON FUNCTION public.get_public_plan(uuid) TO anon;

GRANT ALL ON FUNCTION public.get_public_plan(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_public_plan(uuid) TO service_role;

CREATE FUNCTION public.get_session_detail (
  p_session_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$DECLARE
  v_club_id   uuid;
  v_is_member boolean;
  v_result    jsonb;
BEGIN
  -- Get club_id for this session
  SELECT club_id INTO v_club_id
  FROM public.book_club_sessions
  WHERE id = p_session_id;

  IF v_club_id IS NULL THEN RETURN NULL; END IF;

  -- Verify caller is a club member
  SELECT EXISTS (
    SELECT 1 FROM public.book_club_members
    WHERE club_id = v_club_id AND user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'session', jsonb_build_object(
      'id',          s.id,
      'club_id',     s.club_id,
      'title',       COALESCE(s.title, b.title),
      'admin_notes', s.admin_notes,
      'starts_at',   s.starts_at,
      'ends_at',     s.ends_at,
      'created_at',  s.created_at
    ),
    'book', jsonb_build_object(
      'id',        b.id,
      'title',     b.title,
      'author',    b.author,
      'cover_url', b.cover_url,
      'pages',     b.pages,
      'isbn',      b.isbn,
      'description', b.description
    ),
    'caller_role', (
      SELECT role FROM public.book_club_members
      WHERE club_id = v_club_id AND user_id = auth.uid()
    ),
    'progress', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id',      m.user_id,
        'display_name', p.display_name,
        'avatar_url',   p.avatar_url,
        'role',         m.role,
        'pages_read',   COALESCE(cr.pages_read, 0),
        'user_page_count', cr.user_page_count,
        'is_reading',   (cr.id IS NOT NULL),
        'started_at',   cr.started_at,
        'cr_book_id',   cr.cr_book_id
      ) ORDER BY m.joined_at)
      FROM public.book_club_members m
      JOIN public.profiles p ON p.id = m.user_id
      -- Match by exact book_id first; fall back to any currently_reading row
      -- for a book with the same title (handles duplicate book rows for the
      -- same title added via different paths).
      LEFT JOIN LATERAL (
  SELECT cr2.id, cr2.pages_read, cr2.started_at, cr2.book_id AS cr_book_id,
         cr2.user_page_count
  FROM public.currently_reading cr2
  JOIN public.books b2 ON b2.id = cr2.book_id
  WHERE cr2.user_id = m.user_id
    AND (cr2.book_id = s.book_id OR lower(b2.title) = lower(b.title))
  ORDER BY (cr2.book_id = s.book_id) DESC
  LIMIT 1
) cr ON true
      WHERE m.club_id = v_club_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.book_club_sessions s
  JOIN public.books b ON b.id = s.book_id
  WHERE s.id = p_session_id;

  RETURN v_result;
END;$function$;

GRANT ALL ON FUNCTION public.get_session_detail(uuid) TO anon;

GRANT ALL ON FUNCTION public.get_session_detail(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_session_detail(uuid) TO service_role;

CREATE FUNCTION public.get_session_discussion (
  p_session_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_club_id uuid;
BEGIN
  SELECT club_id INTO v_club_id
  FROM public.book_club_sessions WHERE id = p_session_id;

  IF v_club_id IS NULL OR NOT public.is_club_member(v_club_id, auth.uid()) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'questions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           q.id,
          'body',         q.body,
          'position',     q.position,
          'created_by',   q.created_by,
          'display_name', p.display_name,
          'created_at',   q.created_at,
          'answers', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',           c.id,
                'body',         c.body,
                'created_by',   c.created_by,
                'display_name', cp.display_name,
                'avatar_url',   cp.avatar_url,
                'created_at',   c.created_at,
                'updated_at',   c.updated_at,
                'is_mine',      (c.created_by = auth.uid())
              ) ORDER BY c.created_at
            )
            FROM public.session_comments c
            JOIN public.profiles cp ON cp.id = c.created_by
            WHERE c.question_id = q.id AND c.parent_id IS NULL
          ), '[]'::jsonb)
        ) ORDER BY q.position
      )
      FROM public.session_questions q
      JOIN public.profiles p ON p.id = q.created_by
      WHERE q.session_id = p_session_id
    ), '[]'::jsonb),

    'comments', COALESCE((
      -- Top-level free comments only (no question_id, no parent_id)
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           c.id,
          'body',         c.body,
          'parent_id',    c.parent_id,
          'created_by',   c.created_by,
          'display_name', p.display_name,
          'avatar_url',   p.avatar_url,
          'created_at',   c.created_at,
          'updated_at',   c.updated_at,
          'is_mine',      (c.created_by = auth.uid()),
          'replies', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id',           r.id,
                'body',         r.body,
                'created_by',   r.created_by,
                'display_name', rp.display_name,
                'avatar_url',   rp.avatar_url,
                'created_at',   r.created_at,
                'is_mine',      (r.created_by = auth.uid())
              ) ORDER BY r.created_at
            )
            FROM public.session_comments r
            JOIN public.profiles rp ON rp.id = r.created_by
            WHERE r.parent_id = c.id
          ), '[]'::jsonb)
        ) ORDER BY c.created_at
      )
      FROM public.session_comments c
      JOIN public.profiles p ON p.id = c.created_by
      WHERE c.session_id = p_session_id
        AND c.question_id IS NULL
        AND c.parent_id IS NULL
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT ALL ON FUNCTION public.get_session_discussion(uuid) TO anon;

GRANT ALL ON FUNCTION public.get_session_discussion(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.get_session_discussion(uuid) TO service_role;

CREATE FUNCTION public.handle_club_member_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_club_name text;
  v_actor_id  uuid;
begin
  -- Skip self-joins: when added_by is null or equals the joining user,
  -- this is a voluntary join via join link — no invite notification needed.
  -- (auth.uid() is always NULL in trigger context, so we use NEW.added_by instead.)
  if NEW.added_by is null or NEW.added_by = NEW.user_id then
    return NEW;
  end if;

  select name into v_club_name from public.book_clubs where id = NEW.club_id;

  -- Use the admin who added them as the actor
  v_actor_id := NEW.added_by;

  -- Notify the invited user
  insert into public.notifications (user_id, type, actor_id, data)
  values (
    NEW.user_id,
    'club_invite',
    v_actor_id,
    jsonb_build_object('club_id', NEW.club_id, 'club_name', v_club_name)
  )
  on conflict do nothing;

  return NEW;
end;
$function$;

GRANT ALL ON FUNCTION public.handle_club_member_notification() TO anon;

GRANT ALL ON FUNCTION public.handle_club_member_notification() TO authenticated;

GRANT ALL ON FUNCTION public.handle_club_member_notification() TO service_role;

CREATE FUNCTION public.handle_discussion_question_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_club_id   uuid;
  v_club_name text;
  v_member_id uuid;
  v_session_title text;
begin
  -- Get club_id from the session
  select s.club_id, b.title, bcs.title
  into v_club_id, v_session_title, v_session_title
  from public.book_club_sessions bcs
  left join public.books b on b.id = bcs.book_id
  where bcs.id = NEW.session_id
  limit 1;

  if v_club_id is null then return NEW; end if;

  select name into v_club_name from public.book_clubs where id = v_club_id;

  for v_member_id in
    select user_id from public.book_club_members where club_id = v_club_id
  loop
    -- Don't notify the person who posted the question
    if v_member_id != NEW.created_by then
      insert into public.notifications (user_id, type, actor_id, data)
      values (
        v_member_id, 'discussion_question', NEW.created_by,
        jsonb_build_object(
          'club_id',      v_club_id,
          'club_name',    v_club_name,
          'session_id',   NEW.session_id,
          'question',     NEW.question
        )
      )
      on conflict do nothing;
    end if;
  end loop;

  return NEW;
end;
$function$;

GRANT ALL ON FUNCTION public.handle_discussion_question_notification() TO anon;

GRANT ALL ON FUNCTION public.handle_discussion_question_notification() TO authenticated;

GRANT ALL ON FUNCTION public.handle_discussion_question_notification() TO service_role;

CREATE FUNCTION public.handle_discussion_reply_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  v_thread_owner uuid;
  v_question     text;
  v_session_id   uuid;
  v_club_id      uuid;
  v_club_name    text;
begin
  -- Only notify on replies (parent_id is set), not top-level answers
  if NEW.parent_id is null then return NEW; end if;
 
  -- Find the owner of the parent comment/answer
  select created_by into v_thread_owner
  from public.session_comments
  where id = NEW.parent_id;
 
  if v_thread_owner is null or v_thread_owner = NEW.created_by then
    return NEW;
  end if;
 
  -- Get context
  select sq.question, sq.session_id
  into v_question, v_session_id
  from public.session_questions sq
  where sq.id = NEW.question_id;
 
  select s.club_id into v_club_id
  from public.book_club_sessions s where s.id = v_session_id;
 
  select name into v_club_name
  from public.book_clubs where id = v_club_id;
 
  insert into public.notifications (user_id, type, actor_id, data)
  values (
    v_thread_owner, 'discussion_reply', NEW.created_by,
    jsonb_build_object(
      'club_id',    v_club_id,
      'club_name',  v_club_name,
      'session_id', v_session_id,
      'question',   v_question,
      'preview',    left(NEW.body, 120)
    )
  );
  return NEW;
end;
$function$;

GRANT ALL ON FUNCTION public.handle_discussion_reply_notification() TO anon;

GRANT ALL ON FUNCTION public.handle_discussion_reply_notification() TO authenticated;

GRANT ALL ON FUNCTION public.handle_discussion_reply_notification() TO service_role;

CREATE FUNCTION public.handle_friendship_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- New friend request → notify the addressee
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    insert into public.notifications (user_id, type, actor_id, data)
    values (
      NEW.addressee,
      'friend_request',
      NEW.requester,
      jsonb_build_object('friendship_id', NEW.id)
    );

  -- Request accepted → notify the original requester
  elsif TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status = 'pending' then
    insert into public.notifications (user_id, type, actor_id, data)
    values (
      NEW.requester,
      'friend_accepted',
      NEW.addressee,
      jsonb_build_object('friendship_id', NEW.id)
    );
  end if;

  return NEW;
end;
$function$;

GRANT ALL ON FUNCTION public.handle_friendship_notification() TO anon;

GRANT ALL ON FUNCTION public.handle_friendship_notification() TO authenticated;

GRANT ALL ON FUNCTION public.handle_friendship_notification() TO service_role;

CREATE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$function$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;

GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

CREATE FUNCTION public.handle_poll_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_club_name   text;
  v_member_id   uuid;
  v_question    text;
  v_winner      text;
begin
  select name into v_club_name from public.book_clubs where id = NEW.club_id;

  -- Poll created → notify all club members
  if TG_OP = 'INSERT' then
    v_question := NEW.question;
    for v_member_id in
      select user_id from public.book_club_members where club_id = NEW.club_id
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (
        v_member_id, 'poll_started', NEW.created_by,
        jsonb_build_object(
          'club_id',   NEW.club_id,
          'club_name', v_club_name,
          'poll_id',   NEW.id,
          'question',  v_question
        )
      )
      on conflict do nothing;
    end loop;
  end if;

  -- Poll closed (status changes to 'closed') → notify all members with winner
  if TG_OP = 'UPDATE' and NEW.status = 'closed' and OLD.status != 'closed' then
    -- Find the winning option label
    select label into v_winner
    from public.poll_options
    where poll_id = NEW.id
    order by votes_count desc
    limit 1;

    for v_member_id in
      select user_id from public.book_club_members where club_id = NEW.club_id
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (
        v_member_id, 'poll_finalized', NEW.created_by,
        jsonb_build_object(
          'club_id',   NEW.club_id,
          'club_name', v_club_name,
          'poll_id',   NEW.id,
          'winner',    v_winner
        )
      )
      on conflict do nothing;
    end loop;
  end if;

  return NEW;
end;
$function$;

GRANT ALL ON FUNCTION public.handle_poll_notification() TO anon;

GRANT ALL ON FUNCTION public.handle_poll_notification() TO authenticated;

GRANT ALL ON FUNCTION public.handle_poll_notification() TO service_role;

CREATE FUNCTION public.is_club_admin (
  p_club_id uuid,
  p_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.book_club_members
    WHERE club_id = p_club_id AND user_id = p_user_id AND role = 'admin'
  );
$function$;

GRANT ALL ON FUNCTION public.is_club_admin(uuid, uuid) TO anon;

GRANT ALL ON FUNCTION public.is_club_admin(uuid, uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_club_admin(uuid, uuid) TO service_role;

CREATE FUNCTION public.is_club_member (
  p_club_id uuid,
  p_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.book_club_members
    WHERE club_id = p_club_id AND user_id = p_user_id
  );
$function$;

GRANT ALL ON FUNCTION public.is_club_member(uuid, uuid) TO anon;

GRANT ALL ON FUNCTION public.is_club_member(uuid, uuid) TO authenticated;

GRANT ALL ON FUNCTION public.is_club_member(uuid, uuid) TO service_role;

CREATE FUNCTION public.join_club_by_token (
  p_token text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_club_id uuid;
BEGIN
  -- Resolve token → club id
  SELECT id INTO v_club_id
  FROM public.book_clubs
  WHERE join_token = p_token;

  IF v_club_id IS NULL THEN
    RETURN NULL; -- invalid token
  END IF;

  -- Upsert: if already a member, do nothing and return club_id anyway
  INSERT INTO public.book_club_members (club_id, user_id, role)
  VALUES (v_club_id, auth.uid(), 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;

  RETURN v_club_id;
END;
$function$;

GRANT ALL ON FUNCTION public.join_club_by_token(text) TO anon;

GRANT ALL ON FUNCTION public.join_club_by_token(text) TO authenticated;

GRANT ALL ON FUNCTION public.join_club_by_token(text) TO service_role;

CREATE FUNCTION public.join_public_club (
  p_club_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_club        record;
  v_member_ct   int;
  v_has_room    boolean;
  v_admin_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Lock the club row so two concurrent joins against the last open seat
  -- are serialized rather than both reading the same "room available" count.
  select id, visibility, join_mode, max_members
    into v_club
    from public.book_clubs
    where id = p_club_id
    for update;

  if v_club.id is null then
    raise exception 'Club not found';
  end if;
  if v_club.visibility <> 'public' then
    raise exception 'This club is invite-only';
  end if;

  if exists (select 1 from public.book_club_members where club_id = p_club_id and user_id = auth.uid()) then
    return jsonb_build_object('status', 'already_member');
  end if;

  if exists (
    select 1 from public.club_join_requests
    where club_id = p_club_id and user_id = auth.uid()
      and status in ('pending_approval', 'waitlisted')
  ) then
    return (
      select jsonb_build_object('status', status)
      from public.club_join_requests
      where club_id = p_club_id and user_id = auth.uid()
        and status in ('pending_approval', 'waitlisted')
    );
  end if;

  select count(*) into v_member_ct from public.book_club_members where club_id = p_club_id;
  v_has_room := v_club.max_members is null or v_member_ct < v_club.max_members;

  if v_has_room and v_club.join_mode = 'auto' then
    insert into public.book_club_members (club_id, user_id, role, added_by)
    values (p_club_id, auth.uid(), 'member', auth.uid());
    return jsonb_build_object('status', 'joined');
  end if;

  if v_has_room then
    -- room available, but this club reviews requests
    insert into public.club_join_requests (club_id, user_id, status)
    values (p_club_id, auth.uid(), 'pending_approval');

    for v_admin_id in
      select user_id from public.book_club_members where club_id = p_club_id and role = 'admin'
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (v_admin_id, 'join_request', auth.uid(), jsonb_build_object('club_id', p_club_id))
      on conflict do nothing;
    end loop;

    return jsonb_build_object('status', 'pending_approval');
  end if;

  -- no room either way — waitlist
  insert into public.club_join_requests (club_id, user_id, status)
  values (p_club_id, auth.uid(), 'waitlisted');
  return jsonb_build_object('status', 'waitlisted');
end;
$function$;

GRANT ALL ON FUNCTION public.join_public_club(uuid) TO anon;

GRANT ALL ON FUNCTION public.join_public_club(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.join_public_club(uuid) TO service_role;

CREATE FUNCTION public.link_book_genre (
  _book_id  uuid,
  _genre_id uuid,
  _source   text DEFAULT 'oracle'::text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'link_book_genre requires authenticated user';
  END IF;

  IF _book_id IS NULL OR _genre_id IS NULL THEN
    RAISE EXCEPTION 'book_id and genre_id are required' USING ERRCODE = '22023';
  END IF;

  IF _source NOT IN ('seed', 'oracle', 'admin') THEN
    RAISE EXCEPTION 'invalid source value' USING ERRCODE = '22023';
  END IF;

  -- Verify the book and genre exist (clearer error than FK violation).
  PERFORM 1 FROM books WHERE id = _book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book not found' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM genres WHERE id = _genre_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'genre not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO book_genres (book_id, genre_id, assigned_by_source)
    VALUES (_book_id, _genre_id, _source)
    ON CONFLICT (book_id, genre_id) DO NOTHING;

  RETURN FOUND;
END;
$function$;

GRANT ALL ON FUNCTION public.link_book_genre(uuid, uuid, text) TO anon;

GRANT ALL ON FUNCTION public.link_book_genre(uuid, uuid, text) TO authenticated;

GRANT ALL ON FUNCTION public.link_book_genre(uuid, uuid, text) TO service_role;

CREATE FUNCTION public.link_user_category (
  _book_id  uuid,
  _raw_name text
)
  RETURNS TABLE (
    id              uuid,
    name            text,
    normalized_name text,
    verified        boolean,
    usage_count     integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  _uid          uuid;
  _cat_id       uuid;
  _cat_verified boolean;
  _count        integer;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'link_user_category requires authenticated user';
  END IF;

  IF _book_id IS NULL THEN
    RAISE EXCEPTION 'book_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM books b WHERE b.id = _book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book not found' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO _count
    FROM user_book_categories ubc
    WHERE ubc.user_id = _uid AND ubc.book_id = _book_id;
  IF _count >= 10 THEN
    RAISE EXCEPTION 'category limit reached for this book (10 max)'
      USING ERRCODE = '23514';
  END IF;

  -- Capture the two values we need from upsert_category directly into
  -- typed scalars. No RECORD intermediate → no ambiguity.
  -- The aliased subquery is what disambiguates: `up.id` and `up.verified`
  -- refer unambiguously to the function's returned columns.
  SELECT up.id, up.verified
    INTO _cat_id, _cat_verified
    FROM upsert_category(_raw_name) AS up
    LIMIT 1;

  IF _cat_id IS NULL THEN
    RAISE EXCEPTION 'category resolution failed' USING ERRCODE = '22023';
  END IF;

  -- Link to the user (idempotent)
  INSERT INTO user_book_categories (user_id, book_id, category_id)
    VALUES (_uid, _book_id, _cat_id)
    ON CONFLICT DO NOTHING;

  -- If the category is already verified globally, also ensure the
  -- book_categories link exists.
  IF _cat_verified THEN
    INSERT INTO book_categories (book_id, category_id, added_by)
      VALUES (_book_id, _cat_id, _uid)
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count
      FROM categories c
      WHERE c.id = _cat_id;
END;
$function$;

GRANT ALL ON FUNCTION public.link_user_category(uuid, text) TO anon;

GRANT ALL ON FUNCTION public.link_user_category(uuid, text) TO authenticated;

GRANT ALL ON FUNCTION public.link_user_category(uuid, text) TO service_role;

CREATE FUNCTION public.log_oracle_recommendations (
  p_surface text,
  p_books   jsonb,
  p_call_id bigint DEFAULT NULL::bigint
)
  RETURNS bigint[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_uid     uuid := auth.uid();
  v_surface text;
  v_ids     bigint[];
begin
  if v_uid is null then
    return array[]::bigint[];   -- guest session: nothing to attribute
  end if;

  if p_books is null or jsonb_typeof(p_books) <> 'array' or jsonb_array_length(p_books) = 0 then
    return array[]::bigint[];
  end if;

  v_surface := case
    when p_surface in ('spark', 'ask', 'similar', 'categories', 'plan') then p_surface
    else 'unknown'
  end;

  -- The ids come back in insertion order, which is result-set order, so the
  -- client can zip them straight onto the books it just rendered.
  --
  -- The `ord <= 25` cap is deliberate: the client sends 3-5, and anything
  -- wildly larger is a bug or an abuse attempt. This table must not become a
  -- write amplifier for a single call.
  with input as (
    select
      nullif(btrim(b->>'title'),  '')                   as title,
      nullif(btrim(b->>'author'), '')                   as author,
      coalesce((b->>'position')::smallint, t.ord::smallint) as position,
      t.ord                                             as ord
    from jsonb_array_elements(p_books) with ordinality as t(b, ord)
    where t.ord <= 25
  ),
  ins as (
    insert into public.oracle_recommendations
      (user_id, call_id, surface, position, book_title, book_author)
    select v_uid, p_call_id, v_surface, position, title, author
    from input
    where title is not null
    order by ord
    returning id
  )
  select array_agg(id order by id) into v_ids from ins;

  return coalesce(v_ids, array[]::bigint[]);
end;
$function$;

GRANT ALL ON FUNCTION public.log_oracle_recommendations(text, jsonb, bigint) TO anon;

GRANT ALL ON FUNCTION public.log_oracle_recommendations(text, jsonb, bigint) TO authenticated;

GRANT ALL ON FUNCTION public.log_oracle_recommendations(text, jsonb, bigint) TO service_role;

CREATE FUNCTION public.merge_books (
  _from uuid,
  _to   uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  _fk        record;
  _row       record;
  _snapshot  jsonb;
  _moved     jsonb := '{}'::jsonb;
  _deduped   jsonb := '{}'::jsonb;
  _m         int;
  _d         int;
  _sql       text;
begin
  if _from is null or _to is null then
    raise exception 'merge_books: both ids are required';
  end if;
  if _from = _to then
    raise exception 'merge_books: refusing to merge a row into itself (%)', _from;
  end if;

  select to_jsonb(b) into _snapshot from public.books b where b.id = _from;
  if _snapshot is null then
    raise exception 'merge_books: source book % not found', _from;
  end if;
  if not exists (select 1 from public.books where id = _to) then
    raise exception 'merge_books: target book % not found', _to;
  end if;

  -- Every column in every table holding a foreign key to books(id).
  for _fk in
    select
      src_ns.nspname  as schema_name,
      src_tbl.relname as table_name,
      src_col.attname as column_name
    from pg_constraint c
    join pg_class     src_tbl on src_tbl.oid = c.conrelid
    join pg_namespace src_ns  on src_ns.oid  = src_tbl.relnamespace
    join pg_class     tgt_tbl on tgt_tbl.oid = c.confrelid
    join pg_attribute src_col on src_col.attrelid = c.conrelid
                             and src_col.attnum   = c.conkey[1]
    where c.contype = 'f'
      and tgt_tbl.relname = 'books'
      and array_length(c.conkey, 1) = 1
  loop
    _m := 0;
    _d := 0;

    -- Row-by-row so a unique_violation kills only the offending row, not the merge.
    _sql := format('select ctid from %I.%I where %I = $1',
                   _fk.schema_name, _fk.table_name, _fk.column_name);
    for _row in execute _sql using _from loop
      begin
        execute format('update %I.%I set %I = $1 where ctid = $2',
                       _fk.schema_name, _fk.table_name, _fk.column_name)
          using _to, _row.ctid;
        _m := _m + 1;
      exception when unique_violation then
        -- The user already has the canonical book here; this row is redundant.
        execute format('delete from %I.%I where ctid = $1',
                       _fk.schema_name, _fk.table_name)
          using _row.ctid;
        _d := _d + 1;
      end;
    end loop;

    if _m > 0 then
      _moved := _moved || jsonb_build_object(_fk.table_name || '.' || _fk.column_name, _m);
    end if;
    if _d > 0 then
      _deduped := _deduped || jsonb_build_object(_fk.table_name || '.' || _fk.column_name, _d);
    end if;
  end loop;

  delete from public.books where id = _from;

  insert into public.book_merge_log (from_book_id, to_book_id, from_snapshot, refs_moved, refs_deduped)
  values (_from, _to, _snapshot, _moved, _deduped);

  return jsonb_build_object(
    'from', _from, 'to', _to,
    'refs_moved', _moved, 'refs_deduped', _deduped
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.merge_books(uuid, uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.merge_books(uuid, uuid) TO service_role;

CREATE FUNCTION public.normalize_category_name (
  name text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(name, '')), '^the\s+', ''),
    '[^a-z0-9]', '', 'g'
  )
$function$;

GRANT ALL ON FUNCTION public.normalize_category_name(text) TO anon;

GRANT ALL ON FUNCTION public.normalize_category_name(text) TO authenticated;

GRANT ALL ON FUNCTION public.normalize_category_name(text) TO service_role;

CREATE FUNCTION public.normalize_genre_name (
  name text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(name, '')), '^the\s+', ''),
    '[^a-z0-9]', '', 'g'
  )
$function$;

GRANT ALL ON FUNCTION public.normalize_genre_name(text) TO anon;

GRANT ALL ON FUNCTION public.normalize_genre_name(text) TO authenticated;

GRANT ALL ON FUNCTION public.normalize_genre_name(text) TO service_role;

CREATE FUNCTION public.normalize_series_name (
  _name text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select regexp_replace(
    regexp_replace(lower(coalesce(_name, '')), '^the\s+', '', 'g'),
    '[^a-z0-9]', '', 'g'
  );
$function$;

GRANT ALL ON FUNCTION public.normalize_series_name(text) TO anon;

GRANT ALL ON FUNCTION public.normalize_series_name(text) TO authenticated;

GRANT ALL ON FUNCTION public.normalize_series_name(text) TO service_role;

CREATE FUNCTION public.preview_club_by_token (
  p_token text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT jsonb_build_object('name', name, 'description', description)
  FROM public.book_clubs
  WHERE join_token = p_token;
$function$;

GRANT ALL ON FUNCTION public.preview_club_by_token(text) TO anon;

GRANT ALL ON FUNCTION public.preview_club_by_token(text) TO authenticated;

GRANT ALL ON FUNCTION public.preview_club_by_token(text) TO service_role;

CREATE FUNCTION public.promote_from_waitlist()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_next      record;
  v_join_mode text;
  v_admin_id  uuid;
begin
  select id into v_next
    from public.club_join_requests
    where club_id = OLD.club_id and status = 'waitlisted'
    order by created_at asc
    limit 1
    for update;

  if v_next.id is null then
    return OLD;
  end if;

  select join_mode into v_join_mode from public.book_clubs where id = OLD.club_id;

  if v_join_mode = 'auto' then
    insert into public.book_club_members (club_id, user_id, role, added_by)
    select OLD.club_id, cjr.user_id, 'member', null
    from public.club_join_requests cjr where cjr.id = v_next.id;

    update public.club_join_requests
      set status = 'approved', resolved_at = now()
      where id = v_next.id;

    insert into public.notifications (user_id, type, actor_id, data)
    select user_id, 'waitlist_promoted', null, jsonb_build_object('club_id', OLD.club_id)
    from public.club_join_requests where id = v_next.id
    on conflict do nothing;
  else
    update public.club_join_requests set status = 'pending_approval' where id = v_next.id;

    for v_admin_id in
      select user_id from public.book_club_members where club_id = OLD.club_id and role = 'admin'
    loop
      insert into public.notifications (user_id, type, actor_id, data)
      values (v_admin_id, 'join_request', null, jsonb_build_object('club_id', OLD.club_id))
      on conflict do nothing;
    end loop;
  end if;

  return OLD;
end;
$function$;

GRANT ALL ON FUNCTION public.promote_from_waitlist() TO anon;

GRANT ALL ON FUNCTION public.promote_from_waitlist() TO authenticated;

GRANT ALL ON FUNCTION public.promote_from_waitlist() TO service_role;

CREATE FUNCTION public.regenerate_join_token (
  p_club_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_is_admin boolean;
  v_new_token text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.book_club_members
    WHERE club_id = p_club_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN RETURN NULL; END IF;

  v_new_token := gen_random_uuid()::text;
  UPDATE public.book_clubs SET join_token = v_new_token WHERE id = p_club_id;
  RETURN v_new_token;
END;
$function$;

GRANT ALL ON FUNCTION public.regenerate_join_token(uuid) TO anon;

GRANT ALL ON FUNCTION public.regenerate_join_token(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.regenerate_join_token(uuid) TO service_role;

CREATE FUNCTION public.reject_join_request (
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_req record;
begin
  select * into v_req
    from public.club_join_requests
    where id = p_request_id and status in ('pending_approval', 'waitlisted')
    for update;

  if v_req.id is null then
    raise exception 'Request not found or already resolved';
  end if;

  if not exists (
    select 1 from public.book_club_members
    where club_id = v_req.club_id and user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;

  update public.club_join_requests
    set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id;

  insert into public.notifications (user_id, type, actor_id, data)
  values (v_req.user_id, 'join_rejected', auth.uid(), jsonb_build_object('club_id', v_req.club_id))
  on conflict do nothing;

  return jsonb_build_object('status', 'rejected');
end;
$function$;

GRANT ALL ON FUNCTION public.reject_join_request(uuid) TO anon;

GRANT ALL ON FUNCTION public.reject_join_request(uuid) TO authenticated;

GRANT ALL ON FUNCTION public.reject_join_request(uuid) TO service_role;

CREATE FUNCTION public.resolve_oracle_recommendation (
  p_recommendation_id bigint DEFAULT NULL::bigint,
  p_book_title        text   DEFAULT NULL::text,
  p_book_id           uuid   DEFAULT NULL::uuid,
  p_outcome           text   DEFAULT 'accepted'::text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_uid uuid := auth.uid();
  v_id  bigint;
begin
  if v_uid is null then return null; end if;
  if p_outcome not in ('accepted', 'dismissed') then return null; end if;

  if p_recommendation_id is not null then
    select id into v_id
    from public.oracle_recommendations
    where id = p_recommendation_id
      and user_id = v_uid          -- scoping is not optional in a definer fn
      and outcome is null;
  end if;

  -- Fallback: most recent unresolved impression of this title for this user.
  -- A book can be recommended on several occasions; each is its own row, and
  -- the newest unresolved one is the one being acted on.
  if v_id is null and p_book_title is not null then
    select id into v_id
    from public.oracle_recommendations
    where user_id = v_uid
      and outcome is null
      and lower(book_title) = lower(btrim(p_book_title))
    order by shown_at desc
    limit 1;
  end if;

  if v_id is null then return null; end if;   -- not an Oracle book; fine

  update public.oracle_recommendations
  set outcome    = p_outcome,
      outcome_at = now(),
      book_id    = coalesce(p_book_id, book_id)   -- backfill, never overwrite
  where id = v_id;

  return v_id;
end;
$function$;

GRANT ALL ON FUNCTION public.resolve_oracle_recommendation(bigint, text, uuid, text) TO anon;

GRANT ALL ON FUNCTION public.resolve_oracle_recommendation(bigint, text, uuid, text) TO authenticated;

GRANT ALL ON FUNCTION public.resolve_oracle_recommendation(bigint, text, uuid, text) TO service_role;

CREATE FUNCTION public.search_categories (
  _query text,
  _limit integer DEFAULT 8
)
  RETURNS TABLE (
    id              uuid,
    name            text,
    normalized_name text,
    verified        boolean,
    usage_count     integer,
    exact_match     boolean
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
DECLARE
  _normalized text;
BEGIN
  _normalized := normalize_category_name(coalesce(_query, ''));

  -- Empty query → return most-used verified categories. Useful for the
  -- initial dropdown state (autocomplete open with no input typed).
  IF char_length(_normalized) = 0 THEN
    RETURN QUERY
      SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count,
             false AS exact_match
        FROM categories c
        ORDER BY c.verified DESC, c.usage_count DESC, lower(c.name) ASC
        LIMIT _limit;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count,
           (c.normalized_name = _normalized) AS exact_match
      FROM categories c
      WHERE c.normalized_name LIKE _normalized || '%'
         OR c.normalized_name LIKE '%' || _normalized || '%'
      ORDER BY
        (c.normalized_name = _normalized) DESC,         -- exact match wins
        (c.normalized_name LIKE _normalized || '%') DESC, -- prefix match next
        c.verified DESC,
        c.usage_count DESC,
        lower(c.name) ASC
      LIMIT _limit;
END;
$function$;

GRANT ALL ON FUNCTION public.search_categories(text, integer) TO anon;

GRANT ALL ON FUNCTION public.search_categories(text, integer) TO authenticated;

GRANT ALL ON FUNCTION public.search_categories(text, integer) TO service_role;

CREATE FUNCTION public.search_genres (
  _query text    DEFAULT ''::text,
  _limit integer DEFAULT 100
)
  RETURNS TABLE (
    id              uuid,
    name            text,
    normalized_name text,
    source          text,
    usage_count     integer,
    exact_match     boolean
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
DECLARE
  _normalized text;
BEGIN
  _normalized := normalize_genre_name(coalesce(_query, ''));

  IF char_length(_normalized) = 0 THEN
    RETURN QUERY
      SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count,
             false AS exact_match
        FROM genres gn
        ORDER BY gn.usage_count DESC, lower(gn.name) ASC
        LIMIT _limit;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count,
           (gn.normalized_name = _normalized) AS exact_match
      FROM genres gn
      WHERE gn.normalized_name LIKE _normalized || '%'
         OR gn.normalized_name LIKE '%' || _normalized || '%'
      ORDER BY
        (gn.normalized_name = _normalized) DESC,
        (gn.normalized_name LIKE _normalized || '%') DESC,
        gn.usage_count DESC,
        lower(gn.name) ASC
      LIMIT _limit;
END;
$function$;

GRANT ALL ON FUNCTION public.search_genres(text, integer) TO anon;

GRANT ALL ON FUNCTION public.search_genres(text, integer) TO authenticated;

GRANT ALL ON FUNCTION public.search_genres(text, integer) TO service_role;

CREATE FUNCTION public.search_public_clubs (
  p_query     text    DEFAULT NULL::text,
  p_genre_ids uuid[]  DEFAULT NULL::uuid[],
  p_moods     text[]  DEFAULT NULL::text[],
  p_open_only boolean DEFAULT false,
  p_sort      text    DEFAULT 'activity'::text
)
  RETURNS TABLE (
    id                  uuid,
    name                text,
    description         text,
    join_mode           text,
    max_members         integer,
    member_count        bigint,
    created_at          timestamp with time zone,
    genre_names         text[],
    moods               text[],
    current_book_title  text,
    current_book_author text,
    current_book_cover  text,
    caller_status       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return query
  with base as (
    select bc.*
    from public.book_clubs bc
    where bc.visibility = 'public'
      and (p_query is null or bc.name ilike '%' || p_query || '%' or bc.description ilike '%' || p_query || '%')
      and (
        p_genre_ids is null or exists (
          select 1 from public.book_club_genres bcg
          where bcg.club_id = bc.id and bcg.genre_id = any(p_genre_ids)
        )
      )
      and (
        p_moods is null or exists (
          select 1 from public.book_club_moods bcm
          where bcm.club_id = bc.id and bcm.mood = any(p_moods)
        )
      )
  ),
  counted as (
    select
      b.*,
      (select count(*) from public.book_club_members m where m.club_id = b.id) as member_count
    from base b
  ),
  active_session as (
    select distinct on (bcs.club_id)
      bcs.club_id, bk.title, bk.author, bk.cover_url
    from public.book_club_sessions bcs
    join public.books bk on bk.id = bcs.book_id
    where now() between bcs.starts_at and bcs.ends_at
    order by bcs.club_id, bcs.starts_at desc
  )
  select
    c.id, c.name, c.description, c.join_mode, c.max_members, c.member_count, c.created_at,
    coalesce((
      select array_agg(g.name order by g.name)
      from public.book_club_genres bcg join public.genres g on g.id = bcg.genre_id
      where bcg.club_id = c.id
    ), '{}') as genre_names,
    coalesce((
      select array_agg(bcm.mood order by bcm.mood)
      from public.book_club_moods bcm where bcm.club_id = c.id
    ), '{}') as moods,
    a.title, a.author, a.cover_url,
    case
      when exists (select 1 from public.book_club_members m where m.club_id = c.id and m.user_id = auth.uid())
        then 'member'
      when exists (
        select 1 from public.club_join_requests r
        where r.club_id = c.id and r.user_id = auth.uid() and r.status = 'pending_approval'
      ) then 'pending_approval'
      when exists (
        select 1 from public.club_join_requests r
        where r.club_id = c.id and r.user_id = auth.uid() and r.status = 'waitlisted'
      ) then 'waitlisted'
      else 'none'
    end as caller_status
  from counted c
  left join active_session a on a.club_id = c.id
  where (not p_open_only) or c.max_members is null or c.member_count < c.max_members
  order by
    case when p_sort = 'members'  then c.member_count end desc nulls last,
    case when p_sort = 'newest'   then c.created_at end desc nulls last,
    case when p_sort = 'activity' or p_sort is null
      then coalesce(a.title, '') end desc nulls last, -- has an active session = more active, coarse but cheap
    c.created_at desc;
end;
$function$;

GRANT ALL ON FUNCTION public.search_public_clubs(text, uuid[], text[], boolean, text) TO anon;

GRANT ALL ON FUNCTION public.search_public_clubs(text, uuid[], text[], boolean, text) TO authenticated;

GRANT ALL ON FUNCTION public.search_public_clubs(text, uuid[], text[], boolean, text) TO service_role;

CREATE FUNCTION public.set_book_clubs_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

GRANT ALL ON FUNCTION public.set_book_clubs_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_book_clubs_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_book_clubs_updated_at() TO service_role;

CREATE FUNCTION public.set_session_comments_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

GRANT ALL ON FUNCTION public.set_session_comments_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_session_comments_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_session_comments_updated_at() TO service_role;

CREATE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;

CREATE FUNCTION public.unlink_user_category (
  _book_id     uuid,
  _category_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unlink_user_category requires authenticated user';
  END IF;

  DELETE FROM user_book_categories
    WHERE user_id = _uid
      AND book_id = _book_id
      AND category_id = _category_id;

  RETURN FOUND;
END;
$function$;

GRANT ALL ON FUNCTION public.unlink_user_category(uuid, uuid) TO anon;

GRANT ALL ON FUNCTION public.unlink_user_category(uuid, uuid) TO authenticated;

GRANT ALL ON FUNCTION public.unlink_user_category(uuid, uuid) TO service_role;

CREATE FUNCTION public.upsert_book (
  _title           text,
  _author          text,
  _isbn            text    DEFAULT NULL::text,
  _hardcover_id    bigint  DEFAULT NULL::bigint,
  _series_name     text    DEFAULT NULL::text,
  _series_position numeric DEFAULT NULL::numeric,
  _pages           integer DEFAULT NULL::integer,
  _description     text    DEFAULT NULL::text,
  _cover_url       text    DEFAULT NULL::text,
  _genre           text    DEFAULT NULL::text,
  _complexity      integer DEFAULT NULL::integer,
  _depth           integer DEFAULT NULL::integer,
  _source          text    DEFAULT 'user_manual'::text,
  _verified        boolean DEFAULT false,
  _metadata        jsonb   DEFAULT '{}'::jsonb,
  _series_id       uuid    DEFAULT NULL::uuid,
  _series_source   text    DEFAULT NULL::text,
  _status          text    DEFAULT NULL::text,
  _verified_source text    DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  _key text;
  _id uuid;
  _existing record;
  _resolved_series_id uuid := _series_id;
  _resolved_status text;
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
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into books (
    title, author, normalized_key, isbn, hardcover_id,
    series_id, position_in_series, pages, description, cover_url,
    genre, complexity, depth, source,
    status, verified_source, verified_at, verified_by,
    metadata, created_by
  ) values (
    _title, _author, _key, _isbn, _hardcover_id,
    _resolved_series_id, _series_position, _pages, _description, _cover_url,
    _genre, _complexity, _depth, _source,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$function$;

GRANT ALL ON FUNCTION public.upsert_book(text, text, text, bigint, text, numeric, integer, text, text, text, integer, integer, text, boolean, jsonb, uuid, text, text, text) TO anon;

GRANT ALL ON FUNCTION public.upsert_book(text, text, text, bigint, text, numeric, integer, text, text, text, integer, integer, text, boolean, jsonb, uuid, text, text, text) TO
  authenticated;

GRANT ALL ON FUNCTION public.upsert_book(text, text, text, bigint, text, numeric, integer, text, text, text, integer, integer, text, boolean, jsonb, uuid, text, text, text) TO
  service_role;

CREATE FUNCTION public.upsert_category (
  _raw_name text
)
  RETURNS TABLE (
    id              uuid,
    name            text,
    normalized_name text,
    verified        boolean,
    usage_count     integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  _normalized text;
  _trimmed    text;
  _existing   uuid;
  _new_id     uuid;
  _uid        uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'upsert_category requires authenticated user';
  END IF;

  _trimmed := btrim(coalesce(_raw_name, ''));
  IF char_length(_trimmed) = 0 OR char_length(_trimmed) > 80 THEN
    RAISE EXCEPTION 'category name must be 1-80 characters'
      USING ERRCODE = '22023';
  END IF;

  _normalized := normalize_category_name(_trimmed);
  IF char_length(_normalized) = 0 THEN
    RAISE EXCEPTION 'category name has no alphanumeric content'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO _existing
    FROM categories c
    WHERE c.normalized_name = _normalized
    LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count
        FROM categories c
        WHERE c.id = _existing;
    RETURN;
  END IF;

  INSERT INTO categories (name, normalized_name, created_by)
    VALUES (_trimmed, _normalized, _uid)
    RETURNING categories.id INTO _new_id;

  RETURN QUERY
    SELECT c.id, c.name, c.normalized_name, c.verified, c.usage_count
      FROM categories c
      WHERE c.id = _new_id;
END;
$function$;

GRANT ALL ON FUNCTION public.upsert_category(text) TO anon;

GRANT ALL ON FUNCTION public.upsert_category(text) TO authenticated;

GRANT ALL ON FUNCTION public.upsert_category(text) TO service_role;

CREATE FUNCTION public.upsert_genre (
  _raw_name text
)
  RETURNS TABLE (
    id              uuid,
    name            text,
    normalized_name text,
    source          text,
    usage_count     integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  _normalized text;
  _trimmed    text;
  _existing   uuid;
  _new_id     uuid;
  _uid        uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'upsert_genre requires authenticated user';
  END IF;

  _trimmed := btrim(coalesce(_raw_name, ''));
  IF char_length(_trimmed) = 0 OR char_length(_trimmed) > 80 THEN
    RAISE EXCEPTION 'genre name must be 1-80 characters'
      USING ERRCODE = '22023';
  END IF;

  _normalized := normalize_genre_name(_trimmed);
  IF char_length(_normalized) = 0 THEN
    RAISE EXCEPTION 'genre name has no alphanumeric content'
      USING ERRCODE = '22023';
  END IF;

  SELECT gn.id INTO _existing
    FROM genres gn
    WHERE gn.normalized_name = _normalized
    LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN QUERY
      SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count
        FROM genres gn
        WHERE gn.id = _existing;
    RETURN;
  END IF;

  -- New genre. Default source = 'oracle' — the categorization button is the
  -- only legitimate creator. If we ever need an admin-direct-add path, it
  -- can write 'admin' via direct INSERT (which only admins can do via
  -- service role anyway).
  INSERT INTO genres (name, normalized_name, source)
    VALUES (_trimmed, _normalized, 'oracle')
    RETURNING genres.id INTO _new_id;

  RETURN QUERY
    SELECT gn.id, gn.name, gn.normalized_name, gn.source, gn.usage_count
      FROM genres gn
      WHERE gn.id = _new_id;
END;
$function$;

GRANT ALL ON FUNCTION public.upsert_genre(text) TO anon;

GRANT ALL ON FUNCTION public.upsert_genre(text) TO authenticated;

GRANT ALL ON FUNCTION public.upsert_genre(text) TO service_role;

CREATE FUNCTION public.upsert_series (
  _name               text,
  _author             text    DEFAULT NULL::text,
  _total_books        integer DEFAULT NULL::integer,
  _publication_status text    DEFAULT 'unknown'::text,
  _source             text    DEFAULT 'user_manual'::text,
  _hardcover_id       bigint  DEFAULT NULL::bigint,
  _description        text    DEFAULT NULL::text,
  _verified           boolean DEFAULT false,
  _metadata           jsonb   DEFAULT '{}'::jsonb,
  _status             text    DEFAULT NULL::text,
  _verified_source    text    DEFAULT NULL::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  _norm text;
  _id uuid;
  _existing record;
  _resolved_status text;
begin
  if _name is null or length(trim(_name)) = 0 then
    raise exception 'series name is required';
  end if;
  _norm := normalize_series_name(_name);
  if length(_norm) = 0 then
    raise exception 'series name normalizes to empty string';
  end if;

  if _status is not null then
    _resolved_status := _status;
  elsif _verified is true then
    _resolved_status := 'verified';
  else
    _resolved_status := 'unreviewed';
  end if;

  select * into _existing from series where normalized_name = _norm limit 1;
  if found then
    update series set
      author             = coalesce(_existing.author, _author),
      total_books        = coalesce(_existing.total_books, _total_books),
      publication_status = case when _existing.publication_status = 'unknown'
                                then coalesce(_publication_status, 'unknown')
                                else _existing.publication_status end,
      hardcover_id       = coalesce(_existing.hardcover_id, _hardcover_id),
      description        = coalesce(_existing.description, _description),
      updated_at         = now()
    where id = _existing.id;
    return _existing.id;
  end if;

  insert into series (
    name, normalized_name, author, total_books, publication_status,
    source, hardcover_id, description,
    status, verified_source, verified_at, verified_by,
    metadata, created_by
  ) values (
    _name, _norm, _author, _total_books, coalesce(_publication_status, 'unknown'),
    coalesce(_source, 'user_manual'), _hardcover_id, _description,
    _resolved_status,
    _verified_source,
    case when _resolved_status = 'verified' then now() else null end,
    case when _verified_source = 'admin' then auth.uid() else null end,
    _metadata, auth.uid()
  )
  returning id into _id;
  return _id;
end;
$function$;

GRANT ALL ON FUNCTION public.upsert_series(text, text, integer, text, text, bigint, text, boolean, jsonb, text, text) TO anon;

GRANT ALL ON FUNCTION public.upsert_series(text, text, integer, text, text, bigint, text, boolean, jsonb, text, text) TO authenticated;

GRANT ALL ON FUNCTION public.upsert_series(text, text, integer, text, text, bigint, text, boolean, jsonb, text, text) TO service_role;

CREATE TABLE public.announcements (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  title      text                     NOT NULL,
  body       text                     NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.announcements
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

GRANT ALL ON public.announcements TO anon;

GRANT ALL ON public.announcements TO authenticated;

GRANT ALL ON public.announcements TO service_role;

CREATE POLICY "announcements readable" ON public.announcements
  FOR SELECT
  USING ((auth.uid() IS NOT NULL));

CREATE TABLE public.book_categories (
  book_id     uuid                     NOT NULL,
  category_id uuid                     NOT NULL,
  added_at    timestamp with time zone DEFAULT now() NOT NULL,
  added_by    uuid
);

ALTER TABLE public.book_categories
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_categories
  ADD CONSTRAINT book_categories_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.book_categories
  ADD CONSTRAINT book_categories_pkey PRIMARY KEY (book_id, category_id);

GRANT ALL ON public.book_categories TO anon;

GRANT ALL ON public.book_categories TO authenticated;

GRANT ALL ON public.book_categories TO service_role;

CREATE INDEX book_categories_category_idx ON public.book_categories (category_id);

CREATE POLICY book_categories_read ON public.book_categories
  FOR SELECT
  USING (true);

CREATE TABLE public.book_club_genres (
  club_id  uuid NOT NULL,
  genre_id uuid NOT NULL
);

ALTER TABLE public.book_club_genres
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_club_genres
  ADD CONSTRAINT book_club_genres_pkey PRIMARY KEY (club_id, genre_id);

GRANT ALL ON public.book_club_genres TO anon;

GRANT ALL ON public.book_club_genres TO authenticated;

GRANT ALL ON public.book_club_genres TO service_role;

CREATE POLICY "Club admins can manage genres" ON public.book_club_genres
  USING (public.is_club_admin(club_id, auth.uid()));

CREATE POLICY "Club members can view genres" ON public.book_club_genres
  FOR SELECT
  USING (public.is_club_member(club_id, auth.uid()));

CREATE TABLE public.book_club_members (
  id        uuid                     DEFAULT gen_random_uuid() NOT NULL,
  club_id   uuid                     NOT NULL,
  user_id   uuid                     NOT NULL,
  role      text                     DEFAULT 'member'::text NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.book_club_members
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_club_members
  ADD CONSTRAINT book_club_members_pkey PRIMARY KEY (id);

ALTER TABLE public.book_club_members
  ADD CONSTRAINT book_club_members_role_check CHECK (role = ANY (ARRAY['member'::text, 'admin'::text]));

ALTER TABLE public.book_club_members
  ADD CONSTRAINT book_club_members_unique UNIQUE (club_id, user_id);

ALTER TABLE public.book_club_members
  ADD CONSTRAINT book_club_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.book_club_members TO anon;

GRANT ALL ON public.book_club_members TO authenticated;

GRANT ALL ON public.book_club_members TO service_role;

CREATE INDEX book_club_members_admin_idx ON public.book_club_members (club_id)
  WHERE ROLE = 'admin'::text;

CREATE INDEX book_club_members_user_idx ON public.book_club_members (user_id);

CREATE INDEX book_club_members_club_idx ON public.book_club_members (club_id);

CREATE TRIGGER on_club_member_added
  AFTER INSERT ON public.book_club_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_club_member_notification();

CREATE TRIGGER on_club_member_removed
  AFTER DELETE ON public.book_club_members
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_from_waitlist();

CREATE POLICY "Club admins can remove members" ON public.book_club_members
  FOR DELETE
  USING (((user_id = auth.uid()) OR public.is_club_admin(club_id, auth.uid())));

CREATE POLICY "Club admins can update members" ON public.book_club_members
  FOR UPDATE
  USING (public.is_club_admin(club_id, auth.uid()));

CREATE POLICY "Club members can view roster" ON public.book_club_members
  FOR SELECT
  USING (public.is_club_member(club_id, auth.uid()));

CREATE TABLE public.book_club_moods (
  club_id uuid NOT NULL,
  mood    text NOT NULL
);

ALTER TABLE public.book_club_moods
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_club_moods
  ADD CONSTRAINT book_club_moods_mood_check
    CHECK
    (mood = ANY (ARRAY['comfort'::text, 'challenge'::text, 'escapism'::text, 'mind-bending'::text, 'character-driven'::text, 'atmospheric'::text, 'fast-paced'::text,
    'short-read'::text]));

ALTER TABLE public.book_club_moods
  ADD CONSTRAINT book_club_moods_pkey PRIMARY KEY (club_id, mood);

GRANT ALL ON public.book_club_moods TO anon;

GRANT ALL ON public.book_club_moods TO authenticated;

GRANT ALL ON public.book_club_moods TO service_role;

CREATE POLICY "club admins manage moods" ON public.book_club_moods
  USING ((EXISTS ( SELECT 1
   FROM public.book_club_members bcm
  WHERE ((bcm.club_id = book_club_moods.club_id) AND (bcm.user_id = auth.uid()) AND (bcm.role = 'admin'::text)))));

CREATE POLICY "club moods readable" ON public.book_club_moods
  FOR SELECT
  USING ((auth.uid() IS NOT NULL));

CREATE TABLE public.book_club_sessions (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  club_id     uuid                     NOT NULL,
  book_id     uuid                     NOT NULL,
  title       text,
  admin_notes text,
  starts_at   date                     NOT NULL,
  ends_at     date                     NOT NULL,
  created_by  uuid                     DEFAULT auth.uid() NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.book_club_sessions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_club_sessions
  ADD CONSTRAINT book_club_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.book_club_sessions
  ADD CONSTRAINT book_club_sessions_dates_check CHECK (ends_at >= starts_at);

ALTER TABLE public.book_club_sessions
  ADD CONSTRAINT book_club_sessions_pkey PRIMARY KEY (id);

GRANT ALL ON public.book_club_sessions TO anon;

GRANT ALL ON public.book_club_sessions TO authenticated;

GRANT ALL ON public.book_club_sessions TO service_role;

CREATE INDEX book_club_sessions_club_idx ON public.book_club_sessions (club_id);

CREATE INDEX book_club_sessions_book_idx ON public.book_club_sessions (book_id);

CREATE POLICY "Club admins can manage sessions" ON public.book_club_sessions
  USING (public.is_club_admin(club_id, auth.uid()));

CREATE POLICY "Club members can view sessions" ON public.book_club_sessions
  FOR SELECT
  USING (public.is_club_member(club_id, auth.uid()));

CREATE TABLE public.book_clubs (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  name        text                     NOT NULL,
  description text,
  join_token  text                     DEFAULT (gen_random_uuid())::text NOT NULL,
  created_by  uuid                     DEFAULT auth.uid() NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL,
  visibility  text                     DEFAULT 'private'::text NOT NULL,
  join_mode   text                     DEFAULT 'auto'::text NOT NULL,
  max_members integer
);

CREATE POLICY "Club members insert" ON public.book_club_members
  FOR INSERT
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.book_clubs
  WHERE ((book_clubs.id = book_club_members.club_id) AND (book_clubs.created_by = auth.uid())))) OR public.is_club_admin(club_id, auth.uid())));

ALTER TABLE public.book_clubs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_clubs
  ADD CONSTRAINT book_clubs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.book_clubs
  ADD CONSTRAINT book_clubs_join_mode_check CHECK (join_mode = ANY (ARRAY['auto'::text, 'approval'::text]));

ALTER TABLE public.book_clubs
  ADD CONSTRAINT book_clubs_join_token_key UNIQUE (join_token);

ALTER TABLE public.book_clubs
  ADD CONSTRAINT book_clubs_max_members_check CHECK (max_members IS NULL OR max_members > 0);

ALTER TABLE public.book_clubs
  ADD CONSTRAINT book_clubs_pkey PRIMARY KEY (id);

ALTER TABLE public.book_club_genres
  ADD CONSTRAINT book_club_genres_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.book_club_members
  ADD CONSTRAINT book_club_members_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.book_club_moods
  ADD CONSTRAINT book_club_moods_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.book_club_sessions
  ADD CONSTRAINT book_club_sessions_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.book_clubs
  ADD CONSTRAINT book_clubs_visibility_check CHECK (visibility = ANY (ARRAY['private'::text, 'public'::text]));

GRANT ALL ON public.book_clubs TO anon;

GRANT ALL ON public.book_clubs TO authenticated;

GRANT ALL ON public.book_clubs TO service_role;

CREATE INDEX book_clubs_join_token_idx ON public.book_clubs (join_token);

CREATE INDEX book_clubs_created_by_idx ON public.book_clubs (created_by);

CREATE TRIGGER book_clubs_updated_at
  BEFORE UPDATE ON public.book_clubs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_book_clubs_updated_at();

CREATE POLICY "Auth users can create clubs" ON public.book_clubs
  FOR INSERT
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Club admins can update club" ON public.book_clubs
  FOR UPDATE
  USING (public.is_club_admin(id, auth.uid()));

CREATE POLICY "Club creator can delete club" ON public.book_clubs
  FOR DELETE
  USING ((created_by = auth.uid()));

CREATE POLICY "Club members can view their clubs" ON public.book_clubs
  FOR SELECT
  USING (((created_by = auth.uid()) OR public.is_club_member(id, auth.uid())));

CREATE TABLE public.book_genres (
  book_id            uuid                     NOT NULL,
  genre_id           uuid                     NOT NULL,
  assigned_at        timestamp with time zone DEFAULT now() NOT NULL,
  assigned_by_source text                     DEFAULT 'oracle'::text NOT NULL
);

COMMENT ON TABLE public.book_genres IS 'Global book ↔ genre links. Populated by Oracle categorization or admin. Parallel to book_categories but for the canonical genre taxonomy.';

ALTER TABLE public.book_genres
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_genres
  ADD CONSTRAINT book_genres_assigned_by_source_check CHECK (assigned_by_source = ANY (ARRAY['seed'::text, 'oracle'::text, 'admin'::text]));

ALTER TABLE public.book_genres
  ADD CONSTRAINT book_genres_pkey PRIMARY KEY (book_id, genre_id);

GRANT ALL ON public.book_genres TO anon;

GRANT ALL ON public.book_genres TO authenticated;

GRANT ALL ON public.book_genres TO service_role;

CREATE INDEX book_genres_genre_idx ON public.book_genres (genre_id);

CREATE INDEX book_genres_book_idx ON public.book_genres (book_id);

CREATE TRIGGER book_genres_usage_count
  AFTER INSERT OR DELETE ON public.book_genres
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_genre_usage();

CREATE POLICY book_genres_read ON public.book_genres
  FOR SELECT
  USING (true);

CREATE TABLE public.book_merge_log (
  id            bigint                   DEFAULT nextval('public.book_merge_log_id_seq'::regclass) NOT NULL,
  merged_at     timestamp with time zone DEFAULT now() NOT NULL,
  from_book_id  uuid                     NOT NULL,
  to_book_id    uuid                     NOT NULL,
  from_snapshot jsonb                    NOT NULL,
  refs_moved    jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  refs_deduped  jsonb                    DEFAULT '{}'::jsonb NOT NULL
);

ALTER SEQUENCE public.book_merge_log_id_seq OWNED BY public.book_merge_log.id;

GRANT ALL ON SEQUENCE public.book_merge_log_id_seq TO anon;

GRANT ALL ON SEQUENCE public.book_merge_log_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.book_merge_log_id_seq TO service_role;

ALTER TABLE public.book_merge_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_merge_log
  ADD CONSTRAINT book_merge_log_pkey PRIMARY KEY (id);

GRANT ALL ON public.book_merge_log TO anon;

GRANT ALL ON public.book_merge_log TO authenticated;

GRANT ALL ON public.book_merge_log TO service_role;

CREATE TABLE public.book_reports (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  book_id    uuid                     NOT NULL,
  user_id    uuid                     DEFAULT auth.uid() NOT NULL,
  fields     text[]                   NOT NULL,
  comment    text,
  status     text                     DEFAULT 'open'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.book_reports IS 'User-submitted flags for incorrect book data. Consumed by the admin tool.';

COMMENT ON COLUMN public.book_reports.fields IS 'Which fields are wrong: title | description | series | genres';

COMMENT ON COLUMN public.book_reports.status IS 'open | resolved | dismissed';

ALTER TABLE public.book_reports
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.book_reports
  ADD CONSTRAINT book_reports_pkey PRIMARY KEY (id);

ALTER TABLE public.book_reports
  ADD CONSTRAINT book_reports_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text]));

ALTER TABLE public.book_reports
  ADD CONSTRAINT book_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.book_reports TO anon;

GRANT ALL ON public.book_reports TO authenticated;

GRANT ALL ON public.book_reports TO service_role;

CREATE INDEX book_reports_status_idx ON public.book_reports (status)
  WHERE status = 'open'::text;

CREATE INDEX book_reports_book_idx ON public.book_reports (book_id);

CREATE INDEX book_reports_user_idx ON public.book_reports (user_id);

CREATE TRIGGER book_reports_updated_at
  BEFORE UPDATE ON public.book_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Users insert own reports" ON public.book_reports
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Users read own reports" ON public.book_reports
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));

CREATE TABLE public.books (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  title                    text                     NOT NULL,
  author                   text,
  normalized_key           text                     NOT NULL,
  isbn                     text,
  hardcover_id             bigint,
  pages                    integer,
  description              text,
  cover_url                text,
  genre                    text,
  complexity               integer,
  depth                    integer,
  source                   text                     DEFAULT 'user_manual'::text NOT NULL,
  metadata                 jsonb                    DEFAULT '{}'::jsonb,
  created_by               uuid,
  created_at               timestamp with time zone DEFAULT now(),
  updated_at               timestamp with time zone DEFAULT now(),
  series_id                uuid,
  position_in_series       numeric,
  status                   text                     DEFAULT 'unreviewed'::text NOT NULL,
  verified_at              timestamp with time zone,
  verified_by              uuid,
  verified_source          text,
  author_gender            text,
  author_gender_source     text,
  author_gender_checked_at timestamp with time zone,
  goodreads_id             bigint,
  enrichment_attempts      integer                  DEFAULT 0 NOT NULL
);

COMMENT ON COLUMN public.books.status IS 'Review pipeline: unreviewed | incomplete | oracle_categorized | verified | flagged | discovered';

COMMENT ON COLUMN public.books.verified_at IS 'Timestamp when the row reached its current verified state. NULL until verified.';

COMMENT ON COLUMN public.books.verified_by IS 'Admin user who verified the row. NULL for curated_seed and oracle sources.';

COMMENT ON COLUMN public.books.verified_source IS 'How the row was verified: curated_seed | oracle | admin. NULL for unverified rows.';

COMMENT ON COLUMN public.books.author_gender IS 'Author gender/identity for the "books by women" accomplishment. NOT a genre — kept off the genres/book_genres taxonomy on purpose. NULL = never checked; ''unknown'' = checked, no reliable public signal.';

COMMENT ON COLUMN public.books.author_gender_source IS 'Provenance: oracle_inferred (Claude, from a public bio/interview/pronoun signal — never guessed from name), verified/self_identified (manual, authoritative — Oracle backfill must skip these).';

COMMENT ON COLUMN public.books.goodreads_id IS 'Goodreads work ID from the RSS import. Exact re-import match key. NULL for books from other sources.';

COMMENT ON COLUMN public.books.enrichment_attempts IS 'Lookup-chain failures. At 3, the book is left as-is and skipped by the enrichment sweep.';

ALTER TABLE public.books
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.books
  ADD CONSTRAINT books_author_gender_check CHECK (author_gender = ANY (ARRAY['female'::text, 'male'::text, 'nonbinary'::text, 'mixed'::text, 'unknown'::text]));

ALTER TABLE public.books
  ADD CONSTRAINT books_author_gender_source_check CHECK (author_gender_source = ANY (ARRAY['oracle_inferred'::text, 'verified'::text, 'self_identified'::text]));

ALTER TABLE public.books
  ADD CONSTRAINT books_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.books
  ADD CONSTRAINT books_pkey PRIMARY KEY (id);

ALTER TABLE public.book_categories
  ADD CONSTRAINT book_categories_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.book_club_sessions
  ADD CONSTRAINT book_club_sessions_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.book_genres
  ADD CONSTRAINT book_genres_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.book_reports
  ADD CONSTRAINT book_reports_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.books
  ADD CONSTRAINT books_status_check
    CHECK (status = ANY (ARRAY['unreviewed'::text, 'incomplete'::text, 'oracle_categorized'::text, 'verified'::text, 'flagged'::text, 'discovered'::text]));

ALTER TABLE public.books
  ADD CONSTRAINT books_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.books
  ADD CONSTRAINT books_verified_source_check CHECK (verified_source IS NULL OR (verified_source = ANY (ARRAY['curated_seed'::text, 'oracle'::text, 'admin'::text])));

GRANT ALL ON public.books TO anon;

GRANT ALL ON public.books TO authenticated;

GRANT ALL ON public.books TO service_role;

CREATE INDEX books_isbn_idx ON public.books (isbn)
  WHERE isbn IS NOT NULL;

CREATE UNIQUE INDEX books_normalized_key_idx ON public.books (normalized_key);

CREATE UNIQUE INDEX books_goodreads_id_idx ON public.books (goodreads_id)
  WHERE goodreads_id IS NOT NULL;

CREATE INDEX books_author_idx ON public.books (author);

CREATE INDEX books_author_gender_idx ON public.books (author_gender);

CREATE INDEX books_status_idx ON public.books (status);

CREATE INDEX books_title_idx ON public.books (title);

CREATE INDEX books_genre_idx ON public.books (genre);

CREATE INDEX books_source_idx ON public.books (source);

CREATE TRIGGER books_bump_catalog_version
  AFTER INSERT OR DELETE OR UPDATE ON public.books
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_catalog_version();

CREATE POLICY "Anyone can read books" ON public.books
  FOR SELECT
  USING (true);

CREATE TABLE public.books_duplicate (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  title                    text                     NOT NULL,
  author                   text,
  normalized_key           text                     NOT NULL,
  isbn                     text,
  hardcover_id             bigint,
  pages                    integer,
  description              text,
  cover_url                text,
  genre                    text,
  complexity               integer,
  depth                    integer,
  source                   text                     DEFAULT 'user_manual'::text NOT NULL,
  metadata                 jsonb                    DEFAULT '{}'::jsonb,
  created_by               uuid,
  created_at               timestamp with time zone DEFAULT now(),
  updated_at               timestamp with time zone DEFAULT now(),
  series_id                uuid,
  position_in_series       numeric,
  status                   text                     DEFAULT 'unreviewed'::text NOT NULL,
  verified_at              timestamp with time zone,
  verified_by              uuid,
  verified_source          text,
  author_gender            text,
  author_gender_source     text,
  author_gender_checked_at timestamp with time zone,
  goodreads_id             bigint,
  enrichment_attempts      integer                  DEFAULT 0 NOT NULL
);

COMMENT ON TABLE public.books_duplicate IS 'This is a duplicate of books';

COMMENT ON COLUMN public.books_duplicate.status IS 'Review pipeline: unreviewed | incomplete | oracle_categorized | verified | flagged | discovered';

COMMENT ON COLUMN public.books_duplicate.verified_at IS 'Timestamp when the row reached its current verified state. NULL until verified.';

COMMENT ON COLUMN public.books_duplicate.verified_by IS 'Admin user who verified the row. NULL for curated_seed and oracle sources.';

COMMENT ON COLUMN public.books_duplicate.verified_source IS 'How the row was verified: curated_seed | oracle | admin. NULL for unverified rows.';

COMMENT ON COLUMN public.books_duplicate.author_gender IS 'Author gender/identity for the "books by women" accomplishment. NOT a genre — kept off the genres/book_genres taxonomy on purpose. NULL = never checked; ''unknown'' = checked, no reliable public signal.';

COMMENT ON COLUMN public.books_duplicate.author_gender_source IS 'Provenance: oracle_inferred (Claude, from a public bio/interview/pronoun signal — never guessed from name), verified/self_identified (manual, authoritative — Oracle backfill must skip these).';

COMMENT ON COLUMN public.books_duplicate.goodreads_id IS 'Goodreads work ID from the RSS import. Exact re-import match key. NULL for books from other sources.';

COMMENT ON COLUMN public.books_duplicate.enrichment_attempts IS 'Lookup-chain failures. At 3, the book is left as-is and skipped by the enrichment sweep.';

ALTER TABLE public.books_duplicate
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_author_gender_check CHECK (author_gender = ANY (ARRAY['female'::text, 'male'::text, 'nonbinary'::text, 'mixed'::text, 'unknown'::text]));

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_author_gender_source_check CHECK (author_gender_source = ANY (ARRAY['oracle_inferred'::text, 'verified'::text, 'self_identified'::text]));

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_duplicate_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_duplicate_pkey PRIMARY KEY (id);

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_duplicate_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_status_check
    CHECK (status = ANY (ARRAY['unreviewed'::text, 'incomplete'::text, 'oracle_categorized'::text, 'verified'::text, 'flagged'::text, 'discovered'::text]));

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_verified_source_check CHECK (verified_source IS NULL OR (verified_source = ANY (ARRAY['curated_seed'::text, 'oracle'::text, 'admin'::text])));

GRANT ALL ON public.books_duplicate TO anon;

GRANT ALL ON public.books_duplicate TO authenticated;

GRANT ALL ON public.books_duplicate TO service_role;

CREATE UNIQUE INDEX books_duplicate_goodreads_id_idx ON public.books_duplicate (goodreads_id)
  WHERE goodreads_id IS NOT NULL;

CREATE INDEX books_duplicate_genre_idx ON public.books_duplicate (genre);

CREATE UNIQUE INDEX books_duplicate_normalized_key_idx ON public.books_duplicate (normalized_key);

CREATE INDEX books_duplicate_author_gender_idx ON public.books_duplicate (author_gender);

CREATE INDEX books_duplicate_title_idx ON public.books_duplicate (title);

CREATE INDEX books_duplicate_status_idx ON public.books_duplicate (status);

CREATE INDEX books_duplicate_isbn_idx ON public.books_duplicate (isbn)
  WHERE isbn IS NOT NULL;

CREATE INDEX books_duplicate_source_idx ON public.books_duplicate (source);

CREATE INDEX books_duplicate_author_idx ON public.books_duplicate (author);

CREATE TABLE public.books_isbn_backup_v38 (
  book_id   uuid                     NOT NULL,
  isbn      text,
  backed_up timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.books_isbn_backup_v38
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.books_isbn_backup_v38
  ADD CONSTRAINT books_isbn_backup_v38_pkey PRIMARY KEY (book_id);

GRANT ALL ON public.books_isbn_backup_v38 TO anon;

GRANT ALL ON public.books_isbn_backup_v38 TO authenticated;

GRANT ALL ON public.books_isbn_backup_v38 TO service_role;

CREATE TABLE public.books_isbn_backup_v40 (
  book_id      uuid                     NOT NULL,
  isbn         text,
  title        text,
  backed_up    timestamp with time zone DEFAULT now() NOT NULL,
  hardcover_id bigint
);

ALTER TABLE public.books_isbn_backup_v40
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.books_isbn_backup_v40
  ADD CONSTRAINT books_isbn_backup_v40_pkey PRIMARY KEY (book_id);

GRANT ALL ON public.books_isbn_backup_v40 TO anon;

GRANT ALL ON public.books_isbn_backup_v40 TO authenticated;

GRANT ALL ON public.books_isbn_backup_v40 TO service_role;

CREATE TABLE public.books_isbn_backup_v42 (
  book_id      uuid                     NOT NULL,
  isbn         text,
  hardcover_id bigint,
  title        text,
  backed_up    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.books_isbn_backup_v42
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.books_isbn_backup_v42
  ADD CONSTRAINT books_isbn_backup_v42_pkey PRIMARY KEY (book_id);

GRANT ALL ON public.books_isbn_backup_v42 TO anon;

GRANT ALL ON public.books_isbn_backup_v42 TO authenticated;

GRANT ALL ON public.books_isbn_backup_v42 TO service_role;

CREATE TABLE public.catalog_meta (
  id         boolean                  DEFAULT true NOT NULL,
  version    bigint                   DEFAULT 1 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.catalog_meta
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.catalog_meta
  ADD CONSTRAINT catalog_meta_id_check CHECK (id);

ALTER TABLE public.catalog_meta
  ADD CONSTRAINT catalog_meta_pkey PRIMARY KEY (id);

GRANT ALL ON public.catalog_meta TO anon;

GRANT ALL ON public.catalog_meta TO authenticated;

GRANT ALL ON public.catalog_meta TO service_role;

CREATE POLICY "Anyone can read catalog version" ON public.catalog_meta
  FOR SELECT
  USING (true);

CREATE TABLE public.categories (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  name            text                     NOT NULL,
  normalized_name text                     NOT NULL,
  verified        boolean                  DEFAULT false NOT NULL,
  verified_at     timestamp with time zone,
  verified_by     uuid,
  created_by      uuid,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  usage_count     integer                  DEFAULT 0 NOT NULL
);

ALTER TABLE public.categories
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_name_length_check CHECK (char_length(name) > 0 AND char_length(name) <= 80);

ALTER TABLE public.categories
  ADD CONSTRAINT categories_normalized_name_nonempty CHECK (char_length(normalized_name) > 0);

ALTER TABLE public.categories
  ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE public.book_categories
  ADD CONSTRAINT book_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

GRANT ALL ON public.categories TO anon;

GRANT ALL ON public.categories TO authenticated;

GRANT ALL ON public.categories TO service_role;

CREATE UNIQUE INDEX categories_normalized_name_unique ON public.categories (normalized_name);

CREATE INDEX categories_verified_usage_idx ON public.categories (verified DESC, usage_count DESC);

CREATE INDEX categories_name_trgm_idx ON public.categories USING gin (normalized_name public.gin_trgm_ops);

CREATE POLICY categories_read ON public.categories
  FOR SELECT
  USING (true);

CREATE TABLE public.club_join_requests (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  club_id     uuid                     NOT NULL,
  user_id     uuid                     NOT NULL,
  status      text                     NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  resolved_by uuid
);

ALTER TABLE public.club_join_requests
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.club_join_requests
  ADD CONSTRAINT club_join_requests_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.club_join_requests
  ADD CONSTRAINT club_join_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.club_join_requests
  ADD CONSTRAINT club_join_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);

ALTER TABLE public.club_join_requests
  ADD CONSTRAINT club_join_requests_status_check CHECK (status = ANY (ARRAY['pending_approval'::text, 'waitlisted'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE public.club_join_requests
  ADD CONSTRAINT club_join_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.club_join_requests TO anon;

GRANT ALL ON public.club_join_requests TO authenticated;

GRANT ALL ON public.club_join_requests TO service_role;

CREATE UNIQUE INDEX uq_club_join_requests_active ON public.club_join_requests (club_id, user_id)
  WHERE status = ANY (ARRAY['pending_approval'::text, 'waitlisted'::text]);

CREATE POLICY "admins view club join requests" ON public.club_join_requests
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM public.book_club_members bcm
  WHERE ((bcm.club_id = club_join_requests.club_id) AND (bcm.user_id = auth.uid()) AND (bcm.role = 'admin'::text)))));

CREATE POLICY "own join requests visible" ON public.club_join_requests
  FOR SELECT
  USING ((user_id = auth.uid()));

CREATE TABLE public.club_polls (
  id                uuid                     DEFAULT gen_random_uuid() NOT NULL,
  club_id           uuid                     NOT NULL,
  question          text                     NOT NULL,
  closes_at         timestamp with time zone,
  closed            boolean                  DEFAULT false NOT NULL,
  is_oracle_pick    boolean                  DEFAULT false NOT NULL,
  result_session_id uuid,
  created_by        uuid                     DEFAULT auth.uid() NOT NULL,
  created_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.club_polls
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.club_polls
  ADD CONSTRAINT club_polls_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.club_polls
  ADD CONSTRAINT club_polls_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.club_polls
  ADD CONSTRAINT club_polls_pkey PRIMARY KEY (id);

ALTER TABLE public.club_polls
  ADD CONSTRAINT club_polls_result_session_id_fkey FOREIGN KEY (result_session_id) REFERENCES public.book_club_sessions(id) ON DELETE SET NULL;

GRANT ALL ON public.club_polls TO anon;

GRANT ALL ON public.club_polls TO authenticated;

GRANT ALL ON public.club_polls TO service_role;

CREATE INDEX club_polls_club_idx ON public.club_polls (club_id);

CREATE TRIGGER on_poll_change
  AFTER INSERT OR UPDATE ON public.club_polls
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_poll_notification();

CREATE POLICY "Admins can manage polls" ON public.club_polls
  USING (public.is_club_admin(club_id, auth.uid()));

CREATE POLICY "Members can view polls" ON public.club_polls
  FOR SELECT
  USING (public.is_club_member(club_id, auth.uid()));

CREATE TABLE public.currently_reading (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id         uuid                     NOT NULL,
  book_id         uuid                     NOT NULL,
  started_at      date                     DEFAULT CURRENT_DATE NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  pages_read      integer                  DEFAULT 0 NOT NULL,
  user_page_count integer
);

COMMENT ON COLUMN public.currently_reading.user_page_count IS 'Optional user-supplied override for total pages, used when the reader''s physical edition differs from the catalog book row. NULL means "use book.pages". Never mutates public.books.';

ALTER TABLE public.currently_reading
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.currently_reading
  ADD CONSTRAINT currently_reading_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.currently_reading
  ADD CONSTRAINT currently_reading_pages_read_non_negative CHECK (pages_read >= 0);

ALTER TABLE public.currently_reading
  ADD CONSTRAINT currently_reading_pkey PRIMARY KEY (id);

ALTER TABLE public.currently_reading
  ADD CONSTRAINT currently_reading_user_book_unique UNIQUE (user_id, book_id);

ALTER TABLE public.currently_reading
  ADD CONSTRAINT currently_reading_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.currently_reading TO anon;

GRANT ALL ON public.currently_reading TO authenticated;

GRANT ALL ON public.currently_reading TO service_role;

CREATE INDEX currently_reading_user_id_idx ON public.currently_reading (user_id);

CREATE POLICY "Users can manage their own currently_reading" ON public.currently_reading
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.friendships (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  requester  uuid                     NOT NULL,
  addressee  uuid                     NOT NULL,
  status     text                     DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.friendships
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_addressee_fkey FOREIGN KEY (addressee) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_requester_addressee_key UNIQUE (requester, addressee);

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_requester_fkey FOREIGN KEY (requester) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.friendships
  ADD CONSTRAINT friendships_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'blocked'::text]));

GRANT ALL ON public.friendships TO anon;

GRANT ALL ON public.friendships TO authenticated;

GRANT ALL ON public.friendships TO service_role;

CREATE INDEX friendships_requester_idx ON public.friendships (requester);

CREATE INDEX friendships_addressee_idx ON public.friendships (addressee);

CREATE TRIGGER on_friendship_change
  AFTER INSERT OR UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_friendship_notification();

CREATE POLICY "own friendships" ON public.friendships
  USING (((requester = auth.uid()) OR (addressee = auth.uid())));

CREATE TABLE public.genres (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  name            text                     NOT NULL,
  normalized_name text                     NOT NULL,
  description     text,
  source          text                     DEFAULT 'oracle'::text NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  usage_count     integer                  DEFAULT 0 NOT NULL
);

COMMENT ON TABLE public.genres IS 'Canonical genre taxonomy. Oracle-curated, fixed vocabulary. Distinct from `categories` which is user-driven folksonomy.';

ALTER TABLE public.genres
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.genres
  ADD CONSTRAINT genres_name_length_check CHECK (char_length(name) > 0 AND char_length(name) <= 80);

ALTER TABLE public.genres
  ADD CONSTRAINT genres_normalized_name_nonempty CHECK (char_length(normalized_name) > 0);

ALTER TABLE public.genres
  ADD CONSTRAINT genres_pkey PRIMARY KEY (id);

ALTER TABLE public.book_club_genres
  ADD CONSTRAINT book_club_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genres(id) ON DELETE CASCADE;

ALTER TABLE public.book_genres
  ADD CONSTRAINT book_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genres(id) ON DELETE CASCADE;

ALTER TABLE public.genres
  ADD CONSTRAINT genres_source_check CHECK (source = ANY (ARRAY['seed'::text, 'oracle'::text, 'admin'::text]));

GRANT ALL ON public.genres TO anon;

GRANT ALL ON public.genres TO authenticated;

GRANT ALL ON public.genres TO service_role;

CREATE INDEX genres_name_trgm_idx ON public.genres USING gin (normalized_name public.gin_trgm_ops);

CREATE UNIQUE INDEX genres_normalized_name_unique ON public.genres (normalized_name);

CREATE INDEX genres_usage_idx ON public.genres (usage_count DESC);

CREATE POLICY "Genres are publicly readable" ON public.genres
  FOR SELECT
  USING (true);

CREATE POLICY genres_read ON public.genres
  FOR SELECT
  USING (true);

CREATE TABLE public.list_items (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  list_id    uuid                     NOT NULL,
  book_id    uuid                     NOT NULL,
  "position" integer                  DEFAULT 0 NOT NULL,
  note       text,
  added_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.list_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.list_items
  ADD CONSTRAINT list_items_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.list_items
  ADD CONSTRAINT list_items_list_id_book_id_key UNIQUE (list_id, book_id);

ALTER TABLE public.list_items
  ADD CONSTRAINT list_items_pkey PRIMARY KEY (id);

GRANT ALL ON public.list_items TO anon;

GRANT ALL ON public.list_items TO authenticated;

GRANT ALL ON public.list_items TO service_role;

CREATE INDEX list_items_list_id_idx ON public.list_items (list_id);

CREATE TABLE public.lists (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id     uuid                     NOT NULL,
  title       text                     NOT NULL,
  description text,
  is_public   boolean                  DEFAULT false NOT NULL,
  slug        text,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE POLICY "Anyone can read public list items" ON public.list_items
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM public.lists l
  WHERE ((l.id = list_items.list_id) AND (l.is_public = true)))));

CREATE POLICY "Users can manage own list items" ON public.list_items
  USING ((EXISTS ( SELECT 1
   FROM public.lists l
  WHERE ((l.id = list_items.list_id) AND (l.user_id = auth.uid())))));

ALTER TABLE public.lists
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lists
  ADD CONSTRAINT lists_pkey PRIMARY KEY (id);

ALTER TABLE public.list_items
  ADD CONSTRAINT list_items_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;

GRANT ALL ON public.lists TO anon;

GRANT ALL ON public.lists TO authenticated;

GRANT ALL ON public.lists TO service_role;

CREATE UNIQUE INDEX lists_user_slug_unique ON public.lists (user_id, slug)
  WHERE slug IS NOT NULL;

CREATE INDEX lists_slug_idx ON public.lists (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX lists_user_id_idx ON public.lists (user_id);

CREATE POLICY "Anyone can read public lists" ON public.lists
  FOR SELECT
  USING ((is_public = true));

CREATE POLICY "Users can manage own lists" ON public.lists
  USING ((auth.uid() = user_id));

CREATE TABLE public.notifications (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id    uuid                     NOT NULL,
  type       text                     NOT NULL,
  actor_id   uuid,
  data       jsonb                    DEFAULT '{}'::jsonb,
  read       boolean                  DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

ALTER TABLE public.notifications
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
    CHECK
    (type = ANY (ARRAY['friend_request'::text, 'friend_accepted'::text, 'club_invite'::text, 'poll_started'::text, 'poll_finalized'::text, 'discussion_question'::text,
    'discussion_reply'::text, 'announcement'::text, 'join_request'::text, 'join_approved'::text, 'join_rejected'::text, 'waitlist_promoted'::text]));

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.notifications TO anon;

GRANT ALL ON public.notifications TO authenticated;

GRANT ALL ON public.notifications TO service_role;

CREATE INDEX notifications_user_unread_idx ON public.notifications (user_id, read, created_at DESC);

CREATE TRIGGER notify_on_notification_insert
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION
    supabase_functions.http_request('https://thebooksoracle.com/.netlify/functions/send-notification-email', 'POST',
    '{"Content-type":"application/json","x-webhook-secret":"SHfHtS3Ya9bkCIUK8GhWlWBVDifkZ2BZKu4PA2JxNFY"}', '{}', '5000');

CREATE POLICY "own notifications" ON public.notifications
  USING ((user_id = auth.uid()));

CREATE TABLE public.oracle_call_log (
  id         bigint                   DEFAULT nextval('public.oracle_call_log_id_seq'::regclass) NOT NULL,
  user_id    uuid                     NOT NULL,
  source     text                     DEFAULT 'unknown'::text NOT NULL,
  charged    boolean                  DEFAULT true NOT NULL,
  period     text,
  run_id     uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.oracle_call_log_id_seq OWNED BY public.oracle_call_log.id;

GRANT ALL ON SEQUENCE public.oracle_call_log_id_seq TO anon;

GRANT ALL ON SEQUENCE public.oracle_call_log_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.oracle_call_log_id_seq TO service_role;

COMMENT ON TABLE public.oracle_call_log IS 'Append-only record of every Oracle call that actually reached Anthropic. Written exclusively by consume_oracle_call(). Stores no user content — surface and timestamp only.';

COMMENT ON COLUMN public.oracle_call_log.source IS 'Which surface spent the call: spark | ask | similar | categories | plan | categorization | club_poll | club_discussion | unknown. Allowlisted in netlify/functions/claude.js so a client cannot write arbitrary text here.';

COMMENT ON COLUMN public.oracle_call_log.charged IS 'false for calls that ran without spending quota: curator categorization (period = exempt) and batches 2..n of an already-paid run (period = run).';

ALTER TABLE public.oracle_call_log
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.oracle_call_log
  ADD CONSTRAINT oracle_call_log_pkey PRIMARY KEY (id);

ALTER TABLE public.oracle_call_log
  ADD CONSTRAINT oracle_call_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.oracle_call_log TO anon;

GRANT ALL ON public.oracle_call_log TO authenticated;

GRANT ALL ON public.oracle_call_log TO service_role;

CREATE INDEX oracle_call_log_user_created_idx ON public.oracle_call_log (user_id, created_at DESC);

CREATE POLICY oracle_call_log_select_own ON public.oracle_call_log
  FOR SELECT
  USING ((auth.uid() = user_id));

CREATE TABLE public.oracle_call_runs (
  user_id    uuid                     NOT NULL,
  run_id     uuid                     NOT NULL,
  charged_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.oracle_call_runs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.oracle_call_runs
  ADD CONSTRAINT oracle_call_runs_pkey PRIMARY KEY (user_id, run_id);

ALTER TABLE public.oracle_call_runs
  ADD CONSTRAINT oracle_call_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.oracle_call_runs TO anon;

GRANT ALL ON public.oracle_call_runs TO authenticated;

GRANT ALL ON public.oracle_call_runs TO service_role;

CREATE INDEX oracle_call_runs_charged_at_idx ON public.oracle_call_runs (charged_at);

CREATE TABLE public.oracle_recommendations (
  id          bigint                   DEFAULT nextval('public.oracle_recommendations_id_seq'::regclass) NOT NULL,
  user_id     uuid                     NOT NULL,
  call_id     bigint,
  surface     text                     NOT NULL,
  "position"  smallint,
  book_title  text                     NOT NULL,
  book_author text,
  book_id     uuid,
  outcome     text,
  outcome_at  timestamp with time zone,
  shown_at    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.oracle_recommendations_id_seq OWNED BY public.oracle_recommendations.id;

GRANT ALL ON SEQUENCE public.oracle_recommendations_id_seq TO anon;

GRANT ALL ON SEQUENCE public.oracle_recommendations_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.oracle_recommendations_id_seq TO service_role;

COMMENT ON TABLE public.oracle_recommendations IS 'One row per book the Oracle surfaced, written when it is shown — not when it is accepted. Recording only accepts would hide every rejected recommendation and make the Oracle look better than it is. See docs/oracle-provenance-v1-spec.md.';

COMMENT ON COLUMN public.oracle_recommendations."position" IS 'Rank within the result set, 1-based. If readers consistently take the third suggestion the ranking is wrong even when the picks are good — a different fix from "recommend better books", and invisible without this.';

COMMENT ON COLUMN public.oracle_recommendations.book_title IS 'Snapshot, not a link. Most recommendations have no public.books row when shown — see the header note on why book_id alone would bias the data.';

COMMENT ON COLUMN public.oracle_recommendations.outcome IS 'NULL = still just an impression. Dismissal is INFERRED at read time from age (see the metrics queries) rather than written by a background job, because it only ever matters in aggregate.';

ALTER TABLE public.oracle_recommendations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.oracle_recommendations
  ADD CONSTRAINT oracle_recommendations_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE SET NULL;

ALTER TABLE public.oracle_recommendations
  ADD CONSTRAINT oracle_recommendations_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.oracle_call_log(id) ON DELETE SET NULL;

ALTER TABLE public.oracle_recommendations
  ADD CONSTRAINT oracle_recommendations_outcome_check CHECK (outcome = ANY (ARRAY['accepted'::text, 'dismissed'::text]));

ALTER TABLE public.oracle_recommendations
  ADD CONSTRAINT oracle_recommendations_pkey PRIMARY KEY (id);

ALTER TABLE public.oracle_recommendations
  ADD CONSTRAINT oracle_recommendations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.oracle_recommendations TO anon;

GRANT ALL ON public.oracle_recommendations TO authenticated;

GRANT ALL ON public.oracle_recommendations TO service_role;

CREATE INDEX oracle_recommendations_outcome_idx ON public.oracle_recommendations (user_id, outcome)
  WHERE outcome IS NOT NULL;

CREATE INDEX oracle_recommendations_user_shown_idx ON public.oracle_recommendations (user_id, shown_at DESC);

CREATE INDEX oracle_recommendations_resolve_idx ON public.oracle_recommendations (user_id, lower(book_title), shown_at DESC)
  WHERE outcome IS NULL;

CREATE POLICY oracle_recommendations_select_own ON public.oracle_recommendations
  FOR SELECT
  USING ((auth.uid() = user_id));

CREATE TABLE public.plans (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id    uuid                     DEFAULT auth.uid() NOT NULL,
  title      text                     NOT NULL,
  content    jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.plans
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_pkey PRIMARY KEY (id);

ALTER TABLE public.plans
  ADD CONSTRAINT plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.plans TO anon;

GRANT ALL ON public.plans TO authenticated;

GRANT ALL ON public.plans TO service_role;

CREATE INDEX plans_user_idx ON public.plans (user_id);

CREATE POLICY "Anyone can read public plan" ON public.plans
  FOR SELECT
  USING (true);

CREATE POLICY "Users manage own plans" ON public.plans
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.poll_options (
  id          uuid    DEFAULT gen_random_uuid() NOT NULL,
  poll_id     uuid    NOT NULL,
  label       text    NOT NULL,
  book_id     uuid,
  book_author text,
  cover_url   text,
  "position"  integer DEFAULT 0 NOT NULL
);

ALTER TABLE public.poll_options
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.poll_options
  ADD CONSTRAINT poll_options_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE SET NULL;

ALTER TABLE public.poll_options
  ADD CONSTRAINT poll_options_pkey PRIMARY KEY (id);

ALTER TABLE public.poll_options
  ADD CONSTRAINT poll_options_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.club_polls(id) ON DELETE CASCADE;

GRANT ALL ON public.poll_options TO anon;

GRANT ALL ON public.poll_options TO authenticated;

GRANT ALL ON public.poll_options TO service_role;

CREATE INDEX poll_options_poll_idx ON public.poll_options (poll_id);

CREATE POLICY "Admins can manage poll options" ON public.poll_options
  USING ((EXISTS ( SELECT 1
   FROM public.club_polls p
  WHERE ((p.id = poll_options.poll_id) AND public.is_club_admin(p.club_id, auth.uid())))));

CREATE POLICY "Members can view poll options" ON public.poll_options
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM public.club_polls p
  WHERE ((p.id = poll_options.poll_id) AND public.is_club_member(p.club_id, auth.uid())))));

CREATE TABLE public.poll_votes (
  poll_id   uuid                     NOT NULL,
  user_id   uuid                     NOT NULL,
  option_id uuid                     NOT NULL,
  voted_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.poll_votes
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.poll_votes
  ADD CONSTRAINT poll_votes_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.poll_options(id) ON DELETE CASCADE;

ALTER TABLE public.poll_votes
  ADD CONSTRAINT poll_votes_pkey PRIMARY KEY (poll_id, user_id);

ALTER TABLE public.poll_votes
  ADD CONSTRAINT poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.club_polls(id) ON DELETE CASCADE;

ALTER TABLE public.poll_votes
  ADD CONSTRAINT poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.poll_votes TO anon;

GRANT ALL ON public.poll_votes TO authenticated;

GRANT ALL ON public.poll_votes TO service_role;

CREATE INDEX poll_votes_option_idx ON public.poll_votes (option_id);

CREATE POLICY "Members can change their vote" ON public.poll_votes
  FOR UPDATE
  USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.club_polls p
  WHERE ((p.id = poll_votes.poll_id) AND (p.closed = false))))));

CREATE POLICY "Members can retract their vote" ON public.poll_votes
  FOR DELETE
  USING ((user_id = auth.uid()));

CREATE POLICY "Members can view votes" ON public.poll_votes
  FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM public.club_polls p
  WHERE ((p.id = poll_votes.poll_id) AND public.is_club_member(p.club_id, auth.uid())))));

CREATE POLICY "Members can vote" ON public.poll_votes
  FOR INSERT
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.club_polls p
  WHERE ((p.id = poll_votes.poll_id) AND public.is_club_member(p.club_id, auth.uid()) AND (p.closed = false))))));

CREATE TABLE public.profile_billing (
  user_id            uuid                     NOT NULL,
  ls_customer_id     text,
  ls_subscription_id text,
  updated_at         timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.profile_billing
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profile_billing
  ADD CONSTRAINT profile_billing_pkey PRIMARY KEY (user_id);

GRANT ALL ON public.profile_billing TO service_role;

CREATE TABLE public.profiles (
  id                            uuid                     NOT NULL,
  display_name                  text,
  avatar_url                    text,
  preferences                   jsonb                    DEFAULT '{}'::jsonb,
  created_at                    timestamp with time zone DEFAULT now(),
  updated_at                    timestamp with time zone DEFAULT now(),
  is_curator                    boolean                  DEFAULT false NOT NULL,
  subscription_status           text                     DEFAULT 'free'::text NOT NULL,
  oracle_calls_this_month       integer                  DEFAULT 0 NOT NULL,
  oracle_calls_month_start      timestamp with time zone DEFAULT date_trunc('month'::text, (now() AT TIME ZONE 'utc'::text)) NOT NULL,
  username                      text,
  is_discoverable               boolean                  DEFAULT true NOT NULL,
  email_notifications           boolean                  DEFAULT true NOT NULL,
  oracle_calls_today            integer                  DEFAULT 0 NOT NULL,
  oracle_calls_day_start        timestamp with time zone DEFAULT date_trunc('day'::text, (now() AT TIME ZONE 'utc'::text)) NOT NULL,
  notification_preferences      jsonb                    DEFAULT '{"email": true, "friends": true, "book_club": true, "announcements": true}'::jsonb NOT NULL,
  accomplishments_backfilled_at timestamp with time zone,
  oracle_calls_exempt_total     integer                  DEFAULT 0 NOT NULL,
  oracle_intro_seen_at          timestamp with time zone,
  goodreads_user_id             text,
  goodreads_last_import_at      timestamp with time zone
);

COMMENT ON COLUMN public.profiles.oracle_calls_month_start IS 'START of the monthly quota period (date_trunc(month)), NOT a reset time. The reset instant is month_start + 1 month, computed at read time.';

COMMENT ON COLUMN public.profiles.oracle_calls_day_start IS 'START of the daily quota period (date_trunc(day)), NOT a reset time. Drives the Pro daily cycle. Reset instant is day_start + 1 day.';

COMMENT ON COLUMN public.profiles.oracle_calls_exempt_total IS 'Lifetime count of Oracle calls that bypassed the quota (curator categorization). Tracked for cost visibility only — never enforced, never reset. Deliberately separate from the metered counters so exempt catalog work cannot consume the user''s personal budget.';

COMMENT ON COLUMN public.profiles.oracle_intro_seen_at IS 'When the user acknowledged the one-time "Oracle calls are metered" dialog. NULL means it has not been shown/accepted yet. Set from the client on confirm, not on dismiss — dismissing is not consent to spend a call.';

COMMENT ON COLUMN public.profiles.goodreads_user_id IS 'Numeric Goodreads profile ID, kept for re-sync. Public data; no credential.';

ALTER TABLE public.profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE public.lists
  ADD CONSTRAINT lists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.profile_billing
  ADD CONSTRAINT profile_billing_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_status_check CHECK (subscription_status = ANY (ARRAY['free'::text, 'active'::text, 'past_due'::text, 'cancelled'::text]));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_key UNIQUE (username);

ALTER TABLE public.profiles
  ADD CONSTRAINT username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_-]{3,24}$'::text);

GRANT ALL ON public.profiles TO anon;

GRANT ALL ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

CREATE UNIQUE INDEX profiles_username_lower_idx ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

CREATE INDEX profiles_subscription_idx ON public.profiles (subscription_status);

CREATE INDEX profiles_is_curator_idx ON public.profiles (is_curator)
  WHERE is_curator = true;

CREATE POLICY "Anyone can read curator flag" ON public.profiles
  FOR SELECT
  USING (true);

CREATE POLICY "Users can update own safe profile fields" ON public.profiles
  FOR UPDATE
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT
  USING ((auth.uid() = id));

CREATE POLICY "public profile read" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE public.read_books (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id    uuid                     DEFAULT auth.uid() NOT NULL,
  rating     numeric(2,1),
  read_at    date,
  source     text                     DEFAULT 'manual'::text,
  created_at timestamp with time zone DEFAULT now(),
  book_id    uuid                     NOT NULL,
  notes      text
);

COMMENT ON COLUMN public.read_books.rating IS '1-5 user rating; NULL means unrated';

COMMENT ON COLUMN public.read_books.notes IS 'User-private notes about this book; max 4000 chars';

ALTER TABLE public.read_books
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.read_books
  ADD CONSTRAINT read_books_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.read_books
  ADD CONSTRAINT read_books_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 4000);

ALTER TABLE public.read_books
  ADD CONSTRAINT read_books_pkey PRIMARY KEY (id);

ALTER TABLE public.read_books
  ADD CONSTRAINT read_books_user_book_unique UNIQUE (user_id, book_id);

ALTER TABLE public.read_books
  ADD CONSTRAINT read_books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.read_books TO anon;

GRANT ALL ON public.read_books TO authenticated;

GRANT ALL ON public.read_books TO service_role;

CREATE INDEX read_books_user_idx ON public.read_books (user_id);

CREATE POLICY "Users manage own read books" ON public.read_books
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.reading_accomplishments (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id    uuid                     NOT NULL,
  key        text                     NOT NULL,
  kind       text                     NOT NULL,
  book_id    uuid,
  meta       jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  earned_at  timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.reading_accomplishments
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reading_accomplishments
  ADD CONSTRAINT reading_accomplishments_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE SET NULL;

ALTER TABLE public.reading_accomplishments
  ADD CONSTRAINT reading_accomplishments_key_check CHECK (char_length(key) >= 1 AND char_length(key) <= 200);

ALTER TABLE public.reading_accomplishments
  ADD CONSTRAINT reading_accomplishments_kind_check
    CHECK (kind = ANY (ARRAY['nth_book'::text, 'genre_count'::text, 'new_genre'::text, 'series_completed'::text, 'plan_completed'::text, 'goal_completed'::text]));

ALTER TABLE public.reading_accomplishments
  ADD CONSTRAINT reading_accomplishments_pkey PRIMARY KEY (id);

ALTER TABLE public.reading_accomplishments
  ADD CONSTRAINT reading_accomplishments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.reading_accomplishments
  ADD CONSTRAINT reading_accomplishments_user_id_key_key UNIQUE (user_id, key);

GRANT ALL ON public.reading_accomplishments TO anon;

GRANT ALL ON public.reading_accomplishments TO authenticated;

GRANT ALL ON public.reading_accomplishments TO service_role;

CREATE INDEX reading_accomplishments_user_earned_idx ON public.reading_accomplishments (user_id, earned_at DESC);

CREATE POLICY reading_accomplishments_delete_own ON public.reading_accomplishments
  FOR DELETE
  USING ((auth.uid() = user_id));

CREATE POLICY reading_accomplishments_insert_own ON public.reading_accomplishments
  FOR INSERT
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY reading_accomplishments_select_own ON public.reading_accomplishments
  FOR SELECT
  USING ((auth.uid() = user_id));

CREATE TABLE public.reading_memories (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id    uuid                     NOT NULL,
  book_id    uuid                     NOT NULL,
  kind       text                     DEFAULT 'progress'::text NOT NULL,
  body       text                     NOT NULL,
  pages_at   integer,
  pct_at     integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.reading_memories
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 2000);

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_kind_check CHECK (kind = ANY (ARRAY['progress'::text, 'finished'::text]));

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_pages_at_check CHECK (pages_at IS NULL OR pages_at >= 0);

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_pct_at_check CHECK (pct_at IS NULL OR pct_at >= 0 AND pct_at <= 100);

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_pkey PRIMARY KEY (id);

ALTER TABLE public.reading_memories
  ADD CONSTRAINT reading_memories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.reading_memories TO anon;

GRANT ALL ON public.reading_memories TO authenticated;

GRANT ALL ON public.reading_memories TO service_role;

CREATE INDEX reading_memories_user_created_idx ON public.reading_memories (user_id, created_at DESC);

CREATE POLICY reading_memories_delete_own ON public.reading_memories
  FOR DELETE
  USING ((auth.uid() = user_id));

CREATE POLICY reading_memories_insert_own ON public.reading_memories
  FOR INSERT
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY reading_memories_select_own ON public.reading_memories
  FOR SELECT
  USING ((auth.uid() = user_id));

CREATE TABLE public.series (
  id                 uuid                     DEFAULT gen_random_uuid() NOT NULL,
  name               text                     NOT NULL,
  normalized_name    text                     NOT NULL,
  author             text,
  total_books        integer,
  publication_status text                     DEFAULT 'unknown'::text,
  source             text                     DEFAULT 'user_manual'::text,
  hardcover_id       bigint,
  description        text,
  metadata           jsonb                    DEFAULT '{}'::jsonb,
  created_by         uuid,
  created_at         timestamp with time zone DEFAULT now(),
  updated_at         timestamp with time zone DEFAULT now(),
  status             text                     DEFAULT 'unreviewed'::text NOT NULL,
  verified_at        timestamp with time zone,
  verified_by        uuid,
  verified_source    text
);

COMMENT ON COLUMN public.series.publication_status IS 'Publication state of the series: ongoing | complete | unknown. Distinct from the review `status` column added in v0.14.';

COMMENT ON COLUMN public.series.status IS 'Review pipeline state: unreviewed | incomplete | oracle_categorized | verified | flagged';

COMMENT ON COLUMN public.series.verified_at IS 'Timestamp when the row reached its current verified state. NULL until verified.';

COMMENT ON COLUMN public.series.verified_by IS 'Admin user who verified the row. NULL for curated_seed and oracle sources.';

COMMENT ON COLUMN public.series.verified_source IS 'How the row was verified: curated_seed | oracle | admin. NULL for unverified rows.';

ALTER TABLE public.series
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.series
  ADD CONSTRAINT series_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.series
  ADD CONSTRAINT series_pkey PRIMARY KEY (id);

ALTER TABLE public.books
  ADD CONSTRAINT books_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.series(id) ON DELETE SET NULL;

ALTER TABLE public.books_duplicate
  ADD CONSTRAINT books_duplicate_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.series(id) ON DELETE SET NULL;

ALTER TABLE public.series
  ADD CONSTRAINT series_status_check CHECK (status = ANY (ARRAY['unreviewed'::text, 'incomplete'::text, 'oracle_categorized'::text, 'verified'::text, 'flagged'::text]));

ALTER TABLE public.series
  ADD CONSTRAINT series_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.series
  ADD CONSTRAINT series_verified_source_check CHECK (verified_source IS NULL OR (verified_source = ANY (ARRAY['curated_seed'::text, 'oracle'::text, 'admin'::text])));

GRANT ALL ON public.series TO anon;

GRANT ALL ON public.series TO authenticated;

GRANT ALL ON public.series TO service_role;

CREATE INDEX series_name_idx ON public.series (name);

CREATE INDEX series_status_idx ON public.series (status);

CREATE UNIQUE INDEX series_normalized_name_idx ON public.series (normalized_name);

CREATE POLICY "Anyone can read series" ON public.series
  FOR SELECT
  USING (true);

CREATE TABLE public.session_comments (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  session_id  uuid                     NOT NULL,
  club_id     uuid                     NOT NULL,
  question_id uuid,
  parent_id   uuid,
  body        text                     NOT NULL,
  created_by  uuid                     DEFAULT auth.uid() NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.session_comments
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_pkey PRIMARY KEY (id);

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.session_comments(id) ON DELETE CASCADE;

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_reply_depth CHECK (parent_id IS NULL OR question_id IS NULL);

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.book_club_sessions(id) ON DELETE CASCADE;

GRANT ALL ON public.session_comments TO anon;

GRANT ALL ON public.session_comments TO authenticated;

GRANT ALL ON public.session_comments TO service_role;

CREATE INDEX session_comments_parent_idx ON public.session_comments (parent_id);

CREATE INDEX session_comments_session_idx ON public.session_comments (session_id);

CREATE INDEX session_comments_question_idx ON public.session_comments (question_id);

CREATE INDEX session_comments_club_idx ON public.session_comments (club_id);

CREATE TRIGGER on_discussion_reply
  AFTER INSERT ON public.session_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_discussion_reply_notification();

CREATE TRIGGER session_comments_updated_at
  BEFORE UPDATE ON public.session_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_session_comments_updated_at();

CREATE POLICY "Authors can edit their comments" ON public.session_comments
  FOR UPDATE
  USING ((created_by = auth.uid()));

CREATE POLICY "Authors or admins can delete comments" ON public.session_comments
  FOR DELETE
  USING (((created_by = auth.uid()) OR public.is_club_admin(club_id, auth.uid())));

CREATE POLICY "Members can post comments" ON public.session_comments
  FOR INSERT
  WITH CHECK ((public.is_club_member(club_id, auth.uid()) AND (created_by = auth.uid())));

CREATE POLICY "Members can view comments" ON public.session_comments
  FOR SELECT
  USING (public.is_club_member(club_id, auth.uid()));

CREATE TABLE public.session_questions (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid                     NOT NULL,
  club_id    uuid                     NOT NULL,
  body       text                     NOT NULL,
  "position" integer                  DEFAULT 0 NOT NULL,
  created_by uuid                     DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.session_questions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.session_questions
  ADD CONSTRAINT session_questions_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.book_clubs(id) ON DELETE CASCADE;

ALTER TABLE public.session_questions
  ADD CONSTRAINT session_questions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.session_questions
  ADD CONSTRAINT session_questions_pkey PRIMARY KEY (id);

ALTER TABLE public.session_comments
  ADD CONSTRAINT session_comments_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.session_questions(id) ON DELETE CASCADE;

ALTER TABLE public.session_questions
  ADD CONSTRAINT session_questions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.book_club_sessions(id) ON DELETE CASCADE;

GRANT ALL ON public.session_questions TO anon;

GRANT ALL ON public.session_questions TO authenticated;

GRANT ALL ON public.session_questions TO service_role;

CREATE INDEX session_questions_session_idx ON public.session_questions (session_id);

CREATE INDEX session_questions_club_idx ON public.session_questions (club_id);

CREATE TRIGGER on_discussion_question
  AFTER INSERT ON public.session_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_discussion_question_notification();

CREATE POLICY "Admins can manage questions" ON public.session_questions
  USING (public.is_club_admin(club_id, auth.uid()));

CREATE POLICY "Members can view questions" ON public.session_questions
  FOR SELECT
  USING (public.is_club_member(club_id, auth.uid()));

CREATE TABLE public.user_book_categories (
  user_id     uuid                     NOT NULL,
  book_id     uuid                     NOT NULL,
  category_id uuid                     NOT NULL,
  added_at    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.user_book_categories
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_book_categories
  ADD CONSTRAINT user_book_categories_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.user_book_categories
  ADD CONSTRAINT user_book_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE public.user_book_categories
  ADD CONSTRAINT user_book_categories_pkey PRIMARY KEY (user_id, book_id, category_id);

ALTER TABLE public.user_book_categories
  ADD CONSTRAINT user_book_categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.user_book_categories TO anon;

GRANT ALL ON public.user_book_categories TO authenticated;

GRANT ALL ON public.user_book_categories TO service_role;

CREATE INDEX user_book_categories_book_idx ON public.user_book_categories (book_id);

CREATE INDEX user_book_categories_category_idx ON public.user_book_categories (category_id);

CREATE INDEX user_book_categories_user_idx ON public.user_book_categories (user_id);

CREATE TRIGGER user_book_categories_usage_count
  AFTER INSERT OR DELETE ON public.user_book_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_category_usage();

CREATE POLICY user_book_categories_own ON public.user_book_categories
  FOR SELECT
  USING ((auth.uid() = user_id));

CREATE TABLE public.wishlist_items (
  id            uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id       uuid                     DEFAULT auth.uid() NOT NULL,
  book_author   text,
  book_isbn     text,
  book_metadata jsonb                    DEFAULT '{}'::jsonb,
  notes         text,
  added_at      timestamp with time zone DEFAULT now(),
  book_id       uuid                     NOT NULL
);

ALTER TABLE public.wishlist_items
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;

ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_pkey PRIMARY KEY (id);

ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_user_book_unique UNIQUE (user_id, book_id);

ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.wishlist_items TO anon;

GRANT ALL ON public.wishlist_items TO authenticated;

GRANT ALL ON public.wishlist_items TO service_role;

CREATE INDEX wishlist_user_idx ON public.wishlist_items (user_id);

CREATE POLICY "Users manage own wishlist" ON public.wishlist_items
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE VIEW public.book_categories_view WITH (security_invoker=true) AS SELECT bc.book_id,
    NULL::uuid AS user_id,
    c.id AS category_id,
    c.name AS category_name,
    c.normalized_name,
    c.verified,
    c.usage_count,
    'verified'::text AS source
   FROM (public.book_categories bc
     JOIN public.categories c ON ((c.id = bc.category_id)))
UNION ALL
 SELECT ubc.book_id,
    ubc.user_id,
    c.id AS category_id,
    c.name AS category_name,
    c.normalized_name,
    c.verified,
    c.usage_count,
        CASE
            WHEN c.verified THEN 'verified'::text
            ELSE 'user'::text
        END AS source
   FROM (public.user_book_categories ubc
     JOIN public.categories c ON ((c.id = ubc.category_id)));

COMMENT ON VIEW public.book_categories_view IS 'Union of verified global categories + user-private categories. Filter by book_id and (user_id IS NULL OR user_id = auth.uid()) when querying.';

GRANT ALL ON public.book_categories_view TO anon;

GRANT ALL ON public.book_categories_view TO authenticated;

GRANT ALL ON public.book_categories_view TO service_role;

CREATE VIEW public.book_genres_view WITH (security_invoker=true) AS SELECT bg.book_id,
    bg.genre_id,
    g.name AS genre_name,
    g.normalized_name,
    g.source AS genre_source,
    g.usage_count,
    g.description AS genre_description,
    bg.assigned_by_source
   FROM (public.book_genres bg
     JOIN public.genres g ON ((g.id = bg.genre_id)));

GRANT ALL ON public.book_genres_view TO anon;

GRANT ALL ON public.book_genres_view TO authenticated;

GRANT ALL ON public.book_genres_view TO service_role;

CREATE VIEW public.friend_pairs WITH (security_invoker=true) AS SELECT friendships.requester AS user_a,
    friendships.addressee AS user_b
   FROM public.friendships
  WHERE (friendships.status = 'accepted'::text)
UNION
 SELECT friendships.addressee AS user_a,
    friendships.requester AS user_b
   FROM public.friendships
  WHERE (friendships.status = 'accepted'::text);

CREATE POLICY "read_books select" ON public.read_books
  FOR SELECT
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.friend_pairs
  WHERE ((friend_pairs.user_a = auth.uid()) AND (friend_pairs.user_b = read_books.user_id))))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON public.friend_pairs TO anon;

GRANT ALL ON public.friend_pairs TO authenticated;

GRANT ALL ON public.friend_pairs TO service_role;

CREATE VIEW public.v_dedupe_groups AS SELECT public.dedupe_title_key(title) AS tkey,
    public.dedupe_author_key(author) AS akey,
    count(*) AS rows,
    count(DISTINCT hardcover_id) FILTER (WHERE (hardcover_id IS NOT NULL)) AS distinct_hardcover_ids,
    array_agg(id) AS book_ids,
    array_agg(DISTINCT title) AS titles,
    array_agg(DISTINCT author) AS authors
   FROM public.books
  WHERE (COALESCE(btrim(title), ''::text) <> ''::text)
  GROUP BY (public.dedupe_title_key(title)), (public.dedupe_author_key(author))
 HAVING (count(*) > 1);

GRANT ALL ON public.v_dedupe_groups TO anon;

GRANT ALL ON public.v_dedupe_groups TO authenticated;

GRANT ALL ON public.v_dedupe_groups TO service_role;

CREATE VIEW public.v_dedupe_plan AS WITH ranked AS (
         SELECT b.id,
            b.title,
            b.author,
            public.dedupe_title_key(b.title) AS tkey,
            public.dedupe_author_key(b.author) AS akey,
            row_number() OVER (PARTITION BY (public.dedupe_title_key(b.title)), (public.dedupe_author_key(b.author)) ORDER BY (b.status = ANY (ARRAY['verified'::text, 'oracle_categorized'::text])) DESC, (b.cover_url IS NOT NULL) DESC, (b.description IS NOT NULL) DESC, (b.hardcover_id IS NOT NULL) DESC, (b.genre IS NOT NULL) DESC, (b.pages IS NOT NULL) DESC, b.created_at) AS rn
           FROM public.books b
          WHERE (COALESCE(btrim(b.title), ''::text) <> ''::text)
        )
 SELECT r.id AS loser_id,
    s.id AS survivor_id,
    r.title AS loser_title
   FROM (ranked r
     JOIN ranked s ON (((s.tkey = r.tkey) AND (s.akey = r.akey) AND (s.rn = 1))))
  WHERE (r.rn > 1);

GRANT ALL ON public.v_dedupe_plan TO anon;

GRANT ALL ON public.v_dedupe_plan TO authenticated;

GRANT ALL ON public.v_dedupe_plan TO service_role;
