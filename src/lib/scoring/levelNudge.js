// src/lib/scoring/levelNudge.js — when to suggest raising the stated reading level.
// docs/reference/MATH.md §5.


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
