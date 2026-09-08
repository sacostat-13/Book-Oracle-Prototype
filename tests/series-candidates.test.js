// series-candidates.test.js — the Crescent City payload that broke the backfill.
//
// THE BUG THIS EXISTS FOR
//
// 2026-09-08. seriesBackfill.mjs was written, run once against Crescent City —
// a THREE book series — and proposed twenty books, fifteen of them pre-approved
// at confidence 100. Bundles, box sets, four editions of one volume, three
// translations, and two halves of a split edition at positions 1.1 and 1.2.
//
// Applying it would have put eight junk rows into the series, and
// series_volumes would then have picked one per position by page count — most
// likely `Crescent City ebook Bundle: A 3 Book Bundle`, at 4,379 pages. The
// catalog would have been worse than before the fix.
//
// The fixture below is that exact API response, transcribed from the CSV the
// broken run produced. It is not a plausible example; it is the thing that
// happened. Every filter in seriesCandidates.mjs earns its place against one of
// these rows, so a filter that stops working shows up here as the specific book
// it stopped catching.

import { describe, it, expect } from 'vitest';
import { candidatesByPosition, COLLECTION_RE } from '../batch-scripts/_shared/seriesCandidates.mjs';

// Hardcover's book_series for "Crescent City", 2026-09-08. Positions and page
// counts verbatim; description/cover reduced to what the scoring reads.
const CRESCENT_CITY = [
  { position: 1, title: 'House of Earth and Blood, House of Sky and Breath', author: 'Sarah J. Maas', pages: 1584, coverUrl: 'x', description: '', hardcoverId: 2338974 },
  { position: 1, title: 'Dom Ziemi i Krwi', author: 'Sarah J. Maas', pages: 724, coverUrl: 'x', description: '', hardcoverId: 1899794 },
  { position: 1, title: 'House of Earth and Blood', author: 'Sarah J. Maas', pages: 816, coverUrl: 'x', description: '', hardcoverId: 1886446 },
  { position: 1, title: 'Crescent City ebook Bundle: A 3 Book Bundle', author: 'Sarah J. Maas', pages: 4379, coverUrl: '', description: '', hardcoverId: 1755231 },
  { position: 1, title: 'Crescent City Bundle: A 2-book bundle', author: 'Sarah J. Maas', pages: 1642, coverUrl: 'x', description: '', hardcoverId: 853106 },
  { position: 1, title: ' Crescent City Bundle: A 3 Book Bundle ', author: 'Sarah J. Maas', pages: 2776, coverUrl: 'x', description: '', hardcoverId: 1386749 },
  { position: 1, title: 'House of Earth and Blood', author: 'Sarah J. Maas', pages: null, coverUrl: 'x', description: '', hardcoverId: 2221053 },
  { position: 1, title: 'House of Earth and Blood', author: 'Sarah J. Maas', pages: null, coverUrl: 'x', description: '', hardcoverId: 2248766 },
  { position: 1, title: 'Crescent City Series Set of 3 Books. House of Earth and Blood, House of Sky and Breath and House of Flame and Shadow', author: 'Sarah J. Maas', pages: null, coverUrl: 'x', description: '', hardcoverId: 2339063 },
  { position: 1, title: 'Crescent City Hardcover Box Set', author: 'Sarah J. Maas', pages: null, coverUrl: 'x', description: '', hardcoverId: 2345167 },
  { position: 1, title: 'Toprak ve Kan Hanesi', author: 'Arif Dursun', pages: 856, coverUrl: 'x', description: '', hardcoverId: 2474630 },
  { position: 1, title: 'House of Earth and Blood', author: 'Sarah J. Maas', pages: 803, coverUrl: 'x', description: 'd', hardcoverId: 465201 },
  { position: 1.1, title: 'House of Earth and Blood, Part 1 of 2', author: 'Marcin Mortka', pages: 560, coverUrl: 'x', description: '', hardcoverId: 2385778 },
  { position: 1.2, title: 'House of Earth and Blood, Part 2 of 2', author: '', pages: null, coverUrl: '', description: '', hardcoverId: 2710504 },
  { position: 2.1, title: 'House of Sky and Breath, Part 1 of 2', author: 'Sarah J. Maas', pages: null, coverUrl: 'x', description: '', hardcoverId: 1447207 },
  { position: 2.2, title: 'House of Sky and Breath, Part 2 of 2', author: 'Sarah J. Maas', pages: null, coverUrl: 'x', description: '', hardcoverId: 2710499 },
  { position: 3, title: 'Huis van vuur & schaduw', author: 'Sarah J. Maas', pages: 980, coverUrl: 'x', description: '', hardcoverId: 1901444 },
  { position: 3, title: 'Alev ve Gölge Hanesi', author: 'Seyhan Dönmez', pages: 928, coverUrl: 'x', description: '', hardcoverId: 2474562 },
  { position: 3, title: 'Cidade da Lua Crescente: Casa de chama e sombra', author: 'Carolina Candido', pages: 938, coverUrl: 'x', description: '', hardcoverId: 2462725 },
  { position: 3, title: 'House of Flame and Shadow', author: 'Sarah J. Maas', pages: 838, coverUrl: 'x', description: 'd', hardcoverId: 746152 },
];

