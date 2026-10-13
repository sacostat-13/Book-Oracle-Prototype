// profile-stats.test.js — the Profile Overview numbers (src/views/profile/profileStats.js),
// pulled out of the page in Sprint 4 so they can be pinned without rendering it.

import { describe, it, expect } from 'vitest';
import { computeProfileStats } from '../src/views/profile/profileStats.js';

const NOW = new Date(2026, 9, 13); // 13 Oct 2026, local time
const b = (over) => ({ t: 'Book', a: 'Author', pp: 0, ...over });

describe('computeProfileStats', () => {
  it('an empty shelf gives zeros and nulls, not NaN', () => {
    const s = computeProfileStats({ library: [], wishlist: [], readNext: [], genresByBookId: {} }, NOW);
    expect(s).toMatchObject({ totalBooks: 0, totalPages: 0, booksThisYear: 0, pace: null, avgRating: null, topGenres: [], seriesCompleted: 0 });
    expect(s.topAuthor).toBeUndefined();
  });

  it('counts this year, pace over the last 12 months, and rated books only for the average', () => {
    const library = [
      b({ t: 'A', pp: 300, dateRead: '2026-03-01', rating: 5 }),
      b({ t: 'B', pp: 200, dateRead: '2025-12-01', rating: 3 }),
      b({ t: 'C', pp: 100, dateRead: '2024-01-01' }),
      b({ t: 'D', pp: 0 }),
    ];
    const s = computeProfileStats({ library, wishlist: [], readNext: [] }, NOW);
    expect(s.totalBooks).toBe(4);
    expect(s.totalPages).toBe(600);
    expect(s.booksThisYear).toBe(1);
    expect(s.pagesThisYear).toBe(300);
    expect(s.pace).toBe('0.2');           // 2 books in the last 12 months / 12
    expect(s.avgRating).toBe('4.0');
    expect(s.datedBooks).toHaveLength(3);
  });

  it('top genres by count (max 8), top author by books read', () => {
    const library = [
      b({ bookId: '1', a: 'Daphne du Maurier' }), b({ bookId: '2', a: 'Daphne du Maurier' }), b({ bookId: '3', a: 'Bram Stoker' }),
    ];
    const genresByBookId = {
      1: [{ name: 'Gothic' }, { name: 'Romance' }],
      2: [{ name: 'Gothic' }],
      3: [{ name: 'Horror' }],
    };
    const s = computeProfileStats({ library, wishlist: [], readNext: [], genresByBookId }, NOW);
    expect(s.topGenres[0]).toEqual({ name: 'Gothic', count: 2 });
    expect(s.topGenres).toHaveLength(3);
    expect(s.topAuthor).toEqual(['Daphne du Maurier', 2]);
  });

  it('series: in progress needs a known total and at least one read; complete when all are read', () => {
    const lotr = (n, t) => b({ t, s: { name: 'The Lord of the Rings', n, total: 3 } });
    const duo = (n, t) => b({ t, s: { name: 'Duology', n, total: 2 } });
    const s = computeProfileStats({
      library: [lotr(1, 'Fellowship'), duo(1, 'One'), duo(2, 'Two'), b({ t: 'X', s: { name: 'No total' } })],
      wishlist: [lotr(2, 'Towers')],
      readNext: [],
    }, NOW);
    expect(s.seriesInProgress.map((x) => [x.name, x.read, x.total])).toEqual([['The Lord of the Rings', 1, 3]]);
    expect(s.seriesCompleted).toBe(1);
  });
});
