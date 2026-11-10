// src/components/IntentResumer.jsx
//
// Finishes what a visitor clicked before we asked them to sign up. Someone who
// pressed "Save to your shelf" on a book page, created an account (and went
// through onboarding, if new) should find that book on their wishlist and land
// back on its page — not on an empty dashboard wondering where it went.
//
// Mounted once around every route (App.jsx). Renders nothing. Waits until the
// reader is signed in, their data has loaded and onboarding is done, then runs
// the stored intent exactly once (it is cleared before anything is awaited, so
// a re-render cannot run it twice). See lib/util/pendingIntent.js.

import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useRouter } from '../contexts/RouterContext';
import { readIntent, clearIntent } from '../lib/util/pendingIntent';
import { trackEvent } from '../lib/api/funnel';

export default function IntentResumer() {
  const { user } = useAuth();
  const { state, loading, addToWishlist } = useData();
  const { go } = useRouter();
  const running = useRef(false);

  const ready = !!user && !loading && !!state.onboarded;

  useEffect(() => {
    if (!ready || running.current) return;
    const intent = readIntent();
    if (!intent) return;
    running.current = true;
    clearIntent();

    (async () => {
      try {
        if (intent.type === 'wishlist') await addToWishlist(intent.book);
        trackEvent('intent_resumed', { type: intent.type });
      } catch (err) {
        console.warn('[intent] could not finish the saved action', err?.message || err);
      } finally {
        if (intent.route) go(intent.route.name, intent.route.params);
        running.current = false;
      }
    })();
  }, [ready, addToWishlist, go]);

  return null;
}
