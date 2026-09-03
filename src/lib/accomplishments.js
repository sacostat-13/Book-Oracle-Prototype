// src/lib/accomplishments.js — v0.45
//
// Pure logic for Reading Accomplishments: the persistent, retroactive ledger
// (docs/reading-accomplishments-v1-spec.md). This is the durable counterpart
// to shareMoments.js — same milestone ladders, but earned once and kept.
//
// Two responsibilities, both pure (no React, no Supabase):
//   1. keyForMoment / momentToMeta / rowToMoment — translate between a live
//      share-moment object and a persisted accomplishment row, so the live
//      earn path and the backfill converge on identical stable keys.
//   2. computeBackfillAccomplishments — replay every ladder over an existing
//      library to recover the accomplishments a reader already earned, dated
//      to the read that crossed each threshold.
//
// The stable `key` is what makes both paths idempotent against the DB's
// unique(user_id, key) — a milestone can never double-award.

import { bookKey } from './bookHelpers';
import {
  YEAR_MILESTONES,
  NEW_GENRE_MIN_LIBRARY,
  FEMALE_AUTHOR_MILESTONES,
  countsAsFemaleAuthored,
  FAMILY_MILESTONES,
  FAMILY_BREADTH_MILESTONES,
  familyForBook,
  familyGenreNamesFor,
} from './shareMoments';

// Only these moment types become persistent accomplishments. The plain
// `book_completed` fallback is a share card, not a milestone — it never earns.
// v0.67: 'genre_count' and 'new_genre' are NOT here. They are retired, not
// deleted — rows already earned under them stay in the table and on the shelf
// forever (v1 spec, rule 3: "earned once, kept forever"). They are simply never
// minted again, by the live path or the backfill.
export const EARNABLE_TYPES = new Set([
  'nth_book',
  'family_count',
  'family_breadth',
  'new_family',
  'series_completed',
  'plan_completed',
  'goal_completed',
  'female_authors_count',
]);

// Kinds no longer awarded, but still rendered and still shareable. The ledger
// reads this to group them apart and collapse them past the first few.
export const LEGACY_TYPES = new Set(['genre_count', 'new_genre']);

// A trimmed book snapshot, enough for ShareCard to render the plaque later
// without re-resolving the book from the library.
function cardBook(book) {
  if (!book) return null;
  return { t: book.t, a: book.a, coverUrl: book.coverUrl || null };
}

