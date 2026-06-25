// src/lib/useNotifications.js — v0.36
// Realtime notifications hook. Feeds the bell icon in Nav.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  supabase
} from './supabase';

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select(`
        id, type, read, created_at, data,
        actor:profiles!actor_id(id, username, display_name, avatar_url)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setLoading(false);
    const rows = data || [];
    setNotifications(rows);
    setUnreadCount(rows.filter((n) => !n.read).length);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;

    // Realtime: new notifications appear instantly without a refresh
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          // Fetch the full row with actor join so we have the username
          const { data } = await supabase
            .from('notifications')
            .select(`
              id, type, read, created_at, data,
              actor:profiles!actor_id(id, username, display_name, avatar_url)
            `)
            .eq('id', payload.new.id)
            .maybeSingle();
          if (data) {
            setNotifications((prev) => [data, ...prev]);
            setUnreadCount((c) => c + 1);
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user, load]);

  const markAllRead = useCallback(async () => {
    if (!user || unreadCount === 0) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
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
