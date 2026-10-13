// src/lib/matching/tokenMatch.js — "do these two titles name the same book?",
// by shared words.
//
// The app has two title matchers, on purpose, for two kinds of input:
//   - tokenMatch.js (this file): forgiving, accent-insensitive, word-share
//     scoring (0–1). For live search, where the reader typed a few words and
//     catalogues answer with long Spanish/English titles. Used by Google Books
//     lookup, bookLookup and NavSearch.
//   - titleMatch.js: strict yes/no matching of whole titles with volume and
//     subtitle checks. For the batch scripts that WRITE identifiers to the
//     catalogue, where a near miss is a wrong ISBN.
// Moved here from googleBooksService.js in Sprint 3 (behaviour unchanged;
// tests/consolidation.test.js compares against the frozen copy).

export function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeForMatch(s) {
  return stripDiacritics((s || '').toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
}

// Words too common (EN + ES) to carry matching signal.
const STOP = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'de', 'del',
  'y', 'o', 'u', 'a', 'en', 'que', 'con', 'por', 'para', 'su', 'sus',
  'the', 'and', 'of', 'to', 'an', 'in', 'on', 'lets', 'let',
]);

export function contentTokens(s) {
  return normalizeForMatch(s)
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Share of the query's distinctive words present in the candidate title, 0–1.
 * Accent- and case-insensitive; EN/ES stop-words and words of ≤ 2 letters are ignored.
 * "Cien años de soledad" vs "Cien Anos De Soledad (Spanish Edition)" → 1.
 *
 * @param {string} queryTitle
 * @param {string} candidateTitle
 * @returns {number}
 */
export function titleMatchScore(queryTitle, candidateTitle) {
  const q = contentTokens(queryTitle);
  if (!q.length) return 0;
  const c = new Set(contentTokens(candidateTitle));
  const hits = q.filter((w) => c.has(w)).length;
  return hits / q.length;
}

// Segment-aware match: the best of matching the whole query OR any of its
// colon/dash-separated segments against the candidate. This matters for Spanish
// "Collective: Title" inputs — e.g. a query of "Morras Malditas: Apaguemos la
// luz" should accept the real title "Apaguemos la luz y entremos a la noche"
// (via the segment) even though the full-string match is diluted to 0.5 by the
// "Morras Malditas" prefix. Wrong books like "No apagues la luz" still fail on
// every segment.
export function bestTitleMatch(queryTitle, candidateTitle) {
  let best = titleMatchScore(queryTitle, candidateTitle);
  for (const seg of titleSegments(queryTitle || '')) {
    best = Math.max(best, titleMatchScore(seg, candidateTitle));
    if (best >= 1) break;
  }
  return best;
}

// Split a title into its colon / dash-separated segments, longest first — the
// longest segment is the likeliest "real" title in a "Collective: Title" pair.
export function titleSegments(title) {
  return title
    .split(/\s*:\s+|\s+[–—-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}
