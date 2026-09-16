import { useEffect } from 'react';
import { useI18n, useT } from '../lib/I18nContext';
import { publishedReleases, currentRelease, CURRENT_VERSION } from '../lib/releases';
import CornerBrackets from './CornerBrackets';

// Two modes, one component.
//
//   default   — the full changelog, opened from the nav sparkle. Unchanged.
//   announce  — v0.70. A single release, shown once, unprompted, with a CTA
//               straight into the thing it is announcing.
//
// The announce mode exists because some releases add a capability a reader has
// no reason to go looking for. Scanning is behind a nav icon and uses the
// camera: nobody discovers that by browsing. A typography pass does not qualify,
// and the `major` flag is only worth having if we are willing to leave it off —
// once everything is announced, everything gets dismissed on reflex, including
// the one that mattered.
export default function ReleaseNotesModal({ onClose, announce = false, onCta }) {
  const { lang } = useI18n();
  const t = useT();
  const isSpanish = lang === 'es';

  const current = currentRelease();
  const releases = announce && current ? [current] : publishedReleases();
  const ctaLabel = announce && current ? (isSpanish ? current.ctaEs : current.ctaEn) : null;

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
      className="rating-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`rating-modal modal-wide${announce ? ' rn-announce' : ''}`}>
        <CornerBrackets />
        {/* Header */}
        <div className="modal-head">
          <div>
            <div className="rn-version">
              {announce ? t('releaseNotes.whatsNew') : t('releaseNotes.changelog')}
            </div>
            <h2 className="rn-title">
              {announce && current
                ? (isSpanish ? current.titleEs : current.titleEn)
                : t('releaseNotes.whatsNew')}
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
              // In announce mode the release title is already the modal's
              // heading, so repeating it with a version badge underneath reads
              // as a changelog rather than as news.
              bare={announce}
              t={t}
            />
          ))}
        </div>

        {announce && (
          <div className="modal-foot">
            <button className="btn-secondary" onClick={onClose}>
              {t('releaseNotes.later')}
            </button>
            {ctaLabel && onCta && (
              <button className="btn-primary rn-cta" onClick={onCta}>
                {ctaLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReleaseEntry({ release, isCurrent, isLast, isSpanish, bare = false, t }) {
  const title = isSpanish ? release.titleEs : release.titleEn;
  const body  = isSpanish ? release.bodyEs  : release.bodyEn;

  return (
    <div className="rn-section">
      {!bare && (
        <>
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
              <span className="pf-overline pf-overline--inline">
                {release.date}
              </span>
            )}
          </div>
          <h3 className="pf-account-card__section-title">
            {title}
          </h3>
        </>
      )}
      {/* The changelog is a list of changes and reads correctly as one. An
          announcement is being read as prose by someone who did not ask for
          it, and a diamond bullet per paragraph makes four sentences look
          like a spec. Same data, two shapes. */}
      {bare ? (
        <div className="rn-prose">
          {body.map((para, i) => <p key={i}>{para}</p>)}
        </div>
      ) : (
        <ul className="legal-list">
          {body.map((line, i) => (
            <li key={i} className="legal-list__item">{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
