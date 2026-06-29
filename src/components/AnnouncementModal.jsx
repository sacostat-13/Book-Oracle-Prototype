// src/components/AnnouncementModal.jsx — v0.37
// Shown when a user clicks an announcement notification.
// Receives the announcement data directly from the notification payload
// so it works without an extra DB fetch.

import { useEffect } from 'react';
import { useT } from '../lib/I18nContext';

export default function AnnouncementModal({ announcement, onClose }) {
  const t = useT();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (!announcement) return null;

  const { title, preview, body } = announcement;
  // Normalize both literal \n (stored as backslash-n) and real newlines
  const content = (body || preview || '').replace(/\\n/g, '\n');

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(10, 8, 6, 0.78)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: 'var(--ink, #1a1410)',
        border: '1px solid rgba(176, 140, 63, 0.35)',
        borderRadius: 'var(--ro-radius-sm)',
        maxWidth: '560px', width: '100%',
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.6rem 2rem 1rem',
          borderBottom: '1px solid rgba(176, 140, 63, 0.2)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--ro-font-mono)', fontSize: '0.7rem',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--gilt)', marginBottom: '0.4rem',
            }}>
              {t('notifications.announcement')}
            </div>
            <h2 style={{
              fontFamily: 'var(--ro-font-display)', fontStyle: 'italic',
              fontSize: '1.7rem', color: 'var(--paper)', margin: 0, lineHeight: 1.2,
            }}>
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              background: 'none', border: 'none', color: 'var(--paper-aged)',
              opacity: 0.7, cursor: 'pointer', fontSize: '1.6rem',
              lineHeight: 1, padding: '0.2rem 0.5rem', flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '1.4rem 2rem 1.8rem', flex: 1 }}>
          {content.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} style={{
              color: 'var(--paper-aged)', lineHeight: 1.75, fontSize: '0.95rem',
              margin: '0 0 0.85rem',
            }}>
              {para}
            </p>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 2rem',
          borderTop: '1px solid rgba(176, 140, 63, 0.12)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
