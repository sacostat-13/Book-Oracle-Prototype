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

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

const OracleQuotaContext = createContext(null);

const FREE_LIMIT = 5;

export function OracleQuotaProvider({ children }) {
  const { user } = useAuth();
  // The id, not the object.
  //
  // Everything below keys off the signed-in user's id and nothing else, and
  // AuthContext deliberately preserves the previous `user` REFERENCE when only
  // the token rotates (see the note there) — so depending on `user` would be
  // both wider than needed and, on a token refresh, misleading. Pulling the id
  // out lets the dependency arrays say exactly what they mean instead of
  // carrying `user?.id` while the bodies read `user`, which is what made
  // exhaustive-deps complain here three times over.
  const userId = user?.id ?? null;
  const [quota, setQuota]     = useState(null);
  const [loading, setLoading] = useState(true);

  // v0.58 — the confirmation gate.
  //
  // Two pieces of user feedback, one mechanism: people did not know that
  // "Oracle" means "this spends one of your five", and they did not want to
  // discover they had spent the last one only afterwards. Both are answered by
  // asking BEFORE the call, so the gate is a promise the call site awaits
  // rather than a component each surface has to mount:
  //
  //     if (!(await confirmOracleCall('ask'))) return;
  //
  // One line per surface, and a surface that forgets it degrades to today's
  // behaviour instead of breaking. The dialog itself is rendered once, in App —
  // this provider sits OUTSIDE RouterProvider, and the dialog's upgrade CTA
  // needs the router.
  const [gate, setGate] = useState(null);        // { variant, source } | null
  const gateResolveRef  = useRef(null);
  const [introSeen, setIntroSeen] = useState(true); // assume seen until known:
                                                    // never flash the disclosure
                                                    // at someone who has it.

  const refresh = useCallback(async () => {
    if (!userId) { setQuota(null); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_oracle_quota', { p_user_id: userId });
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
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── One-time disclosure flag (schema_v44) ──────────────────────────────────
  // Its own query rather than a field on get_oracle_quota: that RPC is called
  // on every tab focus and by the Netlify function on every Oracle call, and
  // it has no business carrying UI state.
  useEffect(() => {
    let cancelled = false;
    if (!userId) { setIntroSeen(true); return; }
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('oracle_intro_seen_at')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      // On error, treat it as seen. Failing open here shows a dialog to
      // someone who has already dismissed it; failing closed would suppress a
      // disclosure that exists precisely to prevent an unwitting charge.
      if (error) { setIntroSeen(true); return; }
      setIntroSeen(!!data?.oracle_intro_seen_at);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const markIntroSeen = useCallback(async () => {
    setIntroSeen(true); // optimistic: the user has read it either way
    if (!userId) return;
    const { error } = await supabase
      .from('profiles')
      .update({ oracle_intro_seen_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) console.error('markIntroSeen error:', error);
  }, [userId]);

  // ── The gate ───────────────────────────────────────────────────────────────
  // Resolves true to proceed, false to abort. Deliberately quiet in the cases
  // where a prompt would be noise: unlimited accounts, an already-spent quota
  // (the server 402 and the existing wall handle that far better than a
  // confirm dialog would), and users who have seen the disclosure and have
  // calls to spare.
  const confirmOracleCall = useCallback((source = null) => {
    const remaining = quota?.calls_remaining;
    const needsIntro = !introSeen;
    const isLast     = !quota?.unlimited && remaining === 1;

    if (!needsIntro && !isLast) return Promise.resolve(true);
    if (quota?.unlimited && !needsIntro) return Promise.resolve(true);
    if (!quota?.unlimited && remaining === 0) return Promise.resolve(true);

    return new Promise((resolve) => {
      // A second gate opening while one is pending would strand the first
      // promise forever and leave its caller's spinner running. Let the new
      // one through rather than deadlock a surface.
      if (gateResolveRef.current) { resolve(true); return; }
      gateResolveRef.current = resolve;
      // `intro` wins when both apply and its copy absorbs the last-call
      // warning — two modals in a row to start one Oracle call is a worse
      // answer to "I didn't know this cost anything" than one clear modal.
      setGate({ variant: needsIntro ? 'intro' : 'last', source, isLast });
    });
  }, [quota, introSeen]);

  const resolveGate = useCallback((proceed) => {
    const resolve = gateResolveRef.current;
    gateResolveRef.current = null;
    setGate(null);
    resolve?.(proceed);
  }, []);


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
    <OracleQuotaContext.Provider value={{
      quota, loading, refresh, handleQuotaError, onCallSucceeded,
      gate, confirmOracleCall, resolveGate, introSeen, markIntroSeen,
    }}>
      {children}
    </OracleQuotaContext.Provider>
  );
}

export function useOracleQuota() {
  const ctx = useContext(OracleQuotaContext);
  if (!ctx) throw new Error('useOracleQuota must be used inside <OracleQuotaProvider>');
  return ctx;
}
