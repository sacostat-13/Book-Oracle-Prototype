// src/lib/useFollows.js — v0.66
//
// Follows replace friendships. One asymmetric relationship: I follow you, you
// may follow me back, and a pair of rows pointing at each other is what used to
// be a friendship — derived here, never stored.
//
// ── Vocabulary ───────────────────────────────────────────────────────────────
// The code says follow/follower/following, because a button that says anything
// else is a button nobody presses with confidence. The INTERFACE says Kindred:
// "Your Kindred" is who you follow, and a mutual follow is a "Kinship". Copy
// lives in i18n under `kindred.*`; this file stays plain on purpose, so that
// renaming the room never means renaming the plumbing.
//
// ── What replaced the consent boundary ───────────────────────────────────────
// A friendship used to be the permission: read_books' RLS said "mine, or an
// accepted friend's". A follow is not a permission — anyone can follow anyone —
// so the permission moved to profiles.shelf_visibility, enforced server-side by
// public.can_view_shelf().
//
// That matters for how this file is written: NOTHING here filters for privacy.
// The old getFriendsFeedEvents read `preferences.friendsCanSeeLibrary` in JS and
// dropped rows client-side, which meant the privacy setting was only as good as
// the client asking nicely. Now the rows never arrive. If you find yourself
// adding a visibility check in this file, the policy is wrong — fix it there.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabase';

export const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

const PROFILE_COLS =
  'id, username, display_name, avatar_url, bio, favorite_genres, is_curator, shelf_visibility';

// ── Username helpers (unchanged from useFriends) ─────────────────────────────

export function validateUsername(raw) {
  const u = raw.toLowerCase().trim();
  if (u.length < 3) return 'too_short';
  if (u.length > 24) return 'too_long';
  if (!USERNAME_RE.test(u)) return 'invalid_chars';
  return 'ok';
}

export async function checkUsernameAvailability(username, currentUserId) {
  const u = username.toLowerCase().trim();
  if (validateUsername(u) !== 'ok') return 'invalid';
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', u)
    .neq('id', currentUserId)
    .maybeSingle();
  if (error) return 'error';
  return data ? 'taken' : 'available';
}

// ── The hook ─────────────────────────────────────────────────────────────────

