// series-collections.test.js — the omnibuses that reached a position.
//
// THE BUG THESE EXIST FOR
//
// The Legend of Drizzt, 2026-09-12: position 4 pre-approved "The Icewind Dale
// Trilogy" (1,040 pages, the omnibus of books 4-6) while "The Crystal Shard",
// the real volume 4, sat underneath as an unapproved alternative. Neither guard
// fired — "trilogy" was in no pattern, and the page-count test compares against
// the median of the position's own candidates, seven of whose eight entries
// were omnibuses.
//
// The keep cases are the point. A real volume mentioning a trilogy always also
// names itself, and rejecting those would cost far more than the rule saves.

import { describe, it, expect } from 'vitest';
import { readsAsCollectedSet, COLLECTION_RE, namesADifferentFormat, normSeries } from '../batch-scripts/_shared/seriesCandidates.mjs';

describe('readsAsCollectedSet', () => {
  it('rejects a title that ends in a collective noun and claims no volume', () => {
    for (const t of [
      'The Icewind Dale Trilogy',
      'Vampire Blood Trilogy',
      'Vampire Rites Trilogy',
      'Vampire War Trilogy',
      'Vampire Destiny Trilogy',
    ]) expect(readsAsCollectedSet(t), t).toBe(true);
  });

  it('keeps a real volume that names a trilogy AND numbers itself', () => {
    for (const t of [
      'The Rogue: The Traitor Spy Trilogy, Book 2',
      'The Traitor Queen: The Traitor Spy Trilogy, Book 3',
      'Servant of the Shard: Dungeons & Dragons: Book 1 of The Sellswords Trilogy',
      'Promise of the Witch-King: Dungeons & Dragons: Book 2 of The Sellswords Trilogy',
      "Bartimeaus Trilogy: The Golem's Eye - Book #2",
      'Homeland (Forgotten Realms: The Dark Elf Trilogy, #1; Legend of Drizzt, #1)',
    ]) expect(readsAsCollectedSet(t), t).toBe(false);
  });

  it('keeps a volume whose subtitle merely mentions a trilogy', () => {
    expect(readsAsCollectedSet(
      'Ancillary Mercy: The conclusion to the trilogy that began with ANCILLARY JUSTICE'
    )).toBe(false);
  });

  it('leaves ordinary titles alone', () => {
    for (const t of ['The Crystal Shard', 'Streams of Silver', "The Halfling's Gem", '']) {
      expect(readsAsCollectedSet(t), t).toBe(false);
    }
  });
});

describe("COLLECTION_RE — collector's and anniversary editions", () => {
  it('catches the Drizzt editions that slipped through on 2026-09-12', () => {
    for (const t of [
      'Icewind Dale Trilogy: Collector’s Edition',
      "The Icewind Dale Collector's Edition",
      'Legend of Drizzt 25th Anniversary Edition',
      'Paths of Darkness Collector’s Edition',
    ]) expect(COLLECTION_RE.test(t), t).toBe(true);
  });

  it('still catches what it already caught', () => {
    for (const t of [
      'Crescent City ebook Bundle: A 3 Book Bundle',
      'The Reckoners Series Boxed Set',
      'Books of Blood Omnibus 1: Volumes 1-3',
      'Y: The Last Man Compendium 1',
    ]) expect(COLLECTION_RE.test(t), t).toBe(true);
  });

  it('does not fire on a plain volume', () => {
    for (const t of ['The Crystal Shard', 'House of Earth and Blood', 'One Piece, Vol. 9: Tears']) {
      expect(COLLECTION_RE.test(t), t).toBe(false);
    }
  });
});

describe('omnibus welded to the front of a word — 2026-09-17, Venom', () => {
  it('catches Venomnibus, which \\bomnibus never could', () => {
    expect(COLLECTION_RE.test('Venomnibus, Vol. 1')).toBe(true);
    expect(COLLECTION_RE.test('Venomnibus')).toBe(true);
  });

  it('still catches an ordinary omnibus', () => {
    expect(COLLECTION_RE.test('Books of Blood Omnibus 1: Volumes 1-3')).toBe(true);
  });

  it('does not start matching ordinary titles', () => {
    for (const t of ['The Crystal Shard', 'Venom: Lethal Protector', 'Recollections of a Bus Ride',
                     'House of Earth and Blood', 'One Piece, Vol. 9: Tears']) {
      expect(COLLECTION_RE.test(t), t).toBe(false);
    }
  });
});

describe('a longer series name that names a different format — 2026-09-16, Parasol', () => {
  const diff = (want, got) => namesADifferentFormat(normSeries(want), normSeries(got));

  it('refuses the format and edition-run qualifiers seen in six runs', () => {
    const cases = [
      ['The Parasol Protectorate', 'The Parasol Protectorate Manga'],
      ['Marvel Zombies', 'Marvel Zombies (Collected Editions)'],
      ["Assassin's Creed: The Fall", "Assassin's Creed - The Fall [Single Issues]"],
      ['Mighty Avengers', 'Mighty Avengers (2007) (Single Issues)'],
      ['The Wicked + The Divine', 'The Wicked + The Divine (Issues)'],
      ['Dark Nights: Metal', 'Dark Nights: Metal (Reading Order)'],
      ['Venom: Lethal Protector', 'Venom: Lethal Protector (1993)'],
      ['The Spectacular Spider-Man', 'The Spectacular Spider-Man (1976)'],
    ];
    for (const [want, got] of cases) expect(diff(want, got), `${want} vs ${got}`).toBe(true);
  });

  it('KEEPS the containment matches that are the same series under another name', () => {
    const cases = [
      ['The Last Apprentice', 'The Last Apprentice / Wardstone Chronicles'],
      ['The Wardstone Chronicles', 'The Last Apprentice / Wardstone Chronicles'],
      ['The Hollow Kingdom', 'The Hollow Kingdom Trilogy'],   // a collective noun renames; it does not replace
      ['The Giver', 'The Giver Quartet'],
      ['Knitting Mystery', 'A Knitting Mystery'],
      ['Thor', 'Thor: Tales of Asgard by Stan Lee & Jack Kirby'],
      ['Spires', 'The Cinder Spires'],
      ['Stardust Crusaders', "JoJo's Bizarre Adventure: Stardust Crusaders"],
    ];
    for (const [want, got] of cases) expect(diff(want, got), `${want} vs ${got}`).toBe(false);
  });

  it('never fires on an exact match, or when the hit is the shorter name', () => {
    expect(diff('Ninth House Trilogy', 'Ninth House')).toBe(false);
    expect(diff('Southern Reach Trilogy', 'Southern Reach')).toBe(false);
    expect(diff('Miss Marple', 'Miss Marple')).toBe(false);
    expect(namesADifferentFormat('', '')).toBe(false);
  });
});
