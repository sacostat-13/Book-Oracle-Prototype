// src/components/ShareModal.jsx — v0.43
//
// Page-share modal: share a *destination* (Book Page, List, Club, Plan,
// Profile) as a link. The link preview itself is rendered server-side by
// netlify/edge-functions/og-prerender.js — this modal only has to get the
// URL into the right app.
//
// v0.74: every link leaving this modal carries its own ?s= token
// (src/lib/share/shareTracking.js), made at render so the intent hrefs and
// navigator.share stay inside the tap. A share is recorded when it happens:
// on the intent click, on copy (the button or a hand-selection of the visible
// URL), and after navigator.share resolves — not when the modal opens.
//
// Props:
//   title   — share sheet title (usually the entity name)
//   text    — one-line pitch used by intents and navigator.share
//   url     — canonical share URL (build via src/lib/share/shareService.js)
//   onClose

import { useId, useState } from 'react';
import { useT } from '../contexts/I18nContext';
import Modal from './primitives/Modal';
import {
  shareOrCopy,
  twitterIntent,
  whatsappIntent,
  telegramIntent,
} from '../lib/share/shareService';
import { prepareShare, recordShare } from '../lib/share/shareTracking';

export default function ShareModal({ title, text, url, onClose }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  const titleId = useId();

  // One token per way out, fixed for the life of the modal.
  const [links] = useState(() => ({
    copy: prepareShare(url),
    native: prepareShare(url),
    x: prepareShare(url),
    whatsapp: prepareShare(url),
    telegram: prepareShare(url),
  }));

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(links.copy.url);
      recordShare(links.copy, 'copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the visible URL is selectable */ }
  }

  async function nativeShare() {
    const result = await shareOrCopy({ title, text, url: links.native.url });
    if (result === 'shared') recordShare(links.native, 'native');
    else if (result === 'copied') recordShare(links.native, 'copy');
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} brackets="sm" className="share-modal">
      <div className="rating-modal__eyebrow">{t('share.modalEyebrow')}</div>
      <h2 className="rating-modal__title" id={titleId}>{title}</h2>

      <div className="share-modal__url-row">
        <code className="share-modal__url" onCopy={() => recordShare(links.copy, 'copy')}>{links.copy.url}</code>
        <button className="btn-tertiary btn--sm" onClick={copyLink}>
          {copied ? t('share.copied') : t('share.copyLink')}
        </button>
      </div>

      <div className="share-modal__targets">
        {hasNativeShare && (
          <button
            className="btn-primary"
            onClick={nativeShare}
          >
            {t('share.native')}
          </button>
        )}
        <a className="btn-secondary" href={twitterIntent({ text, url: links.x.url })} onClick={() => recordShare(links.x, 'x')} target="_blank" rel="noopener noreferrer">
          {t('share.onX')}
        </a>
        <a className="btn-secondary" href={whatsappIntent({ text, url: links.whatsapp.url })} onClick={() => recordShare(links.whatsapp, 'whatsapp')} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a className="btn-secondary" href={telegramIntent({ text, url: links.telegram.url })} onClick={() => recordShare(links.telegram, 'telegram')} target="_blank" rel="noopener noreferrer">
          Telegram
        </a>
      </div>

      <div className="modal__actions">
        <button className="btn-tertiary" onClick={onClose}>{t('share.close')}</button>
      </div>
    </Modal>
  );
}
