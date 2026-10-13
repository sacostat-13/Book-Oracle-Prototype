// scoring.test.js — the formulas in src/lib/scoring/, two ways.
//
// 1. EQUIVALENCE: each module refactored in Sprint 3 must return exactly what
//    the code it replaced returned. The old code is frozen in tests/reference/
//    and both are run over thousands of seeded random inputs.
// 2. EXAMPLES: small tables a person can read, pinning the behaviour
//    docs/reference/MATH.md describes. When you change a weight on purpose,
//    these are the tests you update — the equivalence tests then no longer
//    apply to that function and can be deleted for it.

import { describe, it, expect } from 'vitest';

import * as refMatch from './reference/matchHelpers.v0724.js';
import * as refSimilar from './reference/similarity.v0724.js';
import * as refEdition from './reference/editionPicker.v0724.js';
import { scoreCandidate as refScoreCandidate } from './reference/workRepresentative.v0724.js';
import { getPrimaryGenre as refPrimaryGenre } from './reference/primaryGenre.v0724.js';

import { buildTasteProfile } from '../src/lib/scoring/tasteProfile.js';
import { computeLocalMatch, GENRE_WEIGHT, FIT_WEIGHT } from '../src/lib/scoring/localMatch.js';
import { suggestLevelFromTaste } from '../src/lib/scoring/levelNudge.js';
import { drawWeight } from '../src/lib/scoring/drawWeight.js';
import { describeTasteProfile, goalDirective, MATCH_SCORING_INSTRUCTIONS } from '../src/lib/oracle/tastePrompt.js';
import { similarityScore, rankSimilar, rankBySeeds, BOOK_PAGE_WEIGHTS, SEED_WEIGHTS, maxScore } from '../src/lib/scoring/similarity.js';
import { scoreEdition, pickBestEdition } from '../src/lib/scoring/editionPicker.js';
import { scoreWorkRepresentative } from '../src/lib/scoring/workRepresentative.js';
import { getPrimaryGenre } from '../src/lib/scoring/primaryGenre.js';
import { levelPlanSteps, targetComplexity } from '../src/lib/scoring/levelPlan.js';
import { bookKey } from '../src/lib/book/bookHelpers.js';

// ── seeded random fixtures ─────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const maybe = (r, p, v) => (r() < p ? v() : undefined);
const TITLES = ['Piranesi', 'Rebecca', 'Beloved', 'Dracula', 'Ficciones', 'Cien años de soledad', 'Kindred', 'Possession', 'Middlemarch', 'Solaris'];
const AUTHORS = ['Susanna Clarke', 'Daphne du Maurier', 'Toni Morrison', 'Bram Stoker', 'Jorge Luis Borges', 'Octavia E. Butler', ''];
const GENRES = ['Gothic', 'Fantasy', 'Horror', 'Literary', 'Sci-Fi'];
const GENRE_IDS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

function randomBook(r, i) {
  return {
    t: pick(r, TITLES) + (r() < 0.5 ? '' : ` ${i % 7}`),
    a: pick(r, AUTHORS),
    g: maybe(r, 0.7, () => pick(r, GENRES)),
    c: maybe(r, 0.8, () => 1 + Math.floor(r() * 5)),
    p: maybe(r, 0.8, () => 1 + Math.floor(r() * 5)),
    pp: maybe(r, 0.8, () => (r() < 0.05 ? 0 : 80 + Math.floor(r() * 900))),
    rating: maybe(r, 0.6, () => 1 + Math.floor(r() * 5)),
    bookId: maybe(r, 0.9, () => `b${i}`),
    coverUrl: maybe(r, 0.6, () => `https://x/${i}.jpg`),
    status: pick(r, ['unreviewed', 'verified', 'oracle_categorized', undefined]),
    d: maybe(r, 0.5, () => 'desc'),
    language: pick(r, ['en', 'es', 'fr', undefined]),
    originalLanguage: pick(r, ['en', 'es', 'unknown', undefined]),
  };
}
function randomGenres(r, books) {
  const out = {};
  for (const b of books) {
    if (!b.bookId || r() < 0.3) continue;
    const n = Math.floor(r() * 4);
    out[b.bookId] = Array.from({ length: n }, () => {
      const id = pick(r, GENRE_IDS);
      return { genreId: id, name: `Genre ${id}`, usageCount: maybe(r, 0.8, () => Math.floor(r() * 50)) };
    });
  }
  return out;
}
const TRIALS = 1500;

