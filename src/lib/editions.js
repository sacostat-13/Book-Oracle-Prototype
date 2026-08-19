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

// ── Audio ─────────────────────────────────────────────────────────────────────
//
// v0.65. An audiobook is measured in time, and time is not pages. Nothing in
// this file converts between them, and nothing downstream should either: the
// tempting arithmetic (250 wpm, ~9,300 words an hour, so ten hours is "about
// 340 pages") has an invented number in every term, and the result would land
// in accomplishments.js and on share cards indistinguishable from a counted
// one. Two units, two stats.
//
// See docs/audiobook-progress-v1-spec.md.

/**
 * Total minutes this reader's audio edition runs to, or null.
 *
 * Note there is no fallback to a catalog value, deliberately. `books` has no
 * duration column and should not grow one — length is an edition fact, which
 * is the lesson the whole reader_editions table exists to encode. If the reader
 * has not told us, the honest answer is that we do not know.
 */
export function effectiveMinutes(edition) {
  if (edition?.format !== 'audio') return null;
  const m = Number(edition?.duration_minutes);
  return Number.isFinite(m) && m > 0 ? m : null;
}

/** Is this reader tracking this book by time rather than by page? */
export function isAudioEdition(edition) {
  return edition?.format === 'audio';
}

/**
 * How far through, 0..1, or null when it cannot be known.
 *
 * THE point of this function: almost every caller that today divides by pages
 * actually wants a FRACTION. Giving them one means the audio case is handled
 * once, here, rather than at every progress bar in the app — and it fixes a
 * pre-existing wart at the same time, because a PRINT book with no page count
 * currently renders a bar stuck at 0% for exactly the same reason an audiobook
 * did.
 *
 * `null` means "cannot be known" and every caller must render it as NO BAR.
 * Zero and unknown are different facts and a progress bar cannot express the
 * difference, so it should not try.
 */
export function progressFraction(book, edition, progress) {
  if (isAudioEdition(edition)) {
    const total = effectiveMinutes(edition);
    const done = Number(progress?.progress_minutes ?? progress?.progressMinutes);
    if (!total || !Number.isFinite(done) || done <= 0) return null;
    return Math.min(1, done / total);
  }
  const total = effectivePages(book, edition);
  const done = Number(progress?.pages_read ?? progress?.pagesRead);
  if (!total || !Number.isFinite(done) || done <= 0) return null;
  return Math.min(1, done / total);
}

// ── Hours and minutes, in and out ─────────────────────────────────────────────
//
// The column stores minutes; the reader thinks in "11h 47m". These three
// functions are the whole translation layer, and they are here rather than in
// the modal so the probe can exercise them without a browser.

/**
 * Two form fields to a minute count, or null.
 *
 * Blank-and-blank is null rather than 0, and that distinction carries the
 * feature: NULL duration means "the reader does not know the total", which is
 * a supported state — cumulative hours still counts, only the progress bar is
 * withheld. Zero would mean "this audiobook is zero minutes long".
 *
 * Minutes above 59 are not rejected. Someone typing "0h 90m" means ninety
 * minutes and is not confused; refusing it to enforce a format would be the
 * app being pedantic about arithmetic it can do itself.
 */
export function toMinutes(hours, minutes) {
  const h = String(hours ?? '').trim();
  const m = String(minutes ?? '').trim();
  if (h === '' && m === '') return null;
  const hn = h === '' ? 0 : Number(h);
  const mn = m === '' ? 0 : Number(m);
  if (!Number.isFinite(hn) || !Number.isFinite(mn) || hn < 0 || mn < 0) return null;
  const total = Math.round(hn * 60 + mn);
  return total > 0 ? total : null;
}

/** A minute count back to the two form fields. Blank strings for null. */
export function splitMinutes(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return { hours: '', minutes: '' };
  return { hours: String(Math.floor(n / 60)), minutes: String(n % 60) };
}

/**
 * "11h 47m" — for display, never for storage.
 *
 * Drops a zero component rather than printing "0h 47m", and returns null for
 * nothing, so a caller can decide whether a line is worth rendering at all
 * (the same contract editionTitle() uses).
 */
export function formatMinutes(total) {
  const n = Number(total);
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}
