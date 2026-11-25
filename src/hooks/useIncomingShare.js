// src/hooks/useIncomingShare.js — v0.74
//
// Counts a visit that arrived through a shared link (?s=, captured and removed
// from the address in src/main.jsx). Waits for the auth check so the hit can
// say whether the visitor was signed in, and so the server can drop the
// sharer's own click. Once per page load; see src/lib/share/shareTracking.js.

import { useEffect } from 'react';
import { reportIncomingShareClick } from '../lib/share/shareTracking';

/**
 * @param {object|null} user
 * @param {boolean} authLoading
 */
export function useIncomingShare(user, authLoading) {
  useEffect(() => {
    if (authLoading) return;
    reportIncomingShareClick(!!user);
  }, [user, authLoading]);
}
