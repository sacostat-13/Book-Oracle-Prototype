// src/lib/scoring/workRepresentative.js — which row stands for a work.
//
// When several rows are the same work (an original and its translations, two
// imports of one edition), collapseWorks() in book/workGroups.js keeps ONE.
// This scores the candidates; the highest wins. docs/reference/MATH.md §11.
//
// The weights are tiers, not a blend: original language beats everything, the
// reader's UI language beats any amount of completeness, completeness breaks
// the remaining ties.
export const REPRESENTATIVE_WEIGHTS = Object.freeze({
  originalLanguage: 1000, // row is in the language the book was written in
  uiLanguage: 100,        // row is in the reader's interface language
  cover: 50,              // a strip of covers: a grey box reads as broken
  verified: 20,           // a human checked this row
  reviewed: 10,           // any status past 'unreviewed'
  inCatalog: 8,           // a row we hold opens a real page, not a lookup
  description: 5,
  pages: 2,
});

// The rule, from the product side: THE ROW WE SHOW IS THE ONE IN THE LANGUAGE
// THE BOOK WAS WRITTEN IN. A reader browsing an author's work should see
// *Cien años de soledad* under García Márquez because that is the book he
// wrote, not because of who is looking.
//
// It only applies where original_language is actually known, which today means
// books the Oracle categorisation pass has enriched — every pre-existing row
// has NULL and always will, since nothing backfills it. So the ladder below
// falls through to weaker rules rather than pretending, and the section gets
// better as books are enriched instead of being wrong until they are.
//
// The reader's UI language is the SECOND tiebreak, not the first, and never
// overrides a known original. Showing a Spanish reader the Spanish translation
// of a Spanish novel is right; showing them the Spanish translation of an
// English novel *as the canonical entry* is a different and worse claim.
export function scoreWorkRepresentative(book, uiLang) {
  let score = 0;

  const lang = (book.language || '').toLowerCase() || null;
  const orig = (book.originalLanguage || '').toLowerCase() || null;

  // 1. Known to be the original-language edition.
  if (lang && orig && orig !== 'unknown' && lang === orig) score += REPRESENTATIVE_WEIGHTS.originalLanguage;

  // 2. Matches the reader's interface language.
  if (lang && uiLang && lang === uiLang) score += REPRESENTATIVE_WEIGHTS.uiLanguage;

  // 3. Completeness, so the entry renders as something rather than a grey box.
  //    A cover outweighs the rest because this is a strip of covers.
  if (book.coverUrl) score += REPRESENTATIVE_WEIGHTS.cover;
  if (book.status === 'verified') score += REPRESENTATIVE_WEIGHTS.verified;
  else if (book.status && book.status !== 'unreviewed') score += REPRESENTATIVE_WEIGHTS.reviewed;
  if (book.d) score += REPRESENTATIVE_WEIGHTS.description;
  if (book.pp) score += REPRESENTATIVE_WEIGHTS.pages;

  // 4. A row we hold beats one we only found through an API — it opens on a
  //    real page with real genres rather than a lookup on arrival.
  if (book.bookId) score += REPRESENTATIVE_WEIGHTS.inCatalog;

  return score;
}
