// src/lib/util/random.js — unbiased random helpers.
//
// Use these instead of `array.sort(() => Math.random() - 0.5)`. That idiom has
// two problems: it is biased (the comparator is inconsistent, so some orders
// come up far more often than others), and `.sort` mutates — called on a React
// state array it silently reorders the reader's real data. Both bit the Oracle
// Spark before this file existed.
//
// For REPEATABLE randomness (the same order for everyone today — genre cover
// walls, prerendered pages) pass a seeded generator: shuffle(items,
// seededRandom('gothic:2026-10-13')). genreService.dailyShuffle does exactly that.

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

/**
 * 32-bit FNV-1a hash of a string. Same string → same unsigned integer, on every
 * device and in the edge prerender, which is what makes a seeded order stable.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A deterministic random-number generator (xorshift32) starting from `seed`.
 * Adequate for shuffling covers; not for anything security-related.
 *
 * @param {number} seed  unsigned 32-bit integer (0 would stick at 0 — hashSeed never returns it in practice)
 * @returns {() => number} returns numbers in [0, 1), same sequence for the same seed
 */
export function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Seeded generator from a string key: `xorshift32(hashSeed(key))`.
 *
 * @param {string} key  e.g. "gothic:2026-10-13"
 * @returns {() => number}
 */
export function seededRandom(key) {
  return xorshift32(hashSeed(key));
}
