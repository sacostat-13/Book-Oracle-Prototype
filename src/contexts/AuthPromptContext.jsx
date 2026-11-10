// src/contexts/AuthPromptContext.jsx
//
// One sign-in window for every public page. Before this, only Landing could
// open the sign-in modal; the book and series pages — where search visitors
// actually arrive — had a "Sign in to add" link that pointed at the page it was
// on and simply reloaded it. There was no way to sign up from where people land.
//
//   const { openAuth } = useAuthPrompt();
//   openAuth({
//     mode: 'signup',                 // which tab SignInGate opens on
//     from: 'book_save',              // funnel label: which button opened it
//     context: 'Create a free…',      // optional line above the form
//     intent: { type: 'wishlist', book, route: { name, params } },
//   });
//
// `intent` is kept (pendingIntent.js) and finished by IntentResumer once the
// visitor has an account. The window closes itself when a session appears.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import SignInGate from '../components/SignInGate';
import { saveIntent } from '../lib/util/pendingIntent';
import { trackEvent } from '../lib/api/funnel';

const AuthPromptContext = createContext({ openAuth: () => {}, closeAuth: () => {} });

const MODES = new Set(['signin', 'signup']);

export function AuthPromptProvider({ children }) {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState(null); // { mode, context } | null

  const openAuth = useCallback(({ mode = 'signup', from = 'unknown', context = null, intent = null } = {}) => {
    const m = mode === 'login' ? 'signin' : (MODES.has(mode) ? mode : 'signup');
    if (intent) saveIntent(intent);
    trackEvent('auth_open', { from, mode: m });
    setPrompt({ mode: m, context });
  }, []);

  const closeAuth = useCallback(() => setPrompt(null), []);

  // Signed in (password, or back from Google): the window has done its job.
  useEffect(() => { if (user) setPrompt(null); }, [user]);

  const value = useMemo(() => ({ openAuth, closeAuth }), [openAuth, closeAuth]);

  return (
    <AuthPromptContext.Provider value={value}>
      {children}
      {prompt && (
        <div
          className="lp-auth-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) closeAuth(); }}
        >
          <SignInGate onClose={closeAuth} initialMode={prompt.mode} contextLine={prompt.context} />
        </div>
      )}
    </AuthPromptContext.Provider>
  );
}

export const useAuthPrompt = () => useContext(AuthPromptContext);