// ── 1. equivalence ──────────────────────────────────────────────────────────
describe('equivalence with the v0.72.4 code', () => {
  it('taste profile, local match, level nudge, prompt text, draw weight', () => {
    const r = rng(1);
    for (let n = 0; n < TRIALS; n++) {
      const library = Array.from({ length: Math.floor(r() * 25) }, (_, i) => randomBook(r, i));
      const genres = randomGenres(r, library);
      const profile = {
        favoriteGenres: r() < 0.5 ? [`Genre ${pick(r, GENRE_IDS)}`, pick(r, GENRES)] : [],
        currentMood: r() < 0.5 ? ['dark'] : [],
        readingLevel: maybe(r, 0.7, () => 1 + Math.floor(r() * 5)),
        goal: pick(r, ['level-up', 'explore', 'random', null]),
      };
      const tp = buildTasteProfile(library, genres, profile);
      expect(tp).toEqual(refMatch.buildTasteProfile(library, genres, profile));
      expect(describeTasteProfile(tp)).toBe(refMatch.describeTasteProfile(tp));
      expect(suggestLevelFromTaste(tp)).toBe(refMatch.suggestLevelFromTaste(tp));
      const cand = randomBook(r, 999);
      expect(computeLocalMatch(cand, tp, genres)).toBe(refMatch.computeLocalMatch(cand, tp, genres));
      const m = maybe(r, 0.9, () => Math.floor(r() * 120) - 10);
      expect(drawWeight(m)).toBe(refMatch.drawWeight(m));
    }
    for (const g of ['level-up', 'explore', 'random', null, 'x']) expect(goalDirective(g)).toBe(refMatch.goalDirective(g));
    expect(MATCH_SCORING_INSTRUCTIONS).toBe(refMatch.MATCH_SCORING_INSTRUCTIONS);
  });

  it('Book page "You might also like" ranking', () => {
    const r = rng(2);
    for (let n = 0; n < TRIALS; n++) {
      const pool = Array.from({ length: 5 + Math.floor(r() * 30) }, (_, i) => randomBook(r, i));
      const target = r() < 0.3 ? pool[0] : randomBook(r, 500);
      const genres = randomGenres(r, [...pool, target]);
      const exclude = new Set(pool.filter(() => r() < 0.2).map(bookKey));
      const limit = 1 + Math.floor(r() * 24);
      expect(rankSimilar(target, pool, { genresByBookId: genres, limit, exclude }))
        .toEqual(refSimilar.computeSimilar(target, genres, pool, limit, exclude));
    }
  });

  it('Find Similar fallback ranking and match %', () => {
    const r = rng(3);
    for (let n = 0; n < TRIALS; n++) {
      const candidates = Array.from({ length: Math.floor(r() * 30) }, (_, i) => randomBook(r, i));
      const seeds = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => randomBook(r, 100 + i));
      expect(rankBySeeds(seeds, candidates, { limit: 5 })).toEqual(refSimilar.fallbackSimilar(seeds, candidates).books);
    }
  });

  it('edition score and best-edition pick', () => {
    const r = rng(4);
    const isbn13 = (body) => {
      const d = body.split('').map(Number);
      const sum = d.reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
      return body + ((10 - (sum % 10)) % 10);
    };
    const randomEdition = () => ({
      isbn_13: pick(r, [isbn13('978' + String(Math.floor(r() * 1e9)).padStart(9, '0')), '0345253434195', null]),
      isbn_10: pick(r, ['0345339703', null, '123']),
      asin: maybe(r, 0.4, () => 'B00X'),
      reading_format_id: pick(r, [1, 2, 3, 4, null]),
      compilation: pick(r, [true, false, null]),
      edition_format: pick(r, ['Hardcover', 'Kindle Edition', 'Audible Audio', 'Box Set', 'Paperback', null]),
      language_id: pick(r, [1, 2, 7, null]),
      users_count: maybe(r, 0.8, () => Math.floor(r() * 5000)),
    });
    for (let n = 0; n < TRIALS; n++) {
      const eds = Array.from({ length: Math.floor(r() * 8) }, randomEdition);
      for (const e of eds) expect(scoreEdition(e)).toBe(refEdition.scoreEdition(e));
      expect(pickBestEdition(eds)).toEqual(refEdition.pickBestEdition(eds));
    }
  });

  it('work representative and primary genre', () => {
    const r = rng(5);
    for (let n = 0; n < TRIALS; n++) {
      const b = randomBook(r, n);
      const ui = pick(r, ['en', 'es', null]);
      expect(scoreWorkRepresentative(b, ui)).toBe(refScoreCandidate(b, ui));
      const gs = randomGenres(r, [b])[b.bookId];
      expect(getPrimaryGenre(b, gs, 'Uncategorized')).toBe(refPrimaryGenre(b, gs, 'Uncategorized'));
    }
  });

  it('level Passage fallback (same picks for the same random sequence)', () => {
    // The pre-refactor loop from PlanCreate.jsx, verbatim apart from injecting `random`.
    function reference({ candidates, start, end, timeline, library, random }) {
      const sorted = [...candidates].sort((a, b) => (a.c || 3) - (b.c || 3));
      const steps = [];
      for (let i = 0; i < timeline; i++) {
        const targetC = start + ((end - start) * (i / Math.max(1, timeline - 1)));
        const cands = sorted.filter(
          (b) => Math.abs((b.c || 3) - targetC) <= 0.7 &&
            !steps.some((s) => s.t === b.t) &&
            !library.some((l) => bookKey(l) === bookKey(b))
        );
        const picked = cands[Math.floor(random() * Math.min(cands.length, 5))];
        if (picked) steps.push({ ...picked, month: i + 1 });
      }
      return steps;
    }
    const r = rng(6);
    for (let n = 0; n < 500; n++) {
      const candidates = Array.from({ length: Math.floor(r() * 40) }, (_, i) => randomBook(r, i));
      const library = candidates.filter(() => r() < 0.2);
      const args = { candidates, start: 1 + Math.floor(r() * 3), end: 3 + Math.floor(r() * 3), timeline: 1 + Math.floor(r() * 12) };
      const seed = Math.floor(r() * 1e9);
      expect(levelPlanSteps({ ...args, alreadyRead: library, random: rng(seed) }))
        .toEqual(reference({ ...args, library, random: rng(seed) }));
    }
  });
});

