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
      className="rating-modal-overlay"
    >
      <div className="rating-modal modal-wide">
        {/* Header */}
        <div className="modal-head">
          <div>
            <div className="rn-version">
              {t('notifications.announcement')}
            </div>
            <h2 className="rn-title">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="modal-close-btn"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {content.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className="about-section__body" style={{ margin: "0 0 0.85rem" }}>
              {para}
            </p>
          ))}
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <button className="btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
