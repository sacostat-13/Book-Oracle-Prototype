// src/lib/shareCardImage.js — v0.43
//
// Builds the URL for the server-rendered share-card PNG and fetches it as a
// File for the native share sheet. Pairs with netlify/functions/share-card.js.
//
// The function is i18n-agnostic: we resolve the card copy here (via the same
// momentCopy() used by the on-screen ShareCard) so the server just renders the
// finished strings + cover into the brand template.

import { momentCopy } from '../components/ShareCard';
import { GENRE_CARD_META } from './genreCards';
import { CARD_GENRES } from './cardGenres';

const FN = '/.netlify/functions/share-card';

// Build the image URL for a moment. `t` is the I18n translate fn.
export function momentCardUrl(moment, t, lang) {
  const copy = momentCopy(moment, t, lang);
  const q = new URLSearchParams();
  if (copy.ornament) q.set('ornament', copy.ornament);
  if (copy.eyebrow)  q.set('eyebrow', copy.eyebrow);
  if (copy.headline) q.set('headline', copy.headline);
  if (copy.sub)      q.set('sub', copy.sub);
  if (copy.coverUrl) q.set('cover', copy.coverUrl);
  // Framed genre milestones pass the genre so the function loads that genre's
  // illustrated frame + art (public/cards/<genre>/) instead of a book cover.
  if (copy.cardGenre) q.set('genre', copy.cardGenre);
  // Caption only when the headline isn't the book title itself (mirrors
  // ShareCard's showBookCaption rule).
  if (copy.title && !copy.headlineIsBook) {
    q.set('captionTitle', copy.title);
    if (copy.author) q.set('captionAuthor', copy.author);
  }
  return `${FN}?${q.toString()}`;
}

// True when a moment renders as the framed genre-art card (has card assets).
export function isFramedMoment(moment) {
  if (!moment || (moment.type !== 'genre_count' && moment.type !== 'new_genre')) return false;
  const meta = GENRE_CARD_META[moment.genre];
  return !!meta && CARD_GENRES.includes(meta.slug);
}

// Fetch the rendered PNG as a File (for navigator.share / download).
export async function momentCardFile(moment, t, lang, filename = 'books-oracle-card.png') {
  const res = await fetch(momentCardUrl(moment, t, lang));
  if (!res.ok) throw new Error(`share-card ${res.status}`);
  const blob = await res.blob();
  return new File([blob], filename, { type: 'image/png' });
}
