// FROZEN copies of the two similar-books scorers as they were in v0.72.4
// (src/views/BookPage.jsx computeSimilar, src/views/OracleSimilar.jsx
// fallbackSimilar). Used only by tests/scoring.test.js to prove the unified
// src/lib/scoring/similarity.js returns identical results. Do not edit.
import { bookKey } from '../../src/lib/book/bookHelpers.js';

const MAX_SCORE_PER_SEED = 6;
const SIMILAR_COUNT = 5;

export function computeSimilar(display, genresByBookId, pool, limit = 12, exclude) {
  // Build genre ID set for the current book
  const thisGenreIds = new Set(
    (genresByBookId?.[display.bookId] || []).map(g => g.genreId)
  );
  // Fallback to legacy single genre field if no Oracle genres
  const thisGenreLegacy = display.g || '';

  const thisKey = bookKey(display);

  const scored = pool
    .filter(b => bookKey(b) !== thisKey)
    .filter(b => !exclude || !exclude.has(bookKey(b)))
    .map(b => {
      let score = 0;

      // Oracle genre overlap — most powerful signal
      const bGenreIds = (genresByBookId?.[b.bookId] || []).map(g => g.genreId);
      const overlap = bGenreIds.filter(id => thisGenreIds.has(id)).length;
      score += overlap * 4;

      // Legacy single genre fallback
      if (!thisGenreIds.size && b.g && b.g === thisGenreLegacy) score += 3;

      // Same author — strong signal
      if (display.a && b.a && b.a === display.a) score += 3;

      // Similar complexity (±1 step)
      if (display.c && b.c && Math.abs(b.c - display.c) <= 1) score += 1;

      // Similar length (within 30%)
      if (display.pp && b.pp) {
        const ratio = display.pp > 0 ? Math.abs(b.pp - display.pp) / display.pp : 1;
        if (ratio < 0.3) score += 1;
      }

      return { book: b, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.book);
}

export function fallbackSimilar(selection, candidates) {
  const scored = candidates.map((c) => {
    let score = 0;
    for (const s of selection) {
      if (s.g && c.g === s.g) score += 3;
      if (s.c && c.c && Math.abs(c.c - s.c) <= 1) score += 2;
      if (s.p && c.p && Math.abs(c.p - s.p) <= 1) score += 1;
    }
    return { book: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const maxPossible = selection.length * MAX_SCORE_PER_SEED;
  return {
    // This score is a genuine computation against the SEED books you picked
    // (not your overall taste profile) — "similar to these" is the whole
    // point of this mode, so that's the more correct basis here.
    books: scored.slice(0, SIMILAR_COUNT).map((s) => ({
      ...s.book,
      match: maxPossible > 0 ? Math.round((s.score / maxPossible) * 100) : undefined,
    })),
    source: 'fallback',
  };
}
