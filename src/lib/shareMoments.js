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

// v0.67 — RETIRED, not deleted. These fired per GENRE, and the Oracle assigns
// 2-5 genres to every book (specific plus umbrella, deliberately, so both
// readers find it). At 167 genres that is 668 possible genre_count plaques and
// 167 new_genre ones, and worse: one necromancer novel minted "First book in
// Necromancy", "First book in Dark Fantasy" AND "First book in Fantasy" — three
// trophies for one evening, two of which the reader did nothing separate to
// earn. The ladders below replace them on the family axis.
//
// The constant stays exported because accomplishments already earned under it
// are kept forever (v1 spec, rule 3) and the ledger still renders them.
export const GENRE_MILESTONES = [5, 10, 25, 50];

// v0.67 — the family ladders.
//
// Starts at 10, not 5: five books in a GENRE was a real appetite (Folk Horror
// is specific), five in a FAMILY is week two. Runs to 1000 because a rung costs
// one array entry and a reader with a thousand fantasy novels should have
// somewhere left to go. The tail keeps the ~2-2.5x ratio every earlier step has.
export const FAMILY_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

// Distinct genres read WITHIN one family. The only place genre-level detail
// still earns anything, and the only ladder a reader can finish — which is what
// the small families are for: Verse & Stage holds four genres, so 3 is reachable.
export const FAMILY_BREADTH_MILESTONES = [3, 5, 10];

// v0.55: books by women, counted across the WHOLE library regardless of
// genre — this is deliberately not a genre ladder. Author gender lives on
// book.ag ('female'|'male'|'nonbinary'|'mixed'|undefined), set by the Oracle
// via author_gender on the books row (never inferred from name — see
// schema_v35_migration.sql). 'mixed' (co-authored, mixed-gender) counts
// alongside 'female' so a co-authored book isn't invisible.
export const FEMALE_AUTHOR_MILESTONES = [5, 10, 25, 50, 100];

export function countsAsFemaleAuthored(book) {
  return book.ag === 'female' || book.ag === 'mixed';
}

// Don't announce "first book in a new family" until the library is big enough
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

// familyForBook: the ONE family a book counts toward, or null.
//
// A book carries several genres; a book earns at most one family plaque. The
// rule is the first genre that has a family, and rollupGenres already sorts a
// book's genres by usage_count desc — so that is the broadest shelf the book
// sits on. Same choice getPrimaryGenre and useShelfGrouping make; one rule,
// three consumers, and the live path and the backfill cannot drift apart
// because they both call this.
//
// Returns { slug, name } or null. Null for guest/unenriched books and for
// genres curation has not filed yet — those simply earn no family milestone,
// which is correct: we do not know which shelf they are on.
export function familyForBook(book, genresByBookId) {
  const rows = book.bookId ? genresByBookId?.[book.bookId] : null;
  if (!rows || !rows.length) return null;
  const hit = rows.find((r) => r.familySlug);
  return hit ? { slug: hit.familySlug, name: hit.familyName || hit.familySlug } : null;
}

// The distinct genres a book contributes within its own family — the input to
// the breadth ladder.
export function familyGenreNamesFor(book, genresByBookId, slug) {
  const rows = book.bookId ? genresByBookId?.[book.bookId] : null;
  if (!rows || !rows.length) return [];
  return rows.filter((r) => r.familySlug === slug).map((r) => r.normalizedName || r.name);
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

  // ── Family milestones ──────────────────────────────────────────────────
  // v0.67: replaced the per-genre ladders. One family per book, so one plaque
  // at most — see FAMILY_MILESTONES for why the genre version had to go.
  const family = familyForBook(book, genresByBookId);
  if (family) {
    const inFamily = library.filter(
      (b) => familyForBook(b, genresByBookId)?.slug === family.slug
    );
    const count = inFamily.length;

    if (FAMILY_MILESTONES.includes(count)) {
      moments.push({ type: 'family_count', family: family.slug, familyName: family.name, n: count, book });
    } else if (count === 1 && library.length >= NEW_GENRE_MIN_LIBRARY) {
      moments.push({ type: 'new_family', family: family.slug, familyName: family.name, book });
    }

    // Breadth: distinct genres read within this family. Counted over every book
    // whose family is this one — not just the completed book — because breadth
    // is a property of the shelf, not of the last thing put on it.
    //
    // NOT an exact-crossing check, unlike every other ladder here. Counts rise
    // by exactly one per book; a distinct-genre SET can rise by two or three at
    // once, because the completed book may be the first folk horror AND the
    // first slasher on the shelf. `includes(size)` would step straight over
    // rung 3 and that rung would never be earned by anyone. So: award every
    // rung the set passed through, which is also exactly what the backfill in
    // accomplishments.js does — the two must agree or a live earn and a
    // retroactive one produce different keys.
    const after = new Set();
    for (const b of inFamily) {
      for (const g of familyGenreNamesFor(b, genresByBookId, family.slug)) after.add(g);
    }
    const before = new Set();
    for (const b of inFamily) {
      if (b === book || (book.bookId && b.bookId === book.bookId)) continue;
      for (const g of familyGenreNamesFor(b, genresByBookId, family.slug)) before.add(g);
    }
    // GUARD: breadth is capped by the number of books in the family, because a
    // single book carries its specific genre AND its umbrellas — one necromancer
    // novel is tagged Necromancy, Dark Fantasy and Fantasy, and without this it
    // would earn "3 genres in Fantasy & the Invented" on its own. That is the
    // exact inflation the family ladders exist to remove, one level down.
    // Three genres has to mean three books.
    // `before` is capped by the book count BEFORE this book, `after` by the
    // count after. Capping both by the same number would let a shelf of
    // multi-tagged books drift from what the backfill computes, and the two
    // must produce identical keys.
    const capBefore = Math.min(before.size, count - 1);
    const capAfter = Math.min(after.size, count);
    for (const rung of FAMILY_BREADTH_MILESTONES) {
      if (capBefore < rung && capAfter >= rung) {
        moments.push({
          type: 'family_breadth', family: family.slug, familyName: family.name,
          n: rung, book,
        });
      }
    }
  }

  // ── Books by women (all-time, cross-genre) ─────────────────────────────
  if (countsAsFemaleAuthored(book)) {
    const count = library.filter(countsAsFemaleAuthored).length;
    if (FEMALE_AUTHOR_MILESTONES.includes(count)) {
      moments.push({ type: 'female_authors_count', n: count, book });
    }
  }

  // ── Fallback: the book itself ──────────────────────────────────────────
  moments.push({ type: 'book_completed', book });

  const PRIORITY = [
    'goal_completed',
    'series_completed',
    'plan_completed',
    'nth_book',
    'family_count',
    'family_breadth',
    'new_family',
    // Retired in v0.67 — kept in the ordering so a legacy accomplishment
    // reconstructed from a stored row still sorts sensibly.
    'genre_count',
    'new_genre',
    'female_authors_count',
    'book_completed',
  ];
  moments.sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  return moments;
}
