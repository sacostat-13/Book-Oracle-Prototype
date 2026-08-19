// editions.js — the page count a book is actually tracked against.
//
// One rule, in one place, because the alternative is what shipped before: the
// reader's own page count lived on `currently_reading.user_page_count`, only
// ProgressUpdateModal knew about it, and every other surface — the progress bar
// on BookPage, the Dashboard totals, the reading accomplishments — divided by
// `book.pp` from the catalog. A reader on a 512-page Spanish edition of a
// 417-page English novel saw one number in the modal and a different one
// everywhere else, and finishing the book deleted the override entirely.
//
// See docs/reader-editions-v1-spec.md.

/**
 * The page count to use for THIS reader and THIS book.
 *
 * Order matters and is not arbitrary:
 *
 *   1. the reader's recorded edition        — they told us; nothing outranks it
 *   2. the legacy currently_reading override — same statement, older storage
 *   3. the catalog's page count              — a fact about a different edition
 *
 * Step 2 exists because migration 20260818120000 deliberately does NOT drop
 * `user_page_count`: a client running the previously deployed bundle still
 * writes it, so for one release the old column can hold a number the new table
 * has never seen. Remove this branch when the column goes.
 *
 * Returns null when nothing knows, which callers must handle — an audiobook has
 * no page count and never will, and a progress bar over `null` should not
 * render rather than render zero.
 */
export function effectivePages(book, edition) {
  return edition?.page_count || book?.userPageCount || book?.pp || null;
}

/**
 * The title to show for this reader's copy, or null when it is the catalog's.
 *
 * Null rather than the catalog title on purpose: callers use it to decide
 * whether there is a SECOND line worth rendering at all, and returning the
 * canonical title would make every book look like it had a special edition.
 */
export function editionTitle(book, edition) {
  const t = (edition?.edition_title || '').trim();
  if (!t) return null;
  return t === (book?.t || '').trim() ? null : t;
}

/**
 * Does this reader's edition differ from the catalog row in a way worth saying?
 *
 * A recorded edition that matches the catalog in every visible respect is not
 * worth a line of UI — the reader gains nothing from being told their English
 * copy of an English book is English.
 */
export function editionIsNotable(book, edition) {
  if (!edition) return false;
  if (editionTitle(book, edition)) return true;
  if (edition.translator) return true;
  if (edition.format && edition.format !== 'print') return true;
  if (edition.language && book?.language && edition.language !== book.language) return true;
  // A page count that disagrees with the catalog is the original complaint:
  // it is why the reader entered it, and it is what their progress is measured
  // against.
  if (edition.page_count && book?.pp && edition.page_count !== book.pp) return true;
  return false;
}

// The languages offered in the edition picker, in the order they are shown.
//
// The app's own two UI languages first — they are overwhelmingly what a reader
// picking a translation will want — then the languages the catalog actually
// contains most of. Deliberately short: this is a dropdown a reader uses once
// per book, not a complete ISO list, and `null` (unspecified) stays valid.
export const EDITION_LANGUAGES = [
  'en', 'es', 'pt', 'fr', 'de', 'it', 'ca', 'nl', 'pl', 'ru', 'ja', 'zh', 'ko',
];

export const EDITION_FORMATS = ['print', 'ebook', 'audio'];

/**
 * Normalise anything language-shaped to a BCP-47 primary subtag, or null.
 * Mirrors what books.language stores, so a reader's edition and a catalog row
 * are always comparable without either side normalising first.
 */
export function normalizeLanguage(raw) {
  const s = (raw || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2}$/.test(s) ? s : null;
}