export function useFollows() {
  const { user } = useAuth();
  const [following, setFollowing] = useState([]); // people I follow
  const [followers, setFollowers] = useState([]); // people who follow me
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setFollowing([]);
      setFollowers([]);
      return;
    }
    setLoading(true);
    try {
      // Both directions in one round trip. The RLS policy already scopes this
      // to rows I am part of, but the filter is explicit anyway — a query that
      // relies on a policy to be CORRECT rather than to be SAFE is a query that
      // breaks silently the day the policy widens.
      const { data: rows } = await supabase
        .from('user_follows')
        .select('follower_id, followee_id, muted, created_at')
        .or(`follower_id.eq.${user.id},followee_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (!rows || rows.length === 0) {
        setFollowing([]);
        setFollowers([]);
        return;
      }

      // Profiles fetched separately rather than joined. user_follows has two FKs
      // into auth.users, and PostgREST resolves an ambiguous embed by silently
      // dropping rows rather than erroring — the same trap the old useFriends
      // hit and documented.
      const otherIds = [...new Set(rows.flatMap((r) =>
        [r.follower_id, r.followee_id].filter((id) => id !== user.id)
      ))];

      let profileMap = {};
      if (otherIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select(PROFILE_COLS)
          .in('id', otherIds);
        profileMap = Object.fromEntries((profileRows || []).map((p) => [p.id, p]));
      }

      const outbound = rows.filter((r) => r.follower_id === user.id);
      const inbound = rows.filter((r) => r.followee_id === user.id);
      const followerIds = new Set(inbound.map((r) => r.follower_id));
      const followeeIds = new Set(outbound.map((r) => r.followee_id));

      setFollowing(outbound.map((r) => ({
        profile: profileMap[r.followee_id] || null,
        userId: r.followee_id,
        muted: r.muted,
        since: r.created_at,
        // A Kinship: we follow each other. Derived, so it can never disagree
        // with the rows the way a stored `status` column could.
        mutual: followerIds.has(r.followee_id),
      })));

      setFollowers(inbound.map((r) => ({
        profile: profileMap[r.follower_id] || null,
        userId: r.follower_id,
        since: r.created_at,
        mutual: followeeIds.has(r.follower_id),
        // Drives the "follow back" affordance.
        followedBack: followeeIds.has(r.follower_id),
      })));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Refresh when the tab comes back, or when another instance of this hook
  // changes something (the profile page and the nav can both be mounted).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('follows-changed', load);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('follows-changed', load);
    };
  }, [load]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const follow = useCallback(async (followeeId) => {
    if (!user) return { error: 'not_authed' };
    if (followeeId === user.id) return { error: 'self' };

    // Optimistic: a follow is one row and reversible, so the button should
    // settle immediately rather than waiting on a round trip.
    setFollowing((prev) =>
      prev.some((f) => f.userId === followeeId)
        ? prev
        : [{ profile: null, userId: followeeId, muted: false, since: new Date().toISOString(), mutual: false }, ...prev]
    );

    const { error } = await supabase
      .from('user_follows')
      .insert({ follower_id: user.id, followee_id: followeeId });

    // 23505 is unique_violation — already following. Not an error worth showing
    // anyone: the intent ("I want to be following this person") is satisfied.
    if (error && error.code !== '23505') {
      console.error('follow failed', error);
      setFollowing((prev) => prev.filter((f) => f.userId !== followeeId));
      return { error: error.message };
    }
    window.dispatchEvent(new Event('follows-changed'));
    return { ok: true };
  }, [user]);

  const unfollow = useCallback(async (followeeId) => {
    if (!user) return { error: 'not_authed' };
    const previous = following;
    setFollowing((prev) => prev.filter((f) => f.userId !== followeeId));

    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('followee_id', followeeId);

    if (error) {
      console.error('unfollow failed', error);
      setFollowing(previous);
      return { error: error.message };
    }
    window.dispatchEvent(new Event('follows-changed'));
    return { ok: true };
  }, [user, following]);

  // Mute is NOT unfollow. It keeps the relationship and drops the updates —
  // the honest control for "I like this person, I do not need forty notes about
  // the series they are three books into". Unfollowing to achieve that is what
  // people do when a product does not offer this.
  const setMuted = useCallback(async (followeeId, muted) => {
    if (!user) return { error: 'not_authed' };
    setFollowing((prev) =>
      prev.map((f) => (f.userId === followeeId ? { ...f, muted } : f))
    );
    const { error } = await supabase
      .from('user_follows')
      .update({ muted })
      .eq('follower_id', user.id)
      .eq('followee_id', followeeId);
    if (error) {
      console.error('mute toggle failed', error);
      setFollowing((prev) =>
        prev.map((f) => (f.userId === followeeId ? { ...f, muted: !muted } : f))
      );
      return { error: error.message };
    }
    window.dispatchEvent(new Event('follows-changed'));
    return { ok: true };
  }, [user]);

  const isFollowing = useCallback(
    (userId) => following.some((f) => f.userId === userId),
    [following]
  );

  return {
    following,
    followers,
    // Kinships: everyone we follow who follows us back.
    mutuals: following.filter((f) => f.mutual),
    loading,
    follow,
    unfollow,
    setMuted,
    isFollowing,
    reload: load,
  };
}

// ── Finding readers ──────────────────────────────────────────────────────────
//
// Goes through the search_readers RPC rather than querying profiles directly.
// The client CANNOT do this query: email lives in auth.users, which PostgREST
// does not expose. It also gets the two matching rules right, which the first
// version of the Kindred page did not — it matched `username` exactly, so a
// reader who never set a username was unfindable by any spelling of their name,
// and "mari" never found "marisol".
//
// Returns [] for a term under two characters rather than every profile in the
// database.
export async function searchReaders(query) {
  const q = String(query || '').trim();
  if (q.replace(/^@/, '').length < 2) return [];
  const { data, error } = await supabase.rpc('search_readers', { q });
  if (error) {
    console.error('search_readers failed', error);
    return [];
  }
  return data || [];
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export async function getProfileByUsername(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select(`${PROFILE_COLS}, is_discoverable, preferences`)
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// Follower and following counts for a profile page.
//
// head:true + count:'exact' — the numbers without the rows. Note these respect
// the same RLS as everything else, so on someone else's profile they report
// what THIS viewer may see, which for user_follows is only rows they are part
// of. If a public follower count is wanted later it needs a SECURITY DEFINER
// function; it is not a query change.
export async function getFollowCounts(userId) {
  const [followers, following] = await Promise.all([
    supabase.from('user_follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', userId),
    supabase.from('user_follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return {
    followers: followers.count ?? 0,
    following: following.count ?? 0,
  };
}

// ── Someone else's shelves ───────────────────────────────────────────────────
//
// Returns [] when shelf_visibility does not permit it — RLS filters the rows
// away, so an empty result means "not shared with you" exactly as it means
// "nothing here". The caller distinguishes the two from the profile's
// shelf_visibility, not from the length of this array.

export async function getReaderLibrary(userId) {
  const { data } = await supabase
    .from('read_books')
    .select('id, rating, notes, read_at, source, book:books(*, position_in_series, series:series(*))')
    .eq('user_id', userId)
    .order('read_at', { ascending: false, nullsFirst: false });

  if (!data) return [];

  const validRows = data.filter((r) => r.book);
  if (validRows.length === 0) return validRows;

  const bookIds = [...new Set(validRows.map((r) => r.book.id).filter(Boolean))];
  const genresByBookId = {};
  if (bookIds.length > 0) {
    const { data: genreRows } = await supabase
      .from('book_genres')
      .select('book_id, genre:genres(id, name, normalized_name)')
      .in('book_id', bookIds);
    for (const row of genreRows || []) {
      if (!row.genre) continue;
      if (!genresByBookId[row.book_id]) genresByBookId[row.book_id] = [];
      genresByBookId[row.book_id].push(row.genre);
    }
  }

  return validRows.map((r) => ({
    ...r,
    _genres: genresByBookId[r.book?.id] || [],
  }));
}

export async function getReaderCurrentlyReading(userId) {
  const { data } = await supabase
    .from('currently_reading')
    .select('*, book:books(*)')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });
  return data || [];
}

// Lists by this reader that the current viewer may see.
//
// No visibility filter here either: the lists policies grant public lists to
// everyone, followers-only lists to followers, and everything to the owner. The
// `visibility` column comes back so the UI can label a followers-only list as
// such — a reader looking at their own profile should be able to tell what a
// visitor would and would not find.
export async function getVisibleListsFor(userId) {
  const { data } = await supabase
    .from('lists')
    .select('id, title, description, slug, visibility, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  return data || [];
}

// ── The feed ─────────────────────────────────────────────────────────────────
//
// scope: 'follows' | 'mutuals' | 'both'  (reader's choice, stored in preferences)
//
//   follows — everyone I follow. The most useful setting once curators exist,
//             and the noisiest.
//   mutuals — only Kinships. Closest to the old friends feed, and the quietest.
//   both    — identical to 'follows', since mutuals are a subset. Kept as a
//             distinct value because it is a distinct INTENT, and because if
//             the two ever diverge (weighting, grouping) the stored preference
//             should not need migrating.
//
// Muted follows are excluded from every scope. That is the difference between a
// mute and an unfollow: the relationship survives, the noise does not.

export async function getFollowingFeedEvents(userId, { limit = 40, scope = 'both' } = {}) {
  const { data: rows } = await supabase
    .from('user_follows')
    .select('follower_id, followee_id, muted')
    .or(`follower_id.eq.${userId},followee_id.eq.${userId}`);

  if (!rows || rows.length === 0) return [];

  const iFollow = rows.filter((r) => r.follower_id === userId && !r.muted);
  const followsMe = new Set(
    rows.filter((r) => r.followee_id === userId).map((r) => r.follower_id)
  );

  const ids = (scope === 'mutuals'
    ? iFollow.filter((r) => followsMe.has(r.followee_id))
    : iFollow
  ).map((r) => r.followee_id);

  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .in('id', ids);
  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  const events = [];
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // No visibility filtering below. Readers whose shelf_visibility excludes this
  // viewer contribute no rows, because can_view_shelf() already said no.
  const [readRes, crRes] = await Promise.all([
    supabase
      .from('read_books')
      .select('user_id, read_at, rating, book:books(title, author, cover_url)')
      .in('user_id', ids)
      .gte('read_at', cutoff)
      .order('read_at', { ascending: false })
      .limit(limit),
    supabase
      .from('currently_reading')
      .select('user_id, started_at, book:books(title, author, cover_url)')
      .in('user_id', ids)
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(limit),
  ]);

  for (const row of readRes.data || []) {
    events.push({
      type: 'finished',
      date: row.read_at,
      reader: profileMap[row.user_id],
      book: {
        t: row.book?.title,
        a: row.book?.author,
        coverUrl: row.book?.cover_url,
        rating: row.rating,
      },
      key: `fin-${row.user_id}-${row.read_at}`,
    });
  }

  for (const row of crRes.data || []) {
    events.push({
      type: 'started',
      date: row.started_at,
      reader: profileMap[row.user_id],
      book: {
        t: row.book?.title,
        a: row.book?.author,
        coverUrl: row.book?.cover_url,
      },
      key: `cr-${row.user_id}-${row.started_at}`,
    });
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, limit);
}

// ── Curator requests ─────────────────────────────────────────────────────────
//
// is_curator stays a GRANTED flag — it gates the Vault and the exempt Oracle
// quota. This is the ask, not the grant. There is deliberately no client path
// to approval: the RLS policies permit insert and select of your own row and
// nothing else, so a reader cannot set their own status even by crafting the
// request. Granting is a service_role action.

export async function requestCurator(message) {
  const { data: session } = await supabase.auth.getUser();
  const uid = session?.user?.id;
  if (!uid) return { error: 'not_authed' };

  const { error } = await supabase
    .from('curator_requests')
    .insert({ user_id: uid, message: message?.trim() || null });

  // 23505 here is the partial unique index on (user_id) where status='pending':
  // there is already an open request. Same reasoning as the follow insert —
  // the reader's intent is satisfied, so this is not a failure to report.
  if (error && error.code !== '23505') {
    console.error('curator request failed', error);
    return { error: error.message };
  }
  return { ok: true };
}

export async function getMyCuratorRequest() {
  const { data } = await supabase
    .from('curator_requests')
    .select('id, status, message, created_at, reviewed_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}
