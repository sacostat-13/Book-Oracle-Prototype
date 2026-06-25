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

// Fetch public library for a friend (read_books RLS allows this for accepted friends)
export async function getFriendLibrary(userId) {
  const { data } = await supabase
    .from('read_books')
    .select('*, book:books(*)')
    .eq('user_id', userId)
    .order('read_at', { ascending: false });
  return data || [];
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
