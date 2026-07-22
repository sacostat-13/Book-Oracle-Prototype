// src/lib/OracleQuotaContext.jsx
//
// Provides app-wide Oracle quota state.
//
// Quota shape:
//   {
//     subscription_status: 'free'|'active'|'past_due'|'cancelled',
//     period:              'day'|'month'|'unlimited', // 'unlimited' for curators
//     calls_used:          int,
//     calls_limit:         int|null,       // 5 for both tiers, different period; null when unlimited
//     calls_remaining:     int|null,       // null when unlimited
//     reset_at:            Date|null,
//     unlimited:           bool,           // v0.56: true for curators (profiles.is_curator),
//                                          // straight from get_oracle_quota — Pro itself is still 5/day.
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
      // v0.43.1: clamp remaining at 0. After a Pro→Free downgrade calls_used
      // can exceed the free limit mid-period, which makes the raw
      // (limit - used) go negative — every consumer treats remaining as a
      // displayable count, so it must never be below zero.
      // v0.56: curators get unlimited: true from the RPC — calls_limit/
      // calls_remaining come back null and must stay null (not coerced to
      // FREE_LIMIT), so consumers can branch on `unlimited` instead of
      // misreading null as "0 of 5 left".
      // v0.58: is_curator rides along so the UI can say "categorization is
      // unmetered" without a second query. It is NOT the same as `unlimited`:
      // since schema_v37 the curator exemption is scoped to categorization
      // only, so a curator's Spark/Ask/Similar/Plan calls are metered like
      // anyone else's and this RPC (called with no feature) reports their
      // ordinary quota.
      const unlimited = !!data.unlimited;
      setQuota({
        subscription_status: data.subscription_status ?? 'free',
        period:              data.period ?? 'month',
        calls_used:          data.calls_used ?? 0,
        calls_limit:         unlimited ? null : (data.calls_limit ?? FREE_LIMIT),
        calls_remaining:     unlimited ? null : Math.max(0, data.calls_remaining ?? FREE_LIMIT),
        reset_at:            data.reset_at ? new Date(data.reset_at) : null,
        unlimited,
        is_curator:          !!data.is_curator,
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
      // v0.56: unlimited (curator) quota has no remaining count to decrement —
      // just tick calls_used for the (unenforced) cost-visibility number.
      if (prev.unlimited) {
        return { ...prev, calls_used: (prev.calls_used ?? 0) + 1 };
      }
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
