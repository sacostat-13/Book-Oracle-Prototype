-- The naming rule, applied: a nation's whole written output is "<Nation>
-- Literature"; a region or culture within or across nations is "<Region> Fiction".
--
-- Before this, the split was accidental: French, Italian, Spanish, Russian,
-- Korean, Mexican and American were Literature; Irish, Scottish, Southern and
-- Chicano & Latinx were Fiction. Nothing distinguished the two groups except
-- the order they were created in.
--
-- A rename is not just an UPDATE on name. normalized_name is the unique key the
-- genre picker and resolveGenreId() match on, and books.genre is a scalar
-- holding the DISPLAY name — leaving that pointing at a name nothing answers to
-- is the same class of orphan merge_genres() exists to prevent.

create or replace function public.rename_genre(_normalized_from text, _new_name text)
returns int language plpgsql as $$
declare _old_name text; _new_norm text; _scalar int;
begin
  select name into _old_name from genres where normalized_name = _normalized_from;
  if _old_name is null then return 0; end if;          -- already renamed; no-op

  _new_norm := normalize_genre_name(_new_name);
  if exists (select 1 from genres where normalized_name = _new_norm) then
    raise exception 'rename_genre: % already exists', _new_name;
  end if;

  update genres set name = _new_name, normalized_name = _new_norm
   where normalized_name = _normalized_from;

  with r as (update books set genre = _new_name where genre = _old_name returning 1)
  select count(*)::int into _scalar from r;

  raise notice 'renamed % -> % (% scalar rows)', _old_name, _new_name, _scalar;
  return _scalar;
end $$;

revoke all on function public.rename_genre(text, text) from public, anon, authenticated;

-- Nations. Both were "Fiction" only because that is how they were first typed.
select rename_genre('irishfiction',    'Irish Literature');
select rename_genre('scottishfiction', 'Scottish Literature');

-- And the rule turning on something written yesterday: Latin America is not a
-- nation. It is a supranational region, the same shape as International Fiction
-- and East Asian Literary Fiction, both of which already say Fiction. Mexican
-- Literature stays Literature and stays parented under it — which is exactly the
-- relationship the rule is meant to make legible.
select rename_genre('latinamericanliterature', 'Latin American Fiction');

-- The same redundancy, on the horror shelf. Japan is in East Asia, so the name
-- says its own category twice — the identical fault we merged away on the
-- literary side (Japanese & East Asian Literary Fiction into East Asian Literary
-- Fiction). Here there is nothing to merge, only a name to stop repeating
-- itself. No book moves; the ampersands that carry voice stay untouched.
select rename_genre('japaneseeastasianhorror', 'East Asian Horror');

-- Unchanged and correct under the rule, recorded so nobody "fixes" them later:
--   American Literature, French Literature, Italian Literature, Spanish
--   Literature, Russian Literature, Korean Literature, Mexican Literature
--     — nations.
--   Southern Fiction, Chicano & Latinx Fiction — cultures within a nation.
--   International Fiction, East Asian Literary Fiction — supranational regions.

-- ── Two parents the taxonomy is missing ───────────────────────────────────────
-- Epic Poetry is a kind of Poetry; Tragedy is a kind of Drama. Both were left
-- top-level only because they were created before their parents were.
update genres c set parent_id = p.id
  from genres p
 where c.parent_id is null
   and (c.normalized_name, p.normalized_name) in (
     ('epicpoetry', 'poetry'),
     ('tragedy',    'drama')
   );

-- Verification:
-- select name from genres where name like '% Literature' order by name;
-- select name from genres where name like '% Fiction'    order by name;
