// src/lib/oracle/tastePrompt.js — the taste profile, in words, for Oracle prompts.
//
// Match % is computed two ways (docs/reference/MATH.md §3–4):
//   1. LOCAL — pure arithmetic against the taste profile, for books we can
//      inspect (scoring/localMatch.js).
//   2. LLM-ESTIMATED — for books the Oracle proposes (not necessarily in our
//      catalog), we send the same signals as text (describeTasteProfile) and
//      ask the model to self-report 0–100 (MATCH_SCORING_INSTRUCTIONS). A
//      reasoned estimate grounded in real signals, not a reproducible number.
// The wording lives here, once, so every surface scores against one rubric.

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
