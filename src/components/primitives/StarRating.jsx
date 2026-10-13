// src/components/primitives/StarRating.jsx — a reader's 1–5★ rating, read-only.
//
// Replaces '★'.repeat(n) copies in eight places. It renders the same DOM they
// did — filled stars as text, then (optionally) the remaining empty stars in an
// inner <span> that the surrounding stylesheet dims — so every existing style
// (.bp-stars__empty, .feed-stars span, .dim, …) keeps working. What it adds:
// clamping to 0–5, whole stars only, and an accessible name ("4 of 5 stars")
// instead of a screen reader spelling out "black star" four times.
//
// For the rating form itself (clickable stars) see RatingModal.

import { useT } from '../../lib/I18nContext';

const MAX = 5;

/** Clamp a rating to a whole number of stars in 0–5. */
export function clampStars(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(MAX, n));
}

/**
 * A rating as plain text, e.g. for a title="" tooltip: "★★★★".
 * @param {number} value
 * @returns {string} '' when unrated
 */
export function starString(value) {
  return '★'.repeat(clampStars(value));
}

/**
 * @param {object} props
 * @param {number} props.value              the rating; renders nothing when 0/empty
 * @param {boolean} [props.showEmpty=false]  also render the 5−n empty stars
 * @param {string} [props.emptyClassName]    class for the empty-stars span (else styled by the parent)
 * @param {'span'|'div'} [props.as='span']   wrapper element
 * @param {string} [props.className]         wrapper class (existing per-context styling)
 */
export default function StarRating({ value, showEmpty = false, emptyClassName, as: Tag = 'span', className }) {
  const t = useT();
  const n = clampStars(value);
  if (n === 0) return null;
  return (
    <Tag className={className} role="img" aria-label={t('rating.starsAria', { count: n })}>
      {'★'.repeat(n)}
      {showEmpty && n < MAX && <span className={emptyClassName} aria-hidden="true">{'★'.repeat(MAX - n)}</span>}
    </Tag>
  );
}