// ── 2. examples (MATH.md, as tables) ───────────────────────────────────────
describe('Local Match % (MATH §3)', () => {
  const profile = (over = {}) => ({ hasSignal: true, genreAffinity: {}, favoriteGenres: [], avgComplexity: null, avgDepth: null, ...over });
  const cases = [
    ['genre only: 4.5★ genre', { g: 'Gothic' }, profile({ genreAffinity: { Gothic: 4.5 } }), 90],
    ['favourite with no ratings', { g: 'Gothic' }, profile({ favoriteGenres: ['Gothic'] }), 75],
    ['fit only: exact complexity', { c: 3 }, profile({ avgComplexity: 3 }), 100],
    ['fit only: 2 steps off', { c: 5 }, profile({ avgComplexity: 3 }), 50],
    ['blend 0.7/0.3', { g: 'Gothic', c: 3 }, profile({ genreAffinity: { Gothic: 5 }, avgComplexity: 1 }), Math.round(100 * (GENRE_WEIGHT * 1 + FIT_WEIGHT * 0.5))],
    ['no signal → no badge', { g: 'Horror' }, profile({ genreAffinity: { Gothic: 5 } }), null],
  ];
  it.each(cases)('%s', (_, book, tp, expected) => {
    expect(computeLocalMatch(book, tp)).toBe(expected);
  });
});

