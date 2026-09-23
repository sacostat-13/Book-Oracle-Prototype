// src/lib/proGates.js — v0.72
//
// What Free can create, in one place. Spec: docs/pro-tier-v1-spec.md §5.
//
// The server is the authority: BEFORE INSERT triggers in
// 20260924120000_pro_gates.sql refuse the row past these numbers, and
// claude.js refuses club Oracle calls from Free. This hook exists so the UI
// can say so BEFORE the reader fills in a form, instead of after.
//
// Keep FREE_LIMITS in step with public.pro_free_limit() in that migration.
//
// Nothing here ever hides or removes something a reader already has. Limits
// are on creating the next one; a downgraded reader keeps all of theirs.

import { useCallback } from 'react';
import { useData } from './DataContext';
import { useAuth } from './AuthContext';
import { useOracleQuota } from './OracleQuotaContext';
import { useRouter } from './RouterContext';

export const FREE_LIMITS = {
  clubs: 1,   // clubs you created (joining is unlimited)
  lists: 3,   // Anthologies — every one of them shareable
  plans: 1,   // Passages
};

export function useProLimits() {
  const { state } = useData();
  const { user } = useAuth();
  const { quota } = useOracleQuota();
  const { go } = useRouter();

  // Curators are Pro for gating purposes, matching public.is_pro().
  const isPro = quota?.subscription_status === 'active' || !!quota?.is_curator;

  const owned = {
    clubs: (state.clubs || []).filter((c) => c.createdBy && c.createdBy === user?.id).length,
    lists: (state.lists || []).length,
    plans: (state.plans || []).length,
  };

  // Unknown quota (still loading) is treated as allowed: the server will
  // refuse if it must, and a gate that flashes at a Pro reader on page load is
  // worse than one that arrives a moment late for a free one.
  const canCreate = (kind) => isPro || !quota || owned[kind] < FREE_LIMITS[kind];

  const goUpgrade = useCallback(() => go('profile', { scrollTo: 'subscription' }), [go]);

  return { isPro, owned, canCreate, limits: FREE_LIMITS, goUpgrade };
}

/** True when a Supabase error is one of the v0.72 gate triggers. */
export function isProRequiredError(error) {
  return !!error && typeof error.message === 'string' && error.message.startsWith('pro_required');
}
