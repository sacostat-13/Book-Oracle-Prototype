import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

// Supabase enforces a minimum server-side (8 by default on this project). This
// is the client's copy, exported so the form hint, the validator and the
// account screen cannot drift apart. Raising it here does NOT raise it on the
// server — change both, in Auth → Providers → Email.
export const MIN_PASSWORD_LENGTH = 8;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // True from the moment Supabase reports the user arrived via a recovery link
  // until they set a new password. Kept here rather than derived from the URL:
  // the client consumes and clears the hash fragment before any component
  // mounts, so PASSWORD_RECOVERY is the only reliable signal.
  const [recoveringPassword, setRecoveringPassword] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // A recovery link signs the user in for real, so without this flag the
      // app would drop them on the dashboard and the password they came to
      // change would stay as it was.
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);

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

  // const signInWithApple = () =>
  //   supabase.auth.signInWithOAuth({
  //     provider: 'apple',
  //     options: { redirectTo: window.location.origin },
  //   });

  // const signInWithFacebook = () =>
  //   supabase.auth.signInWithOAuth({
  //     provider: 'facebook',
  //     options: { redirectTo: window.location.origin },
  //   });

  // Passwordless email sign-in — sends a one-time magic link rather than
  // requiring a password. Resolves { error } so the caller can show a
  // "check your inbox" state or surface the error inline.
  //
  // Kept alongside the password flow rather than replaced. Readers told us the
  // link was not much use as the ONLY option — leaving the inbox round-trip in
  // place as a fallback costs nothing and is the escape hatch for anyone who
  // signed up through Google and never set a password.
  const signInWithEmail = (email) =>
    supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

  // ── Password auth ───────────────────────────────────────────────────────────
  //
  // Supabase enforces its own minimum server-side, but the client checks too so
  // the reader is told before the round-trip rather than after it. One shared
  // constant so the form hint, the validator and the account screen agree.
  const signInWithPassword = (email, password) =>
    supabase.auth.signInWithPassword({ email: email.trim(), password });

  // `emailRedirectTo` matters even when confirmations are off: if the project
  // ever turns them on, an unset redirect sends people to Supabase's own host
  // instead of back here.
  const signUpWithPassword = (email, password) =>
    supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin },
    });

  const sendPasswordReset = (email) =>
    supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });

  // Also the path by which a Google/magic-link account gains a password for the
  // first time — updateUser sets it whether or not one existed.
  const setPassword = async (password) => {
    const result = await supabase.auth.updateUser({ password });
    if (!result.error) setRecoveringPassword(false);
    return result;
  };

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        loading,
        signInWithGoogle,
        // signInWithApple,
        // signInWithFacebook,
        signInWithEmail,
        signInWithPassword,
        signUpWithPassword,
        sendPasswordReset,
        setPassword,
        recoveringPassword,
        dismissPasswordRecovery: () => setRecoveringPassword(false),
        MIN_PASSWORD_LENGTH,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
