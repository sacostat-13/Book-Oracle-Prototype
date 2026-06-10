import { useEffect } from 'react';
import { useI18n } from '../lib/I18nContext';
import { publishedReleases, CURRENT_VERSION } from '../lib/releases';

// Release notes modal. Shows all published releases newest-first, with
// the current version visually distinguished. Localized via the i18n
// context — content for each release lives in `releases.js`.
//
// The modal uses the same backdrop / dismiss-on-Esc pattern as BookModal
// and RatingModal for consistency. Scrollable body for the long history.
export default function ReleaseNotesModal({ onClose }) {
  const { lang } = useI18n();
  const releases = publishedReleases();
  const isSpanish = lang === 'es';

  // Esc to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 8, 6, 0.78)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'var(--ink, #1a1410)',
          border: '1px solid rgba(176, 140, 63, 0.35)',
          borderRadius: '4px',
          maxWidth: '640px',
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.6rem 2rem 1rem',
            borderBottom: '1px solid rgba(176, 140, 63, 0.2)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Special Elite', monospace",
                fontSize: '0.7rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--gilt)',
                marginBottom: '0.4rem',
              }}
            >
              {isSpanish ? 'Historial' : 'Changelog'}
            </div>
            <h2
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontStyle: 'italic',
                fontSize: '1.7rem',
                color: 'var(--paper)',
                margin: 0,
              }}
            >
              {isSpanish ? 'Novedades' : "What's new"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={isSpanish ? 'Cerrar' : 'Close'}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--paper-aged)',
              opacity: 0.7,
              cursor: 'pointer',
              fontSize: '1.6rem',
              lineHeight: 1,
              padding: '0.2rem 0.5rem',
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div
          style={{
            overflowY: 'auto',
            padding: '1.2rem 2rem 1.6rem',
            flex: 1,
          }}
        >
          {releases.map((r, i) => (
            <ReleaseEntry
              key={r.version}
              release={r}
              isCurrent={r.version === CURRENT_VERSION}
              isLast={i === releases.length - 1}
              isSpanish={isSpanish}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReleaseEntry({ release, isCurrent, isLast, isSpanish }) {
  const title = isSpanish ? release.titleEs : release.titleEn;
  const body = isSpanish ? release.bodyEs : release.bodyEn;

  return (
    <div
      style={{
        paddingBottom: isLast ? 0 : '1.6rem',
        marginBottom: isLast ? 0 : '1.6rem',
        borderBottom: isLast ? 'none' : '1px solid rgba(176, 140, 63, 0.12)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.7rem',
          marginBottom: '0.6rem',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            color: isCurrent ? 'var(--gilt-bright)' : 'var(--gilt)',
            background: isCurrent ? 'rgba(176, 140, 63, 0.15)' : 'transparent',
            border: isCurrent ? '1px solid rgba(176, 140, 63, 0.4)' : 'none',
            padding: isCurrent ? '0.15rem 0.5rem' : '0.15rem 0',
            borderRadius: '2px',
          }}
        >
          {release.version}
        </span>
        {isCurrent && (
          <span
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.65rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--gilt-bright)',
            }}
          >
            ☩ {isSpanish ? 'actual' : 'current'}
          </span>
        )}
        {release.date && (
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--paper-aged)',
              opacity: 0.5,
              fontFamily: "'Special Elite', monospace",
            }}
          >
            {release.date}
          </span>
        )}
      </div>
      <h3
        style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontStyle: 'italic',
          fontSize: '1.2rem',
          color: 'var(--paper)',
          margin: '0 0 0.6rem',
          lineHeight: 1.3,
        }}
      >
        {title}
      </h3>
      <ul
        style={{
          margin: 0,
          paddingLeft: '1.1rem',
          color: 'var(--paper-aged)',
          lineHeight: 1.6,
          fontSize: '0.95rem',
        }}
      >
        {body.map((line, i) => (
          <li key={i} style={{ marginBottom: '0.4rem' }}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
