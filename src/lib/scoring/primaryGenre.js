// src/lib/scoring/primaryGenre.js — the shelf a book is filed under.
// docs/reference/MATH.md §14.

// Pick the genre a book should be filed under when browsing (grouped view).
// Rule (v0.55.3): the book's *most specific* genre — the one with the lowest
// global usage count — so niche shelves (e.g. "Body Horror & Transgressive")
// actually populate instead of every book collapsing into a broad genre like
// "Horror". `genres` are rows from genresByBookId (already carry usageCount).
// Ties break alphabetically for a stable section order. Falls back to the raw
// import genre `b.g`, then the provided `fallback`.
export function getPrimaryGenre(book, genres, fallback = 'Uncategorized') {
  if (genres && genres.length > 0) {
    let primary = genres[0];
    for (const g of genres) {
      const gu = g.usageCount ?? Infinity;
      const pu = primary.usageCount ?? Infinity;
      if (gu < pu || (gu === pu && (g.name || '').localeCompare(primary.name || '') < 0)) {
        primary = g;
      }
    }
    return primary.name;
  }
  return book.g || fallback;
}
