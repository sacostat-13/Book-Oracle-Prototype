// src/lib/scoring/drawWeight.js — how strongly local Oracle draws favour fit.
// docs/reference/MATH.md §8. Used with util/random.js weightedSample().

// How strongly a local draw favours better-matching books. The draw weight is
// (match / 100) ^ DRAW_WEIGHT_POWER, so with power 2 a 90% book is 4x as likely
// as a 45% one: high matches dominate, but a draw still varies between calls
// instead of always returning the same top three. Raise the power for "show me
// the best fits", lower it (1 = proportional, 0 = uniform) for more variety.
export const DRAW_WEIGHT_POWER = 2;

// Books with no usable signal (computeLocalMatch → null) are drawn as if they
// matched this well — neither favoured nor buried.
export const UNSCORED_DRAW_MATCH = 50;

/**
 * Relative weight of a candidate in a local Oracle draw.
 *
 * @param {number | null | undefined} match  Local Match % (0-100) or null
 * @returns {number} weight ≥ 0
 */
export function drawWeight(match) {
  const m = match == null ? UNSCORED_DRAW_MATCH : Math.max(0, Math.min(100, match));
  return (m / 100) ** DRAW_WEIGHT_POWER;
}
