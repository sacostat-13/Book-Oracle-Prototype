// seriesCandidates.mjs — deciding which of Hardcover's "books in this series"
// are actually volumes, and which of those is the one this catalog wants.
//
// Pure. No network, no database, no environment. That is the point: this is the
// half of seriesBackfill.mjs that kept getting it wrong, and a pure function is
// the half a test can hold still.
//
// WHAT HARDCOVER RETURNS
// ----------------------
// A "book" in `book_series` is a work record, not a volume. Translations,
// omnibuses, box sets and split-volume editions each get their own, all attached
// to the series, often all at the same position. Crescent City — a THREE book
// series — comes back with twenty-five.
//
// FILTERS, IN ORDER
//   1. Integer positions only — 1.1 and 2.2 are halves of one volume.
//   2. Bundle/box-set/omnibus titles out, by pattern.
//   3. Omnibus by containment — a title wholly containing another candidate's
//      title is a collection of it. Catches "House of Earth and Blood, House of
//      Sky and Breath", which matches no bundle word.
//   4. Language, when the caller can supply it. Additive: a candidate whose
//      language is KNOWN and different from the wanted one goes; unknown
//      language never disqualifies anything.
//   5. Author. A translation is very often credited to its translator.
//   6. Page-count outliers, per position, against that position's median.
//
// Then the bundle-quotation signal breaks whatever ties remain: a collection
// edition quotes its volumes in the original language, so a candidate whose
// title appears inside the collection titles THIS series threw out is what those
// collections are made of. `House of Earth and Blood` is quoted in two of them;
// `Dom Ziemi i Krwi` in none. That is what separates an original from a
// translation credited to the SAME author, which the author filter cannot see.
//
// THE AUTHOR FILTER READS EVERY CONTRIBUTION, NOT THE FIRST
// ---------------------------------------------------------
// 2026-09-09, from a real propose run. Hardcover's contributions are not
// author-first, and for an audiobook the first one can be the NARRATOR:
//
//   House of Sky and Breath   768pp   credited to "Elizabeth Evans"
//
// That is the English volume — Elizabeth Evans narrates it — and the filter
// threw it out as "usually a translation". It did no harm only because the
// catalog already held position 2, so the row was never going to be proposed.
// Had position 2 been empty, the filter would have dropped the real book and
// left a translation standing.
//
// So a candidate carries `authors` — every contribution — and matches if ANY of
// them is the series author. A narrator alongside Sarah J. Maas keeps the book;
// a translator instead of her still loses it.
//
// ON "ORIGINAL LANGUAGE"
// ----------------------
// `wantLanguage` is the language THIS CATALOG is written in, not a claim about
// the work. The Books Oracle holds English titles for Japanese works — Ring,
// Love Hina, the JoJo volumes — so English is the right preference there even
// though it is not the original language. A catalog holding the Spanish edition
// of a Spanish novel would want something else, and this function takes the
// answer rather than deciding it.

export const COLLECTION_RE =
  /\b(bundle|box(ed)? ?set|omnibus|anthology|collection|complete (series|collection)|series set|set of \d+|\d+[- ]book|books? \d+\s*[-–—]\s*\d+|part \d+ of \d+|vols?\.? \d+\s*[-–—]\s*\d+)\b/i;

export const normTitle = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const authorsOf = (c) => (c.authors && c.authors.length ? c.authors : [c.author]).filter(Boolean);

/**
 * @param {Array<{position:number,title:string,author?:string,authors?:string[],
 *                language?:string|number|null,pages:number|null,description:string,
 *                coverUrl:string,hardcoverId:number|null}>} candidates
 * @param {{seriesAuthors?: string[], wantLanguage?: string|number|null}} [opts]
 * @returns {{ byPosition: Map<number, object[]>, rejected: Array<object & {reason:string}> }}
 *          Survivors carry `originality` (how many collection titles quote them)
 *          and `pick` (the unique best at their position).
 */
export function candidatesByPosition(candidates, { seriesAuthors = [], wantLanguage = null } = {}) {
  const rejected = [];
  let keep = [];

  // Only titles long enough to be distinctive take part in the containment
  // test. Without the floor, a candidate called "Ring" is "contained in"
  // everything and the whole series rejects itself.
  const allTitles = candidates.map((c) => normTitle(c.title)).filter((t) => t.length > 6);
  // The corpus for the originality signal: every title this series threw out as
  // a collection. Built as we go.
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

  // Language. Only ever removes a candidate whose language is KNOWN and wrong —
  // Hardcover answers for roughly half the books in a series, and treating
  // "unknown" as "foreign" would throw away more originals than translations.
  if (wantLanguage != null) {
    const survivors = [];
    for (const c of keep) {
      if (c.language != null && c.language !== wantLanguage) {
        rejected.push({ ...c, reason: `edition language ${c.language}, not ${wantLanguage}` });
      } else survivors.push(c);
    }
    keep = survivors;
  }

  // Author. Conditional on a match existing: if nothing upstream agrees with
  // what we hold, the held author is likelier wrong than every candidate is a
  // translation, so the filter stands down rather than emptying the series.
  const known = new Set(seriesAuthors.map(normTitle).filter(Boolean));
  if (known.size) {
    const matches = (c) => authorsOf(c).some((a) => known.has(normTitle(a)));
    if (keep.some(matches)) {
      const survivors = [];
      for (const c of keep) {
        const names = authorsOf(c);
        if (names.length && !matches(c)) {
          rejected.push({ ...c, reason: `credited to ${names.map((n) => `"${n}"`).join(', ')}, none of them the series author — usually a translation` });
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
    const score = (x) => (x.coverUrl ? 4 : 0) + (x.pages ? 2 : 0) + (x.description ? 1 : 0) + (x.language != null ? 1 : 0);
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
    // A confirmed match on the wanted language outranks the quotation signal:
    // it is a fact where the other is an inference.
    const confirmed = list.filter((c) => wantLanguage != null && c.language === wantLanguage);
    if (confirmed.length === 1) {
      confirmed[0].pick = true;
    } else {
      const pool = confirmed.length ? confirmed : list;
      const top = Math.max(...pool.map((c) => c.originality));
      const winners = pool.filter((c) => c.originality === top);
      // A tie, or nothing quoted anywhere, is a real question. Leave it open.
      if (top > 0 && winners.length === 1) winners[0].pick = true;
    }
    list.sort((a, b) =>
      (Number(b.pick) - Number(a.pick)) ||
      (b.originality - a.originality) ||
      a.title.localeCompare(b.title));
  }

  return { byPosition, rejected };
}
