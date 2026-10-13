// src/components/AnnouncementModal.jsx — v0.37
// Shown when a user clicks an announcement notification.
// Receives the announcement data directly from the notification payload
// so it works without an extra DB fetch.

import { useId } from 'react';
import { useT } from '../contexts/I18nContext';
import Modal from './primitives/Modal';

export default function AnnouncementModal({ announcement, onClose }) {
  const t = useT();

  const titleId = useId();

  if (!announcement) return null;

  const { title, preview, body } = announcement;
  // Normalize both literal \n (stored as backslash-n) and real newlines
  const content = (body || preview || '').replace(/\\n/g, '\n');

  return (
    <Modal onClose={onClose} labelledBy={titleId} size="lg" layout="sections">
      {/* Header */}
      <div className="modal-head">
        <div>
          <div className="rn-version">
            {t('notifications.announcement')}
          </div>
          <h2 className="rn-title" id={titleId}>
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
          <p key={i} className="about-section__body">
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
    </Modal>
  );
}
