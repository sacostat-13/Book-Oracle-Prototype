import { useEffect } from 'react';
import { useI18n, useT } from '../lib/I18nContext';
import { publishedReleases, CURRENT_VERSION } from '../lib/releases';

export default function ReleaseNotesModal({ onClose }) {
  const { lang } = useI18n();
  const t = useT();
  const releases = publishedReleases();
  const isSpanish = lang === 'es';

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="rating-modal-overlay"
    >
      <div className="rating-modal modal-wide">
        {/* Header */}
        <div className="modal-head">
          <div>
            <div className="rn-version">
              {t('releaseNotes.changelog')}
            </div>
            <h2 className="rn-title">
              {t('releaseNotes.whatsNew')}
            </h2>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="modal-close-btn">
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="modal-body">
          {releases.map((r, i) => (
            <ReleaseEntry
              key={r.version}
              release={r}
              isCurrent={r.version === CURRENT_VERSION}
              isLast={i === releases.length - 1}
              isSpanish={isSpanish}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReleaseEntry({ release, isCurrent, isLast, isSpanish, t }) {
  const title = isSpanish ? release.titleEs : release.titleEn;
  const body  = isSpanish ? release.bodyEs  : release.bodyEn;

  return (
    <div className="rn-section">
      <div className="pf-username-row">
        <span className={`rn-version${isCurrent ? ' club-card__badge club-card__badge--active' : ''}`}>
          {release.version}
        </span>
        {isCurrent && (
          <span className="rn-version">
            {t('releaseNotes.currentBadge')}
          </span>
        )}
        {release.date && (
          <span className="pf-overline" style={{ marginBottom: 0 }}>
            {release.date}
          </span>
        )}
      </div>
      <h3 className="rn-title" style={{ fontSize: "1.2rem" }}>
        {title}
      </h3>
      <ul className="legal-list" style={{ paddingLeft: "1.1rem", listStyle: "disc" }}>
        {body.map((line, i) => (
          <li key={i} className="legal-section__body" style={{ marginBottom: "0.4rem" }}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