function isoDate(dateRead) {
  if (!dateRead) return new Date().toISOString();
  const d = new Date(dateRead);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// keyForMoment: the stable identity for a milestone. MUST match the keys the
// backfill produces below, or live + retroactive earns would diverge.
export function keyForMoment(m) {
  switch (m.type) {
    case 'goal_completed':   return `goal:${m.year}`;
    case 'series_completed': return `series:${m.seriesName}`;
    case 'plan_completed':   return `plan:${m.planId || m.planTitle}`;
    case 'nth_book':         return `nth_book:${m.year}:${m.n}`;
    case 'family_count':     return `family_count:${m.family}:${m.n}`;
    case 'family_breadth':   return `family_breadth:${m.family}:${m.n}`;
    case 'new_family':       return `new_family:${m.family}`;
    // Retired: kept so a stored row can still be re-keyed if anything asks.
    case 'genre_count':      return `genre_count:${m.genre}:${m.n}`;
    case 'new_genre':        return `new_genre:${m.genre}`;
    case 'female_authors_count': return `female_authors_count:${m.n}`;
    default:                 return null; // book_completed etc. never persist
  }
}

// momentToMeta: everything ShareCard/momentShareText need to re-render the
// card from a stored row, so sharing an old accomplishment needs no library
// lookup. Carries the earning book snapshot plus the type-specific fields.
export function momentToMeta(m) {
  const meta = { book: cardBook(m.book) };
  for (const f of ['n', 'year', 'genre', 'family', 'familyName', 'seriesName', 'total', 'planTitle', 'planId', 'count', 'goal']) {
    if (m[f] !== undefined && m[f] !== null) meta[f] = m[f];
  }
  return meta;
}

// rowToMoment: reconstruct a moment object (the shape ShareCard consumes) from
// a persisted accomplishment entry, for tap-to-share on the ledger.
export function rowToMoment(entry) {
  return { type: entry.kind, ...(entry.meta || {}) };
}

// entryFromMoment: build a persistable entry from a live moment.
export function entryFromMoment(m, earnedAt = new Date().toISOString()) {
  return {
    key: keyForMoment(m),
    kind: m.type,
    bookId: m.book?.bookId || null,
    meta: momentToMeta(m),
    earnedAt,
  };
}

// computeBackfillAccomplishments({ library, genresByBookId, plans, goal })
//   Returns an array of persistable entries — every accomplishment the
//   existing library already implies, dated to the crossing read where that
//   date is derivable. Idempotent by construction: the caller inserts with
//   on-conflict-do-nothing against unique(user_id, key).
export function computeBackfillAccomplishments({ library = [], genresByBookId = {}, plans = [], goal = null }) {
  const out = [];

  // Chronological replay: dated books in read order, undated appended last.
  const dated = library
    .filter((b) => b.dateRead)
    .sort((a, b) => (a.dateRead < b.dateRead ? -1 : a.dateRead > b.dateRead ? 1 : 0));
  const undated = library.filter((b) => !b.dateRead);
  const ordered = [...dated, ...undated];

  const perYearCount = {};  // year → books read that calendar year, so far
  const familyCount = {};   // family slug → all-time count, so far
  const familyGenres = {};  // family slug → Set of distinct genres read within it
  let libSoFar = 0;
  let femaleAuthorCount = 0; // all-time count of books by women, so far

  for (const book of ordered) {
    libSoFar += 1;
    const earnedAt = isoDate(book.dateRead);
    const snap = cardBook(book);
    const year = (book.dateRead || '').slice(0, 4);

    // ── Nth book of the year (per calendar year) ─────────────────────────
    if (year) {
      perYearCount[year] = (perYearCount[year] || 0) + 1;
      const n = perYearCount[year];
      if (YEAR_MILESTONES.includes(n)) {
        out.push({ key: `nth_book:${year}:${n}`, kind: 'nth_book', bookId: book.bookId || null, meta: { n, year, book: snap }, earnedAt });
      }
    }

    // ── Family count / breadth / first-in-family (all-time) ──────────────
    // v0.67: replays the family ladders in read order, exactly as the genre
    // ones were replayed, so each rung is dated to the book that crossed it.
    // The retired genre ladders are deliberately NOT replayed — existing rows
    // survive because nothing deletes them, and no new ones are minted.
    const fam = familyForBook(book, genresByBookId);
    if (fam) {
      familyCount[fam.slug] = (familyCount[fam.slug] || 0) + 1;
      const c = familyCount[fam.slug];
      const meta = { n: c, family: fam.slug, familyName: fam.name, book: snap };

      if (FAMILY_MILESTONES.includes(c)) {
        out.push({ key: `family_count:${fam.slug}:${c}`, kind: 'family_count', bookId: book.bookId || null, meta, earnedAt });
      } else if (c === 1 && libSoFar >= NEW_GENRE_MIN_LIBRARY) {
        out.push({
          key: `new_family:${fam.slug}`, kind: 'new_family', bookId: book.bookId || null,
          meta: { family: fam.slug, familyName: fam.name, book: snap }, earnedAt,
        });
      }

      const set = (familyGenres[fam.slug] = familyGenres[fam.slug] || new Set());
      const before = set.size;
      for (const g of familyGenreNamesFor(book, genresByBookId, fam.slug)) set.add(g);
      // Crossing check on the SIZE, not on membership: a book adding two new
      // genres at once can step over a rung, and a rung stepped over is a rung
      // never earned. Award every rung the size passed through.
      // Same cap as the live path: breadth cannot exceed the number of books
      // in the family, or one multi-tagged book earns a breadth rung alone.
      const capBefore = Math.min(before, c - 1);
      const capAfter = Math.min(set.size, c);
      for (const rung of FAMILY_BREADTH_MILESTONES) {
        if (capBefore < rung && capAfter >= rung) {
          out.push({
            key: `family_breadth:${fam.slug}:${rung}`, kind: 'family_breadth',
            bookId: book.bookId || null,
            meta: { n: rung, family: fam.slug, familyName: fam.name, book: snap }, earnedAt,
          });
        }
      }
    }

    // ── Books by women (all-time, cross-genre) ───────────────────────────
    if (countsAsFemaleAuthored(book)) {
      femaleAuthorCount += 1;
      if (FEMALE_AUTHOR_MILESTONES.includes(femaleAuthorCount)) {
        out.push({
          key: `female_authors_count:${femaleAuthorCount}`,
          kind: 'female_authors_count',
          bookId: book.bookId || null,
          meta: { n: femaleAuthorCount, book: snap },
          earnedAt,
        });
      }
    }
  }

  // ── Series completed (all-time snapshot) ───────────────────────────────
  const seriesGroups = {};
  for (const b of library) {
    if (!b.s?.name || !b.s?.total) continue;
    const g = (seriesGroups[b.s.name] = seriesGroups[b.s.name] || { total: b.s.total, books: [] });
    g.books.push(b);
  }
  for (const [name, g] of Object.entries(seriesGroups)) {
    if (g.books.length < g.total) continue;
    // Earned at the latest read in the series (the book that completed it).
    const last = g.books
      .filter((b) => b.dateRead)
      .sort((a, b) => (a.dateRead < b.dateRead ? 1 : -1))[0] || g.books[0];
    out.push({
      key: `series:${name}`,
      kind: 'series_completed',
      bookId: last.bookId || null,
      meta: { seriesName: name, total: g.total, book: cardBook(last) },
      earnedAt: isoDate(last.dateRead),
    });
  }

  // ── Reading goal completed (per year the goal was reached) ─────────────
  if (goal) {
    for (const [year, count] of Object.entries(perYearCount)) {
      if (count < goal) continue;
      const yearBooks = dated.filter((b) => (b.dateRead || '').slice(0, 4) === year);
      const goalBook = yearBooks[goal - 1] || yearBooks[yearBooks.length - 1] || null;
      out.push({
        key: `goal:${year}`,
        kind: 'goal_completed',
        bookId: goalBook?.bookId || null,
        meta: { goal, year, book: cardBook(goalBook) },
        earnedAt: isoDate(goalBook?.dateRead),
      });
    }
  }

  // ── Reading plans completed (every book in the plan is in the library) ─
  const readKeys = new Set(library.map((b) => bookKey(b)));
  for (const plan of plans || []) {
    const planBooks = plan.books || [];
    if (!planBooks.length) continue;
    const planKeys = planBooks.map((b) => bookKey({ t: b.title || b.t, a: b.author || b.a }));
    if (!planKeys.every((pk) => readKeys.has(pk))) continue;
    out.push({
      key: `plan:${plan._id || plan.title}`,
      kind: 'plan_completed',
      bookId: null,
      meta: { planTitle: plan.title || 'A reading plan', planId: plan._id || null, count: planBooks.length, book: null },
      earnedAt: new Date().toISOString(),
    });
  }

  return out;
}
