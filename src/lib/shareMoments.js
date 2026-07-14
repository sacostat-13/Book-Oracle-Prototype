// src/lib/shareMoments.js — v0.43
//
// Pure logic for "share moments": the celebratory share-card modal that
// appears after a completion event. Given the post-completion state, this
// computes every moment the completion produced and returns them sorted by
// significance — the caller (DataContext.markAsRead) shows only the first.
//
// Deliberately pure + client-only: no tables, no persistence. Milestones are
// recomputed from the library at the instant of completion, and only fire
// when the completion *crosses* the threshold (count === milestone), so a
// moment can never re-fire on reload. This is the "cheap accomplishments"
// model — a proper achievements system (persistent, retroactive, profile
// trophy shelf) is a post-1.0 feature.

import { bookKey } from './bookHelpers';

// Milestone ladders. Exact-crossing checks mean each fires at most once.
export const YEAR_MILESTONES = [5, 10, 25, 50, 75, 100, 150, 200];
export const GENRE_MILESTONES = [5, 10, 25, 50];

// Don't announce "first book in a new genre" until the library is big enough
// for it to mean something — otherwise every early read triggers it.
// Exported so the persistent-accomplishments backfill (accomplishments.js)
// replays the exact same rule as the live moment computation.
export const NEW_GENRE_MIN_LIBRARY = 5;

function readYear(b) {
  return (b.dateRead || '').slice(0, 4);
}

// genreNamesFor: canonical genre names for a book, via genresByBookId
// (bookId-keyed) with a fallback to the book's own single `g` field for
// guest/unenriched books. Exported for accomplishments.js (same reason as
// NEW_GENRE_MIN_LIBRARY above).
export function genreNamesFor(book, genresByBookId) {
  const rows = book.bookId ? genresByBookId?.[book.bookId] : null;
  if (rows && rows.length) return rows.map((r) => r.name);
  return book.g ? [book.g] : [];
}

// computeCompletionMoments({ book, library, genresByBookId, goal, plans })
//   book     — the just-completed book (client shape, already enriched)
//   library  — the library INCLUDING the just-completed book
//   plans    — state.plans (client shape: content spread + title)
//   goal     — profile.goal (books per year) or null
//
// Returns an array of moment objects sorted most → least significant.
// Always ends with the plain { type: 'book_completed' } fallback.
export function computeCompletionMoments({ book, library, genresByBookId, goal, plans }) {
  const moments = [];
  const year = new Date().getFullYear().toString();
  const thisYear = library.filter((b) => readYear(b) === year);
  const readKeys = new Set(library.map((b) => bookKey(b)));

  // ── Reading goal completed (exact crossing) ────────────────────────────
  if (goal && thisYear.length === goal) {
    moments.push({ type: 'goal_completed', goal, year, book });
  }

  // ── Series completed ───────────────────────────────────────────────────
  // Requires a known series total; counts distinct read books in the series.
  if (book.s?.name && book.s?.total) {
    const inSeries = library.filter((b) => b.s?.name === book.s.name).length;
    if (inSeries >= book.s.total) {
      moments.push({ type: 'series_completed', seriesName: book.s.name, total: book.s.total, book });
    }
  }

  // ── Reading plan completed ─────────────────────────────────────────────
  // A plan is complete when every book it contains is in the library, and
  // the just-completed book is one of them (so finishing an unrelated book
  // doesn't claim credit for a plan finished weeks ago).
  const k = bookKey(book);
  for (const plan of plans || []) {
    const planBooks = plan.books || [];
    if (!planBooks.length) continue;
    const planKeys = planBooks.map((b) => bookKey({ t: b.title || b.t, a: b.author || b.a }));
    if (!planKeys.includes(k)) continue;
    if (planKeys.every((pk) => readKeys.has(pk))) {
      moments.push({
        type: 'plan_completed',
        planTitle: plan.title || 'A reading plan',
        planId: plan._id || null,
        count: planBooks.length,
        book,
      });
      break; // one plan card is plenty for a single completion
    }
  }

  // ── Nth book of the year ───────────────────────────────────────────────
  if (YEAR_MILESTONES.includes(thisYear.length)) {
    moments.push({ type: 'nth_book', n: thisYear.length, year, book });
  }

  // ── Genre milestones: X books in one genre / first book in a new genre ─
  // Counted against canonical Oracle genres of the completed book only.
  const bookGenres = genreNamesFor(book, genresByBookId);
  for (const genre of bookGenres) {
    const count = library.filter((b) =>
      genreNamesFor(b, genresByBookId).includes(genre)
    ).length;
    if (GENRE_MILESTONES.includes(count)) {
      moments.push({ type: 'genre_count', genre, n: count, book });
    } else if (count === 1 && library.length >= NEW_GENRE_MIN_LIBRARY) {
      moments.push({ type: 'new_genre', genre, book });
    }
  }

  // ── Fallback: the book itself ──────────────────────────────────────────
  moments.push({ type: 'book_completed', book });

  const PRIORITY = [
    'goal_completed',
    'series_completed',
    'plan_completed',
    'nth_book',
    'genre_count',
    'new_genre',
    'book_completed',
  ];
  moments.sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  return moments;
}
