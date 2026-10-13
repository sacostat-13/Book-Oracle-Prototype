// src/lib/scoring/localMatch.js — Local Match %: how well a book fits this reader.
//
// Pure arithmetic against the taste profile (tasteProfile.js); no LLM. Used
// wherever we score candidates we can inspect (Oracle wishlist/Vault draws).
// docs/reference/MATH.md §3 — change a weight there and here together.

/** Share of the blend carried by genre affinity when both signals exist. */
export const GENRE_WEIGHT = 0.7;
/** Share carried by complexity/depth fit. Must be 1 − GENRE_WEIGHT. */
export const FIT_WEIGHT = 0.3;
/** Genre score for a stated favourite with no rating history (vs. avg★/5 when rated). */
export const FAVOURITE_GENRE_CREDIT = 0.75;
/** Distance on the 1–5 scale at which fit reaches 0 (the full range). */
export const FIT_DISTANCE_RANGE = 4;


// Scores a single candidate against the taste profile. Returns 0-100, or
// null if there's genuinely no usable signal for this book (missing genre
// AND missing complexity/depth AND no favorite-genre overlap) — callers
// should just omit the badge in that case rather than show a fake number.
export function computeLocalMatch(book, tasteProfile, genresByBookId) {
  if (!tasteProfile?.hasSignal) return null;

  const tagged = genresByBookId?.[book.bookId];
  const genres = (tagged && tagged.length > 0) ? tagged : (book.g ? [{ name: book.g }] : []);
  const genreNames = genres.map((g) => g.name).filter(Boolean);

  // Genre affinity (0.2-1): best-matching genre's average rating divided by 5,
  // so a 1★ genre still counts 20%. Intended (decided 2026-10-12, docs/reference/MATH.md
  // §3): a genre the reader rated low is weak evidence, not proof of dislike.
  // If no rating history but it matches a stated favorite genre, give partial
  // credit rather than nothing.
  let genreScore = null;
  if (genreNames.length > 0) {
    const ratedMatches = genreNames
      .map((n) => tasteProfile.genreAffinity[n])
      .filter((v) => v != null);
    if (ratedMatches.length > 0) {
      genreScore = Math.max(...ratedMatches) / 5;
    } else if (genreNames.some((n) => tasteProfile.favoriteGenres.includes(n))) {
      genreScore = FAVOURITE_GENRE_CREDIT;
    }
  }

  // Complexity/depth fit (0-1): closeness to the level of books they've
  // actually rated highly. 1 = exact match, decreasing linearly to 0 at a
  // difference of 4 (the full 1-5 range).
  const fits = [];
  if (book.c && tasteProfile.avgComplexity != null) {
    fits.push(1 - Math.min(1, Math.abs(book.c - tasteProfile.avgComplexity) / FIT_DISTANCE_RANGE));
  }
  if (book.p && tasteProfile.avgDepth != null) {
    fits.push(1 - Math.min(1, Math.abs(book.p - tasteProfile.avgDepth) / FIT_DISTANCE_RANGE));
  }
  const fitScore = fits.length > 0 ? fits.reduce((a, b) => a + b, 0) / fits.length : null;

  // Blend — genre affinity carries most of the signal when both are present.
  let combined;
  if (genreScore != null && fitScore != null) combined = genreScore * GENRE_WEIGHT + fitScore * FIT_WEIGHT;
  else if (genreScore != null) combined = genreScore;
  else if (fitScore != null) combined = fitScore;
  else return null;

  return Math.round(combined * 100);
}
