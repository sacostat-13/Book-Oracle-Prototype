// src/views/JoinClub.jsx — v0.31

import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';
import SignInGate from '../components/SignInGate';

export default function JoinClub() {
  const { user } = useAuth();
  const { go, route } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const token = route.params?.token;
  const [status, setStatus] = useState('loading');
  const [signingIn, setSigningIn] = useState(false);
  const [clubName, setClubName] = useState(null);
  const [clubDesc, setClubDesc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    supabase.rpc('preview_club_by_token', { p_token: token })
      .then(({ data, error: e }) => {
        if (e || !data) { setStatus('invalid'); return; }
        setClubName(data.name);
        setClubDesc(data.description);
        setStatus('preview');
      });
  }, [token]);

  useEffect(() => {
    if (status !== 'preview' || !user || !token) return;
    setStatus('joining');
    supabase.rpc('join_club_by_token', { p_token: token })
      .then(({ data: clubId, error: e }) => {
        if (e || !clubId) { setError(t('joinClub.joinError')); setStatus('invalid'); return; }
        setStatus('joined');
        setTimeout(() => go('book-club-detail', { clubId }), 1200);
      });
    // `t` is deliberately not a dep: it changes identity when the reader
    // switches language, and re-running this effect would fire
    // join_club_by_token a second time. It is only read to build an error
    // string, so a stale one is worth far less than a duplicate join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user, token, go]);

  if (status === 'loading') {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div className="loading-text">{t('joinClub.loadingText')}</div>
      </div>
    );
  }

  // v0.46 — these three headings were calling keys that do not exist
  // (`invalidTitle`, `joinedTitle`, `previewTitle`), so `resolveKey` fell all
  // the way through to its last resort and rendered the key string itself. The
  // real keys — `invalidPageTitle`, `joinedPageTitle`, `previewPageTitle` —
  // were already in both catalogs, already carrying the `<em class="accent">`
  // markup and the `{name}` placeholder, and needed `tNode` rather than `t`
  // because `t()` strips HTML and stringifies element vars.
  if (status === 'invalid') {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card join-card">
          <div className="onb-eyebrow">{t('joinClub.invalidEyebrow')}</div>
          <h1 className="onb-title join-card__title-sm">
            {tNode('joinClub.invalidPageTitle')}
          </h1>
          <p className="onb-desc join-card__desc-dim">
            {error || t('joinClub.invalidText')}
          </p>
          {user && (
            <div className="onb-actions">
              <div />
              <button className="btn-secondary" onClick={() => go('book-clubs')}>
                {t('joinClub.myClubs')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (status === 'joined') {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card join-card">
          <div className="onb-eyebrow">{t('joinClub.joinedEyebrow')}</div>
          <h1 className="onb-title join-card__title-sm">
            {tNode('joinClub.joinedPageTitle', { name: clubName })}
          </h1>
          <p className="onb-desc join-card__desc-dim">{t('joinClub.joinedText')}</p>
        </div>
      </div>
    );
  }

  if (status === 'joining') {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div className="loading-text">{t('joinClub.joiningText', { name: clubName })}</div>
      </div>
    );
  }

  // status === 'preview'
  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card join-card">
        <div className="onb-eyebrow">{t('joinClub.invitedEyebrow')}</div>
        <h1 className="onb-title">
          {tNode('joinClub.previewPageTitle', { name: clubName })}
        </h1>
        {clubDesc && (
          <p className="onb-desc join-card__desc-dim">{clubDesc}</p>
        )}
        <div className="onb-actions">
          <div />
          {user ? (
            <button className="btn-primary" onClick={() => setStatus('joining')}>
              {t('joinClub.joinBtn')}
            </button>
          ) : (
            // Opens the full sign-in gate in place rather than firing the
            // Google popup directly. Two reasons: Google is no longer the only
            // way in as of v0.46, and the gate rendered here as a modal keeps
            // the reader on the join URL — navigating away to sign in would
            // lose the invite token and drop them on the dashboard with no way
            // back to the club they were invited to.
            <button className="btn-primary" onClick={() => setSigningIn(true)}>
              {t('joinClub.signInToJoin')}
            </button>
          )}
        </div>
        {!user && (
          <p className="clubs-empty-text" style={{ textAlign: "center", marginTop: "1rem" }}>
            {t('joinClub.needAccount')}
          </p>
        )}
      </div>

      {/* Once the session lands, AuthContext re-renders this view with `user`
          set and the Join button takes its place — the token is still in the
          URL, so nothing is lost. */}
      {signingIn && !user && <SignInGate onClose={() => setSigningIn(false)} />}
    </div>
  );
}
