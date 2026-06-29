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
      <div className="loading" style={{ paddingTop: '6rem' }}>
        <div className="loading-spinner" />
        <div className="loading-text">{t('joinClub.loadingText')}</div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card" style={{ maxWidth: 480 }}>
          <div className="onb-eyebrow">{t('joinClub.invalidEyebrow')}</div>
          <h1 className="onb-title" style={{ fontSize: '1.9rem' }}>
            {t('joinClub.invalidTitle', { accent: <span className="accent">{t('joinClub.invalidTitleAccent')}</span> })}
          </h1>
          <p className="onb-desc" style={{ opacity: 0.65 }}>
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
        <div className="onboarding-card" style={{ maxWidth: 480 }}>
          <div className="onb-eyebrow">{t('joinClub.joinedEyebrow')}</div>
          <h1 className="onb-title" style={{ fontSize: '1.9rem' }}>
            {t('joinClub.joinedTitle', { accent: <span className="accent">{clubName}</span> })}
          </h1>
          <p className="onb-desc" style={{ opacity: 0.65 }}>{t('joinClub.joinedText')}</p>
        </div>
      </div>
    );
  }

  if (status === 'joining') {
    return (
      <div className="loading" style={{ paddingTop: '6rem' }}>
        <div className="loading-spinner" />
        <div className="loading-text">{t('joinClub.joiningText', { name: clubName })}</div>
      </div>
    );
  }

  // status === 'preview'
  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card" style={{ maxWidth: 520 }}>
        <div className="onb-eyebrow">{t('joinClub.invitedEyebrow')}</div>
        <h1 className="onb-title" style={{ fontSize: '2rem' }}>
          {t('joinClub.previewTitle', { accent: <span className="accent">{clubName}</span> })}
        </h1>
        {clubDesc && (
          <p className="onb-desc" style={{ opacity: 0.65, lineHeight: 1.6 }}>{clubDesc}</p>
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
          <p style={{ marginTop: '1rem', fontSize: '0.82rem', color: 'var(--paper-aged)', opacity: 0.5, textAlign: 'center' }}>
            {t('joinClub.needAccount')}
          </p>
        )}
      </div>
    </div>
  );
}
