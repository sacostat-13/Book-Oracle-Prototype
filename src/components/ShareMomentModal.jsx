// src/components/ShareMomentModal.jsx — v0.43
//
// Action-share modal: appears after a completion event (book, series, plan,
// reading goal, club session, milestone) and shows the branded ShareCard
// with share/download actions. The on-screen card is a live DOM preview; the
// shared PNG (1080×1350) is rendered by the share-card Netlify function.
//
// Rendered once, globally, from App.jsx — reads the pending moment from
// DataContext (state-only, never persisted). Views that own their own
// moments (SessionCreate/SessionDetail) fire showShareMoment() with a
// prebuilt moment object instead.
//
// The shared image is rendered server-side by the share-card Netlify function
// (netlify/functions/share-card.js). It fetches the cover server-to-server, so
// the CORS-taint that used to break the old html-to-image canvas export is
// gone. The on-screen <ShareCard> is now purely a preview. If the function
// ever fails we still degrade to sharing text + link — never a broken PNG.

import { useRef, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import CornerBrackets from './CornerBrackets';
import ShareCard from './ShareCard';
import { shareOrCopy, canShareFile } from '../lib/shareService';
import { momentCardFile } from '../lib/shareCardImage';

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

  async function handleShareImage() {
    setBusy(true);
    setFeedback(null);
    let objectUrl = null;
    try {
      // Server-rendered PNG (cover fetched server-side — no CORS taint).
      const file = await momentCardFile(moment, t);
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
      objectUrl = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'books-oracle-card.png';
      a.click();
      try { await navigator.clipboard.writeText(`${text} ${url}`); } catch { /* optional */ }
      setFeedback('downloaded');
    } catch (err) {
      // Function unreachable / render error. Degrade to text + link.
      console.warn('share card image failed', err);
      setFeedback('image_failed');
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
