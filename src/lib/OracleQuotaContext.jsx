// src/lib/OracleQuotaContext.jsx
//
// Provides app-wide Oracle quota state so every Oracle surface (OracleCategories,
// OracleSimilar, ClubPolls, SessionDiscussion, PlanCreate) can:
//   - Show how many calls remain without each component fetching independently
//   - Receive live updates after each Oracle call succeeds or is quota-blocked
//   - Display a consistent "out of calls" UI without prop drilling
//
// Usage:
//   const { quota, loading, refresh, handleQuotaError } = useOracleQuota();
//
// quota shape:
//   {
//     unlimited: bool,       // true for paid subscribers
//     calls_used: int,       // calls consumed this month
//     calls_limit: int,      // 5 for free tier
//     calls_remaining: int,  // calls_limit - calls_used
//     reset_at: Date|null,   // when the counter resets
//     subscription_status: 'free'|'active'|'past_due'|'cancelled'
//   }

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

const OracleQuotaContext = createContext(null);

const FREE_LIMIT = 5;

export function OracleQuotaProvider({ children }) {
  const { user } = useAuth();
  const [quota, setQuota]   = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setQuota(null); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_oracle_quota', { p_user_id: user.id });
      if (error) { console.error('get_oracle_quota error:', error); setLoading(false); return; }
      setQuota({
        unlimited:           data.unlimited ?? false,
        calls_used:          data.calls_used ?? 0,
        calls_limit:         data.calls_limit ?? FREE_LIMIT,
        calls_remaining:     data.calls_remaining ?? FREE_LIMIT,
        reset_at:            data.reset_at ? new Date(data.reset_at) : null,
        subscription_status: data.subscription_status ?? 'free',
      });
    } catch (e) {
      console.error('OracleQuotaContext refresh error:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Call this in catch blocks where QuotaExceededError is caught.
  // It updates local state immediately from the error data so the UI
  // updates without a round-trip.
  const handleQuotaError = useCallback((err) => {
    if (err?.code !== 'quota_exceeded') return;
    setQuota((prev) => ({
      ...prev,
      unlimited:       false,
      calls_used:      err.callsUsed  ?? FREE_LIMIT,
      calls_limit:     err.callsLimit ?? FREE_LIMIT,
      calls_remaining: 0,
      reset_at:        err.resetAt    ?? null,
    }));
  }, []);

  // After a successful Oracle call, decrement remaining by 1 optimistically.
  // The next refresh() will correct any drift.
  const onCallSucceeded = useCallback(() => {
    setQuota((prev) => {
      if (!prev || prev.unlimited) return prev;
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
