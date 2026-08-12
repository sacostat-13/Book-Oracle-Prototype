// src/components/SignInGate.jsx
// Extracted from App.jsx (v0.39) so it can be reused both as the standalone
// signed-out root view AND as an inline modal triggered from the public
// Landing page ("Start reading free" / "Log in" CTAs).
//
// v0.46: email + password is now the primary path.
//
// The gate previously offered Google or a magic link and nothing else, and
// readers reported the same thing repeatedly: the link is a poor default. It
// costs an inbox round-trip on every sign-in, it breaks when the link is opened
// on a different device from the one that asked for it, and it is unfamiliar
// enough that some people assume the form failed. A password is what they
// expected to be asked for.
//
// The link is kept, demoted to a secondary option, because it remains the only
// way in for anyone who signed up through Google and never set a password.
import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useT, useTNode } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';

// signin  — email + password (default)
// signup  — create an account with a password
// magic   — the old passwordless link, now opt-in
// forgot  — request a reset email
const MODES = ['signin', 'signup', 'magic', 'forgot'];

// Domains where Google SSO is certain to work, so suggesting it is a real
// shortcut rather than a guess. Kept narrow on purpose: googlemail.com is the
// old alias Gmail still honours, and Workspace domains are indistinguishable
// from any other custom domain from here — nudging those would be wrong as
// often as right, and a suggestion that misfires is worse than no suggestion.
const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function looksLikeGoogleAccount(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return GOOGLE_DOMAINS.has(email.slice(at + 1).trim().toLowerCase());
}

