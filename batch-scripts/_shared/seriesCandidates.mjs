// seriesCandidates.mjs — deciding which of Hardcover's "books in this series"
// are actually volumes, and which of those is the original.
//
// Pure. No network, no database, no environment. That is the point: this is the
// half of seriesBackfill.mjs that keeps getting it wrong, and a pure function is
// the half a test can hold still.
//
// WHAT HARDCOVER RETURNS
// ----------------------
// A "book" in `book_series` is a work record, not a volume. Translations,
// omnibuses, box sets and split-volume editions each get their own, all attached
// to the series, often all at the same position. Crescent City — a THREE book
// series — comes back with twenty.
//
// TWO ROUNDS OF THIS, BOTH WORTH REMEMBERING
// ------------------------------------------
// Round one (2026-09-08) proposed all twenty, fifteen pre-approved at
// confidence 100: bundles, box sets, four editions of one volume, three
// translations, and two halves of a split edition at positions 1.1 and 1.2.
// Applying it would have put eight junk rows into a three-book series.
//
// Round two filtered the bundles and split editions correctly and then offered
// the translations as equal candidates for a human to choose between — three at
// position 1, four at position 3. That is not what a reading-order page wants.
// A series page is the series in its ORIGINAL language: House of Earth and
// Blood, not Dom Ziemi i Krwi, and not Toprak ve Kan Hanesi.
//
// SO: STRUCTURE, THEN AUTHOR, THEN ORIGINALITY
// --------------------------------------------
//   1. Integer positions only — 1.1 and 2.2 are halves of one volume.
//   2. Bundle/box-set/omnibus titles out, by pattern.
//   3. Omnibus by containment — a title wholly containing another candidate's
//      title is a collection of it. Catches "House of Earth and Blood, House of
//      Sky and Breath", which matches no bundle word.
//   4. Author filter. A translation is very often credited to its TRANSLATOR:
//      Toprak ve Kan Hanesi to Arif Dursun, Alev ve Gölge Hanesi to Seyhan
//      Dönmez, Cidade da Lua Crescente to Carolina Candido. Where the series has
//      a known author and at least one candidate matches, the rest go.
//   5. Page-count outliers out, per position, against that position's median.
//
// That leaves the translations credited to the original author — Dom Ziemi i
// Krwi and Huis van vuur & schaduw are both "by Sarah J. Maas". Nothing in the
// author, title, page count or position separates those from the original.
//
// THE ORIGINALITY SIGNAL
// ----------------------
// The bundles do it. A collection edition quotes its volumes' titles in the
// original language:
//
//   "Crescent City Series Set of 3 Books. House of Earth and Blood, House of
//    Sky and Breath and House of Flame and Shadow"
//
// So a candidate whose title appears INSIDE the collection titles this same
// series threw out is the one those collections are made of — the original.
// `Dom Ziemi i Krwi` appears in none of them; `House of Earth and Blood` appears
// in three.
//
// It is a signal, not a proof, so it is used the way a signal should be: the
// unique highest scorer at a position is marked `pick`, and everything else at
// that position stays in the output as a visible, unapproved alternative. A
// series with no collection editions scores every candidate zero, nothing is
// picked, and the caller falls back to asking a person. Degrading to the
// previous behaviour is the worst case, not a wrong answer.

export const COLLECTION_RE =
  /\b(bundle|box(ed)? ?set|omnibus|anthology|collection|complete (series|collection)|series set|set of \d+|\d+[- ]book|books? \d+\s*[-–—]\s*\d+|part \d+ of \d+|vols?\.? \d+\s*[-–—]\s*\d+)\b/i;

export const normTitle = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param {Array<{position:number,title:string,author:string,pages:number|null,
 *                description:string,coverUrl:string,hardcoverId:number|null}>} candidates
 * @param {{seriesAuthors?: string[]}} [opts] authors already known for this
 *        series, from the books we hold. Used to drop translations credited to
 *        their translator — only when at least one candidate matches, so a
 *        series whose held author is wrong or missing loses nothing.
 * @returns {{ byPosition: Map<number, object[]>, rejected: Array<object & {reason:string}> }}
 *          Each surviving candidate carries `originality` (how many collection
 *          titles quote it) and `pick` (the unique best at its position).
 */
export function candidatesByPosition(candidates, { seriesAuthors = [] } = {}) {
  const rejected = [];
  let keep = [];

  // Only titles long enough to be distinctive take part in the containment
  // test. Without the floor, a candidate called "Ring" is "contained in"
  // everything and the whole series rejects itself.
  const allTitles = candidates.map((c) => normTitle(c.title)).filter((t) => t.length > 6);
  // The corpus for the originality signal below: every title this series threw
  // out as a collection. Built as we go.
  const collectionTitles = [];

  for (const c of candidates) {
    if (!Number.isInteger(c.position)) {
      rejected.push({ ...c, reason: `split edition (position ${c.position})` }); continue;
    }
    if (COLLECTION_RE.test(c.title)) {
      collectionTitles.push(normTitle(c.title));
      rejected.push({ ...c, reason: 'title reads as a bundle or collection' }); continue;
    }
    const nt = normTitle(c.title);
    const contains = allTitles.filter((t) => t !== nt && nt.includes(t)).length;
    if (contains >= 1) {
      collectionTitles.push(nt);
      rejected.push({ ...c, reason: `title contains ${contains} other volume title(s) — a collection` }); continue;
    }
    keep.push(c);
  }

  // The author filter. Conditional on a match existing: if nothing we hold
  // agrees with anything upstream, the held author is more likely to be the
  // wrong one than every candidate to be a translation.
  const known = new Set(seriesAuthors.map(normTitle).filter(Boolean));
  if (known.size) {
    const anyMatch = keep.some((c) => c.author && known.has(normTitle(c.author)));
    if (anyMatch) {
      const survivors = [];
      for (const c of keep) {
        if (c.author && !known.has(normTitle(c.author))) {
          rejected.push({ ...c, reason: `credited to "${c.author}", not the series author — usually a translation` });
        } else survivors.push(c);
      }
      keep = survivors;
    }
  }

  // Editions of one work: same position, same normalised title. Keep the most
  // complete, because that row becomes the catalog entry.
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
        collectionTitles.push(normTitle(c.title));
        rejected.push({ ...c, reason: `${c.pages} pages against a median of ${median} — a collection` });
      } else kept.push(c);
    }
    byPosition.set(pos, kept);
  }

  // Originality, and the pick.
  for (const [, list] of byPosition) {
    for (const c of list) {
      const nt = normTitle(c.title);
      c.originality = collectionTitles.filter((t) => t !== nt && t.includes(nt)).length;
      c.pick = false;
    }
    if (list.length === 1) { list[0].pick = true; continue; }
    const top = Math.max(...list.map((c) => c.originality));
    const winners = list.filter((c) => c.originality === top);
    // A tie, or nothing quoted anywhere, is a real question. Leave it open.
    if (top > 0 && winners.length === 1) winners[0].pick = true;
    // Best first, so the CSV reads in the order a reviewer should consider it.
    list.sort((a, b) => (b.originality - a.originality) || a.title.localeCompare(b.title));
  }

  return { byPosition, rejected };
}
