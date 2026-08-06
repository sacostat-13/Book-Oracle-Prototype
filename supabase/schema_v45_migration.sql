-- ============================================================
-- schema_v45_migration.sql — Oracle provenance
--
-- Spec: docs/oracle-provenance-v1-spec.md
--
-- ── What this is for ─────────────────────────────────────────────────────────
-- A rating on a book the reader chose tells you about the reader. A rating on a
-- book the ORACLE chose tells you about the Oracle. Today nothing distinguishes
-- them: `aiSuggested: true` is stamped on every recommendation in the Oracle
-- views and thrown away the moment addToWishlist() runs.
--
-- This is the one fact here that cannot be backfilled. Whether a book was the
-- Oracle's idea is knowable only at the moment it is offered.
--
-- ── Why impressions, not just accepts ────────────────────────────────────────
-- The obvious design stamps provenance when a recommendation is ADDED. It also
-- cannot answer the question, because the Oracle's worst suggestions are
-- exactly the ones nobody adds — they would never be recorded, and the average
-- rating of "Oracle books" would be flattering by construction. So every book
-- the Oracle surfaces gets a row at the moment it is surfaced, and the outcome
-- is written later. 3-5 rows per call, 5 calls a month on Free: trivial volume,
-- and the only version that can see a refusal.
--
-- ── Why a title snapshot and not just book_id ────────────────────────────────
-- The Oracle recommends from world literature, not the catalog — the prompts
-- say so explicitly. Most recommendations have NO public.books row when they
-- are shown; one is created by upsertBookOnServer only if the reader adds the
-- book. Keying on book_id alone would therefore record precisely the accepted
-- subset and silently drop every rejection — reintroducing the bias this design
-- exists to avoid. Title/author are snapshotted; book_id is backfilled on
-- accept, when it finally exists.
--
-- ── Privacy ──────────────────────────────────────────────────────────────────
-- This table stores book titles, which oracle_call_log (schema_v44)
-- deliberately does not. The v0.58 announcement promised "never your question,
-- and never which book you were reading" — about the CALL LOG, and that stays
-- true. The distinction: the call log would have recorded what the reader
-- ASKED (their own words); this records what the Oracle OFFERED (the app's own
-- output). Owner-read-only, no client writes, cascades on account deletion.
-- Deliberately NOT surfaced in the quota history panel.
-- ============================================================

begin;

-- ── The table ────────────────────────────────────────────────────────────────
create table if not exists public.oracle_recommendations (
  id          bigserial   primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- set null, not cascade: the call log may be pruned (it is a receipt with a
  -- one-year retention) long before the recommendation history stops being
  -- interesting. Losing the link must not delete the observation.
  call_id     bigint      references public.oracle_call_log(id) on delete set null,
  surface     text        not null,
  position    smallint,
  book_title  text        not null,
  book_author text,
  book_id     uuid        references public.books(id) on delete set null,
  outcome     text        check (outcome in ('accepted', 'dismissed')),
  outcome_at  timestamptz,
  shown_at    timestamptz not null default now()
);

comment on table public.oracle_recommendations is
  'One row per book the Oracle surfaced, written when it is shown — not when '
  'it is accepted. Recording only accepts would hide every rejected '
  'recommendation and make the Oracle look better than it is. See '
  'docs/oracle-provenance-v1-spec.md.';

comment on column public.oracle_recommendations.position is
  'Rank within the result set, 1-based. If readers consistently take the third '
  'suggestion the ranking is wrong even when the picks are good — a different '
  'fix from "recommend better books", and invisible without this.';

comment on column public.oracle_recommendations.outcome is
  'NULL = still just an impression. Dismissal is INFERRED at read time from '
  'age (see the metrics queries) rather than written by a background job, '
  'because it only ever matters in aggregate.';

comment on column public.oracle_recommendations.book_title is
  'Snapshot, not a link. Most recommendations have no public.books row when '
  'shown — see the header note on why book_id alone would bias the data.';

