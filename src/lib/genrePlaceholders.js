// Names that are not genres.
//
// The categorization prompt teaches "unknown" as the honest answer for author
// gender and original language, and the Oracle carries the habit into the
// genres array. Every genre writer creates whatever name it is handed, so a
// shrug becomes a row: "unknown" was deleted on 2026-09-18 and back with 12
// books on 2026-09-19.
//
// The DATABASE is the authority — genres_not_placeholder (migration
// 20260922120000_retire_unknown_genre.sql) rejects these names on every write
// path, including ones that do not exist yet. This list lets the writers drop
// a placeholder quietly instead of tripping the constraint and logging a
// failure for what is really just "no genre".
//
// Keep the two lists identical. Entries are NORMALIZED names (lowercase,
// leading "the " dropped, non-alphanumerics stripped) — the same shape as
// normalize_genre_name() in the database.
export const GENRE_PLACEHOLDERS = new Set([
  'unknown',
  'unknowngenre',
  'other',
  'others',
  'misc',
  'miscellaneous',
  'na',
  'none',
  'null',
  'undefined',
  'uncategorized',
  'uncategorised',
  'unclassified',
  'unsorted',
  'tbd',
  'various',
  'genre',
  'nogenre',
  'notapplicable',
]);

export function normalizeGenreName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

export function isPlaceholderGenre(name) {
  const n = normalizeGenreName(name);
  return n === '' || GENRE_PLACEHOLDERS.has(n);
}
