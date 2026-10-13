// src/lib/scoring/similarity.js — "how alike are these two books?", once.
//
// Two surfaces rank books by likeness, with different emphases:
//   - the Book page's "You might also like" (BOOK_PAGE_WEIGHTS), which knows
//     the target's Oracle genres and author;
//   - Find Similar's fallback (SEED_WEIGHTS), which compares candidates to the
//     1–3 seed books the reader picked, using the legacy single genre.
// They used to be two hand-written loops with their own numbers. Now each is a
// weight preset over the same signals, so changing what "similar" means is one
// edit here. docs/reference/MATH.md §6–7. Both presets reproduce the previous
// scores exactly (tests/scoring.test.js compares against frozen copies).

import { bookKey } from '../book/bookHelpers';

/**
 * @typedef {object} SimilarityWeights
 * @property {number} perSharedGenre     points per Oracle genre both books carry
 * @property {number} legacyGenre        points when the legacy genre `g` matches
 * @property {boolean} legacyGenreOnlyWithoutOracleGenres
 *           true: legacy genre counts only when the target has no Oracle genres
 * @property {number} sameAuthor          points for an identical author string
 * @property {number} complexityWithin1   points when prose complexity differs by ≤ 1
 * @property {number} depthWithin1        points when thematic depth differs by ≤ 1
 * @property {number} pagesWithin30Pct    points when page counts differ by < 30 %
 */

/** "You might also like" on the Book page (MATH §6). */
export const BOOK_PAGE_WEIGHTS = Object.freeze({
  perSharedGenre: 4,
  legacyGenre: 3,
  legacyGenreOnlyWithoutOracleGenres: true,
  sameAuthor: 3,
  complexityWithin1: 1,
  depthWithin1: 0,
  pagesWithin30Pct: 1,
});

/** Find Similar's fallback, per seed book (MATH §7). Max 6 per seed. */
export const SEED_WEIGHTS = Object.freeze({
  perSharedGenre: 0,
  legacyGenre: 3,
  legacyGenreOnlyWithoutOracleGenres: false,
  sameAuthor: 0,
  complexityWithin1: 2,
  depthWithin1: 1,
  pagesWithin30Pct: 0,
});

/**
 * Likeness of `candidate` to `target` under `weights`. Higher is more alike;
 * 0 means no shared signal.
 *
 * @param {object} target     book (client shape: t, a, g, c, p, pp, bookId)
 * @param {object} candidate  book
 * @param {SimilarityWeights} weights
 * @param {Record<string, Array<{genreId: string}>>} [genresByBookId]  Oracle genres
 * @returns {number}
 */
export function similarityScore(target, candidate, weights, genresByBookId) {
  let score = 0;

  const targetGenreIds = weights.perSharedGenre || weights.legacyGenreOnlyWithoutOracleGenres
    ? new Set((genresByBookId?.[target.bookId] || []).map((g) => g.genreId))
    : null;

  if (weights.perSharedGenre) {
    const shared = (genresByBookId?.[candidate.bookId] || []).filter((g) => targetGenreIds.has(g.genreId)).length;
    score += shared * weights.perSharedGenre;
  }

  if (weights.legacyGenre && target.g && candidate.g === target.g) {
    if (!weights.legacyGenreOnlyWithoutOracleGenres || targetGenreIds.size === 0) score += weights.legacyGenre;
  }

  if (weights.sameAuthor && target.a && candidate.a && candidate.a === target.a) score += weights.sameAuthor;

  if (weights.complexityWithin1 && target.c && candidate.c && Math.abs(candidate.c - target.c) <= 1) {
    score += weights.complexityWithin1;
  }

  if (weights.depthWithin1 && target.p && candidate.p && Math.abs(candidate.p - target.p) <= 1) {
    score += weights.depthWithin1;
  }

  if (weights.pagesWithin30Pct && target.pp && candidate.pp) {
    const ratio = target.pp > 0 ? Math.abs(candidate.pp - target.pp) / target.pp : 1;
    if (ratio < 0.3) score += weights.pagesWithin30Pct;
  }

  return score;
}

/** Highest score one comparison can reach under `weights` (genre overlap excluded — unbounded). */
export function maxScore(weights) {
  return weights.legacyGenre + weights.sameAuthor + weights.complexityWithin1 + weights.depthWithin1 + weights.pagesWithin30Pct;
}

/**
 * Books from `pool` most like `target`, best first ("You might also like").
 * Skips the target itself and anything in `exclude`; drops score-0 books.
 * Ties keep pool order.
 *
 * @param {object} target
 * @param {object[]} pool
 * @param {{ genresByBookId?: object, limit?: number, exclude?: Set<string>, weights?: SimilarityWeights }} [opts]
 *        `exclude`: bookKeys never to offer (in practice: books the reader finished)
 * @returns {object[]}
 */
export function rankSimilar(target, pool, { genresByBookId, limit = 12, exclude, weights = BOOK_PAGE_WEIGHTS } = {}) {
  const targetKey = bookKey(target);
  return (pool || [])
    .filter((b) => bookKey(b) !== targetKey)
    .filter((b) => !exclude || !exclude.has(bookKey(b)))
    .map((book) => ({ book, score: similarityScore(target, book, weights, genresByBookId) }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((s) => s.book);
}

/**
 * Candidates most like a set of seed books, scored by summing per-seed
 * likeness, with a 0–100 match % relative to the best possible total.
 *
 * @param {object[]} seeds        the reader's picks (1–3)
 * @param {object[]} candidates
 * @param {{ limit?: number, weights?: SimilarityWeights }} [opts]
 * @returns {Array<object & { match?: number }>}
 */
export function rankBySeeds(seeds, candidates, { limit = 5, weights = SEED_WEIGHTS } = {}) {
  const scored = (candidates || []).map((book) => ({
    book,
    score: seeds.reduce((sum, seed) => sum + similarityScore(seed, book, weights), 0),
  }));
  scored.sort((x, y) => y.score - x.score);
  const maxPossible = seeds.length * maxScore(weights);
  return scored.slice(0, limit).map((s) => ({
    ...s.book,
    match: maxPossible > 0 ? Math.round((s.score / maxPossible) * 100) : undefined,
  }));
}
