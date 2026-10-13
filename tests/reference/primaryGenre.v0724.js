// FROZEN copy of bookHelpers.getPrimaryGenre as of v0.72.4. Do not edit.
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
