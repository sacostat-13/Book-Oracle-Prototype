// src/lib/OracleQuotaContext.jsx
//
// Provides app-wide Oracle quota state.
//
// Quota shape:
//   {
//     subscription_status: 'free'|'active'|'past_due'|'cancelled',
//     period:              'day'|'month',   // 'day' for Pro, 'month' for Free
//     calls_used:          int,
//     calls_limit:         int,             // 5 for both tiers, different period
//     calls_remaining:     int,
//     reset_at:            Date|null,
//     unlimited:           false,           // always false now — Pro is 5/day not unlimited
//   }

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

const OracleQuotaContext = createContext(null);

const FREE_LIMIT = 5;

export function OracleQuotaProvider({ children }) {
  const { user } = useAuth();
  const [quota, setQuota]     = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setQuota(null); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_oracle_quota', { p_user_id: user.id });
      if (error) { console.error('get_oracle_quota error:', error); setLoading(false); return; }
      setQuota({
        subscription_status: data.subscription_status ?? 'free',
        period:              data.period ?? 'month',
        calls_used:          data.calls_used ?? 0,
        calls_limit:         data.calls_limit ?? FREE_LIMIT,
        calls_remaining:     data.calls_remaining ?? FREE_LIMIT,
        reset_at:            data.reset_at ? new Date(data.reset_at) : null,
        unlimited:           false,
      });
    } catch (e) {
      console.error('OracleQuotaContext refresh error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-fetch when tab becomes visible — catches DB changes and webhook updates
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const handleQuotaError = useCallback((err) => {
    if (err?.code !== 'quota_exceeded') return;
    setQuota((prev) => ({
      ...prev,
      calls_used:      err.callsUsed  ?? FREE_LIMIT,
      calls_limit:     err.callsLimit ?? FREE_LIMIT,
      calls_remaining: 0,
      reset_at:        err.resetAt    ?? null,
    }));
  }, []);

  const onCallSucceeded = useCallback(() => {
    setQuota((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        calls_used:      (prev.calls_used ?? 0) + 1,
        calls_remaining: Math.max(0, (prev.calls_remaining ?? 1) - 1),
      };
    });
  }, []);

  return (
    <OracleQuotaContext.Provider value={{ quota, loading, refresh, handleQuotaError, onCallSucceeded }}>
      {children}
    </OracleQuotaContext.Provider>
  );
}

export function useOracleQuota() {
  const ctx = useContext(OracleQuotaContext);
  if (!ctx) throw new Error('useOracleQuota must be used inside <OracleQuotaProvider>');
  return ctx;
}
