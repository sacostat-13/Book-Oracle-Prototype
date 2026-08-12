// src/components/PasswordResetGate.jsx — v0.46
//
// Shown when the reader arrives from a "reset your password" email.
//
// A Supabase recovery link is a real sign-in: by the time this renders there is
// a valid session and the app would otherwise drop them straight on the
// dashboard, with the old password still in place and no obvious way to change
// it. This intercepts that moment and asks for the new one before anything else
// loads.
//
// Blocking rather than dismissible-to-dashboard. Somebody who followed a reset
// link came to do exactly one thing, and a skippable prompt would leave a
// half-finished recovery behind — plus the recovery session is short-lived, so
// "I'll do it later" quietly means "not at all".
import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useT } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';

export default function PasswordResetGate() {
  const { setPassword, signOut, MIN_PASSWORD_LENGTH } = useAuth();
  const t = useT();
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const minLen = MIN_PASSWORD_LENGTH || 8;

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    if (password.length < minLen) {
      setError(t('signIn.errorPasswordShort', { min: minLen }));
      return;
    }
    if (password !== confirm) {
      setError(t('signIn.errorPasswordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await setPassword(password);
    setBusy(false);
    // On success setPassword clears the recovery flag, this component unmounts
    // and the app renders normally — already signed in, no second login.
    if (err) setError(err.message || t('signIn.errorGeneric'));
  }

  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card">
        <CornerBrackets />
        <div className="onb-eyebrow">{t('signIn.eyebrow')}</div>
        <h1 className="onb-title">{t('signIn.resetTitle')}</h1>
        <p className="onb-desc">{t('signIn.resetDesc')}</p>

        <form className="sso-email-form" onSubmit={handleSubmit}>
          <input
            type="password"
            required
            minLength={minLen}
            autoComplete="new-password"
            className="input"
            placeholder={t('signIn.newPasswordPlaceholder')}
            value={password}
            onChange={(e) => setPw(e.target.value)}
          />
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
          <button type="submit" className="btn-primary btn--block" disabled={busy || !password || !confirm}>
            {busy ? t('signIn.saving') : t('signIn.savePassword')}
          </button>
          {error && <div className="pf-error">{error}</div>}
        </form>

        {/* The way out for someone who followed a link they did not request. */}
        <div className="sign-in-alt">
          <button className="btn-text" onClick={signOut}>{t('signIn.cancelReset')}</button>
        </div>
      </div>
    </div>
  );
}
