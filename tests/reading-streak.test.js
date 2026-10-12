// reading-streak.test.js — lib/readingStreak.js, lib/random.js, lib/dates.js.
//
// The streak cases are the rules in docs/MATH.md → "Reading streak", as
// examples. The shuffle cases pin the property that broke the Oracle Spark:
// the input array must never be reordered.

import { describe, it, expect } from 'vitest';
import { monthlyReadingStreak, streakTemperature } from '../src/lib/readingStreak.js';
import { shuffle, sample } from '../src/lib/random.js';
import { parseIsoDate } from '../src/lib/dates.js';

const read = (...dates) => dates.map((dateRead) => ({ dateRead }));
const OCT_12 = new Date(2026, 9, 12); // local time, month is 0-based

describe('monthlyReadingStreak', () => {
  it('counts consecutive months ending this month', () => {
    const r = monthlyReadingStreak(read('2026-10-02', '2026-09-20', '2026-08-01'), OCT_12);
    expect(r).toEqual({ months: 3, includesCurrentMonth: true, lastFinishedOn: '2026-10-02' });
  });

  it('does not break on a current month with no finish yet (grace period)', () => {
    const r = monthlyReadingStreak(read('2026-09-30', '2026-08-15', '2026-07-01'), OCT_12);
    expect(r.months).toBe(3);
    expect(r.includesCurrentMonth).toBe(false);
  });

  it('breaks on a missing completed month', () => {
    const r = monthlyReadingStreak(read('2026-10-01', '2026-08-01'), OCT_12);
    expect(r.months).toBe(1);
  });

  it('is 0 when last month and this month are both empty', () => {
    const r = monthlyReadingStreak(read('2026-08-01'), OCT_12);
    expect(r).toEqual({ months: 0, includesCurrentMonth: false, lastFinishedOn: '2026-08-01' });
  });

  it('counts several books in one month once, and crosses year boundaries', () => {
    const jan = new Date(2027, 0, 3);
    const r = monthlyReadingStreak(read('2026-12-31', '2026-12-01', '2026-11-11'), jan);
    expect(r.months).toBe(2);
  });

  it('ignores books without a date and handles an empty library', () => {
    expect(monthlyReadingStreak([{}, { dateRead: null }], OCT_12).lastFinishedOn).toBeNull();
    expect(monthlyReadingStreak(undefined, OCT_12).months).toBe(0);
  });

  it('maps months to a temperature', () => {
    expect([0, 2, 3, 5, 6, 40].map(streakTemperature)).toEqual(['cold', 'cold', 'warm', 'warm', 'hot', 'hot']);
  });
});

describe('shuffle / sample', () => {
  it('never mutates the input', () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    shuffle(input);
    sample(input, 3);
    expect(input).toEqual(snapshot);
  });

  it('returns a permutation of the input', () => {
    expect(shuffle([3, 1, 2]).sort()).toEqual([1, 2, 3]);
  });

  it('is deterministic with an injected random source', () => {
    const zero = () => 0;
    expect(shuffle(['a', 'b', 'c'], zero)).toEqual(['b', 'c', 'a']);
  });

  it('samples at most the available items and tolerates bad input', () => {
    expect(sample([1, 2], 5)).toHaveLength(2);
    expect(sample(null, 3)).toEqual([]);
    expect(sample([1, 2, 3], -1)).toEqual([]);
  });

  it('is roughly uniform (each of 3 items lands first ~1/3 of the time)', () => {
    let seed = 42;
    const lcg = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const firsts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 30000; i++) firsts[shuffle(['a', 'b', 'c'], lcg)[0]]++;
    for (const n of Object.values(firsts)) expect(Math.abs(n / 30000 - 1 / 3)).toBeLessThan(0.02);
  });
});

describe('parseIsoDate', () => {
  it('reads a bare date as that local calendar day, not UTC midnight', () => {
    const d = parseIsoDate('2026-10-05');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 5]);
  });

  it('passes timestamps through and rejects junk', () => {
    expect(parseIsoDate('2026-10-05T12:00:00Z')).toBeInstanceOf(Date);
    expect(parseIsoDate('not a date')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });
});
