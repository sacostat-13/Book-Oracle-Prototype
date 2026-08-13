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

// The generic fallback frame, for genres with no art of their own.
//
// The taxonomy grew from 15 seeds to 142 as the Oracle invented genres it
// needed, and commissioning art for each is not going to keep pace — 93 of them
// have no folder today. Without this, every one of those falls out of the
// framed path entirely and shares as the plain cover card, so "I finished my
// 10th Alien Invasion novel" looks materially cheaper than the same milestone
// in Horror. The reader did not do anything less impressive.
//
// The assets are moment-milestone's: a reader under a tower of books, ivy and
// stars around the border. Genre-neutral by construction — it was drawn to
// serve any milestone — which is exactly what a fallback needs to be.
export const GENERIC_CARD_SLUG = 'generic';

// The asset-folder slug for a moment, or null if it has no framed variant.
//
// `exact` = false (the default) allows the generic fallback. Pass true when you
// need to know whether the genre has art of its OWN — currently nothing does,
// but the distinction is the difference between "which folder do I load" and
// "is this genre illustrated yet", and conflating them is how the fallback
// would silently become invisible to a future art-coverage report.
export function frameSlugFor(moment, { exact = false } = {}) {
  if (!moment) return null;
  if (moment.type === 'genre_count' || moment.type === 'new_genre') {
    const meta = GENRE_CARD_META[moment.genre];
    if (meta && CARD_GENRES.includes(meta.slug)) return meta.slug;
    if (exact) return null;
    // Unknown genre, or one whose folder has not shipped yet.
    return moment.genre ? GENERIC_CARD_SLUG : null;
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
