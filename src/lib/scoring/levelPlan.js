// src/lib/scoring/levelPlan.js — the level-Passage fallback, when the Oracle
// can't be reached: a month-by-month climb in prose complexity.
// docs/reference/MATH.md §9.

import { bookKey } from '../book/bookHelpers';

/** A month's target complexity may be missed by at most this much. */
export const COMPLEXITY_TOLERANCE = 0.7;
/** Pick at random among this many closest-by-order candidates for a month. */
export const PICK_AMONG = 5;
/** Complexity assumed for a book the Oracle hasn't rated. */
export const UNRATED_COMPLEXITY = 3;

/**
 * Target complexity for month `i` (0-based) of a `timeline`-month climb from
 * `start` to `end`: linear interpolation, hitting `end` in the last month.
 */
export function targetComplexity(start, end, i, timeline) {
  return start + ((end - start) * (i / Math.max(1, timeline - 1)));
}

/**
 * Choose one book per month. Months with no candidate near the target are
 * skipped, so the result can be shorter than `timeline`.
 *
 * @param {object} args
 * @param {object[]} args.candidates   pool (client book shape, `c` = complexity)
 * @param {number} args.start          reader's level
 * @param {number} args.end            target level
 * @param {number} args.timeline       months
 * @param {object[]} [args.alreadyRead] library; never suggested again
 * @param {() => number} [args.random=Math.random]
 * @returns {Array<object & { month: number }>} the chosen books, with their month (1-based)
 */
export function levelPlanSteps({ candidates, start, end, timeline, alreadyRead = [], random = Math.random }) {
  const c = (b) => b.c || UNRATED_COMPLEXITY;
  const sorted = [...(candidates || [])].sort((a, b) => c(a) - c(b));
  const readKeys = new Set(alreadyRead.map(bookKey));
  const steps = [];
  for (let i = 0; i < timeline; i++) {
    const want = targetComplexity(start, end, i, timeline);
    const near = sorted.filter(
      (b) => Math.abs(c(b) - want) <= COMPLEXITY_TOLERANCE &&
        !steps.some((s) => s.t === b.t) &&
        !readKeys.has(bookKey(b))
    );
    const picked = near[Math.floor(random() * Math.min(near.length, PICK_AMONG))];
    if (picked) steps.push({ ...picked, month: i + 1 });
  }
  return steps;
}
