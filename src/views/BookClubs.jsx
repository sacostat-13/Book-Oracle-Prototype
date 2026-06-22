// src/views/BookClubs.jsx — v0.31

import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useT } from '../lib/I18nContext';

export default function BookClubs() {
  const { state } = useData();
  const { go } = useRouter();
  const { user } = useAuth();
  const t = useT();

  const clubs = state.clubs || [];

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow">{t('clubs.eyebrow')}</div>
        <h1 className="page-title">{t('clubs.title', { accent: <span className="accent">{t('clubs.titleAccent')}</span> })}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
          {t('clubs.subtitle')}
        </p>
      </div>

      {user && (
        <div style={{ marginBottom: '2rem' }}>
          <button className="btn" onClick={() => go('book-club-create')}>
            {t('clubs.newClub')}
          </button>
        </div>
      )}

      {clubs.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('clubs.emptyTitle')}</div>
          <div className="empty-state-text">{t('clubs.emptyText')}</div>
        </div>
      ) : (
        <div className="plan-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {clubs.map((club) => (
            <div
              key={club.id}
              className="cr-card"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', cursor: 'pointer', gridTemplateColumns: undefined }}
              onClick={() => go('book-club-detail', { clubId: club.id })}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.2rem', color: 'var(--paper)' }}>
                  {club.name}
                </div>
                <span style={{
                  fontFamily: "'Special Elite', monospace",
                  fontSize: '0.65rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: club.callerRole === 'admin' ? 'var(--gilt)' : 'var(--paper-aged)',
                  opacity: club.callerRole === 'admin' ? 1 : 0.5,
                  flexShrink: 0,
                }}>
                  {club.callerRole === 'admin' ? t('clubs.roleAdmin') : t('clubs.roleMember')}
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
