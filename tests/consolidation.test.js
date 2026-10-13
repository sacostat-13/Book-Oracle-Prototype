// consolidation.test.js — helpers that existed in two places now exist once
// (Sprint 3, L4). Each test proves the single copy behaves exactly like the
// code it replaced (frozen in tests/reference/), and the one duplicate that
// must stay — Goodreads title parsing, which Netlify Functions bundle on their
// own — is held to its twin by a contract test.

import { describe, it, expect } from 'vitest';

import { dailyShuffle as refDailyShuffle } from './reference/dailyShuffle.v0724.js';
import * as refToken from './reference/googleTitleMatch.v0724.js';
import { scoreHit as refScoreHit } from './reference/hardcoverHit.v0724.js';

import { dailyShuffle } from '../src/lib/api/genreService.js';
import { hashSeed, xorshift32, seededRandom } from '../src/lib/util/random.js';
import { titleMatchScore, bestTitleMatch } from '../src/lib/matching/tokenMatch.js';
import { compactKey, normTitle } from '../src/lib/matching/titleMatch.js';
import { scoreSearchHit, isCompilationHit } from '../src/lib/sources/hardcoverService.js';
import { splitGoodreadsSeriesTitle as clientSplit } from '../src/lib/sources/goodreadsImport.js';
import { splitGoodreadsSeriesTitle as functionSplit } from '../netlify/functions/_shared/goodreadsTitle.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const TITLES = [
  'Cien años de soledad', 'Cien Anos De Soledad (Spanish Edition)', 'Pedro Páramo',
  'Morras Malditas: Apaguemos la luz', 'Apaguemos la luz y entremos a la noche', 'No apagues la luz',
  'The Sandman, Vol. 1: Preludes & Nocturnes', 'The Sandman Omnibus', 'Harry Potter Box Set (Books 1-7)',
  'Agatha Christie: An Autobiography', "Agatha Christie's: Poirot", 'Dune (Dune, #1)', 'Dune Messiah (Dune #2)',
  'Fourth Wing (The Empyrean, 1)', 'Saga A (Saga A, #1; Saga B, #3)', 'Ficciones', 'Babel — An Arcane History',
  'Lets go', 'A, B, C, D', '', '   ', 'Book (Spanish Edition)', 'Title (Series, #1.5)', 'Odd (#3)',
];
const randomTitle = (r) => {
  const t = pick(r, TITLES);
  return r() < 0.3 ? t.toUpperCase() : r() < 0.3 ? `${t} ${pick(r, TITLES)}` : t;
};

describe('daily cover-wall shuffle (genreService → util/random)', () => {
  it('produces the identical order for every genre, day and list length', () => {
    const r = rng(11);
    for (let n = 0; n < 1000; n++) {
      const items = Array.from({ length: Math.floor(r() * 80) }, (_, i) => `b${i}`);
      const key = pick(r, ['gothic', 'family', '42', 'horror-folk']);
      const day = new Date(Date.UTC(2026, Math.floor(r() * 12), 1 + Math.floor(r() * 28), Math.floor(r() * 24)));
      expect(dailyShuffle(items, key, day)).toEqual(refDailyShuffle(items, key, day));
    }
  });

  it('same key, same sequence; the generator is xorshift32 over FNV-1a', () => {
    const a = seededRandom('gothic:2026-10-13');
    const b = xorshift32(hashSeed('gothic:2026-10-13'));
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
    expect(hashSeed('')).toBe(2166136261);
  });
});

describe('token title matching (googleBooksService → matching/tokenMatch)', () => {
  it('scores every pair exactly as before', () => {
    const r = rng(12);
    for (let n = 0; n < 3000; n++) {
      const q = randomTitle(r);
      const c = randomTitle(r);
      expect(titleMatchScore(q, c)).toBe(refToken.titleMatchScore(q, c));
      expect(bestTitleMatch(q, c)).toBe(refToken.bestTitleMatch(q, c));
    }
  });

  it.each([
    ['accents and edition suffix ignored', 'Cien años de soledad', 'Cien Anos De Soledad (Spanish Edition)', 1],
    ['segment rescues "Collective: Title"', 'Morras Malditas: Apaguemos la luz', 'Apaguemos la luz y entremos a la noche', 1],
    ['a different book stays below half', 'Morras Malditas: Apaguemos la luz', 'No apagues la luz', 0.5],
  ])('%s', (_, q, c, expected) => {
    expect(bestTitleMatch(q, c)).toBe(expected);
  });
});

describe('compact comparison key', () => {
  it.each([
    ['The Sandman, Vol. 1', 'thesandmanvol1'],
    ['  Dune  ', 'dune'],
    [null, ''],
    ['Pedro Páramo', 'pedropramo'], // accented letter dropped, not folded
  ])('compactKey(%j) → %j', (input, expected) => {
    expect(compactKey(input)).toBe(expected);
  });

  it('normTitle is compactKey after spelling out "&"', () => {
    expect(normTitle('Rock Bottom & Nowhere')).toBe(compactKey('Rock Bottom and Nowhere'));
    expect(normTitle('A + B')).toBe('aandb');
  });
});

describe('Hardcover search-hit ranking (hoisted out of two functions)', () => {
  it('scores every hit exactly as before', () => {
    const r = rng(13);
    for (let n = 0; n < 3000; n++) {
      const doc = {
        title: randomTitle(r),
        compilation: pick(r, [true, false, undefined]),
        users_count: pick(r, [undefined, 0, 12, 999, 1000, 250000]),
        ratings_count: pick(r, [undefined, 40, 5000]),
      };
      const hit = r() < 0.5 ? { document: doc } : doc;
      const target = randomTitle(r).toLowerCase();
      expect(scoreSearchHit(hit, target)).toBe(refScoreHit(hit, target));
    }
  });

  it('flags box sets, title lists and "Author\'s:" collections', () => {
    expect(isCompilationHit({ title: 'The Sandman Omnibus' })).toBe(true);
    expect(isCompilationHit({ title: 'A, B, C, D' })).toBe(true);
    expect(isCompilationHit({ title: "Agatha Christie's: Poirot" })).toBe(true);
    expect(isCompilationHit({ title: 'Ficciones', compilation: true })).toBe(true);
    expect(isCompilationHit({ title: 'Ficciones' })).toBe(false);
  });
});

describe('Goodreads series parsing: client and Netlify Function copies agree', () => {
  // The two copies cannot share a file (separate bundles). This is what keeps
  // CSV and RSS imports from producing two rows for the same book.
  it('returns the same result for every title shape', () => {
    const r = rng(14);
    const cases = [...TITLES];
    for (let n = 0; n < 500; n++) cases.push(`${randomTitle(r)} (${pick(r, ['Dune', 'Saga A', ''])}${pick(r, [', #', ' #', ', '])}${pick(r, ['1', '2.5', 'x', ''])})`);
    for (const t of cases) expect(clientSplit(t)).toEqual(functionSplit(t));
  });

  it('the two source bodies are textually identical', async () => {
    const { readFileSync } = await import('node:fs');
    const body = (path) => {
      const src = readFileSync(new URL(path, import.meta.url), 'utf8');
      const start = src.indexOf('export function splitGoodreadsSeriesTitle');
      return src.slice(start, src.indexOf('\n}\n', start) + 2);
    };
    expect(body('../src/lib/sources/goodreadsImport.js')).toBe(body('../netlify/functions/_shared/goodreadsTitle.js'));
  });
});
