// series-queue.test.js — does the queue actually rotate?
//
// THE BUG THIS EXISTS FOR
//
// 2026-09-15. Every individual ordering the queue produced was correct. The
// defect only existed ACROSS RUNS: with a boolean first key, once every series
// carried a stamp the order collapsed onto two static keys and the same head was
// served every night. Wicked, Marvel Zombies and The Godfather opened three
// consecutive runs while the series behind them were never reached.
//
// So the test that catches it cannot assert on one call. It runs the queue
// several times, stamps what it served the way --stale does, and asserts that
// the whole population gets a turn.

import { describe, it, expect } from 'vitest';
import { orderStaleQueue, lastSeen } from '../batch-scripts/_shared/seriesQueue.mjs';

const norm = (s) => String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
const DEMAND = new Map([['wicked', 0], ['marvelzombies', 1], ['godfather', 2], ['redrising', 3]]);

const population = () => [
  { name: 'Wicked', held: 4, volumes_checked_at: '2026-09-14T10:00:00Z' },
  { name: 'Marvel Zombies', held: 3, volumes_checked_at: '2026-09-14T10:00:00Z' },
  { name: 'The Godfather', held: 3, volumes_checked_at: '2026-09-14T10:00:00Z' },
  { name: 'Red Rising', held: 6, volumes_checked_at: '2026-09-14T10:00:00Z' },
  { name: 'Dune', held: 6, volumes_checked_at: '2026-09-14T10:00:00Z' },
  { name: 'Earthsea', held: 5, volumes_checked_at: '2026-09-14T10:00:00Z' },
];

// One run of `--stale --limit N`: serve the head, stamp what was served.
const run = (pending, n, at) => {
  const served = orderStaleQueue(pending, DEMAND, norm).slice(0, n);
  for (const s of served) s.volumes_checked_at = at;
  return served.map((s) => s.name);
};

describe('the stale queue rotates', () => {
  it('gives every series a turn instead of repeating the head', () => {
    const pending = population();
    const seen = [];
    let clock = Date.parse('2026-09-15T09:00:00Z');
    for (let i = 0; i < 3; i++) {
      seen.push(run(pending, 2, new Date(clock).toISOString()));
      clock += 86_400_000;
    }
    // Three runs of two, six series: everyone, nobody twice.
    const flat = seen.flat();
    expect(flat).toHaveLength(6);
    expect(new Set(flat).size).toBe(6);
  });

  it('does not serve the same series two runs running', () => {
    const pending = population();
    let clock = Date.parse('2026-09-15T09:00:00Z');
    const first = run(pending, 2, new Date(clock).toISOString());
    clock += 86_400_000;
    const second = run(pending, 2, new Date(clock).toISOString());
    expect(second.some((n) => first.includes(n))).toBe(false);
  });

  it('comes back to the oldest once the queue has been round', () => {
    const pending = population();
    let clock = Date.parse('2026-09-15T09:00:00Z');
    const first = run(pending, 2, new Date(clock).toISOString());
    for (let i = 0; i < 2; i++) { clock += 86_400_000; run(pending, 2, new Date(clock).toISOString()); }
    clock += 86_400_000;
    const fourth = run(pending, 2, new Date(clock).toISOString());
    expect(fourth).toEqual(first);   // full rotation, same order
  });

  it('THE REGRESSION: a boolean first key repeats the head forever', () => {
    // The old comparator, kept as the thing this file exists to prevent.
    const oldOrder = (p) => p.slice().sort((a, b) =>
      (Number(a.volumes_checked_at != null) - Number(b.volumes_checked_at != null)) ||
      ((DEMAND.get(norm(a.name)) ?? 999) - (DEMAND.get(norm(b.name)) ?? 999)) ||
      (b.held - a.held));
    const pending = population();
    let clock = Date.parse('2026-09-15T09:00:00Z');
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const served = oldOrder(pending).slice(0, 2);
      for (const s of served) s.volumes_checked_at = new Date(clock).toISOString();
      runs.push(served.map((s) => s.name));
      clock += 86_400_000;
    }
    expect(runs[0]).toEqual(['Wicked', 'Marvel Zombies']);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);   // exactly what was happening in production
  });
});

describe('a never-examined series still wins outright', () => {
  it('sorts before every stamped series, whatever its demand rank', () => {
    const pending = [
      ...population(),
      { name: 'Nobody Has Looked', held: 1, volumes_checked_at: null },
    ];
    expect(orderStaleQueue(pending, DEMAND, norm)[0].name).toBe('Nobody Has Looked');
  });

  it('treats an unparseable stamp as never examined rather than skipping it', () => {
    expect(lastSeen({ volumes_checked_at: 'not a date' })).toBe(0);
    expect(lastSeen({ volumes_checked_at: null })).toBe(0);
    expect(lastSeen({})).toBe(0);
    expect(lastSeen(null)).toBe(0);
  });

  it('does not produce NaN when two series are both never examined', () => {
    // 0 rather than -Infinity: -Infinity minus -Infinity is NaN, and a NaN
    // comparator makes Array.prototype.sort undefined behaviour.
    const pending = [
      { name: 'A', held: 1, volumes_checked_at: null },
      { name: 'B', held: 9, volumes_checked_at: null },
    ];
    const ordered = orderStaleQueue(pending, new Map(), norm);
    expect(ordered.map((r) => r.name)).toEqual(['B', 'A']);   // falls through to shelf size
  });
});

describe('demand still orders within a cohort', () => {
  it('ranks by demand among series stamped at the same moment', () => {
    const pending = population();   // all stamped identically
    const ordered = orderStaleQueue(pending, DEMAND, norm).map((r) => r.name);
    expect(ordered.slice(0, 4)).toEqual(['Wicked', 'Marvel Zombies', 'The Godfather', 'Red Rising']);
  });

  it('falls back to the bigger shelf when demand knows neither', () => {
    const pending = [
      { name: 'Unknown Small', held: 2, volumes_checked_at: '2026-09-14T10:00:00Z' },
      { name: 'Unknown Big', held: 11, volumes_checked_at: '2026-09-14T10:00:00Z' },
    ];
    expect(orderStaleQueue(pending, DEMAND, norm)[0].name).toBe('Unknown Big');
  });
});
