// src/lib/useFriends.js — v0.36
// Hook for all friend-related actions and state.
// Keeps friendship logic out of the monolithic DataContext.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  supabase
} from './supabase';

export const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

// ── Username helpers ──────────────────────────────────────────────────────────

export function validateUsername(raw) {
  const u = raw.toLowerCase().trim();
  if (u.length < 3)  return 'too_short';
  if (u.length > 24) return 'too_long';
  if (!USERNAME_RE.test(u)) return 'invalid_chars';
  return 'ok';
}

// Debounced availability check — returns 'available' | 'taken' | 'invalid' | 'error'
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

// ── useFriends hook ───────────────────────────────────────────────────────────

export function useFriends() {
  const { user } = useAuth();
  const [friends,  setFriends]  = useState([]);   // accepted friends with profile data
  const [pending,  setPending]  = useState([]);   // outgoing pending requests
  const [incoming, setIncoming] = useState([]);   // incoming pending requests (for display only — notifications handle actions)
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // All friendship rows involving this user
      const { data: rows } = await supabase
        .from('friendships')
        .select(`
          id, status, requester, addressee, created_at,
          requester_profile:profiles!requester(id, username, display_name, avatar_url),
          addressee_profile:profiles!addressee(id, username, display_name, avatar_url)
        `)
        .or(`requester.eq.${user.id},addressee.eq.${user.id}`)
        .order('created_at', { ascending: false });

      const accepted  = [];
      const outgoing  = [];
      const recv      = [];

      for (const row of rows || []) {
        const iAmRequester = row.requester === user.id;
        const other = iAmRequester ? row.addressee_profile : row.requester_profile;
        const entry = { id: row.id, status: row.status, createdAt: row.created_at, other };

        if (row.status === 'accepted')                   accepted.push(entry);
        else if (row.status === 'pending' && iAmRequester)  outgoing.push(entry);
        else if (row.status === 'pending' && !iAmRequester) recv.push(entry);
      }

      setFriends(accepted);
      setPending(outgoing);
      setIncoming(recv);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  // Send a friend request to a user by their Supabase user ID
  const sendRequest = useCallback(async (addresseeId) => {
    if (!user) return { error: 'not_authed' };
    if (addresseeId === user.id) return { error: 'self' };

    // Check for existing row in either direction
    const { data: existing } = await supabase
      .from('friendships')
      .select('id, status')
      .or(
        `and(requester.eq.${user.id},addressee.eq.${addresseeId}),` +
        `and(requester.eq.${addresseeId},addressee.eq.${user.id})`
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') return { error: 'already_friends' };
      if (existing.status === 'pending')  return { error: 'already_pending' };
      if (existing.status === 'blocked')  return { error: 'blocked' };
    }

    const { error } = await supabase
      .from('friendships')
      .insert({ requester: user.id, addressee: addresseeId, status: 'pending' });

    if (error) return { error: error.message };
    await load();
    return { ok: true };
  }, [user, load]);

  // Accept an incoming friend request by friendship ID
  const acceptRequest = useCallback(async (friendshipId) => {
    if (!user) return;
    await supabase
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', friendshipId)
      .eq('addressee', user.id);   // only the addressee can accept
    await load();
  }, [user, load]);

  // Decline or cancel — just delete the row
  const declineRequest = useCallback(async (friendshipId) => {
    if (!user) return;
    await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .or(`requester.eq.${user.id},addressee.eq.${user.id}`);
    await load();
  }, [user, load]);

  // Remove an accepted friend
  const removeFriend = useCallback(async (friendshipId) => {
    if (!user) return;
    await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .or(`requester.eq.${user.id},addressee.eq.${user.id}`);
    await load();
  }, [user, load]);

  return {
    friends, pending, incoming, loading,
    sendRequest, acceptRequest, declineRequest, removeFriend,
    reload: load,
  };
}

// ── Look up a public profile by username ──────────────────────────────────────

export async function getProfileByUsername(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, is_discoverable, preferences')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// Fetch public library for a friend.
// RLS on read_books allows this for accepted friends (schema_v20).
// Matches the same join shape DataContext uses for the current user's library.
export async function getFriendLibrary(userId) {
  const { data } = await supabase
    .from('read_books')
    .select('id, rating, notes, read_at, source, book:books(*, position_in_series, series:series(*))')
    .eq('user_id', userId)
    .order('read_at', { ascending: false, nullsFirst: false });

  if (!data) return [];

  // Filter out rows where the book join is null (orphaned read_books rows)
  // then attach genre data in a second query matching what DataContext does.
  const validRows = data.filter((r) => r.book);
  if (validRows.length === 0) return validRows;

  // Fetch genres for all these books in one query
  const bookIds = [...new Set(validRows.map((r) => r.book.id).filter(Boolean))];
  let genresByBookId = {};
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

  // Attach genres to each row so normalizeBook can access them
  return validRows.map((r) => ({
    ...r,
    _genres: genresByBookId[r.book?.id] || [],
  }));
}

// Fetch currently_reading for a friend
export async function getFriendCurrentlyReading(userId) {
  const { data } = await supabase
    .from('currently_reading')
    .select('*, book:books(*)')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });
  return data || [];
}

// ── Friends feed ──────────────────────────────────────────────────────────────
// Fetches recent reading activity across all accepted friends.
// Returns events sorted newest-first, respecting friend privacy prefs.

export async function getFriendsFeedEvents(userId, limit = 40) {
  // Get accepted friend IDs via the friend_pairs view
  const { data: pairs } = await supabase
    .from('friend_pairs')
    .select('user_b')
    .eq('user_a', userId);

  if (!pairs || pairs.length === 0) return [];

  const friendIds = pairs.map((p) => p.user_b);

  // Fetch friend profiles for display name / avatar / privacy prefs
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, preferences')
    .in('id', friendIds);

  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  // Friends whose library is visible (default true unless explicitly opted out)
  const visibleIds = friendIds.filter((id) => {
    const prefs = profileMap[id]?.preferences || {};
    return prefs.friendsCanSeeLibrary !== false;
  });

  const events = [];
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days

  // Finished books — only from friends who allow library visibility
  if (visibleIds.length > 0) {
    const { data: readRows } = await supabase
      .from('read_books')
      .select('user_id, read_at, rating, book:books(title, author, cover_url)')
      .in('user_id', visibleIds)
      .gte('read_at', cutoff)
      .order('read_at', { ascending: false })
      .limit(limit);

    for (const row of readRows || []) {
      events.push({
        type: 'finished',
        date: row.read_at,
        friend: profileMap[row.user_id],
        book: { t: row.book?.title, a: row.book?.author, coverUrl: row.book?.cover_url, rating: row.rating },
        key: `fin-${row.user_id}-${row.read_at}`,
      });
    }
  }

  // Currently reading (started events) — visible to all friends
  const { data: crRows } = await supabase
    .from('currently_reading')
    .select('user_id, started_at, book:books(title, author, cover_url)')
    .in('user_id', friendIds)
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(limit);

  for (const row of crRows || []) {
    events.push({
      type: 'started',
      date: row.started_at,
      friend: profileMap[row.user_id],
      book: { t: row.book?.title, a: row.book?.author, coverUrl: row.book?.cover_url },
      key: `cr-${row.user_id}-${row.started_at}`,
    });
  }

  // Sort all events newest-first and cap at limit
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events.slice(0, limit);
}
