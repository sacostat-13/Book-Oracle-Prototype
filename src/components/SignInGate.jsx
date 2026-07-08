// src/components/SignInGate.jsx
// Extracted from App.jsx (v0.39) so it can be reused both as the standalone
// signed-out root view AND as an inline modal triggered from the public
// Landing page ("Start reading free" / "Log in" CTAs).
import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useT, useTNode } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';

export default function SignInGate({ onClose }) {
  const { signInWithGoogle, signInWithApple, signInWithFacebook, signInWithEmail } = useAuth();
  const t = useT();
  const tNode = useTNode();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const { error: err } = await signInWithEmail(email.trim());
    setSending(false);
    if (err) setError(t('signIn.emailErrorGeneric'));
    else setSentTo(email.trim());
  }

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

        {sentTo ? (
          <div className="sign-in-confirm">
            <div className="pf-account-card__section-title">{t('signIn.checkInboxTitle')}</div>
            <p className="onb-desc">{t('signIn.checkInboxText', { email: sentTo })}</p>
            <button className="btn-text" onClick={() => setSentTo(null)}>
              {t('signIn.useAnotherEmail')}
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

            <form className="sso-email-form" onSubmit={handleEmailSubmit}>
              <input
                type="email"
                required
                className="input"
                placeholder={t('signIn.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="btn-primary btn--block" disabled={sending || !email.trim()}>
                {sending ? t('signIn.sendingLink') : t('signIn.sendLink')}
              </button>
              {error && <div className="pf-error">{error}</div>}
            </form>
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
