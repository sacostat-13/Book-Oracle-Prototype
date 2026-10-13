import { useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';

// ── Display name section ──────────────────────────────────────────────────────
// v0.46 — set or change the account password.
//
// Password sign-in is new, so almost every existing account has none: they came
// in through Google or a magic link. Without this section those readers could
// only ever adopt a password by signing out and using "forgot password" on an
// account they are not sure has one, which is a strange thing to ask. Here it
// is one field.
//
// No "current password" prompt. Supabase's updateUser authenticates with the
// live session, and the session is what proves identity — asking for the old
// one would be theatre for OAuth users who genuinely do not have it. The real
// protection is that a stolen session is already game over regardless.
export default function PasswordSection({ user, showToast, t }) {
  const { setPassword, MIN_PASSWORD_LENGTH } = useAuth();
  const [editing, setEditing] = useState(false);
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const minLen = MIN_PASSWORD_LENGTH || 8;

  // identities carries one row per linked provider. An 'email' identity means
  // this account can, in principle, sign in without OAuth — though it does not
  // distinguish a password from a magic link, which is exactly why the copy
  // below says "set or change" rather than claiming to know which.
  const hasEmailIdentity = (user?.identities || []).some((i) => i.provider === 'email');

  function reset() {
    setEditing(false);
    setPw('');
    setConfirm('');
    setError(null);
  }

  async function save() {
    if (password.length < minLen) { setError(t('signIn.errorPasswordShort', { min: minLen })); return; }
    if (password !== confirm) { setError(t('signIn.errorPasswordMismatch')); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await setPassword(password);
    setSaving(false);
    if (err) { setError(err.message || t('signIn.errorGeneric')); return; }
    reset();
    showToast(t('profile.passwordSaved'));
  }

  if (!user) return null;

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">{t('profile.labelPassword')}</h2>
      <p className="pf-section__hint">
        {hasEmailIdentity ? t('profile.passwordHintExisting') : t('profile.passwordHintOauth')}
      </p>
      {editing ? (
        <div className="pf-edit-row pf-edit-row--wrap">
          <input
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={minLen}
            placeholder={t('signIn.newPasswordPlaceholder')}
            value={password}
            onChange={(e) => setPw(e.target.value)}
          />
          <input
            type="password"
            className="input"
            autoComplete="new-password"
            placeholder={t('signIn.confirmPlaceholder')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button className="btn-tertiary btn--sm" onClick={save} disabled={saving || !password || !confirm}>
            {saving ? t('profile.usernameSaving') : t('common.save')}
          </button>
          <button className="btn-text" onClick={reset}>{t('common.cancel')}</button>
          {error && <div className="pf-error">{error}</div>}
        </div>
      ) : (
        <div className="pf-value-row">
          <span className="pf-account-card__name">
            <span className="lv-hl-muted">{t('profile.passwordMasked')}</span>
          </span>
          <button className="btn-tertiary btn--sm" onClick={() => setEditing(true)}>
            {hasEmailIdentity ? t('profile.changePassword') : t('profile.setPassword')}
          </button>
        </div>
      )}
    </div>
  );
}
