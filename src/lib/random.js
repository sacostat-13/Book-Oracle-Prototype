// src/lib/random.js — unbiased random helpers.
//
// Use these instead of `array.sort(() => Math.random() - 0.5)`. That idiom has
// two problems: it is biased (the comparator is inconsistent, so some orders
// come up far more often than others), and `.sort` mutates — called on a React
// state array it silently reorders the reader's real data. Both bit the Oracle
// Spark before this file existed.
//
// Deterministic, seeded shuffling for SEO-stable pages lives in
// genreService.dailyShuffle; this file is for ordinary per-draw randomness.

/**
 * Return a shuffled copy of `items` (Fisher–Yates). Never mutates the input.
 *
 * @template T
 * @param {readonly T[] | null | undefined} items
 * @param {() => number} [random=Math.random]  injectable for tests; must return [0, 1)
 * @returns {T[]} a new array with the same elements in uniformly random order
 */
export function shuffle(items, random = Math.random) {
  const out = Array.isArray(items) ? items.slice() : [];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick up to `count` distinct elements uniformly at random. Never mutates the input.
 *
 * @template T
 * @param {readonly T[] | null | undefined} items
 * @param {number} count  how many to return; fewer if `items` is shorter
 * @param {() => number} [random=Math.random]
 * @returns {T[]}
 */
export function sample(items, count, random = Math.random) {
  return shuffle(items, random).slice(0, Math.max(0, count));
}

/**
 * Pick up to `count` distinct elements at random, each with probability
 * proportional to its weight (Efraimidis–Spirakis "A-Res": key = u^(1/w), keep
 * the largest keys). Never mutates the input. Items with weight ≤ 0 are only
 * picked once every positive-weight item has been taken.
 *
 * @template T
 * @param {readonly T[] | null | undefined} items
 * @param {number} count
 * @param {(item: T) => number} weightOf  relative weight; larger = likelier
 * @param {() => number} [random=Math.random]
 * @returns {T[]} chosen items, most-favoured key first
 */
export function weightedSample(items, count, weightOf, random = Math.random) {
  if (!Array.isArray(items) || count <= 0) return [];
  const keyed = items.map((item) => {
    const w = Number(weightOf(item));
    // u in (0, 1]: avoids log(0); weight ≤ 0 sorts after every positive weight.
    const u = 1 - random();
    const key = w > 0 ? Math.log(u) / w : -Infinity;
    return { item, key, fallback: random() };
  });
  keyed.sort((x, y) => (y.key - x.key) || (y.fallback - x.fallback));
  return keyed.slice(0, count).map((k) => k.item);
}
