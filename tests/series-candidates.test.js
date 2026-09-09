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

describe('the author filter reads every contribution', () => {
  // THE BUG THIS EXISTS FOR: a real propose run, 2026-09-09. Hardcover returned
  //
  //   House of Sky and Breath   768pp   credited to "Elizabeth Evans"
  //
  // as a candidate at position 2. That is the English volume — Elizabeth Evans
  // narrates the audiobook — and the filter threw it out as "usually a
  // translation" because it read contributions[0] and stopped. It did no harm
  // only because the catalog already held position 2, so the row was never
  // going to be proposed. With position 2 empty it would have dropped the real
  // book and left a translation standing.
  const withNarrator = {
    position: 2, title: 'House of Sky and Breath', authors: ['Elizabeth Evans', 'Sarah J. Maas'],
    pages: 768, coverUrl: 'x', description: 'd', hardcoverId: 429093,
  };
  const translated = {
    position: 2, title: 'Gökyüzü ve Nefes Hanesi', authors: ['Seyhan Dönmez'],
    pages: 840, coverUrl: 'x', description: '', hardcoverId: 2474585,
  };

  it('keeps a book whose author appears behind a narrator', () => {
    const { byPosition, rejected } = candidatesByPosition([withNarrator, translated], {
      seriesAuthors: ['Sarah J. Maas'],
    });
    expect(byPosition.get(2).map((c) => c.title)).toEqual(['House of Sky and Breath']);
    expect(rejected.map((r) => r.title)).toEqual(['Gökyüzü ve Nefes Hanesi']);
  });

  it('names every contributor when it does reject', () => {
    const { rejected } = candidatesByPosition([withNarrator, translated], {
      seriesAuthors: ['Sarah J. Maas'],
    });
    expect(rejected[0].reason).toContain('"Seyhan Dönmez"');
    expect(rejected[0].reason).toContain('none of them the series author');
  });
});

describe('the language filter', () => {
  const eng = { position: 1, title: 'The English One', authors: ['A'], language: 'eng', pages: 300, coverUrl: 'x', description: '', hardcoverId: 1 };
  const pol = { position: 1, title: 'Ta Polska Ksiazka', authors: ['A'], language: 'pol', pages: 310, coverUrl: 'x', description: '', hardcoverId: 2 };
  const unknown = { position: 1, title: 'Een Nederlands Boek', authors: ['A'], language: null, pages: 305, coverUrl: 'x', description: '', hardcoverId: 3 };

  it('drops a candidate whose language is known and wrong', () => {
    const { byPosition, rejected } = candidatesByPosition([eng, pol], { wantLanguage: 'eng' });
    expect(byPosition.get(1).map((c) => c.title)).toEqual(['The English One']);
    expect(rejected[0].reason).toMatch(/edition language pol, not eng/);
  });

  it('never drops a candidate whose language is unknown', () => {
    // Hardcover answered for 14 of 25 books in the probe run. Treating silence
    // as "foreign" would throw away more originals than translations.
    const { byPosition } = candidatesByPosition([eng, unknown], { wantLanguage: 'eng' });
    expect(byPosition.get(1)).toHaveLength(2);
  });

  it('a confirmed language beats the bundle inference', () => {
    // The quotation signal would favour whichever title the collections quote.
    // A language the API actually reported is a fact, and outranks it.
    const { byPosition } = candidatesByPosition([
      { ...unknown, title: 'Quoted Somewhere Else' },
      eng,
      { position: 1, title: 'A Collection of Quoted Somewhere Else', authors: ['A'], language: null, pages: 900, coverUrl: 'x', description: '', hardcoverId: 9 },
    ], { wantLanguage: 'eng' });
    expect(byPosition.get(1).find((c) => c.pick)?.title).toBe('The English One');
  });

  it('is inert when the caller supplies no preference', () => {
    const { byPosition, rejected } = candidatesByPosition([eng, pol], {});
    expect(rejected).toHaveLength(0);
    expect(byPosition.get(1)).toHaveLength(2);
  });
});

describe('a lone candidate is not evidence', () => {
  // THE BUG THIS EXISTS FOR: the 25-series run, 2026-09-09. Twelve of the
  // twenty-four pre-approvals were the only candidate at their position, and
  // half of those were wrong — Il Dio storpio (Italian) as Malazan 10, Veža
  // lastovičky (Slovak) as Witcher 4, Gideon: a Nona (a translation) as Locked
  // Tomb 1. With one candidate, `pick` was set unconditionally: nothing to
  // compare, so every signal sat idle and the row went out pre-approved because
  // Hardcover had filed it at that position.
  //
  // Translations name the ORIGINAL author alongside the translator, so the
  // author filter passes them. Only a reported language catches these.
  const lone = (extra) => [{
    position: 10, title: 'Il Dio storpio', authors: ['Steven Erikson'],
    pages: 900, coverUrl: 'x', description: '', hardcoverId: 1, ...extra,
  }];

  it('does not pick a lone candidate whose language is unknown', () => {
    const { byPosition } = candidatesByPosition(lone({ language: null }), {
      seriesAuthors: ['Steven Erikson'], wantLanguage: 'eng',
    });
    const c = byPosition.get(10)[0];
    expect(c.pick).toBe(false);
    expect(c.pickReason).toMatch(/no language reported/);
  });

  it('picks a lone candidate once the language is confirmed', () => {
    const { byPosition } = candidatesByPosition(lone({ language: 'eng' }), {
      seriesAuthors: ['Steven Erikson'], wantLanguage: 'eng',
    });
    expect(byPosition.get(10)[0].pick).toBe(true);
    expect(byPosition.get(10)[0].pickReason).toMatch(/language confirmed/);
  });

  it('drops a lone candidate outright when its language is known and wrong', () => {
    const { byPosition, rejected } = candidatesByPosition(lone({ language: 'ita' }), {
      seriesAuthors: ['Steven Erikson'], wantLanguage: 'eng',
    });
    expect(byPosition.get(10)).toBeUndefined();
    expect(rejected[0].reason).toMatch(/edition language ita, not eng/);
  });

  it('picks nothing at all when the caller wants no language filtering', () => {
    // --prefer-language none. Without a language there is no fact to lean on,
    // and one candidate still is not evidence, so the honest output is a
    // question rather than a default.
    const { byPosition } = candidatesByPosition(lone({ language: null }), {
      seriesAuthors: ['Steven Erikson'],
    });
    expect(byPosition.get(10)[0].pick).toBe(false);
  });
});

describe('collections that do not announce themselves in English', () => {
  it("catches L'Intégrale, and the other usual words", () => {
    // Sorceleur - L'Intégrale is the complete Witcher saga in French. It was
    // pre-approved as volume 0 on 2026-09-09.
    for (const t of [
      'Sorceleur - L’Intégrale', 'Sorceleur - L\'Integrale',
      'Il Ciclo di Geralt: edizione integrale', 'Obras completas de Sapkowski',
      'Die Hexer Gesamtausgabe', 'Coffret Sorceleur',
    ]) {
      expect(COLLECTION_RE.test(t), `"${t}" should read as a collection`).toBe(true);
    }
  });

  it('does not catch an ordinary volume title', () => {
    for (const t of [
      'Hellboy, Vol. 5: Conqueror Worm', 'Baptism of Fire', 'Midnight Tides',
      'The Complete Sherlock Holmes Novel', 'Integral Calculus for Beginners',
    ]) {
      expect(COLLECTION_RE.test(t), `"${t}" should NOT read as a collection`).toBe(false);
    }
  });
});
