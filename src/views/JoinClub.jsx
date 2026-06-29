// src/views/JoinClub.jsx — v0.31

import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

export default function JoinClub() {
  const { user, signInWithGoogle } = useAuth();
  const { go, route } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const token = route.params?.token;
  const [status, setStatus] = useState('loading');
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
  }, [status, user, token, go]);

  if (status === 'loading') {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div className="loading-text">{t('joinClub.loadingText')}</div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card join-card">
          <div className="onb-eyebrow">{t('joinClub.invalidEyebrow')}</div>
          <h1 className="onb-title join-card__title-sm">
            {t('joinClub.invalidTitle', { accent: <span className="accent">{t('joinClub.invalidTitleAccent')}</span> })}
          </h1>
          <p className="onb-desc join-card__desc-dim">
            {error || t('joinClub.invalidText')}
          </p>
          {user && (
            <div className="onb-actions">
              <div />
              <button className="btn btn-ghost" onClick={() => go('book-clubs')}>
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
            {t('joinClub.joinedTitle', { accent: <span className="accent">{clubName}</span> })}
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
          {t('joinClub.previewTitle', { accent: <span className="accent">{clubName}</span> })}
        </h1>
        {clubDesc && (
          <p className="onb-desc join-card__desc-dim">{clubDesc}</p>
        )}
        <div className="onb-actions">
          <div />
          {user ? (
            <button className="btn" onClick={() => setStatus('joining')}>
              {t('joinClub.joinBtn')}
            </button>
          ) : (
            <button className="btn" onClick={signInWithGoogle}>
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
    </div>
  );
}
