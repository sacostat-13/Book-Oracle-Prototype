// workGroups.js — collapsing rows that are the same BOOK into one entry.
//
// THE PROBLEM
//
// `books` is a work table carrying edition facts. Its identity, normalized_key,
// is built from title + author by compute_book_key, so *Cien años de soledad*
// and *One Hundred Years of Solitude* are two rows, and nothing in the schema
// says they are one novel. That was survivable while the two rows only ever
// appeared in a search result. It stops being survivable the moment a surface
// shows a LIST of one author's books, because then the same six novels appear
// twelve times, in whatever languages the site's readers happen to have added.
//
// The real fix is a work/edition split (docs/reader-editions-v1-spec.md). This
// file is not that. This is the part that can be done without touching the
// identity of every book in the app: given a handful of candidate rows, work
// out which of them are provably the same book, and show one.
//
// PROVABLY, NOT PROBABLY
//
// Every signal used here is an EXACT match on a shared identifier. None of it
// is title similarity, and that is the whole design:
//
//   - "Cien años de soledad" and "One Hundred Years of Solitude" share not one
//     character. No string metric will ever pair them.
//   - Any metric loose enough to pair translations would also pair
//     "The Hobbit" with "The Hobbit: Illustrated Edition" (fine) and
//     "Emma" with "Emma: A Modern Retelling" (a different novel by a different
//     author). Collapsing two genuinely different books hides one of them
//     completely, and the reader has no way to tell it happened.
//
// So: a false negative shows a book twice, which is the bug we started with and
// which the reader can see and understand. A false positive silently disappears
// a book. Those are not symmetric, and everything below is biased accordingly.
//
// UNION-FIND, NOT A GROUPING KEY
//
// The obvious implementation is a single key per row —
// `coalesce(hardcover_id, isbn, id)` — and it is subtly wrong. Given
//
//   row A  hardcover_id=1  isbn=X
//   row B  hardcover_id=1  isbn=null
//   row C  hardcover_id=null isbn=X
//
// A and B group on the hardcover id, A and C group on the ISBN, but a
// precedence-based key sends A and B to 'hc:1' and C to 'isbn:X', so C is shown
// as a separate book despite sharing an ISBN with A. Transitive grouping needs
// union-find, and over the ten to thirty candidates these surfaces handle it
// costs nothing.

// Explicit .js so this module loads under raw node as well as Vite — same
// reason editionPicker.js imports './isbn.js'. batch-scripts/probes/
// workGroups.probe.mjs runs this file directly, and node ESM does not guess
// extensions. Vite resolves both forms, so nothing changes in the browser.
import { bookKey } from './bookHelpers.js';

// ---------- title variants ----------

// Suffixes that mark an EDITION rather than a different book.
//
// Deliberately an explicit list, and deliberately NOT "everything after the
// first colon". Google Books' own canonicalKey() takes the pre-colon segment,
// which is right for its purpose and catastrophic here: within one author's
// bibliography it would collapse
//
//   "The Expanse: Leviathan Wakes"  and  "The Expanse: Caliban's War"
//
// into a single entry and silently hide one of them. Series titles built as
// "Series: Volume" are common, and this file's whole premise is that hiding a
// book is worse than showing it twice.
//
// So only these come off — phrases that never distinguish two works by the same
// author, only two printings of one. Extend it when a real case appears; do not
// replace it with a generic rule.
const EDITION_NOISE = new RegExp(
  '\\s*[:(\\[-]\\s*(' + [
    'a novel', 'a memoir', 'a novella', 'a story', 'stories',
    'una novela', 'novela', 'roman',
    'illustrated( edition)?', 'deluxe( edition)?', 'collector\'s edition',
    'anniversary edition', 'special edition', 'expanded edition',
    'revised( edition)?', 'unabridged', 'abridged',
    'edicion ilustrada', 'edicion especial',
    'movie tie[- ]?in', 'media tie[- ]?in', 'tv tie[- ]?in',
    'book \\d+', 'libro \\d+',
  ].join('|') + ')\\s*[)\\]]?\\s*$',
  'i'
);

// Title reduced to what identifies the WORK: accents folded, edition noise
// removed, everything non-alphanumeric dropped. Repeated once so
// "…: A Novel (Illustrated)" reduces fully.
function titleVariantKey(t) {
  let s = (t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+\/\s+/)[0]        // "Spanish Title / English Title"
    .trim();
  for (let i = 0; i < 2; i++) s = s.replace(EDITION_NOISE, '').trim();
  return s.replace(/[^a-z0-9]/g, '');
}

// ---------- identity signals ----------

