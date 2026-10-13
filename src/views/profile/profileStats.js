// src/views/profile/profileStats.js — the numbers on the Profile Overview tab.
//
// Pure: shelves in, figures out. Pulled out of Profile.jsx (Sprint 4) so it can
// be tested without rendering the page; `now` is a parameter for the same reason.

import { bookKey } from '../../lib/book/bookHelpers';

/**
 * @param {{ library: object[], wishlist: object[], readNext: object[], genresByBookId?: object }} shelves
 * @param {Date} [now]
 * @returns {{
 *   totalBooks: number, totalPages: number, booksThisYear: number, pagesThisYear: number,
 *   pace: string|null,            // books per month over the last 12 months, 1 decimal
 *   topGenres: Array<{ name: string, count: number }>,   // up to 8, most read first
 *   seriesInProgress: Array<{ name: string, total: number, read: number, known: number }>, // up to 5
 *   seriesCompleted: number,
 *   avgRating: string|null,       // 1 decimal, rated books only
 *   topAuthor: [string, number]|undefined,
 *   datedBooks: object[],
 * }}
 */
export function computeProfileStats({ library, wishlist, readNext, genresByBookId }, now = new Date()) {
  const lib = library;
  const genres = genresByBookId || {};
  const thisYear = now.getFullYear();

  // Total books & pages
  const totalBooks = lib.length;
  const totalPages = lib.reduce((s, b) => s + (b.pp || 0), 0);

  // This year
  const booksThisYear = lib.filter((b) => {
    if (!b.dateRead) return false;
    return new Date(b.dateRead).getFullYear() === thisYear;
  });
  const pagesThisYear = booksThisYear.reduce((s, b) => s + (b.pp || 0), 0);

  // Books with dates (for pace)
  const datedBooks = lib.filter((b) => b.dateRead);

  // Reading pace — books per month over last 12 months
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const recentDated = datedBooks.filter((b) => new Date(b.dateRead) >= twelveMonthsAgo);
  const pace = recentDated.length > 0
    ? (recentDated.length / 12).toFixed(1)
    : null;

  // Genre breakdown
  const genreCount = {};
  for (const b of lib) {
    const gs = genres[b.bookId] || [];
    for (const g of gs) {
      genreCount[g.name] = (genreCount[g.name] || 0) + 1;
    }
  }
  const topGenres = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Series completion
  const seriesMap = {};
  const allBooks = [...lib, ...wishlist, ...readNext];
  for (const b of allBooks) {
    if (!b.s?.name) continue;
    const n = b.s.name;
    if (!seriesMap[n]) seriesMap[n] = { name: n, total: b.s.total || null, read: 0, known: 0 };
    seriesMap[n].known++;
    if (lib.some((l) => bookKey(l) === bookKey(b))) seriesMap[n].read++;
  }
  const seriesInProgress = Object.values(seriesMap)
    .filter((s) => s.read > 0 && s.total && s.read < s.total)
    .sort((a, b) => b.read - a.read)
    .slice(0, 5);
  const seriesCompleted = Object.values(seriesMap)
    .filter((s) => s.total && s.read >= s.total)
    .length;

  // Average rating
  const rated = lib.filter((b) => b.rating > 0);
  const avgRating = rated.length > 0
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
    : null;

  // Favourite author (most books read)
  const authorCount = {};
  for (const b of lib) {
    if (b.a) authorCount[b.a] = (authorCount[b.a] || 0) + 1;
  }
  const topAuthor = Object.entries(authorCount).sort((a, b) => b[1] - a[1])[0];

  return {
    totalBooks, totalPages, booksThisYear: booksThisYear.length,
    pagesThisYear, pace, topGenres, seriesInProgress, seriesCompleted,
    avgRating, topAuthor, datedBooks,
  };
}
