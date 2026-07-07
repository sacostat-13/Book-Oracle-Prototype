// src/views/BookClubs.jsx — v0.31

import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useT, useTNode } from '../lib/I18nContext';

export default function BookClubs() {
  const { state } = useData();
  const { go } = useRouter();
  const { user } = useAuth();
  const t = useT();
  const tNode = useTNode();

  const clubs = state.clubs || [];

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow">{t('clubs.eyebrow')}</div>
        <h1 className="page-title">{tNode('clubs.pageTitle')}</h1>
        <p className="clubs-empty-text">
          {t('clubs.subtitle')}
        </p>
      </div>

      {user && (
        <div className="clubs-list clubs-list__actions">
          <button className="btn-primary" onClick={() => go('book-club-create')}>
            {t('clubs.newClub')}
          </button>
          <button className="btn-secondary" onClick={() => go('club-directory')}>
            {t('clubs.discoverClubs')}
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
        <div className="clubs-list">
          {clubs.map((club) => (
            <div
              key={club.id}
              className="club-card"
              onClick={() => go('book-club-detail', { clubId: club.id })}
            >
              <div className="club-card__head">
                <div className="club-card__name">
                  {club.name}
                </div>
                <span className={`club-card__badge${club.callerRole === 'admin' ? ' club-card__badge--active' : ' club-card__badge--past'}`}>
                  {club.callerRole === 'admin' ? t('clubs.roleAdmin') : t('clubs.roleMember')}
                </span>
              </div>
              {club.description && (
                <div className="club-card__desc">
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
