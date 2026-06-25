// src/lib/useNotifications.js — v0.37
// Realtime notifications hook. Feeds the bell icon in Nav.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabase';

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // Fetch notifications without the actor join first — the join was causing
    // PostgREST to silently drop rows due to FK ambiguity (notifications has
    // both user_id and actor_id pointing toward auth.users/profiles).
    const { data: rows, error } = await supabase
      .from('notifications')
      .select('id, type, read, created_at, data, actor_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) console.error('useNotifications load error:', error);

    if (!rows || rows.length === 0) {
      setLoading(false);
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    // Fetch actor profiles for rows that have an actor_id
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
    let actorMap = {};
    if (actorIds.length > 0) {
      const { data: actors } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', actorIds);
      if (actors) {
        actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      actor: r.actor_id ? (actorMap[r.actor_id] || null) : null,
    }));

    setLoading(false);
    setNotifications(enriched);
    setUnreadCount(enriched.filter((n) => !n.read).length);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, async (payload) => {
        const { data: row } = await supabase
          .from('notifications')
          .select('id, type, read, created_at, data, actor_id')
          .eq('id', payload.new.id)
          .maybeSingle();
        if (row) {
          let actor = null;
          if (row.actor_id) {
            const { data: actorData } = await supabase
              .from('profiles')
              .select('id, username, display_name, avatar_url')
              .eq('id', row.actor_id)
              .maybeSingle();
            actor = actorData || null;
          }
          const enriched = { ...row, actor };
          setNotifications((prev) => [enriched, ...prev]);
          setUnreadCount((c) => c + 1);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user, load]);

  const markAllRead = useCallback(async () => {
    if (!user || unreadCount === 0) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [user, unreadCount]);

  const markOneRead = useCallback(async (id) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  return { notifications, unreadCount, loading, markAllRead, markOneRead, reload: load };
}

// ── Notification label helpers ────────────────────────────────────────────────
// Used by Nav bell panel to render human-readable text for each type.

export function notificationLabel(n, t) {
  const actor = n.actor?.display_name || (n.actor?.username ? `@${n.actor.username}` : t('notifications.someone'));
  const data  = n.data || {};

  switch (n.type) {
    case 'friend_request':
      return t('notifications.friendRequest', { actor });
    case 'friend_accepted':
      return t('notifications.friendAccepted', { actor });
    case 'club_invite':
      return t('notifications.clubInvite', { actor, club: data.club_name || '' });
    case 'poll_started':
      return t('notifications.pollStarted', { club: data.club_name || '', question: data.question || '' });
    case 'poll_finalized':
      return t('notifications.pollFinalized', { club: data.club_name || '', winner: data.winner || '' });
    case 'discussion_question':
      return t('notifications.discussionQuestion', { actor, club: data.club_name || '' });
    case 'discussion_reply':
      return t('notifications.discussionReply', { actor, question: data.question || '' });
    case 'announcement':
      return data.title || t('notifications.announcement');
    default:
      return t('notifications.generic');
  }
}

export function notificationRoute(n) {
  const data = n.data || {};
  switch (n.type) {
    case 'friend_request':
    case 'friend_accepted':
      return n.actor?.username ? ['profile', {}] : ['profile', {}];
    case 'club_invite':
    case 'poll_started':
    case 'poll_finalized':
    case 'discussion_question':
    case 'discussion_reply':
      return data.session_id
        ? ['session-detail', { sessionId: data.session_id }]
        : data.club_id
        ? ['book-club-detail', { clubId: data.club_id }]
        : ['book-clubs', {}];
    case 'announcement':
      return ['about', {}];
    default:
      return null;
  }
}
