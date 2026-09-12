// hardcover-contributions.test.js — the narrator is not the author.
//
// THE BUG THESE EXIST FOR
//
// hardcoverService.js read `contributions[0]` and called it the author.
// Hardcover's contributions are not author-first, and the 2026-09-10 Dresden
// Files query found two catalog rows it had created in the preceding fortnight:
//
//   "Death Masks"  by James Marsters   — narrates the Dresden audiobooks
//   "White Night"  by Chris McGrath    — paints the covers
//
// Both sat on positions the real volume already held, invisible because
// series_volumes renders one row per position. The same bug threw the English
// "House of Sky and Breath" out of a Crescent City proposal a day earlier,
// credited to its narrator.
//
// Every fixture below is a real payload shape recorded by
// batch-scripts/probes/probeHardcoverContributions.mjs, 2026-09-10.

import { describe, it, expect } from 'vitest';
import { pickAuthorName, allContributorNames, isNonAuthorRole } from '../src/lib/contributions';

const C = (contribution, name) => ({ contribution, author: { name } });

// Verbatim from the probe.
const HOUSE_OF_SKY_AND_BREATH = [C('Narrator', 'Elizabeth Evans'), C('Author', 'Sarah J. Maas')];
const A_HAT_FULL_OF_SKY = [C('Author', 'Terry Pratchett'), C('illustrator', 'Paul Kidby')];

describe('the roles the probe actually saw', () => {
  it('picks the author past a narrator listed first', () => {
    expect(pickAuthorName(HOUSE_OF_SKY_AND_BREATH)).toBe('Sarah J. Maas');
  });

  it('picks the author past an illustrator', () => {
    // This is where our own Wintersmith row got Paul Kidby, and why the
    // Tiffany Aching author matching had nothing to work with.
    expect(pickAuthorName(A_HAT_FULL_OF_SKY)).toBe('Terry Pratchett');
  });

  it('is case-insensitive, because Hardcover is not consistent', () => {
    // "Author" capitalised, "illustrator" not — both in the same book.
    expect(pickAuthorName([C('illustrator', 'Artist'), C('AUTHOR', 'Writer')])).toBe('Writer');
    expect(pickAuthorName([C('narrator', 'Reader'), C('author', 'Writer')])).toBe('Writer');
  });
});

describe('payloads with no role information', () => {
  it('takes a lone unroled contributor', () => {
    // Older Hardcover records leave `contribution` null.
    expect(pickAuthorName([{ contribution: null, author: { name: 'Somebody' } }])).toBe('Somebody');
  });

  it('falls back to the first name when nothing carries a role', () => {
    // A caller that cannot select `contribution` must be no worse off than
    // before this module existed.
    const unroled = [{ author: { name: 'First' } }, { author: { name: 'Second' } }];
    expect(pickAuthorName(unroled)).toBe('First');
  });

  it('prefers an explicit author over an unroled contributor', () => {
    expect(pickAuthorName([{ author: { name: 'Unroled' } }, C('Author', 'Named')])).toBe('Named');
  });
});

describe('requireRole, for callers with a better fallback', () => {
  it('returns null when nobody is identified as the author', () => {
    // An audiobook edition record credited only to its narrator. The search
    // path has `author_names` to fall back on, so a guess here would just
    // reintroduce the bug.
    expect(pickAuthorName([C('Narrator', 'Reader')], { requireRole: true })).toBeNull();
    expect(pickAuthorName([{ author: { name: 'Unroled' } }], { requireRole: true })).toBeNull();
  });

  it('still answers when the role is there', () => {
    expect(pickAuthorName(HOUSE_OF_SKY_AND_BREATH, { requireRole: true })).toBe('Sarah J. Maas');
  });
});

describe('what it refuses to invent', () => {
  it('returns null for nothing at all', () => {
    for (const v of [null, undefined, [], 'not an array', 42]) {
      expect(pickAuthorName(v)).toBeNull();
    }
  });

  it('ignores contributions with no usable name', () => {
    const junk = [{ contribution: 'Author', author: null }, { contribution: 'Author', author: { name: '   ' } }, C('Author', 'Real Name')];
    expect(pickAuthorName(junk)).toBe('Real Name');
  });

  it('trims what it returns', () => {
    expect(pickAuthorName([C('Author', '  Padded Name  ')])).toBe('Padded Name');
  });
});

describe('the other two helpers', () => {
  it('lists everyone credited, for callers that compare against a known author', () => {
    // seriesBackfill needs all of them: a narrator alongside Sarah J. Maas
    // keeps the book, a translator instead of her loses it.
    expect(allContributorNames(HOUSE_OF_SKY_AND_BREATH)).toEqual(['Elizabeth Evans', 'Sarah J. Maas']);
    expect(allContributorNames(null)).toEqual([]);
  });

  it('knows the roles that are not authorship', () => {
    for (const r of ['Narrator', 'illustrator', 'Translator', 'EDITOR', 'colorist']) {
      expect(isNonAuthorRole(r)).toBe(true);
    }
    for (const r of ['Author', 'author', '', null, undefined]) {
      expect(isNonAuthorRole(r)).toBe(false);
    }
  });
});
