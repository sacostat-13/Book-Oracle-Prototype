// src/lib/matchHelpers.js
//
// Match % — a real, explainable "how well does this fit you" score, computed
// two different ways depending on where the recommendation came from:
//
//   1. LOCAL (computeLocalMatch) — pure arithmetic against the reader's own
//      taste profile. Zero LLM involvement. Used wherever we're scoring
//      candidates from a pool we can already inspect (OracleCategories'
//      wishlist/vault draws).
//
//   2. LLM-ESTIMATED — for AI-generated recommendations (books that may not
//      even be in our catalog, so there's nothing local to score against),
//      we hand Claude the same taste-profile summary (describeTasteProfile)
//      and ask it to self-report a 0-100 match as part of its normal JSON
//      response (MATCH_SCORING_INSTRUCTIONS). This is a reasoned estimate
//      grounded in real signals we provide — not a reproducible statistical
//      computation, and not invented from nothing either.
//
// OracleSimilar's wishlist mode is a third case: it already scores candidates
// against the reader's 1-3 SELECTED SEED books (not their overall taste
// profile) — that's handled inline in OracleSimilar.jsx itself, since
// "similar to these specific books" is a different (and for that page, more
// correct) basis than the general taste profile below.

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

// v0.50: the onboarding goal chip, translated into a prompt directive. One
// place, one wording — every AI surface that mentions the goal uses this.
export function goalDirective(goal) {
  switch (goal) {
    case 'level-up':
      return `Reader's stated goal: level up their reading. Prefer picks that stretch them slightly beyond their comfort zone — a meaningful but achievable step up in complexity or depth.`;
    case 'explore':
      return `Reader's stated goal: explore new topics and genres. Favor well-chosen introductions to territory absent from their history over more of what they already know.`;
    case 'random':
      return `Reader's stated goal: just find something great to read. Optimize for pure fit and delight over stretch or novelty.`;
    default:
      return null;
  }
}

// Human-readable summary injected into AI prompts — same wording everywhere
// it's used, so all AI modes score against a consistent rubric.
export function describeTasteProfile(tasteProfile) {
  const parts = [];
  const genreEntries = Object.entries(tasteProfile.genreAffinity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (genreEntries.length > 0) {
    parts.push(`Reader's average rating by genre (from their library, 1-5★): ${genreEntries.map(([n, r]) => `${n} (${r.toFixed(1)}★)`).join(', ')}.`);
  }
  if (tasteProfile.favoriteGenres.length > 0) {
    parts.push(`Reader's stated favorite genres: ${tasteProfile.favoriteGenres.join(', ')}.`);
  }
  if (tasteProfile.currentMood.length > 0) {
    parts.push(`Reader's stated current mood: ${tasteProfile.currentMood.join(', ')}.`);
  }
  // v0.50: stated reading level + goal join the shared summary, so every
  // surface that uses the taste profile inherits them automatically.
  if (tasteProfile.readingLevel != null) {
    parts.push(`Reader's stated reading level: ${tasteProfile.readingLevel}/5 (1=casual page-turners, 5=experimental prose).`);
  }
  const gd = goalDirective(tasteProfile.goal);
  if (gd) parts.push(gd);
  if (tasteProfile.avgComplexity != null) {
    parts.push(`Average prose complexity of books they've rated 4-5★: ${tasteProfile.avgComplexity.toFixed(1)}/5.`);
  }
  if (tasteProfile.avgDepth != null) {
    parts.push(`Average thematic depth of books they've rated 4-5★: ${tasteProfile.avgDepth.toFixed(1)}/5.`);
  }
  return parts.join(' ');
}

// Appended to AI-mode system prompts. Defines the match rubric explicitly so
// it's a reasoned estimate against the signals above, not a vibe.
export const MATCH_SCORING_INSTRUCTIONS = `
MATCH RULES: Also return "match" — an integer 0-100 estimating how well this
recommendation fits THIS reader specifically, given their genre ratings,
stated favorite genres/mood, and prose complexity/depth preferences (provided
above, if any). Weigh genre affinity most heavily; use complexity/depth fit
as a secondary factor. If little or nothing is known about the reader yet,
base it on how strongly the book fits the request itself rather than
guessing at a false personalization. Always return an integer 0-100 — never
null and never omit it.`;

// ---------- local (zero-LLM) scoring ----------

// Scores a single candidate against the taste profile. Returns 0-100, or
// null if there's genuinely no usable signal for this book (missing genre
// AND missing complexity/depth AND no favorite-genre overlap) — callers
// should just omit the badge in that case rather than show a fake number.
export function computeLocalMatch(book, tasteProfile, genresByBookId) {
  if (!tasteProfile?.hasSignal) return null;

  const tagged = genresByBookId?.[book.bookId];
  const genres = (tagged && tagged.length > 0) ? tagged : (book.g ? [{ name: book.g }] : []);
  const genreNames = genres.map((g) => g.name).filter(Boolean);

  // Genre affinity (0-1): best-matching genre's average rating, scaled from
  // 1-5★ to 0-1. If no rating history but it matches a stated favorite
  // genre, give partial credit rather than nothing.
  let genreScore = null;
  if (genreNames.length > 0) {
    const ratedMatches = genreNames
      .map((n) => tasteProfile.genreAffinity[n])
      .filter((v) => v != null);
    if (ratedMatches.length > 0) {
      genreScore = Math.max(...ratedMatches) / 5;
    } else if (genreNames.some((n) => tasteProfile.favoriteGenres.includes(n))) {
      genreScore = 0.75;
    }
  }

  // Complexity/depth fit (0-1): closeness to the level of books they've
  // actually rated highly. 1 = exact match, decreasing linearly to 0 at a
  // difference of 4 (the full 1-5 range).
  const fits = [];
  if (book.c && tasteProfile.avgComplexity != null) {
    fits.push(1 - Math.min(1, Math.abs(book.c - tasteProfile.avgComplexity) / 4));
  }
  if (book.p && tasteProfile.avgDepth != null) {
    fits.push(1 - Math.min(1, Math.abs(book.p - tasteProfile.avgDepth) / 4));
  }
  const fitScore = fits.length > 0 ? fits.reduce((a, b) => a + b, 0) / fits.length : null;

  // Blend — genre affinity carries most of the signal when both are present.
  let combined;
  if (genreScore != null && fitScore != null) combined = genreScore * 0.7 + fitScore * 0.3;
  else if (genreScore != null) combined = genreScore;
  else if (fitScore != null) combined = fitScore;
  else return null;

  return Math.round(combined * 100);
}

// ---------- level growth nudge (v0.50) ----------

// Compares the reader's EARNED complexity signal (avg prose complexity of
// books they rated 4-5★) against their STATED reading level. When the earned
// signal, grounded in enough books, sits a full level above the stated one,
// we suggest a single-step promotion — never a silent overwrite, never a jump.
// Returns the suggested level (2-5) or null.
export const LEVEL_NUDGE_MIN_SAMPLES = 5;

export function suggestLevelFromTaste(tasteProfile) {
  if (!tasteProfile) return null;
  const stated = tasteProfile.readingLevel;
  if (stated == null || stated >= 5) return null;
  if (tasteProfile.avgComplexity == null) return null;
  if ((tasteProfile.complexitySampleCount || 0) < LEVEL_NUDGE_MIN_SAMPLES) return null;
  const earned = Math.round(tasteProfile.avgComplexity);
  if (earned <= stated) return null;
  return stated + 1; // one step at a time, regardless of how far ahead earned is
}
