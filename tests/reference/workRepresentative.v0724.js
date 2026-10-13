// FROZEN copy of workGroups.scoreCandidate as of v0.72.4, for tests/scoring.test.js. Do not edit.
export function scoreCandidate(book, uiLang) {
  let score = 0;

  const lang = (book.language || '').toLowerCase() || null;
  const orig = (book.originalLanguage || '').toLowerCase() || null;

  // 1. Known to be the original-language edition.
  if (lang && orig && orig !== 'unknown' && lang === orig) score += 1000;

  // 2. Matches the reader's interface language.
  if (lang && uiLang && lang === uiLang) score += 100;

  // 3. Completeness, so the entry renders as something rather than a grey box.
  //    A cover outweighs the rest because this is a strip of covers.
  if (book.coverUrl) score += 50;
  if (book.status === 'verified') score += 20;
  else if (book.status && book.status !== 'unreviewed') score += 10;
  if (book.d) score += 5;
  if (book.pp) score += 2;

  // 4. A row we hold beats one we only found through an API — it opens on a
  //    real page with real genres rather than a lookup on arrival.
  if (book.bookId) score += 8;

  return score;
}