create index if not exists oracle_recommendations_user_shown_idx
  on public.oracle_recommendations(user_id, shown_at desc);

create index if not exists oracle_recommendations_outcome_idx
  on public.oracle_recommendations(user_id, outcome)
  where outcome is not null;

-- Supports the accept path: "most recent unresolved row for this title".
create index if not exists oracle_recommendations_resolve_idx
  on public.oracle_recommendations(user_id, lower(book_title), shown_at desc)
  where outcome is null;

alter table public.oracle_recommendations enable row level security;

-- Owner-read only. No insert/update/delete policy: writes come from the
-- SECURITY DEFINER functions below. A reader may see what the Oracle offered
-- them; they may not edit the record of it.
drop policy if exists "oracle_recommendations_select_own" on public.oracle_recommendations;
create policy "oracle_recommendations_select_own"
  on public.oracle_recommendations for select
  using (auth.uid() = user_id);

-- ── log_oracle_recommendations ───────────────────────────────────────────────
-- The whole result set in ONE call. A five-book recommendation is one round
-- trip and one transaction — logging five separate rows from the client would
-- put five requests between the reader and results they already paid for.
--
-- Takes jsonb rather than parallel arrays so the client passes the same shape
-- it already renders.
--
-- p_surface is allowlisted here as well as client-side. It feeds the
-- per-surface accept-rate breakdown, and a typo'd surface silently splits a
-- metric in two rather than failing loudly.
create or replace function public.log_oracle_recommendations(
  p_surface text,
  p_books   jsonb,
  p_call_id bigint default null
)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ── resolve_oracle_recommendation ────────────────────────────────────────────
-- Called when a recommendation is accepted. Takes the id the client was handed
-- at log time; falls back to title matching when the client has lost it (a
-- reload between seeing a recommendation and adding it, which is common).
--
-- Idempotent: re-accepting an already-resolved row is a no-op, so an add that
-- retries cannot double-count.
create or replace function public.resolve_oracle_recommendation(
  p_recommendation_id bigint default null,
  p_book_title        text   default null,
  p_book_id           uuid   default null,
  p_outcome           text   default 'accepted'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.log_oracle_recommendations(text, jsonb, bigint)          to authenticated;
grant execute on function public.resolve_oracle_recommendation(bigint, text, uuid, text)  to authenticated;

commit;

-- ============================================================
-- Verification
-- ============================================================
-- 1. Logging returns one id per book, in result order:
--   select log_oracle_recommendations('similar',
--     '[{"title":"Piranesi","author":"Susanna Clarke"},
--       {"title":"The Historian","author":"Elizabeth Kostova"}]'::jsonb);
--   -- expect a 2-element array
--
-- 2. They start as impressions:
--   select id, surface, position, book_title, outcome from oracle_recommendations
--   where user_id = auth.uid() order by id desc limit 2;
--   -- expect outcome NULL, position 1 and 2
--
-- 3. Accept resolves exactly one, and is idempotent:
--   select resolve_oracle_recommendation(null, 'Piranesi', null, 'accepted');
--   -- returns an id
--   select resolve_oracle_recommendation(null, 'Piranesi', null, 'accepted');
--   -- returns NULL — already resolved, not double-counted
--
-- 4. A non-Oracle book resolves to nothing rather than erroring:
--   select resolve_oracle_recommendation(null, 'A Book Nobody Suggested');
--   -- expect NULL
--
-- 5. Cross-account isolation (run as an authenticated user, not service_role):
--   select count(*) from oracle_recommendations where user_id <> auth.uid();
--   -- expect 0
--   update oracle_recommendations set outcome = 'accepted' where user_id = auth.uid();
--   -- expect: no policy allows UPDATE
--
-- Metrics queries live in docs/oracle-provenance-v1-spec.md.
-- ============================================================
