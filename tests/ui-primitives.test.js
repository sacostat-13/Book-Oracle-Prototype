// ui-primitives.test.js — the pure parts of the Sprint 2 UI building blocks.
// (Rendering is checked with before/after screenshots; see the PR.)

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { toggleInList } from '../src/lib/selection.js';

describe('toggleInList', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('refuses to add past max, returning the same array so callers can skip a save', () => {
    const full = ['a', 'b'];
    expect(toggleInList(full, 'c', { max: 2 })).toBe(full);
    expect(toggleInList(full, 'a', { max: 2 })).toEqual(['b']); // removing still works at the max
  });

  it('never mutates and tolerates a missing list', () => {
    const list = ['a'];
    toggleInList(list, 'b');
    expect(list).toEqual(['a']);
    expect(toggleInList(undefined, 'x')).toEqual(['x']);
  });
});

// Every dialog goes through primitives/Modal: no hand-rolled backdrops, no
// per-modal Escape listeners or body-scroll toggles. A file that needs one of
// these is a sign it should use (or extend) Modal instead.
describe('modals use the shared Modal', () => {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.jsx') && !p.includes('primitives')) files.push(p);
    }
  })(new URL('../src', import.meta.url).pathname);

  it('no component renders the old overlay shells', () => {
    const offenders = files.filter((f) => /className="[^"]*\b(rating-modal-overlay|overlay)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no component calls the native confirm() — use useConfirm()', () => {
    const offenders = files.filter((f) => /(^|[^.\w])(window\.)?confirm\(/m.test(readFileSync(f, 'utf8').replace(/await confirm\(/g, '')));
    expect(offenders).toEqual([]);
  });

  it('no component toggles body scrolling itself', () => {
    const offenders = files.filter((f) => /document\.body\.style\.overflow/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('StarRating helpers', async () => {
  const { clampStars, starString } = await import('../src/components/primitives/StarRating.jsx');

  it('clamps to whole stars in 0–5', () => {
    expect([-1, 0, 2.4, 2.6, 5, 9, 'x', null].map(clampStars)).toEqual([0, 0, 2, 3, 5, 5, 0, 0]);
  });

  it('formats a rating as text for tooltips', () => {
    expect(starString(4)).toBe('★★★★');
    expect(starString(0)).toBe('');
  });

  it('no component repeats ★ by hand any more', () => {
    const offenders = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.jsx') && !p.includes('primitives') && /'★'\.repeat/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    })(new URL('../src', import.meta.url).pathname);
    expect(offenders).toEqual([]);
  });
});
