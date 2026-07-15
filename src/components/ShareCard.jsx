// src/components/ShareCard.jsx — v0.43
//
// The branded share-card template. Rendered in the DOM at 540×675 (4:5) as an
// on-screen preview; the shared PNG (1080×1350) is produced server-side by
// netlify/functions/share-card.js, so it works for Instagram, X, WhatsApp and
// stories-style sharing without CORS-tainting on third-party covers.
//
// NOTE on styling: unlike app surfaces, the card deliberately does NOT use
// the --ro-* theme variables. It's a fixed brand asset — the exported PNG
// must look identical whether the user is in dark or parchment theme, so
// its palette is hardcoded to the Dark Academia brand constants here.
// (This same design is reproduced with satori in
// netlify/functions/share-card.js for the shared/OG PNG — keep the two in
// sync when touching either.)
//
// `moment` shapes come from src/lib/shareMoments.js, plus the non-completion
// variants fired directly by views:
//   { type: 'session_created', clubName, bookTitle, bookAuthor, coverUrl, startsAt, endsAt }
//   { type: 'session_done',    clubName, bookTitle, bookAuthor, coverUrl }

import { useI18n } from '../lib/I18nContext';
import { GENRE_CARD_META } from '../lib/genreCards';
import { CARD_GENRES } from '../lib/cardGenres';
import { frameSlugFor } from '../lib/cardResolve';
import { CARD_BOXES, DEFAULT_BOX } from '../lib/cardBoxes';

export const SHARE_CARD_WIDTH = 540;
export const SHARE_CARD_HEIGHT = 675;

// Exported so the server-render URL builder (src/lib/shareCardImage.js) can
// resolve the exact same copy with the client's t() and pass finished strings
// to the share-card function — keeping i18n on the client and the two renders
// in sync.
function baseCopy(moment, t, lang) {
  const b = moment.book;
  const bookLine = b ? { title: b.t, author: b.a, coverUrl: b.coverUrl } : {};
  switch (moment.type) {
    case 'goal_completed':
      return {
        eyebrow: t('share.card.goalEyebrow'),
        headline: t('share.card.goalHeadline', { goal: moment.goal, year: moment.year }),
        sub: t('share.card.goalSub'),
        ornament: '✦',
        ...bookLine,
      };
    case 'series_completed':
      return {
        eyebrow: t('share.card.seriesEyebrow'),
        headline: moment.seriesName,
        sub: t('share.card.seriesSub', { total: moment.total }),
        ornament: '☩',
        ...bookLine,
      };
    case 'plan_completed':
      return {
        eyebrow: t('share.card.planEyebrow'),
        headline: moment.planTitle,
        sub: t('share.card.planSub', { count: moment.count }),
        ornament: '❦',
        ...bookLine,
      };
    case 'nth_book':
      return {
        eyebrow: t('share.card.nthEyebrow', { year: moment.year }),
        headline: t('share.card.nthHeadline', { n: moment.n }),
        sub: t('share.card.nthSub'),
        ornament: '✺',
        ...bookLine,
      };
    case 'genre_count': {
      const meta = GENRE_CARD_META[moment.genre];
      return {
        eyebrow: t('share.card.genreCountEyebrow'),
        headline: t('share.card.genreCountHeadline', { n: moment.n, genre: moment.genre }),
        // Per-genre sub-line (English) when available; generic i18n otherwise.
        sub: (lang === 'en' && meta?.sub) || t('share.card.genreCountSub'),
        ornament: '⚜',
        ...bookLine,
      };
    }
    case 'new_genre': {
      const meta = GENRE_CARD_META[moment.genre];
      return {
        eyebrow: t('share.card.newGenreEyebrow'),
        headline: moment.genre,
        sub: (lang === 'en' && meta?.sub) || t('share.card.newGenreSub'),
        ornament: '✧',
        ...bookLine,
      };
    }
    case 'session_created':
      return {
        eyebrow: t('share.card.sessionCreatedEyebrow'),
        headline: moment.bookTitle,
        sub: t('share.card.sessionCreatedSub', { club: moment.clubName }),
        ornament: '❧',
        title: moment.bookTitle,
        author: moment.bookAuthor,
        coverUrl: moment.coverUrl,
        headlineIsBook: true,
      };
    case 'session_done':
      return {
        eyebrow: t('share.card.sessionDoneEyebrow'),
        headline: moment.bookTitle,
        sub: t('share.card.sessionDoneSub', { club: moment.clubName }),
        ornament: '❧',
        title: moment.bookTitle,
        author: moment.bookAuthor,
        coverUrl: moment.coverUrl,
        headlineIsBook: true,
      };
    case 'book_completed':
    default:
      return {
        eyebrow: t('share.card.bookEyebrow'),
        headline: b?.t || '',
        sub: b?.a ? t('share.card.bookSub', { author: b.a }) : '',
        ornament: '❦',
        ...bookLine,
        headlineIsBook: true,
      };
  }
}

export function momentCopy(moment, t, lang) {
  return withFramed(moment, baseCopy(moment, t, lang));
}

