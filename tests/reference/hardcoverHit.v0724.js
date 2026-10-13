// Frozen copy of hardcoverService's in-function hit scoring as of v0.72.4,
// wrapped so targetTitle is a parameter. Do not edit.
export function scoreHit(h, targetTitle) {
  const COMPILATION_KW_RX = /\b(omnibus|box\s*set|complete\s+collect|books?\s+\d+[-\u2013\u2014]\d+|volumes?\s+\d+[-\u2013\u2014]\d+|complet[ea]|anthology)\b/i;
  function isCompilation(doc) {
    if (doc?.compilation === true) return true;
    const title = doc?.title || '';
    if (COMPILATION_KW_RX.test(title)) return true;
    if ((title.match(/,/g) || []).length >= 3) return true;
    if (/^[^:]+\'s\s*:/i.test(title)) return true;
    return false;
  }
  function scoreHit(h) {
    const doc = h.document || h;
    const title = doc?.title || '';
    const titleMatch = title.toLowerCase().includes(targetTitle);
    const compilation = isCompilation(doc);
    const popularity = doc?.users_count || doc?.ratings_count || 0;
    return (compilation ? -10 : 0) + (titleMatch ? 2 : 0) + Math.min(popularity / 1000, 1);
  }
  return scoreHit(h);
}
