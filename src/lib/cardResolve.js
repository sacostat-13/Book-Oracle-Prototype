// src/lib/cardResolve.js
//
// Single source of truth for "does this moment render as a framed art card, and
// which asset folder does it use?" Shared by momentCopy (ShareCard) and the
// share-card URL builder so the two never diverge. No import of ShareCard here,
// so it's safe to import from shareCardImage without a cycle.

import { GENRE_CARD_META } from './genreCards';
import { CARD_GENRES } from './cardGenres';

// Non-genre moments that share one reusable frame (+ art, except book which uses
// the reader's cover). Values are folder slugs under public/cards/.
export const MOMENT_SLUGS = {
  series_completed: 'moment-series',
  nth_book:         'moment-milestone',
  goal_completed:   'moment-goal',
  plan_completed:   'moment-plan',
  book_completed:   'moment-book',
  // v0.55: 'female_authors_count' intentionally has no entry yet — art/frame
  // pending. Once /public/cards/moment-female-authors/{frame,art-trim}.png
  // exist and are added to CARD_GENRES, add
  //   female_authors_count: 'moment-female-authors',
  // here and the plain card in ShareCard.jsx upgrades to framed automatically
  // — no other logic change needed.
};

// The asset-folder slug for a moment, or null if it has no framed variant.
export function frameSlugFor(moment) {
  if (!moment) return null;
  if (moment.type === 'genre_count' || moment.type === 'new_genre') {
    const meta = GENRE_CARD_META[moment.genre];
    return meta ? meta.slug : null;
  }
  return MOMENT_SLUGS[moment.type] || null;
}

// True when the moment should render as the framed card (assets exist). For
// book_completed a cover is required, since the cover fills the slot.
export function isFramedMoment(moment) {
  const slug = frameSlugFor(moment);
  if (!slug || !CARD_GENRES.includes(slug)) return false;
  if (moment.type === 'book_completed') return !!moment.book?.coverUrl;
  return true;
}