// If this moment has a ready framed-card asset, swap the cover-led fields for the
// genre/moment frame + art. book_completed keeps the reader's cover in the slot.
function withFramed(moment, copy) {
  const slug = frameSlugFor(moment);
  if (!slug || !CARD_GENRES.includes(slug)) return copy;
  const isBook = moment.type === 'book_completed';
  const cover = copy.coverUrl;
  if (isBook && !cover) return copy; // no cover to fill the slot -> keep the plain card
  // eslint-disable-next-line no-unused-vars
  const { coverUrl, title, author, headlineIsBook, ...rest } = copy;
  return {
    ...rest,
    framed: true,
    frameSlug: slug,
    box: CARD_BOXES[slug] || DEFAULT_BOX,
    frameUrl: `/cards/${slug}/frame.png`,
    artUrl: isBook ? cover : `/cards/${slug}/art-trim.png`,
    ...(isBook ? { coverUrl: cover } : {}),
  };
}

export default function ShareCard({ moment, cardRef }) {
  const { t, lang } = useI18n();
  const copy = momentCopy(moment, t, lang);
  // When the headline already IS the book title, repeating a cover caption
  // underneath would be redundant — show the caption only otherwise.
  const showBookCaption = copy.title && !copy.headlineIsBook;

  // Framed genre milestone: illustrated frame + genre art from /cards/<genre>/,
  // composed here in the DOM so the preview matches the server-rendered PNG
  // without needing the share-card function. Mirrors netlify/functions/share-card.mjs.
  if (copy.framed) {
    const bx = copy.box || DEFAULT_BOX;
    // DOM card is half the 1080x1350 master, so halve the measured opening.
    const B = { left: bx.x / 2, top: bx.y / 2, width: bx.w / 2, height: bx.h / 2 };
    const h = copy.headline || '';
    const titleSize = h.length > 44 ? 24 : h.length > 32 ? 29 : h.length > 22 ? 34 : 39;
    const lines = Math.max(1, Math.ceil((h.length * 0.40 * titleSize) / B.width));
    const artMaxH = Math.max(90, Math.min(235, B.height - (99 + lines * titleSize * 1.05)));
    return (
      <div
        ref={cardRef}
        className="share-card share-card--framed"
        style={{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, position: 'relative', backgroundColor: '#141210', overflow: 'hidden' }}
      >
        <img src={copy.frameUrl} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        <div style={{ position: 'absolute', left: B.left, top: B.top, width: B.width, height: B.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <svg width="34" height="34" viewBox="0 0 100 100" style={{ marginBottom: 9 }}>
              <g fill="none" stroke="#D8B85E" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M50,30 C40,22 24,22 14,28 L14,72 C24,66 40,66 50,74 C60,66 76,66 86,72 L86,28 C76,22 60,22 50,30 Z" />
                <path d="M50,30 L50,74" strokeWidth="2.6" />
                <path d="M22,40 C30,37 38,37 44,40 M22,52 C30,49 38,49 44,52" stroke="#C9A84C" strokeWidth="2" />
                <path d="M56,40 C62,37 70,37 78,40 M56,52 C62,49 70,49 78,52" stroke="#C9A84C" strokeWidth="2" />
              </g>
            </svg>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, letterSpacing: 3.5, textTransform: 'uppercase', color: '#D8B85E', marginBottom: 12 }}>{copy.eyebrow}</div>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: titleSize, lineHeight: 1.0, color: '#E9DFCA' }}>{copy.headline}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '6px 0' }}>
            <div style={{ padding: 4, backgroundColor: '#141210', border: '1px solid #C9A84C', borderRadius: 4 }}>
              <img src={copy.artUrl} alt="" style={{ maxWidth: B.width - 14, maxHeight: artMaxH, objectFit: 'contain', display: 'block' }} />
            </div>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(201,168,76,0.72)' }}>The Books Oracle · thebooksoracle.com</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="share-card"
      style={{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }}
    >
      <div className="share-card__frame">
        <div className="share-card__ornament">{copy.ornament}</div>
        <div className="share-card__eyebrow">{copy.eyebrow}</div>
        <div className="share-card__headline">{copy.headline}</div>
        {copy.sub && <div className="share-card__sub">{copy.sub}</div>}

        {copy.coverUrl && (
          <div className="share-card__cover-wrap">
            {/* No crossOrigin: this <img> is now only an on-screen preview.
                The shared PNG is rendered server-side by the share-card
                function, so we no longer draw this cover onto a canvas — which
                is what forced (and then failed) the CORS request before. */}
            <img
              className="share-card__cover"
              src={copy.coverUrl}
              alt=""
            />
          </div>
        )}
        {showBookCaption && (
          <div className="share-card__book-caption">
            <span className="share-card__book-title">{copy.title}</span>
            {copy.author && <span className="share-card__book-author"> — {copy.author}</span>}
          </div>
        )}

        <div className="share-card__footer">
          <span className="share-card__footer-glyph">✦</span>
          <span className="share-card__footer-brand">The Books Oracle</span>
          <span className="share-card__footer-url">thebooksoracle.com</span>
        </div>
      </div>
    </div>
  );
}
