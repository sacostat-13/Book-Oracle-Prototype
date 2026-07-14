// src/lib/shareCardImage.js — v0.43
//
// Builds the URL for the server-rendered share-card PNG and fetches it as a
// File for the native share sheet. Pairs with netlify/functions/share-card.js.
//
// The function is i18n-agnostic: we resolve the card copy here (via the same
// momentCopy() used by the on-screen ShareCard) so the server just renders the
// finished strings + cover into the brand template.

import { momentCopy } from '../components/ShareCard';

const FN = '/.netlify/functions/share-card';

// Build the image URL for a moment. `t` is the I18n translate fn.
export function momentCardUrl(moment, t) {
  const copy = momentCopy(moment, t);
  const q = new URLSearchParams();
  if (copy.ornament) q.set('ornament', copy.ornament);
  if (copy.eyebrow)  q.set('eyebrow', copy.eyebrow);
  if (copy.headline) q.set('headline', copy.headline);
  if (copy.sub)      q.set('sub', copy.sub);
  if (copy.coverUrl) q.set('cover', copy.coverUrl);
  // Caption only when the headline isn't the book title itself (mirrors
  // ShareCard's showBookCaption rule).
  if (copy.title && !copy.headlineIsBook) {
    q.set('captionTitle', copy.title);
    if (copy.author) q.set('captionAuthor', copy.author);
  }
  return `${FN}?${q.toString()}`;
}

// Fetch the rendered PNG as a File (for navigator.share / download).
export async function momentCardFile(moment, t, filename = 'books-oracle-card.png') {
  const res = await fetch(momentCardUrl(moment, t));
  if (!res.ok) throw new Error(`share-card ${res.status}`);
  const blob = await res.blob();
  return new File([blob], filename, { type: 'image/png' });
}
