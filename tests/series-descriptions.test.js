// series-descriptions.test.js — the composer may not describe our shelf as if
// it were the series.
//
// THE BUGS THESE EXIST FOR
//
// Both found in the first draft's own output, 2026-09-09, before it wrote a
// single row — and both the same mistake in opposite directions: taking `held`
// (what the catalog can list) for `total_books` (what the series has).
//
//   Hellboy, holding 3 with no total_books
//     → "Hellboy is a 3-book series by Mike Mignola."
//        Hellboy has dozens. Not a thin description — a false one, published
//        as a fact on the page.
//
//   Discworld: Tiffany Aching, holding 2 of 5
//     → "It begins with The Wee Free Men and ends with A Hat Full of Sky."
//        A Hat Full of Sky is the SECOND of five. A page that ranks for
//        "tiffany aching reading order" telling a reader the wrong place to
//        stop is worse than one that says nothing.
//
// Overclaiming is the failure this whole 2026-09-08/09 series push has been
// about: the Crescent City page announcing "All 2 books" for a trilogy. A
// description generator repeats it across 175 pages at once, so every claim it
// can make is pinned here.

import { describe, it, expect } from 'vitest';
import { composeSeriesDescription } from '../batch-scripts/manual/seriesDescriptions.mjs';

// Volumes in position order, as series_volumes returns them.
const V = (...titles) => titles.map((title, i) => ({ title, position_in_series: i + 1 }));

const compose = (over = {}) => composeSeriesDescription({
  name: 'A Series', author: 'An Author', totalBooks: null,
  publicationStatus: null, volumes: V('One', 'Two'), ...over,
});

describe('the length it claims', () => {
  it('states total_books when the series row knows it', () => {
    expect(compose({ totalBooks: 10, volumes: V(...Array(10).fill('x')) }))
      .toMatch(/is a 10-book series/);
  });

  it('claims NO length when nothing knows it', () => {
    // Hellboy. held is not a total and may never stand in for one.
    const d = compose({ name: 'Hellboy', totalBooks: null, volumes: V('a', 'b', 'c') });
    expect(d).toMatch(/Hellboy is a series by/);
    expect(d).not.toMatch(/\d-book series/);
  });

  it('keeps held and total apart when the shelf is short', () => {
    const d = compose({ totalBooks: 5, volumes: V('One', 'Two') });
    expect(d).toMatch(/is a 5-book series/);        // what it has
    expect(d).toMatch(/lists 2 of 5/);              // what we can show
    expect(d).not.toMatch(/all 2/);
  });

  it('says "all" only when the shelf is complete', () => {
    expect(compose({ totalBooks: 2, volumes: V('One', 'Two') })).toMatch(/lists all 2 volumes/);
  });
});

describe('the ends it claims', () => {
  it('names the last volume only when we hold the whole series', () => {
    expect(compose({ totalBooks: 3, volumes: V('One', 'Two', 'Three') }))
      .toMatch(/begins with One and ends with Three/);
  });

  it('does NOT name an end when the shelf is short', () => {
    // Tiffany Aching: A Hat Full of Sky is not where the series ends.
    const d = compose({ totalBooks: 5, volumes: V('The Wee Free Men', 'A Hat Full of Sky') });
    expect(d).toMatch(/begins with The Wee Free Men\./);
    expect(d).not.toMatch(/ends with/);
  });

  it('does NOT name an end when no total is known', () => {
    // Unknown length means unknown end, however many we hold.
    expect(compose({ totalBooks: null, volumes: V('a', 'b', 'c') })).not.toMatch(/ends with/);
  });

  it('reads the first volume by POSITION, not by array order', () => {
    const d = compose({
      totalBooks: 2,
      volumes: [
        { title: 'Second', position_in_series: 2 },
        { title: 'First', position_in_series: 1 },
      ],
    });
    expect(d).toMatch(/begins with First and ends with Second/);
  });
});

