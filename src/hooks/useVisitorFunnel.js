// src/hooks/useVisitorFunnel.js
//
// Records a signed-out visitor's pages for the visitor funnel
// (src/lib/api/funnel.js): the first one in the tab as `landing`, the rest as
// `page_view`. Waits for the auth check, so a signed-in reader's page is never
// recorded as a visitor's; once signed in, nothing more is recorded here.

import { useEffect } from 'react';
import { trackPage } from '../lib/api/funnel';

/**
 * @param {{ name: string }} route   current route (a new object per navigation)
 * @param {object|null} user
 * @param {boolean} authLoading
 */
export function useVisitorFunnel(route, user, authLoading) {
  useEffect(() => {
    if (authLoading || user) return;
    trackPage(route.name);
  }, [route, user, authLoading]);
}
