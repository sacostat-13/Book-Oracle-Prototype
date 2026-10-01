// tests/publication-year.test.js — the rule that decides books.first_published_year.
//
// Every case below is a real row from the 2026-09-30 conflicts CSV (hc = Hardcover,
// ol = OpenLibrary, wd = what Wikidata's P577 says for the work). The first run
// wrote the EARLIEST year on conflict and got every one of the "junk" cases wrong.

import { describe, it, expect } from 'vitest';
import { decideYear, wikidataYear, plausibleYear } from '../batch-scripts/_shared/publicationYear.mjs';

describe('decideYear: two sources that agree', () => {
  it('writes the earlier of two agreeing years', () => {
    expect(decideYear({ hc: 1997, ol: 1996 })).toEqual({ year: 1996, basis: 'hc+ol' });
  });
  it('treats exactly TOLERANCE apart as agreement', () => {
    expect(decideYear({ hc: 1999, ol: 1996 }).year).toBe(1996);
  });
});

describe('decideYear: the junk the first run wrote', () => {
  it('OpenLibrary sentinel year loses to a corroborated one (Frankenstein)', () => {
    expect(decideYear({ hc: 1818, ol: 1718, wd: 1818 })).toEqual({ year: 1818, basis: 'hc+wd' });
  });
  it('Hardcover fragment loses to a corroborated one (The Screaming Staircase)', () => {
    expect(decideYear({ hc: 8, ol: 2013, wd: 2013 }).year).toBe(2013);
  });
  it('Hardcover reissue year loses (A Game of Thrones)', () => {
    expect(decideYear({ hc: 2000, ol: 1996, wd: 1996 }).year).toBe(1996);
  });
  it('two near answers outvote a reissue (Harry Potter: 2016 / 2000 / 1997)', () => {
    expect(decideYear({ hc: 2016, ol: 2000, wd: 1997 })).toEqual({ year: 1997, basis: 'ol+wd' });
  });
  it('the later year wins when it is the corroborated one (Onyx Storm)', () => {
    expect(decideYear({ hc: 2025, ol: 2018, wd: 2025 }).year).toBe(2025);
  });
});

describe('decideYear: refuses rather than guesses', () => {
  it('three-way disagreement is a conflict (Little Women: 2026 / 1848 / 1868)', () => {
    expect(decideYear({ hc: 2026, ol: 1848, wd: 1868 })).toEqual({ year: null, basis: 'conflict' });
  });
  it('two sources that disagree with no tiebreaker is a conflict', () => {
    expect(decideYear({ hc: 1985, ol: 1900 }).year).toBeNull();
  });
  it('groups are pairwise: 1994 / 1997 / 2000 is not one agreement', () => {
    expect(decideYear({ hc: 2000, ol: 1997, wd: 1994 }).year).toBeNull();
  });
  it('a lone year below 1000 is not written (Red Rabbit: 20)', () => {
    expect(decideYear({ hc: 20 })).toEqual({ year: null, basis: 'implausible' });
  });
  it('an ancient year is written when two sources agree (The Art of War)', () => {
    expect(decideYear({ hc: -500, wd: -500 }).year).toBe(-500);
  });
  it('nothing in, nothing out', () => {
    expect(decideYear({ hc: null, ol: undefined })).toEqual({ year: null, basis: 'none' });
  });
});

describe('decideYear: a single source', () => {
  it('is accepted at or after 1000', () => {
    expect(decideYear({ wd: 1954 })).toEqual({ year: 1954, basis: 'wd' });
  });
  it('drops impossible values before deciding', () => {
    expect(plausibleYear(0)).toBeNull();
    expect(plausibleYear(new Date().getFullYear() + 5)).toBeNull();
    expect(decideYear({ hc: 99999, ol: 1990 })).toEqual({ year: 1990, basis: 'ol' });
  });
});

describe('wikidataYear', () => {
  it('reads a year-precision date', () => {
    expect(wikidataYear({ time: '+1954-07-29T00:00:00Z', precision: 11 })).toBe(1954);
  });
  it('reads a BCE date', () => {
    expect(wikidataYear({ time: '-0500-00-00T00:00:00Z', precision: 9 })).toBe(-500);
  });
  it('refuses decade or century precision', () => {
    expect(wikidataYear({ time: '+1950-00-00T00:00:00Z', precision: 8 })).toBeNull();
  });
  it('tolerates junk', () => {
    expect(wikidataYear(null)).toBeNull();
    expect(wikidataYear({ time: 'nope' })).toBeNull();
  });
});
