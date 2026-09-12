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
import { candidatesByPosition, COLLECTION_RE, resolveSeriesHit, rankSeriesHits, splitAuthors, cleanTitle } from '../batch-scripts/_shared/seriesCandidates.mjs';

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
  // heldTitles is what the catalog had at the time: one book, House of Sky and
  // Breath at position 2. It matters because an omnibus quotes the volumes it
  // collects and some of those are ours — without it, "House of Earth and
  // Blood, House of Sky and Breath" quotes only one title this list knows about
  // and reads as a volume.
  const { byPosition, rejected } = candidatesByPosition(CRESCENT_CITY, {
    seriesAuthors: ['Sarah J. Maas'],
    heldTitles: ['House of Sky and Breath'],
  });

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

  it('rejects an omnibus that only gives itself away by quoting two volumes', () => {
    // "House of Earth and Blood, House of Sky and Breath" matches no bundle
    // word. It is caught because it quotes TWO titles whole — the candidate at
    // position 1 and the book the catalog already holds at position 2.
    //
    // Two and not one: a title quoting ONE sibling is how a sequel is named.
    // Requiring one rejected every volume of Marvel Zombies, because a
    // candidate titled exactly "Marvel Zombies" is a substring of every book in
    // its own series.
    const r = rejectedTitle(rejected, 'House of Earth and Blood, House of Sky and Breath');
    expect(r).toBeTruthy();
    expect(r.reason).toMatch(/quotes 2 other volume titles/);
  });

  it('collapses four editions of one volume into one candidate, keeping the fullest', () => {
    const one = byPosition.get(1);
    const heab = one.filter((c) => c.title.trim() === 'House of Earth and Blood');
    expect(heab).toHaveLength(1);
    // Of the four, only 465201 has a cover, a page count AND a description.
    expect(heab[0].hardcoverId).toBe(465201);
  });

  it('drops the translator-credited rows and leaves the rest as a real choice', () => {
    // The Turkish and Portuguese editions are credited to their translators and
    // share a position with a Sarah J. Maas row, so they go. The Polish and
    // Dutch ones name her too and survive as genuine alternatives — nothing in
    // the fields this can safely query separates those from the originals.
    expect(titlesAt(byPosition, 1)).toEqual(['Dom Ziemi i Krwi', 'House of Earth and Blood']);
    expect(titlesAt(byPosition, 3)).toEqual(['House of Flame and Shadow', 'Huis van vuur & schaduw']);
  });

  it('picks the original on the quotation signal, with no language to help', () => {
    const picked = (n) => (byPosition.get(n) || []).filter((c) => c.pick).map((c) => c.title.trim());
    expect(picked(1)).toEqual(['House of Earth and Blood']);
    expect(picked(3)).toEqual(['House of Flame and Shadow']);
  });

  it('turns twenty candidates into four, none of them junk', () => {
    // 20 in. Four survive — two positions with the original and one plausible
    // translation each. 13 are rejected and 3 were duplicate editions of House
    // of Earth and Blood, collapsed rather than rejected.
    const total = [...byPosition.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(4);
    expect(rejected.length).toBe(13);
    expect(total + rejected.length + 3).toBe(CRESCENT_CITY.length);
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
    expect(rejected[0].reason).toMatch(/editions are pol — no eng among them/);
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
    expect(byPosition.get(10)[0].pickReason).toMatch(/has a eng edition/);
  });

  it('drops a lone candidate outright when its language is known and wrong', () => {
    const { byPosition, rejected } = candidatesByPosition(lone({ language: 'ita' }), {
      seriesAuthors: ['Steven Erikson'], wantLanguage: 'eng',
    });
    expect(byPosition.get(10)).toBeUndefined();
    expect(rejected[0].reason).toMatch(/editions are ita — no eng among them/);
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

describe('resolving which Hardcover series is ours', () => {
  const hits = (...names) => names.map((n, i) => ({ document: { id: i + 1, name: n } }));

  it('takes an exact name match', () => {
    const r = resolveSeriesHit(hits('Marvel Zombies'), 'Marvel Zombies');
    expect([r.hit.name, r.score, r.exact]).toEqual(['Marvel Zombies', 2, true]);
  });

  it('takes a containing match, with the leading "the" stripped', () => {
    // Our catalog says "The Icewind Dale"; Hardcover files it as a trilogy.
    const r = resolveSeriesHit(hits('Icewind Dale Trilogy'), 'The Icewind Dale');
    expect([r.hit.name, r.score, r.exact]).toEqual(['Icewind Dale Trilogy', 1, false]);
  });

  it('prefers an exact hit over a containing one', () => {
    const r = resolveSeriesHit(hits('Ring: The Complete Saga', 'Ring'), 'Ring');
    expect([r.hit.name, r.score]).toEqual(['Ring', 2]);
  });

  it('resolves to NOTHING when no hit matches, rather than the first hit', () => {
    // THE BUG THIS EXISTS FOR: bestScore started at -1, so a score of 0 still
    // won and an unrelated series' volumes were fetched as if they were ours.
    // The name-corroboration guard caught it downstream and set confidence 0,
    // so nothing was ever pre-approved — but the CSV filled with another
    // series' books and said only that the name did not match.
    const r = resolveSeriesHit(hits('Warhammer 40k: Horus Heresy', "Gaunt's Ghosts"), 'Marvel Zombies');
    expect(r.hit).toBeNull();
    expect(r.score).toBe(0);
  });

  it('reports what was offered instead, so a naming mismatch is diagnosable', () => {
    // Three of the twenty-five series went silent on 2026-09-09 and all three
    // said "hardcover has no volume list". Two of them were this.
    const r = resolveSeriesHit(hits('Warhammer 40k: Horus Heresy', "Gaunt's Ghosts"), 'Marvel Zombies');
    expect(r.nearMisses).toEqual(['Warhammer 40k: Horus Heresy', "Gaunt's Ghosts"]);
  });

  it('handles an empty hit list without inventing one', () => {
    const r = resolveSeriesHit([], 'Anything');
    expect([r.hit, r.nearMisses]).toEqual([null, []]);
  });
});

describe('no primary_books_count ceiling', () => {
  // THE BUG THIS EXISTS FOR: The Bloodsworn Saga, 2026-09-09. Three volumes and
  // a boxed set, and the run reported "hardcover offered 1, 1 filtered out" for
  // a series holding two of three. The volumes were dropped by the
  // primary_books_count ceiling in the FETCH, before any filter could see them,
  // so --show-rejected could not show what had gone. The one thing to survive
  // was the boxed set.
  const bloodsworn = [
    { position: 1, title: 'The Shadow of the Gods', authors: ['John Gwynne'], language: 'eng', pages: 500, coverUrl: 'x', description: 'd', hardcoverId: 1 },
    { position: 2, title: 'The Hunger of the Gods', authors: ['John Gwynne'], language: 'eng', pages: 600, coverUrl: 'x', description: 'd', hardcoverId: 2 },
    { position: 3, title: 'The Fury of the Gods', authors: ['John Gwynne'], language: 'eng', pages: 550, coverUrl: 'x', description: 'd', hardcoverId: 3 },
    { position: 1, title: 'The Bloodsworn Saga Boxed Set: The Shadow of the Gods, The Hunger of the Gods, The Fury of the Gods', authors: ['John Gwynne'], language: 'eng', pages: 1776, coverUrl: 'x', description: '', hardcoverId: 4 },
  ];
  const { byPosition, rejected } = candidatesByPosition(bloodsworn, {
    seriesAuthors: ['John Gwynne'], wantLanguage: 'eng',
  });

  it('every volume reaches the filters', () => {
    expect([...byPosition.keys()].sort()).toEqual([1, 2, 3]);
  });

  it('and only the boxed set is turned away', () => {
    expect(rejected.map((r) => r.hardcoverId)).toEqual([4]);
  });

  it('so the missing volume 3 is pickable', () => {
    expect(byPosition.get(3).map((c) => [c.title, c.pick])).toEqual([['The Fury of the Gods', true]]);
  });
});

describe('ranking every plausible Hardcover series, not just the winner', () => {
  const hits = (...names) => names.map((n, i) => ({ document: { id: i + 1, name: n } }));

  // THE BUG THIS EXISTS FOR: 2026-09-09. "Marvel Zombies" and "The Icewind Dale"
  // each matched a Hardcover series EXACTLY — and both of those records have no
  // books attached. Returning only the best hit meant stopping at a stub: an
  // exact match to an empty record beat a containing match to the populated one,
  // and the run reported "0 entries" as though Hardcover had never heard of the
  // series. A name is not an identifier there.
  it('keeps the runner-up so the caller can move past an empty record', () => {
    const r = rankSeriesHits(hits('Marvel Zombies', 'Marvel Zombies Omnibus Collection'), 'Marvel Zombies');
    expect(r.ranked.map((x) => [x.name, x.score]))
      .toEqual([['Marvel Zombies', 2], ['Marvel Zombies Omnibus Collection', 1]]);
  });

  it('ranks exact ahead of containing', () => {
    const r = rankSeriesHits(hits('The Icewind Dale', 'Icewind Dale Trilogy'), 'The Icewind Dale');
    expect(r.ranked.map((x) => x.name)).toEqual(['The Icewind Dale', 'Icewind Dale Trilogy']);
  });

  it('ranks nothing when nothing is plausible, and says what was offered', () => {
    const r = rankSeriesHits(hits('Warhammer 40k', "Gaunt's Ghosts"), 'Marvel Zombies');
    expect(r.ranked).toHaveLength(0);
    expect(r.nearMisses).toEqual(['Warhammer 40k', "Gaunt's Ghosts"]);
  });

  it('will not rank a hit with no id, which cannot be fetched', () => {
    expect(rankSeriesHits([{ document: { name: 'No Id Here' } }], 'No Id Here').ranked).toHaveLength(0);
  });

  it('resolveSeriesHit still answers with the top of the ranking', () => {
    const r = resolveSeriesHit(hits('Ring: The Complete Saga', 'Ring'), 'Ring');
    expect([r.hit.name, r.score, r.exact]).toEqual(['Ring', 2, true]);
  });
});

describe('a volume named after its own series', () => {
  // THE BUG THIS EXISTS FOR: Marvel Zombies, 2026-09-09. The series proposed
  // NOTHING and every candidate was rejected as "a collection". One of them is
  // titled exactly `Marvel Zombies`, so `marvelzombies` is a substring of
  // `marvelzombies2`, `marvelzombiesavengers`, `marvelzombiesbattleworld` — of
  // every sibling it has. Any series with a volume named after the series does
  // this: Dune, Hellboy, Jaws, Saga, Borne. `Ring` escaped only because four
  // characters is under the length floor.
  //
  // It also found the next one: with containment fixed, the AUTHOR filter took
  // over and killed the same series, because our catalog credits it to Robert
  // Kirkman and Hardcover credits its volumes to Arthur Suydam, Fred Van Lente,
  // Kev Walker and Marvel Comics — which is simply what a comics series is.
  const C = (position, title, authors, language, pages, hardcoverId) =>
    ({ position, title, authors, language, pages, coverUrl: 'x', description: 'd', hardcoverId });
  const MARVEL_ZOMBIES = [
    C(0, 'Marvel Zombies: The Covers', ['Arthur Suydam'], null, null, 1276926),
    C(1, 'Marvel Zombies: Avengers', ['Marvel Comics'], null, 136, 1633665),
    C(1, 'Marvel Zombies', ['Sean Phillips', 'Robert Kirkman'], 'pol', 136, 185940),
    C(2, 'Marvel Zombies 2', ['Robert Kirkman', 'Sean Philips'], 'eng', 120, 526519),
    C(2, 'Marvel Zombies: The Complete Collection Volume 2', ['Fred Van Lente'], 'eng', 464, 2005740),
    C(2, 'Marvel Zombies, Vol. 2', ['Sean Phillips', 'Robert Kirkman'], null, null, 782056),
    C(3, 'Marvel Zombies 3', ['Fred Van Lente'], 'eng', 112, 702942),
    C(4, 'Marvel Zombies 4', ['Kev Walker', 'Fred Van Lente'], null, null, 702939),
    C(5, 'Marvel Zombies 5', ['Fred Van Lente', 'Kano'], 'eng', null, 1075635),
    C(8, 'Marvel Zombies: Battleworld', ['Kevin Walker'], 'eng', null, 1175441),
  ];
  const { byPosition, rejected } = candidatesByPosition(MARVEL_ZOMBIES, {
    seriesAuthors: ['Robert Kirkman'], wantLanguage: 'eng', heldTitles: ['Marvel Zombies'],
  });

  it('does not eat the series it is named after', () => {
    expect([...byPosition.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 8]);
  });

  it('calls no sequel a collection', () => {
    expect(rejected.filter((r) => /quotes/.test(r.reason))).toHaveLength(0);
  });

  it('survives having a different creative team per volume', () => {
    // Only two of the ten name Kirkman. A filter applied across the series
    // would leave one position standing out of seven.
    expect(rejected.filter((r) => /the series author/.test(r.reason))).toHaveLength(0);
  });

  it('still throws out the Complete Collection and the Polish edition', () => {
    expect(rejected.find((r) => r.hardcoverId === 2005740).reason).toMatch(/bundle or collection/);
    expect(rejected.find((r) => r.hardcoverId === 185940).reason).toMatch(/no eng among them/);
  });

  it('picks the English volume where the language confirms it', () => {
    expect(byPosition.get(2).filter((c) => c.pick).map((c) => c.title)).toEqual(['Marvel Zombies 2']);
    expect(byPosition.get(3)[0].pick).toBe(true);
    expect(byPosition.get(5)[0].pick).toBe(true);
  });
});

describe('the author filter is a question about one position', () => {
  const C = (position, title, authors, hardcoverId) =>
    ({ position, title, authors, language: null, pages: 300, coverUrl: 'x', description: 'd', hardcoverId });

  it('drops a translation that shares a position with the real author', () => {
    const { byPosition } = candidatesByPosition([
      C(2, 'House of Sky and Breath', ['Elizabeth Evans', 'Sarah J. Maas'], 1),
      C(2, 'Gökyüzü ve Nefes Hanesi', ['Seyhan Dönmez'], 2),
    ], { seriesAuthors: ['Sarah J. Maas'] });
    expect(byPosition.get(2).map((c) => c.title)).toEqual(['House of Sky and Breath']);
  });

  it('keeps a volume by another hand when nothing at that position competes', () => {
    // A volume by a different author, with nothing to compare it to, is just a
    // volume by a different author.
    const { byPosition, rejected } = candidatesByPosition([
      C(1, 'Written By The Usual Hand', ['Robert Kirkman'], 1),
      C(8, 'Written By Somebody Else', ['Kevin Walker'], 2),
    ], { seriesAuthors: ['Robert Kirkman'] });
    expect(rejected).toHaveLength(0);
    expect(byPosition.get(8).map((c) => c.title)).toEqual(['Written By Somebody Else']);
  });
});

// -- MALAZAN BOOK OF THE FALLEN, 2026-09-09 -----------------------------------
//
// THE BUG THIS EXISTS FOR
//
// The propose run deleted eight of the ten English volumes with the reason
// `edition language spa, not eng`, and then proposed the Russian and Italian
// translations in their place, because with the English volume gone they were
// alone at their positions and a lone candidate is the easiest thing in this
// module to pick.
//
// The cause was not the filter. It was the shape of the input: language was
// read off `editions(limit: 3)` and reduced to ONE value, so a work with
// English, Spanish and Italian editions "was" whichever of them Hardcover
// listed first. Midnight Tides drew eng and was pre-approved; Gardens of the
// Moon drew spa and was deleted. Same work, same author, same shelf.
//
// The rows below are that run, with the edition sets the query should have
// returned. `languages` is a set now, and the question is membership.
describe('Malazan — a work is not in one language', () => {
  const M = (position, title, languages, extra = {}) => ({
    position, title, author: 'Steven Erikson', authors: ['Steven Erikson'],
    languages, pages: 900, coverUrl: 'x', description: '', ...extra,
  });

  it('keeps an English work that also has Spanish editions', () => {
    const { byPosition, rejected } = candidatesByPosition(
      [M(1, 'Gardens of the Moon', ['spa', 'eng', 'ita'])],
      { wantLanguage: 'eng' }
    );
    expect(rejected).toHaveLength(0);
    expect(byPosition.get(1)[0].pick).toBe(true);
  });

  it('still removes a work with no edition in the language we want', () => {
    const { byPosition, rejected } = candidatesByPosition(
      [M(4, 'Дом Цепей', ['rus']), M(4, 'House of Chains', ['spa', 'eng'])],
      { wantLanguage: 'eng' }
    );
    expect(rejected.map((r) => r.title)).toEqual(['Дом Цепей']);
    expect(byPosition.get(4).map((c) => c.title)).toEqual(['House of Chains']);
    expect(byPosition.get(4)[0].pick).toBe(true);
  });

  it('does not promote a translation left alone by a wrongly-deleted original', () => {
    // The whole failure in one assertion: position 9 proposed the Italian
    // "La polvere dei sogni" at confidence 100 because "Dust of Dreams" had
    // been removed as `ita`. Both survive now, and the English one is chosen.
    const { byPosition } = candidatesByPosition([
      M(9, 'Dust of Dreams', ['ita', 'eng']),
      M(9, 'La polvere dei sogni', ['ita']),
    ], { wantLanguage: 'eng' });
    expect(byPosition.get(9).map((c) => c.title)).toEqual(['Dust of Dreams']);
    expect(byPosition.get(9)[0].pick).toBe(true);
  });

  it('treats no reported editions as unknown, not as foreign', () => {
    const { byPosition, rejected } = candidatesByPosition(
      [M(10, 'The Crippled God', [])], { wantLanguage: 'eng' }
    );
    expect(rejected).toHaveLength(0);
    expect(byPosition.get(10)[0].pick).toBeFalsy();
    expect(byPosition.get(10)[0].pickReason).toMatch(/no language reported/);
  });

  it('accepts the old single-value shape as a set of one', () => {
    // languagesOf() reads `language` when `languages` is absent, so fixtures
    // and callers written before this change still mean what they said.
    const { rejected } = candidatesByPosition([
      { position: 1, title: 'Une traduction française', author: 'Steven Erikson',
        language: 'fre', pages: 500, coverUrl: 'x', description: '' },
    ], { wantLanguage: 'eng' });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/no eng among them/);
  });

  it('keeps two Cyrillic titles apart', () => {
    // normTitle stripped everything outside [a-z0-9], so both of these
    // normalised to '' and deduped to a single candidate at position 8.
    const { byPosition } = candidatesByPosition([
      M(8, 'Дань псам', ['rus']), M(8, 'Дом Цепей', ['rus']),
    ], { wantLanguage: null });
    expect(byPosition.get(8)).toHaveLength(2);
  });
});

// -- THE FIRST QUEUE RUN, 2026-09-10 -----------------------------------------
//
// THE BUG THESE EXIST FOR
//
// `--propose --stale --limit 5` produced 53 proposals and ZERO pre-approvals,
// one day after a 25-series run pre-approved 44 of 46. Discworld: Tiffany
// Aching gave it away: five proposals, every position resolved to one pick, and
// nothing approvable.
//
// The catalog stores creators as one slash-joined credit line. Compared whole,
// "Duncan Fegredo / Dave Stewart / Mike Mignola" is not "Mike Mignola", so
// every Hellboy volume upstream offers reads as credited to a stranger, and the
// disowned veto — two rows across 25 series a day earlier — vetoed everything.
describe('a credit line is not one author', () => {
  const C = (position, title, author, authors) => ({
    position, title, author, authors, pages: 300, coverUrl: 'x', description: '', languages: ['eng'],
  });

  it('matches one name inside a slash-joined credit line', () => {
    // Hellboy. The held books are credited to three people; Hardcover credits
    // the volume to one of them.
    const { byPosition, rejected } = candidatesByPosition(
      [C(2, 'Hellboy, Vol. 2: Wake the Devil', 'Mike Mignola'),
       C(2, 'Une traduction', 'Quelquun Dautre')],
      { seriesAuthors: ['Duncan Fegredo / Dave Stewart / Mike Mignola'] }
    );
    expect(rejected.map((r) => r.title)).toEqual(['Une traduction']);
    expect(byPosition.get(2).map((c) => c.title)).toEqual(['Hellboy, Vol. 2: Wake the Devil']);
  });

  it('splits the candidate side too', () => {
    const { byPosition, rejected } = candidatesByPosition(
      [C(1, 'Ours', undefined, ['Erik Wilson / Matt Dinniman']),
       C(1, 'Theirs', 'Nobody Here')],
      { seriesAuthors: ['Matt Dinniman'] }
    );
    expect(rejected.map((r) => r.title)).toEqual(['Theirs']);
    expect(byPosition.get(1).map((c) => c.title)).toEqual(['Ours']);
  });

  it('does not split a comma, which is a name written backwards', () => {
    // "Erikson, Steven" is one person. Splitting it invents two.
    expect(splitAuthors('Erikson, Steven')).toEqual(['Erikson, Steven']);
  });

  it('splits the separators a credit line actually uses', () => {
    expect(splitAuthors('A Smith / B Jones')).toEqual(['A Smith', 'B Jones']);
    expect(splitAuthors('A Smith & B Jones')).toEqual(['A Smith', 'B Jones']);
    expect(splitAuthors('A Smith; B Jones')).toEqual(['A Smith', 'B Jones']);
    expect(splitAuthors('A Smith and B Jones')).toEqual(['A Smith', 'B Jones']);
  });

  it('leaves a lone name alone', () => {
    expect(splitAuthors('Terry Pratchett')).toEqual(['Terry Pratchett']);
    expect(splitAuthors('')).toEqual([]);
    expect(splitAuthors(null)).toEqual([]);
  });
});

describe('a collection says so in the words its publisher uses', () => {
  it('catches the comics ones the pattern was missing', () => {
    // Hellboy #7, from the 2026-09-10 queue run. Two candidates at position 7,
    // both confirmed English, so neither could be picked — and one of them
    // collects the other.
    for (const t of [
      'Hellboy, Library Edition, Vol. 4: The Crooked Man and the Troll Witch',
      'The Sandman Deluxe Edition, Book One',
      'Saga Compendium One',
      'The Complete Far Side Treasury',
    ]) expect(COLLECTION_RE.test(t)).toBe(true);
  });

  it('leaves a volume that merely has a library in it alone', () => {
    for (const t of [
      'Hellboy, Vol. 7: The Troll Witch and Others',
      'The Library at Mount Char',
      'The Invisible Library',
    ]) expect(COLLECTION_RE.test(t)).toBe(false);
  });

  it('resolves Hellboy position 7 once the collection is out of the way', () => {
    const H = (title, pages) => ({
      position: 7, title, author: 'Mike Mignola', authors: ['Mike Mignola'],
      pages, coverUrl: 'x', description: '', languages: ['eng', 'fre'],
    });
    const { byPosition, rejected } = candidatesByPosition(
      [H('Hellboy, Library Edition, Vol. 4: The Crooked Man and the Troll Witch', 312),
       H('Hellboy, Vol. 7: The Troll Witch and Others', 144)],
      { wantLanguage: 'eng', seriesAuthors: ['Duncan Fegredo / Dave Stewart / Mike Mignola'] }
    );
    expect(rejected.map((r) => r.reason)).toEqual(['title reads as a bundle or collection']);
    const list = byPosition.get(7);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Hellboy, Vol. 7: The Troll Witch and Others');
    expect(list[0].pick).toBe(true);
  });
});

// -- A SERIES OF UNFORTUNATE EVENTS, 2026-09-10 -------------------------------
//
// THE BUG THIS EXISTS FOR
//
// The second queue batch pre-approved, at confidence 100, a book one titled
// "A Series of Unfortunate Events" — reason "quoted in 8 collection edition(s)
// of this series". The Bad Beginning sat under it as an unapproved alternative.
//
// Every box set of that series is called "A Series of Unfortunate Events
// <something>", so a candidate whose title IS the series name is a substring of
// all of them by construction. The quotation signal asks which volume the
// collections collect, and a series-named title answers it accidentally, every
// time, in any series with box sets.
//
// The mirror of the Marvel Zombies containment bug: there a series-named volume
// was rejected for containing its siblings; here one wins for being contained
// by its collections.
describe('a volume named after its series cannot win the quotation signal', () => {
  const A = (title, languages = ['eng']) => ({
    position: 1, title, author: 'Lemony Snicket', authors: ['Lemony Snicket'],
    pages: 176, coverUrl: 'x', description: '', languages,
  });

  it('picks the real book one, not the one named after the series', () => {
    const { byPosition } = candidatesByPosition([
      A('A Series of Unfortunate Events'),
      A('The Bad Beginning'),
      A('A Series of Unfortunate Events Set books #1-9'),
      A('A Series of Unfortunate Events Pack'),
      A('Un Mal Principio', ['spa']),
    ], { wantLanguage: 'eng', seriesName: 'A Series of Unfortunate Events' });

    const list = byPosition.get(1);
    const picked = list.find((c) => c.pick);
    expect(picked && picked.title).toBe('The Bad Beginning');
  });

  it('still lets a series-named volume be picked when the language settles it', () => {
    // Marvel Zombies: one volume genuinely IS titled after the series, and when
    // it is the only English candidate it wins on language, not on quotation.
    const { byPosition } = candidatesByPosition([
      { position: 1, title: 'Marvel Zombies', author: 'Robert Kirkman', authors: ['Robert Kirkman'],
        pages: 200, coverUrl: 'x', description: '', languages: ['eng'] },
      { position: 1, title: 'Marvel Zombies (Italiano)', author: 'Robert Kirkman', authors: ['Robert Kirkman'],
        pages: 200, coverUrl: 'x', description: '', languages: ['ita'] },
    ], { wantLanguage: 'eng', seriesName: 'Marvel Zombies' });
    const list = byPosition.get(1);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Marvel Zombies');
    expect(list[0].pick).toBe(true);
  });

  it('catches the box-set shapes that got through', () => {
    expect(COLLECTION_RE.test('A Series of Unfortunate Events Set books #1-9')).toBe(true);
    expect(COLLECTION_RE.test('Hellboy Books 1-3')).toBe(true);
    expect(COLLECTION_RE.test('The Reptile Room')).toBe(false);
  });
});

// -- THE DRESDEN FILES, 2026-09-10 --------------------------------------------
//
// THE BUG THIS EXISTS FOR
//
// The queue reported FOURTEEN position mismatches on a seventeen-book series
// whose catalog is very nearly right. Thirteen were the same book on both
// sides, separated only by a Goodreads suffix:
//
//   #2  ours "Fool Moon (The Dresden Files, #2)"    theirs "Fool Moon"
//   #3  ours "Grave Peril (The Dresden Files, #3)"  theirs "Grave Peril"
//
// The fourteenth was real, and it is the one that matters: position 1 holds
// "Welcome to the Jungle", the graphic novel, while Storm Front — book one of
// the whole series — is missing from the catalog entirely. A mismatch signal
// that cries wolf thirteen times buries the single thing it was built to find.
describe('a Goodreads suffix is not a disagreement', () => {
  it('strips a trailing series-and-position parenthetical', () => {
    expect(cleanTitle('Fool Moon (The Dresden Files, #2)')).toBe('Fool Moon');
    expect(cleanTitle('The Crystal Shard (Forgotten Realms: The Icewind Dale, #1; Legend of Drizzt, #4)'))
      .toBe('The Crystal Shard');
  });

  it('leaves a parenthetical that is part of the title', () => {
    expect(cleanTitle('Overlord (Light Novel)')).toBe('Overlord (Light Novel)');
    expect(cleanTitle('Marvel Zombies (Collected Editions)')).toBe('Marvel Zombies (Collected Editions)');
  });

  it('is a no-op on an ordinary title', () => {
    expect(cleanTitle('Storm Front')).toBe('Storm Front');
    expect(cleanTitle('')).toBe('');
    expect(cleanTitle(null)).toBe('');
  });
});
