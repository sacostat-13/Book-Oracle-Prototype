// src/views/BookClubs.jsx — v0.28
// Index page: lists all clubs the user belongs to, with a create button.

import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';

export default function BookClubs() {
  const { state } = useData();
  const { go } = useRouter();
  const { user } = useAuth();

  const clubs = state.clubs || [];

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow">Community</div>
        <h1 className="page-title">Book <span className="accent">Clubs</span></h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
          Read together. Track progress. Discuss in sessions.
        </p>
      </div>

      {user && (
        <div style={{ marginBottom: '2rem' }}>
          <button className="btn" onClick={() => go('book-club-create')}>
            + New book club
          </button>
        </div>
      )}

      {clubs.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">No clubs yet</div>
          <div className="empty-state-text">
            Create a club or ask someone to share their join link with you.
          </div>
        </div>
      ) : (
        <div className="plan-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {clubs.map((club) => (
            <div
              key={club.id}
              className="cr-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                cursor: 'pointer',
                gridTemplateColumns: undefined,
              }}
              onClick={() => go('book-club-detail', { clubId: club.id })}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
                <div
                  style={{
                    fontFamily: "'Cormorant Garamond', serif",
                    fontStyle: 'italic',
                    fontSize: '1.2rem',
                    color: 'var(--paper)',
                  }}
                >
                  {club.name}
                </div>
                <span
                  style={{
                    fontFamily: "'Special Elite', monospace",
                    fontSize: '0.65rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: club.callerRole === 'admin' ? 'var(--gilt)' : 'var(--paper-aged)',
                    opacity: club.callerRole === 'admin' ? 1 : 0.5,
                    flexShrink: 0,
                  }}
                >
                  {club.callerRole === 'admin' ? '✦ Admin' : 'Member'}
                </span>
              </div>
              {club.description && (
                <div style={{ fontSize: '0.88rem', color: 'var(--paper-aged)', opacity: 0.65, lineHeight: 1.5 }}>
                  {club.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
