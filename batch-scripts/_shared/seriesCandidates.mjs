// seriesCandidates.mjs — deciding which of Hardcover's "books in this series"
// are actually volumes.
//
// Pure. No network, no database, no environment. That is the point: this is the
// half of seriesBackfill.mjs that got it wrong, and a pure function is the half
// a test can hold still.
//
// WHAT WENT WRONG, 2026-09-08
// ---------------------------
// The first propose run asked Hardcover for Crescent City — a THREE book series
// — and produced twenty proposals, fifteen pre-approved at confidence 100:
//
//   position 1    House of Earth and Blood                     (x4 editions)
//                 House of Earth and Blood, House of Sky and Breath
//                 Crescent City ebook Bundle: A 3 Book Bundle  (4,379 pages)
//                 Crescent City Bundle: A 2-book bundle
//                 Crescent City Hardcover Box Set
//                 Dom Ziemi i Krwi                             (Polish)
//                 Toprak ve Kan Hanesi                         (Turkish)
//   position 1.1  House of Earth and Blood, Part 1 of 2
//   position 1.2  House of Earth and Blood, Part 2 of 2
//   position 3    Huis van vuur & schaduw                      (Dutch)
//                 House of Flame and Shadow                    (the volume)
//
// A "book" in Hardcover's `book_series` is a work record, not a volume.
// Translations, omnibuses, box sets and split-volume editions each get their
// own, all attached to the series, often all at the same position. Applying
// that list would have put eight junk rows into a three-book series — and
// series_volumes would then have picked one per position by ITS preference
// order, most likely the 4,379-page bundle, on page count.
//
// The irony worth remembering: the duplicate-editions-at-one-position problem
// had already been fixed in SQL that same day. It was then reintroduced by the
// script feeding the database, because the fix lived in the view and the
// script never asked the same question.
//
// WHAT THIS DOES
// --------------
// Four filters, then an admission:
//
//   1. Integer positions only — 1.1 and 2.2 are halves of one volume.
//   2. Bundle/box-set/omnibus titles out, by pattern.
//   3. Omnibus by containment — a title that wholly contains another
//      candidate's title is a collection of it. Catches "House of Earth and
//      Blood, House of Sky and Breath" without it having to say "omnibus".
//   4. Page-count outliers out, per position, against that position's median.
//
// Editions of one work are then deduped by normalised title, keeping the most
// complete. What survives is grouped by position, and a position with more than
// one survivor is NOT something this module resolves: an original and its
// translations cannot be told apart with the fields the API query can safely
// ask for, so the caller states the choice and a person makes it.

// Anchored on whole words: `bundle` catches the bundles, `collection` does not
// catch `Collector's Edition` alone, and `\d+[- ]book` catches "A 3 Book
// Bundle" and "2-book bundle" both.
export const COLLECTION_RE =
  /\b(bundle|box(ed)? ?set|omnibus|anthology|collection|complete (series|collection)|series set|set of \d+|\d+[- ]book|books? \d+\s*[-–—]\s*\d+|part \d+ of \d+|vols?\.? \d+\s*[-–—]\s*\d+)\b/i;

export const normTitle = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {Array<{position:number,title:string,author:string,pages:number|null,
 *                description:string,coverUrl:string,hardcoverId:number|null}>} candidates
 * @returns {{ byPosition: Map<number, object[]>, rejected: Array<object & {reason:string}> }}
 */
export function candidatesByPosition(candidates) {
  const rejected = [];
  const keep = [];

  // Only titles long enough to be distinctive take part in the containment
  // test. Without the floor, a candidate called "Ring" is "contained in"
  // everything and the whole series is rejected.
  const allTitles = candidates.map((c) => normTitle(c.title)).filter((t) => t.length > 6);

  for (const c of candidates) {
    if (!Number.isInteger(c.position)) {
      rejected.push({ ...c, reason: `split edition (position ${c.position})` }); continue;
    }
    if (COLLECTION_RE.test(c.title)) {
      rejected.push({ ...c, reason: 'title reads as a bundle or collection' }); continue;
    }
    const nt = normTitle(c.title);
    const contains = allTitles.filter((t) => t !== nt && nt.includes(t)).length;
    if (contains >= 1) {
      rejected.push({ ...c, reason: `title contains ${contains} other volume title(s) — a collection` }); continue;
    }
    keep.push(c);
  }

  // Editions of one work: same position, same normalised title. Keep the most
  // complete, because that is the row that will become the catalog entry.
  const byTitle = new Map();
  for (const c of keep) {
    const k = `${c.position}::${normTitle(c.title)}`;
    const prev = byTitle.get(k);
    if (!prev) { byTitle.set(k, c); continue; }
    const score = (x) => (x.coverUrl ? 4 : 0) + (x.pages ? 2 : 0) + (x.description ? 1 : 0);
    if (score(c) > score(prev)) byTitle.set(k, c);
  }

  const byPosition = new Map();
  for (const c of byTitle.values()) {
    if (!byPosition.has(c.position)) byPosition.set(c.position, []);
    byPosition.get(c.position).push(c);
  }

  // Page-count outliers, per position, against that position's own median. A
  // 4,379-page "volume" beside three ~800-page ones is a collection whatever it
  // calls itself. Needs three page counts before a median means anything.
  for (const [pos, list] of byPosition) {
    const paged = list.filter((c) => c.pages > 0).map((c) => c.pages).sort((a, b) => a - b);
    if (paged.length < 3) continue;
    const median = paged[Math.floor(paged.length / 2)];
    const kept = [];
    for (const c of list) {
      if (c.pages && c.pages > median * 1.6) {
        rejected.push({ ...c, reason: `${c.pages} pages against a median of ${median} — a collection` });
      } else kept.push(c);
    }
    byPosition.set(pos, kept);
  }

  return { byPosition, rejected };
}
