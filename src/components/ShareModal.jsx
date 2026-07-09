// src/components/ShareModal.jsx — v0.43
//
// Page-share modal: share a *destination* (Book Page, List, Club, Plan,
// Profile) as a link. The link preview itself is rendered server-side by
// netlify/edge-functions/og-prerender.js — this modal only has to get the
// URL into the right app.
//
// Props:
//   title   — share sheet title (usually the entity name)
//   text    — one-line pitch used by intents and navigator.share
//   url     — canonical share URL (build via src/lib/shareService.js)
//   onClose

import { useEffect, useState } from 'react';
import { useT } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';
import {
  shareOrCopy,
  twitterIntent,
  whatsappIntent,
  telegramIntent,
} from '../lib/shareService';

export default function ShareModal({ title, text, url, onClose }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the visible URL is selectable */ }
  }

  return (
    <div
      className="rating-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="rating-modal share-modal">
        <CornerBrackets size="sm" />
        <div className="rating-modal__eyebrow">{t('share.modalEyebrow')}</div>
        <h2 className="rating-modal__title">{title}</h2>

        <div className="share-modal__url-row">
          <code className="share-modal__url">{url}</code>
          <button className="btn-tertiary btn--sm" onClick={copyLink}>
            {copied ? t('share.copied') : t('share.copyLink')}
          </button>
        </div>

        <div className="share-modal__targets">
          {hasNativeShare && (
            <button
              className="btn-primary"
              onClick={() => shareOrCopy({ title, text, url })}
            >
              {t('share.native')}
            </button>
          )}
          <a className="btn-secondary" href={twitterIntent({ text, url })} target="_blank" rel="noopener noreferrer">
            {t('share.onX')}
          </a>
          <a className="btn-secondary" href={whatsappIntent({ text, url })} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a className="btn-secondary" href={telegramIntent({ text, url })} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
        </div>

        <div className="modal__actions">
          <button className="btn-tertiary" onClick={onClose}>{t('share.close')}</button>
        </div>
      </div>
    </div>
  );
}