describe('publication status', () => {
  it('uses the two values the app is known to write', () => {
    expect(compose({ publicationStatus: 'completed', totalBooks: 3 })).toMatch(/a completed 3-book/);
    expect(compose({ publicationStatus: 'ongoing', totalBooks: 3 })).toMatch(/an? ongoing 3-book/);
  });

  it('says nothing for a value it does not recognise', () => {
    // rowToSeriesBook defaults this to 'unknown'; "an unknown 6-book series"
    // would be worse than silence, and asserting "completed" off an
    // unrecognised value would be a checkably wrong claim.
    for (const s of ['unknown', '', null, 'hiatus', 'CANCELLED']) {
      expect(compose({ publicationStatus: s, totalBooks: 6 })).toMatch(/is a 6-book series/);
    }
  });
});

describe('what it does without', () => {
  it('drops the author clause rather than inventing one', () => {
    const d = compose({ author: null });
    expect(d).not.toMatch(/ by /);
    expect(d).toMatch(/^A Series is a series\./);
  });

  it('says nothing about the list when we hold one volume', () => {
    // "The Books Oracle lists 1 volume so far" appeared on hundreds of rows in
    // the 701-row dry run. It advertises a gap and it sounds unsure on the one
    // line a reader is most likely to see. What the series IS still gets said.
    const d = compose({ name: 'The Godfather', totalBooks: 3, volumes: V('The Godfather') });
    expect(d).toBe('The Godfather is a 3-book series by An Author. It begins with The Godfather.');
    expect(d).not.toMatch(/volume so far|lists|all 1|ends with/);
  });

  it('returns null without a name rather than a headless sentence', () => {
    expect(composeSeriesDescription({ name: '', volumes: [] })).toBeNull();
  });

  it('survives volumes with no positions, and claims no start', () => {
    const d = composeSeriesDescription({
      name: 'Unnumbered', author: 'X', totalBooks: null, publicationStatus: null,
      volumes: [{ title: 'One', position_in_series: null }, { title: 'Two', position_in_series: null }],
    });
    expect(d).toMatch(/lists 2 volumes/);
    expect(d).not.toMatch(/begins with|ends with/);
  });
});

describe('the meta description it becomes', () => {
  it('answers the count question inside the first 160 characters', () => {
    // og-prerender does description.slice(0, 200); search engines show rather
    // less. The count is the query these pages rank for, so it goes first.
    const d = compose({
      name: 'Malazan Book of the Fallen', author: 'Steven Erikson',
      publicationStatus: 'completed', totalBooks: 10,
      volumes: V('Gardens of the Moon', ...Array(8).fill('x'), 'The Crippled God'),
    });
    expect(d.slice(0, 160)).toMatch(/10-book series/);
    expect(d.slice(0, 160)).toMatch(/Gardens of the Moon/);
  });
});


// -- THE 701-ROW DRY RUN, 2026-09-09 ------------------------------------------
//
// The first full pass wrote nothing — it was a --dry-run — and reading its
// output found four more claims the composer had no right to make. Each one
// below is a line it actually printed.

describe('the start it claims', () => {
  it('names a first volume only when the shelf starts at position 1', () => {
    // Printed: "Tiffany Aching is a 5-book series. It begins with A Hat Full of
    // Sky." That is book TWO. `first` is the lowest position we HOLD, which is
    // the start of the series only when it is 1 — and these pages rank for
    // reading order, so sending a reader to book two is the worst available
    // answer.
    const d = composeSeriesDescription({
      name: 'Tiffany Aching', author: 'Terry Pratchett', totalBooks: 5, publicationStatus: null,
      volumes: [{ title: 'A Hat Full of Sky', position_in_series: 2 }],
    });
    expect(d).toBe('Tiffany Aching is a 5-book series by Terry Pratchett.');
    expect(d).not.toMatch(/begins with/);
  });

  it('still names it when the shelf does start at 1, however short', () => {
    expect(compose({ totalBooks: 9, volumes: V('One', 'Two') })).toMatch(/begins with One\./);
  });
});