describe('similarity presets (MATH §6–7)', () => {
  const target = { t: 'Rebecca', a: 'Daphne du Maurier', g: 'Gothic', c: 3, p: 4, pp: 400, bookId: 't' };
  const genres = { t: [{ genreId: 'gothic' }, { genreId: 'romance' }], x: [{ genreId: 'gothic' }, { genreId: 'romance' }] };
  it.each([
    ['two shared Oracle genres (4 each)', { bookId: 'x' }, 8],
    ['same author', { a: 'Daphne du Maurier' }, 3],
    ['legacy genre ignored: target has Oracle genres', { g: 'Gothic' }, 0],
    ['complexity within 1 + length within 30 %', { c: 4, pp: 350 }, 2],
    ['nothing in common', { a: 'Someone', c: 1, pp: 50 }, 0],
  ])('Book page: %s', (_, cand, expected) => {
    expect(similarityScore(target, cand, BOOK_PAGE_WEIGHTS, genres)).toBe(expected);
  });

  it('seed preset: genre 3 + complexity 2 + depth 1, max 6 per seed', () => {
    expect(similarityScore(target, { g: 'Gothic', c: 2, p: 5 }, SEED_WEIGHTS)).toBe(6);
    expect(maxScore(SEED_WEIGHTS)).toBe(6);
    expect(rankBySeeds([target], [{ g: 'Gothic', c: 2, p: 5, t: 'A' }, { c: 3, t: 'B' }])
      .map((b) => [b.t, b.match])).toEqual([['A', 100], ['B', 33]]);
  });
});

describe('edition score ordering (MATH §10)', () => {
  const ed = (over) => ({ isbn_13: '9780547928210', reading_format_id: 1, language_id: 1, users_count: 0, ...over });
  it('no popularity can lift an audiobook or a foreign printing over an English print edition', () => {
    const print = scoreEdition(ed({ users_count: 0 }));
    expect(scoreEdition(ed({ reading_format_id: 2, users_count: 10_000_000 }))).toBeLessThan(print);
    expect(scoreEdition(ed({ language_id: 7, users_count: 10_000_000 }))).toBeLessThan(print);
  });
  it('an invalid ISBN disqualifies; a compilation sinks', () => {
    expect(scoreEdition(ed({ isbn_13: '0345253434195' }))).toBe(-Infinity);
    expect(scoreEdition(ed({ compilation: true }))).toBeLessThan(0);
  });
  it('an ASIN only breaks ties — it cannot beat a more-owned edition', () => {
    expect(scoreEdition(ed({ asin: 'B0', users_count: 3 }))).toBeLessThan(scoreEdition(ed({ users_count: 102 })));
  });
});

describe('work representative tiers (MATH §11)', () => {
  it('original language beats UI language beats completeness', () => {
    const orig = { language: 'es', originalLanguage: 'es' };
    const ui = { language: 'en', coverUrl: 'x', status: 'verified', d: 'd', pp: 1, bookId: '1' };
    expect(scoreWorkRepresentative(orig, 'en')).toBeGreaterThan(scoreWorkRepresentative(ui, 'en'));
    expect(scoreWorkRepresentative({ language: 'en' }, 'en'))
      .toBeGreaterThan(scoreWorkRepresentative({ language: 'fr', coverUrl: 'x', status: 'verified', d: 'd', pp: 1, bookId: '1' }, 'en'));
  });
});

describe('primary genre and level plan (MATH §9, §14)', () => {
  it('files a book under its least-used genre, ties A–Z', () => {
    const gs = [{ name: 'Horror', usageCount: 900 }, { name: 'Folk Horror', usageCount: 12 }, { name: 'Body Horror', usageCount: 12 }];
    expect(getPrimaryGenre({}, gs)).toBe('Body Horror');
    expect(getPrimaryGenre({ g: 'Gothic' }, [])).toBe('Gothic');
  });
  it('climbs linearly from start to end level', () => {
    expect([0, 1, 2, 3].map((i) => targetComplexity(1, 4, i, 4))).toEqual([1, 2, 3, 4]);
    expect(targetComplexity(2, 5, 0, 1)).toBe(2);
  });
});
