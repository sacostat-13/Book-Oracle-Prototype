-- v0.63.3 — persist the Oracle's reason alongside the recommendation.
--
-- Until now `reason` existed only in React component state: the Oracle argued
-- for a book, the reader navigated away, and the argument was gone. Two things
-- were lost with it.
--
--   For the reader: the reason is half of what a recommendation IS. A book
--   sitting on the wishlist a week later, with no memory of why it was drawn,
--   is indistinguishable from one they added themselves at random.
--
--   For us: oracle_recommendations already records what was offered and what
--   became of it. Without the reason it cannot answer the more useful
--   question — which KINDS of argument get taken up. "Because you rated
--   Piranesi 5★" and "a haunting modern gothic" are not the same pitch, and
--   the accept rate is the only place that difference is visible.
--
-- Nullable on purpose. Every row written before this migration has no reason,
-- and the local (non-LLM) draws never will — a NOT NULL default of '' would
-- make "no reason given" and "reason not applicable" the same value.

alter table public.oracle_recommendations
  add column if not exists reason text;

comment on column public.oracle_recommendations.reason is
  'The personalised "why this reader, why now" the Oracle returned with the book. NULL for rows written before v0.63.3 and for local draws, which never involve the model. Distinct from the book description, which is about the book rather than the reader.';

-- log_oracle_recommendations: same signature, same contract, one more field
-- read out of the payload.
--
-- The 400-char clamp is the same reasoning as the ord <= 25 cap below it: the
-- client sends one sentence, and anything much larger is a bug or an attempt
-- to use the impressions table as free storage. Truncating is right rather
-- than rejecting — a long reason should cost the reader a clipped sentence,
-- never the whole recommendation set they just spent a quota call on.
create or replace function public.log_oracle_recommendations (
  p_surface text,
  p_books   jsonb,
  p_call_id bigint default null::bigint
)
  returns bigint[]
  language plpgsql
  security definer
  set search_path to 'public'
  as $function$
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
      nullif(btrim(b->>'title'),  '')                       as title,
      nullif(btrim(b->>'author'), '')                       as author,
      left(nullif(btrim(b->>'reason'), ''), 400)            as reason,
      coalesce((b->>'position')::smallint, t.ord::smallint) as position,
      t.ord                                                 as ord
    from jsonb_array_elements(p_books) with ordinality as t(b, ord)
    where t.ord <= 25
  ),
  ins as (
    insert into public.oracle_recommendations
      (user_id, call_id, surface, position, book_title, book_author, reason)
    select v_uid, p_call_id, v_surface, position, title, author, reason
    from input
    where title is not null
    order by ord
    returning id
  )
  select array_agg(id order by id) into v_ids from ins;

  return coalesce(v_ids, array[]::bigint[]);
end;
$function$;

grant all on function public.log_oracle_recommendations(text, jsonb, bigint) to anon;
grant all on function public.log_oracle_recommendations(text, jsonb, bigint) to authenticated;
grant all on function public.log_oracle_recommendations(text, jsonb, bigint) to service_role;
