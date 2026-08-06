// Series-suffix parsing, shared by the RSS import function.
//
// This is a deliberate duplicate of splitGoodreadsSeriesTitle() in
// src/lib/goodreadsImport.js. Netlify Functions are bundled separately from
// the Vite client build and cannot import across that boundary, so the logic
// lives in both places.
//
// KEEP THESE TWO IN SYNC. If the CSV path's series parsing changes, this must
// change identically — otherwise the same book imported via CSV and via RSS
// will produce two different titles and therefore two different rows.

// "Title (Series Name, #2)" → { title: "Title", series: { name, n } }.
// Handles decimal positions ("#1.5"), a missing comma ("(Dune #2)"), and
// multi-series parentheticals ("(Saga A, #1; Saga B, #3)" — first wins).
// Titles whose parenthetical carries no "#" (e.g. "(Spanish Edition)") are
// left untouched here — bookKey/cleanTitle handle those downstream.
export function splitGoodreadsSeriesTitle(rawTitle) {
  const raw = (rawTitle || '').trim();
  const m = raw.match(/^(.*?)\s*\(([^()]*#[^()]*)\)$/);
  if (!m || !m[1].trim()) return { title: raw, series: null };
  const first = m[2].split(';')[0].trim();
  const sm = first.match(/^(.+?),?\s*#\s*(\d+(?:\.\d+)?)$/);
  if (!sm) return { title: raw, series: null };
  const n = parseFloat(sm[2]);
  return {
    title: m[1].trim(),
    series: { name: sm[1].trim(), n: Number.isFinite(n) ? n : null },
  };
}
