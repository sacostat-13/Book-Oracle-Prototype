// Frozen copy of genreService's hashSeed/dayStamp/dailyShuffle as of v0.72.4.
// Equivalence reference for tests/consolidation.test.js; do not edit.
const GENRE_PAGE_SIZE = 20;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10); // UTC, so every viewer agrees
}

export function dailyShuffle(items, seedKey, now = new Date()) {
  // Nothing to rotate. A genre whose whole shelf fits on the first page and
  // reorders daily reads as broken rather than fresh, so leave short lists
  // alone.
  if (!Array.isArray(items) || items.length <= GENRE_PAGE_SIZE) return items || [];

  let state = hashSeed(`${seedKey}:${dayStamp(now)}`);
  const rand = () => {
    // xorshift32 — deterministic from the seed, adequate for shuffling covers.
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

