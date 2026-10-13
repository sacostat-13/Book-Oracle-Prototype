// Frozen copy of googleBooksService's token title matching as of v0.72.4.
// Equivalence reference for tests/consolidation.test.js; do not edit.

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeForMatch(s) {
  return stripDiacritics((s || '').toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
}

// Words too common (EN + ES) to carry matching signal.
const STOP = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'de', 'del',
  'y', 'o', 'u', 'a', 'en', 'que', 'con', 'por', 'para', 'su', 'sus',
  'the', 'and', 'of', 'to', 'an', 'in', 'on', 'lets', 'let',
]);

function contentTokens(s) {
  return normalizeForMatch(s)
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// Share of the query's distinctive tokens present in the candidate string (0–1).
function matchScore(queryTitle, candidateTitle) {
  const q = contentTokens(queryTitle);
  if (!q.length) return 0;
  const c = new Set(contentTokens(candidateTitle));
  const hits = q.filter((w) => c.has(w)).length;
  return hits / q.length;
}

// Exported so callers (e.g. NavSearch) can judge whether ANOTHER source's hit
// is a real match for the query, using the same accent-insensitive token logic.
// Returns 0–1: the share of the query's distinctive words present in the title.
export function titleMatchScore(queryTitle, candidateTitle) {
  return matchScore(queryTitle, candidateTitle);
}

// Segment-aware match: the best of matching the whole query OR any of its
// colon/dash-separated segments against the candidate. This matters for Spanish
// "Collective: Title" inputs — e.g. a query of "Morras Malditas: Apaguemos la
// luz" should accept the real title "Apaguemos la luz y entremos a la noche"
// (via the segment) even though the full-string match is diluted to 0.5 by the
// "Morras Malditas" prefix. Wrong books like "No apagues la luz" still fail on
// every segment.
export function bestTitleMatch(queryTitle, candidateTitle) {
  let best = matchScore(queryTitle, candidateTitle);
  for (const seg of titleSegments(queryTitle || '')) {
    best = Math.max(best, matchScore(seg, candidateTitle));
    if (best >= 1) break;
  }
  return best;
}

// Split a title into its colon / dash-separated segments, longest first — the
// longest segment is the likeliest "real" title in a "Collective: Title" pair.
function titleSegments(title) {
  return title
    .split(/\s*:\s+|\s+[–—-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

