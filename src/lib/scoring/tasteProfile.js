// src/lib/scoring/tasteProfile.js — what the reader's own shelf says they like.
//
// Built from data already on the client (no query). Feeds the Local Match %
// (localMatch.js), the level nudge (levelNudge.js) and the prompt summary every
// Oracle surface sends (oracle/tastePrompt.js). See docs/reference/MATH.md §2.

// ---------- taste profile ----------

// Builds a taste profile from data already loaded client-side — no new query,
// no new backend call. Reused by every mode.
export function buildTasteProfile(library, genresByBookId, profile) {
  const genreRatings = {}; // name -> { sum, count }
  let complexitySum = 0, complexityCount = 0;
  let depthSum = 0, depthCount = 0;

  for (const b of (library || [])) {
    if (!b.rating || b.rating <= 0) continue;

    const tagged = genresByBookId?.[b.bookId];
    const genres = (tagged && tagged.length > 0) ? tagged : (b.g ? [{ name: b.g }] : []);
    for (const g of genres) {
      if (!g?.name) continue;
      const cur = genreRatings[g.name] || { sum: 0, count: 0 };
      cur.sum += b.rating;
      cur.count += 1;
      genreRatings[g.name] = cur;
    }

    // Weight complexity/depth affinity toward books the reader actually liked (4-5★),
    // not everything they've merely read.
    if (b.rating >= 4) {
      if (b.c) { complexitySum += b.c; complexityCount++; }
      if (b.p) { depthSum += b.p; depthCount++; }
    }
  }

  const genreAffinity = Object.fromEntries(
    Object.entries(genreRatings).map(([name, { sum, count }]) => [name, sum / count])
  );

  const favoriteGenres = profile?.favoriteGenres || [];
  const currentMood    = profile?.currentMood || [];
  const readingLevel   = profile?.readingLevel || null; // v0.50: stated 1-5 level
  const goal           = profile?.goal || null;         // v0.50: onboarding intent chip

  return {
    genreAffinity,     // { "Gothic": 4.7, "Body Horror": 3.1, ... } — avg rating per genre
    favoriteGenres,
    currentMood,
    readingLevel,
    goal,
    avgComplexity: complexityCount > 0 ? complexitySum / complexityCount : null,
    avgDepth:      depthCount > 0 ? depthSum / depthCount : null,
    // v0.50: sample size behind avgComplexity — the level nudge needs to know
    // the earned signal is grounded in enough books before trusting it.
    complexitySampleCount: complexityCount,
    hasSignal: Object.keys(genreRatings).length > 0 || favoriteGenres.length > 0,
  };
}
