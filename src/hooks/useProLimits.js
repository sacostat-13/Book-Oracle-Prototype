// src/hooks/useProLimits.js — v0.72
//
// What Free can create, in one place. Spec: docs/specs/pro-tier-v1-spec.md §5.
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
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useOracleQuota } from '../contexts/OracleQuotaContext';
import { useRouter } from '../contexts/RouterContext';

export const FREE_LIMITS = {
  clubs: 1,   // clubs you created (joining is unlimited)
  lists: 3,   // Anthologies — every one of them shareable
  plans: 1,   // Passages
};

/**
 * Is this account on Pro? A paid, active subscription — nothing else.
 * Curators are NOT Pro (decided 2026-10-13: separate role, separate product);
 * mirrors public.is_pro() in 20261013120000_curators_are_not_pro.sql and the
 * check in netlify/functions/claude.js.
 *
 * @param {{ subscription_status?: string } | null | undefined} quota  from useOracleQuota()
 * @returns {boolean}
 */
export function isProAccount(quota) {
  return quota?.subscription_status === 'active';
}

export function useProLimits() {
  const { state } = useData();
  const { user } = useAuth();
  const { quota } = useOracleQuota();
  const { go } = useRouter();

  const isPro = isProAccount(quota);

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
