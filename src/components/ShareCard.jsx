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

import { useT } from '../lib/I18nContext';

export const SHARE_CARD_WIDTH = 540;
export const SHARE_CARD_HEIGHT = 675;

// Exported so the server-render URL builder (src/lib/shareCardImage.js) can
// resolve the exact same copy with the client's t() and pass finished strings
// to the share-card function — keeping i18n on the client and the two renders
// in sync.
export function momentCopy(moment, t) {
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
    case 'genre_count':
      return {
        eyebrow: t('share.card.genreCountEyebrow'),
        headline: t('share.card.genreCountHeadline', { n: moment.n, genre: moment.genre }),
        sub: t('share.card.genreCountSub'),
        ornament: '⚜',
        ...bookLine,
      };
    case 'new_genre':
      return {
        eyebrow: t('share.card.newGenreEyebrow'),
        headline: moment.genre,
        sub: t('share.card.newGenreSub'),
        ornament: '✧',
        ...bookLine,
      };
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

export default function ShareCard({ moment, cardRef }) {
  const t = useT();
  const copy = momentCopy(moment, t);
  // When the headline already IS the book title, repeating a cover caption
  // underneath would be redundant — show the caption only otherwise.
  const showBookCaption = copy.title && !copy.headlineIsBook;

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
