// match-decisions.test.js — the three decisions recorded in docs/reference/MATH.md on
// 2026-10-12, as executable examples:
//   §1  share/address keys fold accents (and agree with the SQL migration)
//   §3  a 1★ genre still counts 20% in Local Match %
//   §8  local Oracle draws favour higher Match %

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { addressKey, bookKey } from '../src/lib/book/bookHelpers.js';
import { computeLocalMatch } from '../src/lib/scoring/localMatch.js';
import { drawWeight, DRAW_WEIGHT_POWER, UNSCORED_DRAW_MATCH } from '../src/lib/scoring/drawWeight.js';
import { weightedSample } from '../src/lib/util/random.js';

describe('§1 address keys fold accents', () => {
  it('folds Spanish and other Latin diacritics instead of dropping the letter', () => {
    expect(bookKey({ t: 'Cien años de soledad', a: 'Gabriel García Márquez' })).toBe('cienanosdesoledad|gabrielgar');
    expect(addressKey('Les Misérables')).toBe('lesmiserables');
    expect(addressKey('Mañana, tal vez')).toBe('mananatalvez');
  });

  it('still removes letters with no decomposition and non-Latin scripts', () => {
    expect(addressKey('Øyeblikk')).toBe('yeblikk');
    expect(addressKey('Straße')).toBe('strae');
    expect(addressKey('ノルウェイの森')).toBe('');
  });

  it('uses the same combining-mark range as the SQL migration', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261012120000_accent_folded_share_key.sql', import.meta.url), 'utf8');
    expect(sql).toContain("normalize(coalesce(_title, ''), NFD), '[\\u0300-\\u036f]'");
    expect(sql).toContain("normalize(coalesce(_author, ''), NFD), '[\\u0300-\\u036f]'");
  });
});

describe('§3 Local Match % keeps a 20% floor for a 1★ genre', () => {
  const profile = (rating) => ({
    hasSignal: true,
    genreAffinity: { Gothic: rating },
    favoriteGenres: [],
    avgComplexity: null,
    avgDepth: null,
  });

  it('maps average genre rating r to r/5 when it is the only signal', () => {
    const book = { g: 'Gothic' };
    expect(computeLocalMatch(book, profile(1))).toBe(20);
    expect(computeLocalMatch(book, profile(5))).toBe(100);
  });
});

describe('§8 local draws favour higher Match %', () => {
  it('weights by (match/100)^power, with a neutral weight for unscored books', () => {
    expect(DRAW_WEIGHT_POWER).toBe(2);
    expect(drawWeight(90) / drawWeight(45)).toBeCloseTo(4);
    expect(drawWeight(null)).toBeCloseTo((UNSCORED_DRAW_MATCH / 100) ** DRAW_WEIGHT_POWER);
    expect(drawWeight(0)).toBe(0);
    expect(drawWeight(150)).toBe(1);
  });

  it('picks single items in proportion to their weight', () => {
    let seed = 7;
    const lcg = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const items = [{ id: 'a', w: 1 }, { id: 'b', w: 3 }];
    let b = 0;
    const runs = 40000;
    for (let i = 0; i < runs; i++) if (weightedSample(items, 1, (x) => x.w, lcg)[0].id === 'b') b++;
    expect(b / runs).toBeGreaterThan(0.73);
    expect(b / runs).toBeLessThan(0.77);
  });

  it('returns distinct items, never mutates, and puts zero weights last', () => {
    const items = [{ id: 'zero', w: 0 }, { id: 'x', w: 1 }, { id: 'y', w: 2 }];
    const snapshot = JSON.stringify(items);
    const picked = weightedSample(items, 2, (it) => it.w);
    expect(new Set(picked.map((p) => p.id))).toEqual(new Set(['x', 'y']));
    expect(JSON.stringify(items)).toBe(snapshot);
    expect(weightedSample(items, 5, (it) => it.w)).toHaveLength(3);
    expect(weightedSample(null, 3, () => 1)).toEqual([]);
  });
});