describe('a total we already exceed is not a total', () => {
  it('drops the claim rather than contradicting it', () => {
    // Printed: "Villains is a 2-book series ... lists all 3 volumes." Holding
    // more than the claim is proof the claim is wrong.
    const d = compose({ name: 'Villains', totalBooks: 2, volumes: V('Vicious', 'Vengeful', 'Victorious') });
    expect(d).toMatch(/Villains is a series by/);
    expect(d).toMatch(/lists 3 volumes/);
    expect(d).not.toMatch(/2-book|all 3/);
  });

  it('drops a 1-book claim, which is not a series length', () => {
    // Printed: "Good Daughter is a 1-book series by Karin Slaughter."
    expect(compose({ totalBooks: 1, volumes: V('Only') })).not.toMatch(/1-book/);
  });
});

describe('the sentence has to read', () => {
  it('gets the article right before 8, 11 and 18', () => {
    // Printed: "The Witcher is a 8-book series."
    expect(compose({ totalBooks: 8, volumes: V('a', 'b') })).toMatch(/is an 8-book/);
    expect(compose({ totalBooks: 11, volumes: V('a', 'b') })).toMatch(/is an 11-book/);
    expect(compose({ totalBooks: 18, volumes: V('a', 'b') })).toMatch(/is an 18-book/);
    expect(compose({ totalBooks: 7, volumes: V('a', 'b') })).toMatch(/is a 7-book/);
    expect(compose({ totalBooks: 14, volumes: V('a', 'b') })).toMatch(/is a 14-book/);
  });

  it('strips the series-and-position parenthetical from a title', () => {
    // Printed: "It begins with Harry Potter and the Sorcerer's Stone (Harry
    // Potter, #1)" — inside a sentence about the Harry Potter series.
    const d = compose({
      totalBooks: 2,
      volumes: [
        { title: "Harry Potter and the Sorcerer's Stone (Harry Potter, #1)", position_in_series: 1 },
        { title: 'The Crystal Shard (Forgotten Realms: The Icewind Dale, #1; Legend of Drizzt, #4)', position_in_series: 2 },
      ],
    });
    expect(d).toMatch(/begins with Harry Potter and the Sorcerer's Stone and ends with The Crystal Shard\./);
  });

  it('leaves a parenthetical that is part of the title alone', () => {
    const d = compose({ totalBooks: 2, volumes: V('Overlord (Light Novel)', 'Two') });
    expect(d).toMatch(/begins with Overlord \(Light Novel\)/);
  });
});

describe('who it credits', () => {
  it('falls back to the author on most of the volumes', () => {
    // series.author is empty for a great many rows — Malazan among them — and
    // the volumes know who wrote them.
    const d = composeSeriesDescription({
      name: 'Malazan Book of the Fallen', author: null, totalBooks: 10, publicationStatus: null,
      volumes: [
        { title: 'Gardens of the Moon', author: 'Steven Erikson', position_in_series: 1 },
        { title: 'Deadhouse Gates', author: 'Steven Erikson', position_in_series: 2 },
      ],
    });
    expect(d).toMatch(/by Steven Erikson/);
  });

  it('credits nobody when no author is typical of the series', () => {
    // Marvel Zombies, Hellboy: a different creative team per volume. Picking
    // one would be a claim, not a fallback.
    const d = composeSeriesDescription({
      name: 'Marvel Zombies', author: null, totalBooks: null, publicationStatus: null,
      volumes: [
        { title: 'One', author: 'Robert Kirkman', position_in_series: 1 },
        { title: 'Two', author: 'Fred Van Lente', position_in_series: 2 },
        { title: 'Three', author: 'Kev Walker', position_in_series: 3 },
      ],
    });
    expect(d).not.toMatch(/ by /);
  });

  it('prefers the series row over the volumes', () => {
    const d = composeSeriesDescription({
      name: 'X', author: 'The Curated One', totalBooks: null, publicationStatus: null,
      volumes: [{ title: 'One', author: 'Someone Else', position_in_series: 1 }],
    });
    expect(d).toMatch(/by The Curated One/);
  });
});
