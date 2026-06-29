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
      style={{ position: 'fixed', inset: 0, background: 'rgba(10, 8, 6, 0.78)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: 'var(--ink, #1a1410)', border: '1px solid rgba(176, 140, 63, 0.35)', borderRadius: 'var(--ro-radius-sm)', maxWidth: '640px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)' }}>
        {/* Header */}
        <div style={{ padding: '1.6rem 2rem 1rem', borderBottom: '1px solid rgba(176, 140, 63, 0.2)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem' }}>
              {t('releaseNotes.changelog')}
            </div>
            <h2 style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1.7rem', color: 'var(--paper)', margin: 0 }}>
              {t('releaseNotes.whatsNew')}
            </h2>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} style={{ background: 'none', border: 'none', color: 'var(--paper-aged)', opacity: 0.7, cursor: 'pointer', fontSize: '1.6rem', lineHeight: 1, padding: '0.2rem 0.5rem' }}>
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '1.2rem 2rem 1.6rem', flex: 1 }}>
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
    <div style={{ paddingBottom: isLast ? 0 : '1.6rem', marginBottom: isLast ? 0 : '1.6rem', borderBottom: isLast ? 'none' : '1px solid rgba(176, 140, 63, 0.12)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.7rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.85rem', letterSpacing: '0.1em', color: isCurrent ? 'var(--gilt-bright)' : 'var(--gilt)', background: isCurrent ? 'rgba(176, 140, 63, 0.15)' : 'transparent', border: isCurrent ? '1px solid rgba(176, 140, 63, 0.4)' : 'none', padding: isCurrent ? '0.15rem 0.5rem' : '0.15rem 0', borderRadius: 'var(--ro-radius-sm)' }}>
          {release.version}
        </span>
        {isCurrent && (
          <span style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gilt-bright)' }}>
            {t('releaseNotes.currentBadge')}
          </span>
        )}
        {release.date && (
          <span style={{ fontSize: '0.75rem', color: 'var(--paper-aged)', opacity: 0.5, fontFamily: 'var(--ro-font-mono)' }}>
            {release.date}
          </span>
        )}
      </div>
      <h3 style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1.2rem', color: 'var(--paper)', margin: '0 0 0.6rem', lineHeight: 1.3 }}>
        {title}
      </h3>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--paper-aged)', lineHeight: 1.6, fontSize: '0.95rem' }}>
        {body.map((line, i) => (
          <li key={i} style={{ marginBottom: '0.4rem' }}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