export default function SignInGate({ onClose }) {
  const {
    signInWithGoogle,
    signInWithEmail,
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    MIN_PASSWORD_LENGTH,
  } = useAuth();
  const t = useT();
  const tNode = useTNode();

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Which "check your inbox" screen to show, and for whom. One piece of state
  // rather than two booleans so the two confirmations can never both be true.
  const [sent, setSent] = useState(null); // { kind: 'magic' | 'reset' | 'signup', email }

  const minLen = MIN_PASSWORD_LENGTH || 8;

  function switchMode(next) {
    if (!MODES.includes(next)) return;
    setMode(next);
    setError(null);
    setPassword('');
    setConfirm('');
  }

  // Supabase returns deliberately vague messages for sign-in failures so an
  // attacker cannot tell a wrong password from an unregistered address. We do
  // not make them more specific — but we do translate the handful that are
  // actionable, because "AuthApiError: Invalid login credentials" in English,
  // to a Spanish-speaking reader, is not an error message.
  function describe(err) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('invalid login credentials')) return t('signIn.errorBadCredentials');
    if (msg.includes('email not confirmed')) return t('signIn.errorUnconfirmed');
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      return t('signIn.errorAlreadyRegistered');
    }
    if (msg.includes('password')) return t('signIn.errorPasswordRejected', { min: minLen });
    if (msg.includes('rate limit') || msg.includes('too many')) return t('signIn.errorRateLimited');
    return t('signIn.errorGeneric');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setError(null);

    if (mode === 'signup') {
      if (password.length < minLen) {
        setError(t('signIn.errorPasswordShort', { min: minLen }));
        return;
      }
      if (password !== confirm) {
        setError(t('signIn.errorPasswordMismatch'));
        return;
      }
    }

    setBusy(true);
    let err = null;

    if (mode === 'signin') {
      ({ error: err } = await signInWithPassword(email.trim(), password));
    } else if (mode === 'signup') {
      const { data, error: e2 } = await signUpWithPassword(email.trim(), password);
      err = e2;

      // Signing up with an address that ALREADY has an account.
      //
      // Supabase does not return an error for this — by design. With email
      // enumeration protection on (the default), signUp on an existing address
      // returns a perfectly normal-looking user object and sends no mail, so
      // that a stranger cannot use the signup form to discover who has an
      // account here. The tell is `identities: []`: a genuinely new user always
      // comes back with one identity, a fabricated one has none.
      //
      // This is what produced the report — "it let me create an account with my
      // existing account and told me to check my inbox, and nothing arrived."
      // The account was never created and no mail was ever sent. Without this
      // branch the reader waits indefinitely for an email that does not exist.
      //
      // We do not say "that address is taken", which would undo the protection.
      // We say something true for both cases and give them somewhere to go.
      const obfuscated = !err && data?.user && (data.user.identities || []).length === 0;
      if (obfuscated) {
        setBusy(false);
        setSent({ kind: 'maybeExisting', email: email.trim() });
        return;
      }

      // With email confirmation ON, signUp returns a user but no session and
      // nothing further happens on this device until the link is opened. With
      // it OFF, a session arrives and AuthContext takes over — so only show the
      // inbox screen in the first case, or the reader is told to check an inbox
      // that will never receive anything.
      if (!err && !data?.session) {
        setBusy(false);
        setSent({ kind: 'signup', email: email.trim() });
        return;
      }
    } else if (mode === 'magic') {
      ({ error: err } = await signInWithEmail(email.trim()));
      if (!err) {
        setBusy(false);
        setSent({ kind: 'magic', email: email.trim() });
        return;
      }
    } else if (mode === 'forgot') {
      ({ error: err } = await sendPasswordReset(email.trim()));
      // Always report success. Whether an address has an account is not
      // something this form should confirm to whoever typed it.
      setBusy(false);
      setSent({ kind: 'reset', email: email.trim() });
      return;
    }

    setBusy(false);
    if (err) setError(describe(err));
    // On success for signin/signup-with-session, onAuthStateChange swaps the
    // whole view out from under this component. Nothing to do here.
  }

  const titles = {
    signin: t('signIn.tabSignIn'),
    signup: t('signIn.tabCreate'),
    magic: t('signIn.sendLink'),
    forgot: t('signIn.forgotTitle'),
  };

  const submitLabels = {
    signin: busy ? t('signIn.signingIn') : t('signIn.tabSignIn'),
    signup: busy ? t('signIn.creating') : t('signIn.createAccount'),
    magic: busy ? t('signIn.sendingLink') : t('signIn.sendLink'),
    forgot: busy ? t('signIn.sendingLink') : t('signIn.sendReset'),
  };

  const inboxCopy = {
    magic: t('signIn.checkInboxText', { email: sent?.email }),
    reset: t('signIn.checkInboxReset', { email: sent?.email }),
    signup: t('signIn.checkInboxSignup', { email: sent?.email }),
    maybeExisting: t('signIn.maybeExistingText', { email: sent?.email }),
  };

  // Only while creating an account. On the sign-in tab the reader already has
  // an account and telling them how they might have signed up is noise; on the
  // reset tab it would be actively unhelpful, since a Google account has no
  // password to reset.
  const showGoogleNudge = mode === 'signup' && looksLikeGoogleAccount(email);

  const inboxTitle = sent?.kind === 'maybeExisting'
    ? t('signIn.maybeExistingTitle')
    : t('signIn.checkInboxTitle');

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        {onClose && (
          <button className="btn-icon sign-in-close" onClick={onClose} aria-label={t('common.close') || 'Close'}>✕</button>
        )}
        <CornerBrackets />
        <div className="onb-eyebrow">{t('signIn.eyebrow')}</div>
        <h1 className="onb-title">
          {tNode('app.brand', { wishlist: <span className="accent">{t('app.brandAccent')}</span> })}
        </h1>
        <p className="onb-desc">{t('signIn.desc')}</p>

        {sent ? (
          <div className="sign-in-confirm">
            <div className="pf-account-card__section-title">{inboxTitle}</div>
            <p className="onb-desc">{inboxCopy[sent.kind]}</p>
            {/* The "you may already have an account" case is the one where the
                reader is stuck, so it gets real exits rather than just a back
                link — including the one that works even if the existing account
                is a Google account with no password. */}
            {sent.kind === 'maybeExisting' && (
              <div className="sign-in-alt">
                <button className="btn-text" onClick={() => { setSent(null); switchMode('forgot'); }}>
                  {t('signIn.forgotLink')}
                </button>
                <span className="sign-in-legal__sep">·</span>
                <button className="btn-text" onClick={signInWithGoogle}>
                  {t('signIn.continueGoogle')}
                </button>
              </div>
            )}
            <button className="btn-text" onClick={() => { setSent(null); switchMode('signin'); }}>
              {t('signIn.backToSignIn')}
            </button>
          </div>
        ) : (
          <>
            <div className="sso-stack">
              <button className="btn-secondary btn--block" onClick={signInWithGoogle}>
                {t('signIn.continueGoogle')}
              </button>
            </div>

            <div className="sso-divider"><span>{t('signIn.orDivider')}</span></div>

            {/* Sign in / Create account. Deliberately two visible tabs rather
                than a single form with a hidden "or register" link: a new
                reader arriving from Landing should not have to work out which
                of the two things the one button does. */}
            {(mode === 'signin' || mode === 'signup') && (
              <div className="sign-in-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  className={`sign-in-tab${mode === 'signin' ? ' active' : ''}`}
                  onClick={() => switchMode('signin')}
                >
                  {t('signIn.tabSignIn')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  className={`sign-in-tab${mode === 'signup' ? ' active' : ''}`}
                  onClick={() => switchMode('signup')}
                >
                  {t('signIn.tabCreate')}
                </button>
              </div>
            )}

            {(mode === 'magic' || mode === 'forgot') && (
              <div className="pf-account-card__section-title">{titles[mode]}</div>
            )}
            {mode === 'forgot' && <p className="onb-desc">{t('signIn.forgotDesc')}</p>}
            {mode === 'magic' && <p className="onb-desc">{t('signIn.magicDesc')}</p>}

            <form className="sso-email-form" onSubmit={handleSubmit}>
              <input
                type="email"
                required
                autoComplete="email"
                className="input"
                placeholder={t('signIn.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {/* Soft nudge, not a block. A Gmail address almost certainly has
                  a working Google account behind it, and SSO is one tap with no
                  password to invent, no confirmation email to wait for, and no
                  reset flow later. It also avoids the most confusing outcome
                  available here: creating a password account at the same
                  address a Google account already uses, then not understanding
                  why the two do not feel like the same login.

                  Deliberately a suggestion and never a redirect. Someone may
                  have good reasons not to involve Google, and the form still
                  works exactly as before if they ignore this. */}
              {showGoogleNudge && (
                <div className="sign-in-nudge">
                  <span className="sign-in-nudge__text">{t('signIn.googleNudge')}</span>
                  <button type="button" className="btn-text" onClick={signInWithGoogle}>
                    {t('signIn.googleNudgeAction')}
                  </button>
                </div>
              )}

              {(mode === 'signin' || mode === 'signup') && (
                <input
                  type="password"
                  required
                  minLength={mode === 'signup' ? minLen : undefined}
                  // Tells the browser's password manager whether to offer a
                  // saved password or to generate a new one. Getting this wrong
                  // is the difference between a usable form and one that fights
                  // the reader's keychain on every visit.
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className="input"
                  placeholder={t('signIn.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}

              {mode === 'signup' && (
                <>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    className="input"
                    placeholder={t('signIn.confirmPlaceholder')}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <div className="sign-in-hint">{t('signIn.passwordHint', { min: minLen })}</div>
                </>
              )}

              <button
                type="submit"
                className="btn-primary btn--block"
                disabled={busy || !email.trim() || ((mode === 'signin' || mode === 'signup') && !password)}
              >
                {submitLabels[mode]}
              </button>

              {error && <div className="pf-error">{error}</div>}
            </form>

            <div className="sign-in-alt">
              {mode === 'signin' && (
                <>
                  <button className="btn-text" onClick={() => switchMode('forgot')}>
                    {t('signIn.forgotLink')}
                  </button>
                  <span className="sign-in-legal__sep">·</span>
                  <button className="btn-text" onClick={() => switchMode('magic')}>
                    {t('signIn.useMagicLink')}
                  </button>
                </>
              )}
              {(mode === 'magic' || mode === 'forgot') && (
                <button className="btn-text" onClick={() => switchMode('signin')}>
                  {t('signIn.backToSignIn')}
                </button>
              )}
            </div>
          </>
        )}

        <div className="sign-in-legal">
          <a className="btn btn-text" href="#privacy" target="_blank" rel="noopener noreferrer">{t('footer.privacy') || 'Privacy Policy'}</a>
          <span className="sign-in-legal__sep">·</span>
          <a className="btn btn-text" href="#terms" target="_blank" rel="noopener noreferrer">{t('footer.terms') || 'Terms of Service'}</a>
          <span className="sign-in-legal__sep">·</span>
          <a className="btn btn-text" href="#refund" target="_blank" rel="noopener noreferrer">{t('footer.refund') || 'Refund Policy'}</a>
        </div>
      </div>
    </div>
  );
}
