-- search_readers() — finding a person to follow.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A FUNCTION AND NOT A QUERY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The Kindred page shipped searching `profiles.username` with an exact match,
-- which fails in the two most ordinary cases there are:
--
--   * The reader has no username. It is a nullable column and nothing forces
--     one, so an account that only ever set a display name was unfindable by
--     any spelling of their name.
--   * The searcher typed part of it. "mari" does not equal "marisol".
--
-- And email cannot be matched from the client at all: it lives in auth.users,
-- which PostgREST does not expose and should not. So one SECURITY DEFINER
-- function does all three.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT IT DELIBERATELY WILL NOT DO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Email is matched EXACTLY, never as a prefix or a substring. A partial match
-- on email turns this into an address-harvesting endpoint: type "@gmail.com"
-- and read back the account list. Exact-match means you can only confirm an
-- address you already had, which is the actual use case ("my friend gave me
-- their email") and nothing more.
--
-- The email is never RETURNED either — matching on it is allowed, reading it
-- back is not. Two people can share a display name; the searcher confirms the
-- right one from the avatar and username, not by us echoing their address.
--
-- is_discoverable is honoured. A reader who has switched it off is unfindable
-- here by any of the three fields, but their profile still loads by direct URL
-- — "do not surface me in search" and "do not let anyone open my page" are
-- different requests, and this flag is only the first.

create or replace function public.search_readers(q text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  is_curator boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  with needle as (
    select
      -- A leading @ is how people write a handle; it is not part of one.
      lower(trim(both from regexp_replace(coalesce(q, ''), '^@', ''))) as term
  )
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.is_curator
  from public.profiles p
  cross join needle n
  left join auth.users u on u.id = p.id
  where
    length(n.term) >= 2
    and p.is_discoverable
    and p.id is distinct from auth.uid()
    and (
      -- Username: prefix. Handles are typed from the front.
      p.username ilike n.term || '%'
      -- Display name: anywhere, so a surname finds someone.
      or p.display_name ilike '%' || n.term || '%'
      -- Email: exact, and only when the term looks like an address at all.
      or (n.term like '%@%' and lower(u.email) = n.term)
    )
  order by
    -- Exact handle first, then handle prefix, then everything else. Someone
    -- who typed a username in full meant that person.
    (p.username is not null and lower(p.username) = n.term) desc,
    (p.username ilike n.term || '%') desc,
    p.username nulls last,
    p.display_name
  limit 10;
$function$;

comment on function public.search_readers(text) is
  'Reader search for the Kindred page: username prefix, display-name substring, or EXACT email. Definer because email lives in auth.users. Never returns the email — matching on it is allowed, reading it back is not. Honours is_discoverable and excludes the caller.';

revoke all on function public.search_readers(text) from public;
grant execute on function public.search_readers(text) to authenticated;

-- Deliberately NOT granted to anon. Signed-out visitors can open a profile by
-- its URL, but enumerating the user base is not something to offer the open
-- internet.
