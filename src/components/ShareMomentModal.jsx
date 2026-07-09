// src/components/ShareMomentModal.jsx — v0.43
//
// Action-share modal: appears after a completion event (book, series, plan,
// reading goal, club session, milestone) and shows the branded ShareCard
// with share/download actions. The card is a live DOM node exported to PNG
// with html-to-image at 2× (1080×1350).
//
// Rendered once, globally, from App.jsx — reads the pending moment from
// DataContext (state-only, never persisted). Views that own their own
// moments (SessionCreate/SessionDetail) fire showShareMoment() with a
// prebuilt moment object instead.
//
// Cover images come from third-party hosts (OpenLibrary, Wikimedia, …).
// Export needs CORS-approved image data; when a host refuses, html-to-image
// throws and we fall back to sharing text + link — never a broken PNG.

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';
import ShareCard from './ShareCard';
import { shareOrCopy, canShareFile } from '../lib/shareService';

const EXPORT_PIXEL_RATIO = 2; // 540×675 → 1080×1350

function momentShareText(moment, t) {
  switch (moment.type) {
    case 'goal_completed': return t('share.text.goal', { goal: moment.goal, year: moment.year });
    case 'series_completed': return t('share.text.series', { series: moment.seriesName });
    case 'plan_completed': return t('share.text.plan', { plan: moment.planTitle });
    case 'nth_book': return t('share.text.nth', { n: moment.n, year: moment.year });
    case 'genre_count': return t('share.text.genreCount', { n: moment.n, genre: moment.genre });
    case 'new_genre': return t('share.text.newGenre', { genre: moment.genre });
    case 'session_created': return t('share.text.sessionCreated', { book: moment.bookTitle, club: moment.clubName });
    case 'session_done': return t('share.text.sessionDone', { book: moment.bookTitle, club: moment.clubName });
    case 'book_completed':
    default: return t('share.text.book', { title: moment.book?.t || '', author: moment.book?.a || '' });
  }
}

export default function ShareMomentModal() {
  const { shareMoment, dismissShareMoment } = useData();
  const t = useT();
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // 'shared' | 'copied' | 'downloaded' | 'image_failed'

  if (!shareMoment) return null;

  const moment = shareMoment;
  const text = momentShareText(moment, t);
  const url = moment.url || 'https://thebooksoracle.com';

  async function exportPng() {
    // filter skips the corner-bracket helper if it ever ends up inside the
    // card; fontEmbedCSS is left to html-to-image's default (it inlines the
    // Google-hosted fonts so the PNG matches the DOM).
    return toPng(cardRef.current, {
      pixelRatio: EXPORT_PIXEL_RATIO,
      cacheBust: true,
    });
  }

  async function handleShareImage() {
    setBusy(true);
    setFeedback(null);
    try {
      const dataUrl = await exportPng();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'books-oracle-card.png', { type: 'image/png' });
      if (canShareFile(file)) {
        try {
          await navigator.share({ files: [file], title: 'The Books Oracle', text: `${text} ${url}` });
          setFeedback('shared');
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
          // fall through to download
        }
      }
      // Desktop path: download the PNG, put the text on the clipboard.
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'books-oracle-card.png';
      a.click();
      try { await navigator.clipboard.writeText(`${text} ${url}`); } catch { /* optional */ }
      setFeedback('downloaded');
    } catch (err) {
      // Almost always a CORS-tainted cover image. Degrade to text + link.
      console.warn('share card export failed', err);
      setFeedback('image_failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleShareLink() {
    const result = await shareOrCopy({ title: 'The Books Oracle', text, url });
    setFeedback(result === 'failed' ? null : result);
  }

  return (
    <div
      className="rating-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) dismissShareMoment(); }}
    >
      <div className="rating-modal share-moment-modal">
        <CornerBrackets size="sm" />
        <div className="rating-modal__eyebrow">{t('share.momentEyebrow')}</div>

        <div className="share-moment-modal__card-scale">
          <ShareCard moment={moment} cardRef={cardRef} />
        </div>

        {feedback === 'image_failed' && (
          <p className="share-moment-modal__note">{t('share.imageFailed')}</p>
        )}
        {feedback === 'downloaded' && (
          <p className="share-moment-modal__note">{t('share.downloaded')}</p>
        )}
        {feedback === 'copied' && (
          <p className="share-moment-modal__note">{t('share.copied')}</p>
        )}

        <div className="modal__actions">
          <button className="btn-tertiary" onClick={dismissShareMoment} disabled={busy}>
            {t('share.notNow')}
          </button>
          <button className="btn-secondary" onClick={handleShareLink} disabled={busy}>
            {t('share.shareLink')}
          </button>
          <button className="btn-primary" onClick={handleShareImage} disabled={busy}>
            {busy ? t('share.preparing') : t('share.shareImage')}
          </button>
        </div>
      </div>
    </div>
  );
}