// Each function returns a stable string, or null when the row cannot speak to
// that signal. Two rows sharing any non-null value are the same book.
//
// Deliberately NOT included:
//   title/author  — that is bookKey, and it is what already failed to catch
//                   this: translations differ in exactly that field.
//   pages         — a translation legitimately has a different page count, and
//                   two unrelated 320-page novels are not one book.
//   cover_url     — placeholder covers are shared by many rows.
const SIGNALS = [
  // Hardcover's `books` node is work-level (its `editions` are the edition
  // level), so two rows carrying the same hardcover_id are the same work by
  // Hardcover's own definition — including across languages. This is the
  // strongest signal available and the one that actually catches translations.
  (b) => (b.hardcoverId != null ? `hc:${b.hardcoverId}` : null),

  // Edition-level, so a shared ISBN is a stronger statement than needed: it
  // means the same physical printing, which certainly means the same work.
  // Cheap, exact, and present on most imported rows.
  (b) => {
    const i = (b.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    return i.length === 10 || i.length === 13 ? `isbn:${i}` : null;
  },

  (b) => (b.goodreadsId != null ? `gr:${b.goodreadsId}` : null),

  // Two rows at the same position in the same series are the same book. The
  // series row is resolved by upsert_series and is shared across languages, so
  // this catches translated rows that never reached Hardcover.
  //
  // Both shapes are read because the app has two. bookRowToClient nests series
  // under `s` (with the position as `s.n`), because it selects a joined series
  // row; find_books_by_author returns `setof books`, which has no join, so
  // authorWorks keeps the flat columns. Reading both here is what lets one
  // collapse serve both surfaces.
  //
  // Requires BOTH parts: without the position check, every standalone book in
  // a series-less catalog shares `null` and the whole list collapses to one
  // entry — the false-positive failure this file exists to avoid.
  (b) => {
    const sid = b.seriesId || b.s?.seriesId || null;
    const pos = b.seriesPosition ?? b.s?.n ?? null;
    return sid && pos != null ? `sp:${sid}:${pos}` : null;
  },

  // Same title modulo edition noise, same author. This is the one signal that
  // is not an identifier, and it is kept deliberately narrow: it exists because
  // a catalog row titled "This Is How You Lose the Time War" and a Google Books
  // hit titled "This Is How You Lose the Time War: A Novel" share no id at all
  // — the API result has never been near our catalog — yet are plainly one
  // book.
  //
  // The author half is what keeps it safe in a mixed-author pool ("You might
  // also like" draws from the whole shelf), and it uses the same 10-character
  // truncation as bookKey so the two agree about who wrote what.
  (b) => {
    const t = titleVariantKey(b.t);
    if (!t) return null;
    const a = (b.a || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
    return `tv:${t}|${a}`;
  },
];

function signalsFor(book) {
  const out = [];
  for (const fn of SIGNALS) {
    const v = fn(book);
    if (v) out.push(v);
  }
  return out;
}

// ---------- representative choice ----------

// Which row of a group the reader is shown.
//
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
function scoreCandidate(book, uiLang) {
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

/**
 * Collapse same-work rows, keeping one entry per book.
 *
 * Order is preserved: each group appears at the position of its FIRST member in
 * the input, so a caller that sorted by relevance keeps its ranking and only
 * loses the repeats. The entry shown is the group's best representative, which
 * is not necessarily that first member.
 *
 * @param {Array}  books
 * @param {object} opts
 * @param {string} opts.uiLang   reader's interface language ('en' | 'es')
 * @returns {Array} one entry per distinct work, input order
 */
export function collapseWorks(books, opts = {}) {
  const { uiLang = null } = opts;
  const list = (books || []).filter((b) => b?.t);
  if (list.length < 2) return list;

  // Union-find over indices.
  const parent = list.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    // Lower index wins, so a group's root is always its earliest member and
    // input order is recoverable from the root alone.
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  // Same title AND author is the pre-existing notion of identity and still
  // holds — it is how the same book arrives from two different sources in one
  // list. It is a starting point, not the mechanism: everything interesting
  // here is a book whose title differs.
  const byKey = new Map();
  const bySignal = new Map();

  list.forEach((b, i) => {
    const k = bookKey(b);
    if (byKey.has(k)) union(byKey.get(k), i);
    else byKey.set(k, i);

    for (const sig of signalsFor(b)) {
      if (bySignal.has(sig)) union(bySignal.get(sig), i);
      else bySignal.set(sig, i);
    }
  });

  // Pick each group's representative, emitted at the root's position.
  const best = new Map();      // root → { index, score }
  list.forEach((b, i) => {
    const root = find(i);
    const score = scoreCandidate(b, uiLang);
    const cur = best.get(root);
    // Strict >: ties keep the earlier row, so a list with no distinguishing
    // signal at all comes back in exactly the order it went in.
    if (!cur || score > cur.score) best.set(root, { index: i, score });
  });

  const out = [];
  const emitted = new Set();
  list.forEach((_, i) => {
    const root = find(i);
    if (emitted.has(root)) return;
    emitted.add(root);
    out.push(list[best.get(root).index]);
  });
  return out;
}

/**
 * How many rows `collapseWorks` would remove. Diagnostics only — no caller
 * should branch on this. Useful from the console when checking whether a
 * surface's duplication is the translation problem or something else.
 */
export function duplicateCount(books, opts = {}) {
  const n = (books || []).filter((b) => b?.t).length;
  return n - collapseWorks(books, opts).length;
}
