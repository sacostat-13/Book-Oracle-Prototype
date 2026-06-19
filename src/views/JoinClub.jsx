// src/views/JoinClub.jsx — v0.28
// Public landing page for join-club token links.
// Resolves the token via RPC, shows a club preview, then:
//   - Not authed → show sign-in gate
//   - Authed      → join and redirect to club detail

import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { supabase } from '../lib/supabase';

export default function JoinClub() {
  const { user, signInWithGoogle } = useAuth();
  const { go, route } = useRouter();

  const token = route.params?.token;

  const [status, setStatus] = useState('loading'); // loading | preview | joining | joined | invalid
  const [clubName, setClubName] = useState(null);
  const [clubDesc, setClubDesc] = useState(null);
  const [error, setError] = useState(null);

  // Resolve the token to get club preview info (we'll do this via joining and
  // then reading the result — or we can do a lightweight preview lookup first)
  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    // We use a lightweight query: try to find the club name from join_token.
    // This is a SECURITY DEFINER function so it's safe to call before auth.
    supabase.rpc('preview_club_by_token', { p_token: token })
      .then(({ data, error: e }) => {
        if (e || !data) { setStatus('invalid'); return; }
        setClubName(data.name);
        setClubDesc(data.description);
        setStatus('preview');
      });
  }, [token]);

  // Once authed and on preview, auto-join
  useEffect(() => {
    if (status !== 'preview' || !user || !token) return;
    setStatus('joining');
    supabase.rpc('join_club_by_token', { p_token: token })
      .then(({ data: clubId, error: e }) => {
        if (e || !clubId) { setError('Could not join — the link may have expired.'); setStatus('invalid'); return; }
        setStatus('joined');
        // Navigate after a brief moment so the user sees the confirmation
        setTimeout(() => go('book-club-detail', { clubId }), 1200);
      });
  }, [status, user, token, go]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="loading" style={{ paddingTop: '6rem' }}>
        <div className="loading-spinner" />
        <div className="loading-text">Checking invitation…</div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="onboarding-wrap">
        <div className="onboarding-card" style={{ maxWidth: 480 }}>
          <div className="onb-eyebrow">Oops</div>
          <h1 className="onb-title" style={{ fontSize: '1.9rem' }}>
            Invalid <span className="accent">invitation</span>
          </h1>
          <p className="onb-desc" style={{ opacity: 0.65 }}>
            {error || 'This join link is invalid or has expired. Ask the club admin for a fresh link.'}
          </p>
          {user && (
            <div className="onb-actions">
              <div />
              <button className="btn btn-ghost" onClick={() => go('book-clubs')}>
                My clubs
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
          <div className="onb-eyebrow">Welcome</div>
          <h1 className="onb-title" style={{ fontSize: '1.9rem' }}>
            You've joined <span className="accent">{clubName}</span>
          </h1>
          <p className="onb-desc" style={{ opacity: 0.65 }}>Taking you to the club…</p>
        </div>
      </div>
    );
  }

  if (status === 'joining') {
    return (
      <div className="loading" style={{ paddingTop: '6rem' }}>
        <div className="loading-spinner" />
        <div className="loading-text">Joining {clubName}…</div>
      </div>
    );
  }

  // status === 'preview'
  return (
    <div className="onboarding-wrap">
      <div className="onboarding-card" style={{ maxWidth: 520 }}>
        <div className="onb-eyebrow">You've been invited</div>
        <h1 className="onb-title" style={{ fontSize: '2rem' }}>
          Join <span className="accent">{clubName}</span>
        </h1>
        {clubDesc && (
          <p className="onb-desc" style={{ opacity: 0.65, lineHeight: 1.6 }}>
            {clubDesc}
          </p>
        )}
        <div className="onb-actions">
          <div />
          {user ? (
            <button className="btn" onClick={() => setStatus('joining')}>
              Join club ❦
            </button>
          ) : (
            <button className="btn" onClick={signInWithGoogle}>
              Sign in with Google to join
            </button>
          )}
        </div>
        {!user && (
          <p style={{ marginTop: '1rem', fontSize: '0.82rem', color: 'var(--paper-aged)', opacity: 0.5, textAlign: 'center' }}>
            You need an account to join a book club.
          </p>
        )}
      </div>
    </div>
  );
}