const titlesAt = (byPosition, n) => (byPosition.get(n) || []).map((c) => c.title.trim()).sort();
const rejectedTitle = (rejected, t) => rejected.find((r) => r.title.trim() === t);

describe('Hardcover series candidates → volumes', () => {
  const { byPosition, rejected } = candidatesByPosition(CRESCENT_CITY);

  it('keeps only integer positions', () => {
    expect([...byPosition.keys()].sort((a, b) => a - b)).toEqual([1, 3]);
    for (const p of [1.1, 1.2, 2.1, 2.2]) {
      const r = rejected.find((x) => x.position === p);
      expect(r, `position ${p} should have been rejected`).toBeTruthy();
      expect(r.reason).toMatch(/split edition/);
    }
  });

  it('rejects every bundle, box set and multi-book collection', () => {
    for (const t of [
      'Crescent City ebook Bundle: A 3 Book Bundle',
      'Crescent City Bundle: A 2-book bundle',
      'Crescent City Bundle: A 3 Book Bundle',
      'Crescent City Hardcover Box Set',
      'Crescent City Series Set of 3 Books. House of Earth and Blood, House of Sky and Breath and House of Flame and Shadow',
    ]) {
      expect(rejectedTitle(rejected, t), `"${t}" should be rejected`).toBeTruthy();
    }
  });

  it('rejects an omnibus that only gives itself away by containing another title', () => {
    // "House of Earth and Blood, House of Sky and Breath" matches no bundle
    // word. It is caught because it contains "House of Earth and Blood" whole.
    const r = rejectedTitle(rejected, 'House of Earth and Blood, House of Sky and Breath');
    expect(r).toBeTruthy();
    expect(r.reason).toMatch(/contains \d+ other volume title/);
  });

  it('collapses four editions of one volume into one candidate, keeping the fullest', () => {
    const one = byPosition.get(1);
    const heab = one.filter((c) => c.title.trim() === 'House of Earth and Blood');
    expect(heab).toHaveLength(1);
    // Of the four, only 465201 has a cover, a page count AND a description.
    expect(heab[0].hardcoverId).toBe(465201);
  });

  it('leaves the real choice for a human instead of guessing at translations', () => {
    // Position 1: the English original and the Polish and Turkish translations
    // survive as genuine candidates. Nothing in the fields this can safely query
    // separates them, so all three are offered.
    expect(titlesAt(byPosition, 1)).toEqual([
      'Dom Ziemi i Krwi', 'House of Earth and Blood', 'Toprak ve Kan Hanesi',
    ]);
    expect(titlesAt(byPosition, 3)).toEqual([
      'Alev ve Gölge Hanesi',
      'Cidade da Lua Crescente: Casa de chama e sombra',
      'House of Flame and Shadow',
      'Huis van vuur & schaduw',
    ]);
  });

  it('turns twenty proposals into seven, none of them junk', () => {
    const total = [...byPosition.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(7);
    expect(rejected.length).toBe(20 - 7 - 3); // 3 of the 20 were duplicate editions, collapsed not rejected
  });

  it('never proposes a bundle as a volume, whatever the page count says', () => {
    const survivors = [...byPosition.values()].flat().map((c) => c.title);
    for (const t of survivors) expect(COLLECTION_RE.test(t)).toBe(false);
  });
});

describe('the containment filter does not eat short-titled series', () => {
  // "Ring" is a real series in the catalog (Kōji Suzuki, 14 impressions). A
  // naive containment test would find "ring" inside "Spring Snow" and reject
  // the lot, so titles of six characters or fewer sit the test out.
  const RING = [
    { position: 1, title: 'Ring', author: 'Kōji Suzuki', pages: 282, coverUrl: 'x', description: '', hardcoverId: 1 },
    { position: 2, title: 'Spiral', author: 'Kōji Suzuki', pages: 288, coverUrl: 'x', description: '', hardcoverId: 2 },
    { position: 3, title: 'Loop', author: 'Kōji Suzuki', pages: 352, coverUrl: 'x', description: '', hardcoverId: 3 },
  ];
  it('keeps all three volumes', () => {
    const { byPosition, rejected } = candidatesByPosition(RING);
    expect(rejected).toHaveLength(0);
    expect([...byPosition.keys()].sort()).toEqual([1, 2, 3]);
  });
});

describe('the page-count outlier filter needs a real median', () => {
  it('does not fire on two candidates', () => {
    // Two books, one much longer, is normal in a series. The filter only means
    // something once there are three page counts to take a median of.
    const { byPosition, rejected } = candidatesByPosition([
      { position: 1, title: 'Short Volume One', author: 'A', pages: 300, coverUrl: 'x', description: '', hardcoverId: 1 },
      { position: 1, title: 'Longer Volume Uno', author: 'A', pages: 900, coverUrl: 'x', description: '', hardcoverId: 2 },
    ]);
    expect(rejected).toHaveLength(0);
    expect(byPosition.get(1)).toHaveLength(2);
  });
});
