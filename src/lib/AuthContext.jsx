import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Only update session state when the user identity actually changes.
      // Supabase fires TOKEN_REFRESHED and similar events on tab focus, which
      // would otherwise trigger downstream effects (DataContext reloads, etc.)
      // and blow away in-flight UI state — open modals, bulk-import results,
      // half-typed forms.
      //
      // See: github.com/sacostat-13/Book-Oracle-Prototype/issues/6
      setSession((prev) => {
        const prevUserId = prev?.user?.id || null;
        const nextUserId = newSession?.user?.id || null;

        // No user change → keep the previous reference. The token under the
        // hood still rotates (Supabase client handles that internally), so
        // future authed requests use the fresh token. We just don't propagate
        // a new React reference upward.
        if (prevUserId === nextUserId) return prev;

        // User actually changed (sign-in, sign-out, account switch) → update.
        return newSession;
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        loading,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
