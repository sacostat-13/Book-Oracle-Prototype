// Pure helpers around the book catalog. No state, no React.
import { BOOKS_DATA } from './booksData';

// Dedupe by normalized title
const _seen = new Set();
export const ALL_BOOKS = BOOKS_DATA.filter((b) => {
  const k = b.t.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (_seen.has(k)) return false;
  _seen.add(k);
  return true;
});

export const GENRES = [...new Set(ALL_BOOKS.map((b) => b.g))].sort();

// v0.63. What to SHOW when the catalogue has no author.
//
// The counterpart to storableAuthor() in DataContext: that one keeps the
// placeholder out of the database, this one keeps it on the screen. Splitting
// the two is the point — 'Unknown author' is a fine thing to read and a
// terrible thing to store, because author is half of compute_book_key and the
// placeholder silently forks a book into two catalogue rows.
//
// Without this, a null author renders as an empty line in BookCard and, worse,
// interpolates as the literal string "null" in the document title
// (`${book.t} by ${book.a}`) and the share title.
export const UNKNOWN_AUTHOR = 'Unknown author';

// The write-side counterpart. Lives here rather than in DataContext because
// upsert_book has THREE callers across two files (upsertBookOnServer,
// upsertDiscoveredBook, topUpIsbn) and a sanitiser that only one of them uses
// is not a sanitiser. Author is half of compute_book_key; a placeholder stored
// there forks the book.
export const AUTHOR_PLACEHOLDERS = new Set([
  'unknown author',
  'unknown',
  'author unknown',
  'anonymous',
  'n/a',
  '-',
]);

export function storableAuthor(a) {
  const trimmed = (a || '').trim();
  if (!trimmed) return null;
  return AUTHOR_PLACEHOLDERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

export function displayAuthor(b) {
  const a = (b?.a || '').trim();
  return a || UNKNOWN_AUTHOR;
}

// The shareable address of a book: /book/<bookKey>.
//
// v0.63.3 — THIS IS NOW THE ONLY COPY. og-prerender.js and sitemap.js each
// carried their own, and og-prerender's comment recorded that they had already
// drifted once (it assumed 10 characters of author; production was emitting
// 11). Both now take the key precomputed from public.books_share_key, and
// lookups go through find_book_by_client_key — see migration
// 20260813120000_client_book_key_lookup.sql, which is the authority this
// function must agree with.
//
// It survives here because the client has to build a URL from a book already in
// memory, and a round trip to learn its own address would be absurd. If you
// change it, change client_title_key / client_author_key to match, or shared
// links silently start 404ing — the failure is invisible to whoever shares one,
// because their own copy always resolves from their shelf.
//
// Note this is an ADDRESS, not an identity. books.normalized_key is the
// identity, and it is built differently on purpose (spaces kept, accents
// folded, author not truncated).
export function bookKey(b) {
  return (
    (b.t || '').toLowerCase().replace(/[^a-z0-9]/g, '') +
    '|' +
    (b.a || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  );
}

// Pick the genre a book should be filed under when browsing (grouped view).
// Rule (v0.55.3): the book's *most specific* genre — the one with the lowest
// global usage count — so niche shelves (e.g. "Body Horror & Transgressive")
// actually populate instead of every book collapsing into a broad genre like
// "Horror". `genres` are rows from genresByBookId (already carry usageCount).
// Ties break alphabetically for a stable section order. Falls back to the raw
// import genre `b.g`, then the provided `fallback`.
export function getPrimaryGenre(book, genres, fallback = 'Uncategorized') {
  if (genres && genres.length > 0) {
    let primary = genres[0];
    for (const g of genres) {
      const gu = g.usageCount ?? Infinity;
      const pu = primary.usageCount ?? Infinity;
      if (gu < pu || (gu === pu && (g.name || '').localeCompare(primary.name || '') < 0)) {
        primary = g;
      }
    }
    return primary.name;
  }
  return book.g || fallback;
}

export function findBookByTitle(title, wishlist) {
  const norm = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (wishlist) {
    const inWish = wishlist.find(
      (b) => b.t.toLowerCase().replace(/[^a-z0-9]/g, '') === norm
    );
    if (inWish) return inWish;
  }
  return ALL_BOOKS.find(
    (b) => b.t.toLowerCase().replace(/[^a-z0-9]/g, '') === norm
  );
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---- Placeholder cover generator data ----
export const PALETTES = [
  { bg: 'linear-gradient(135deg, #2a1810 0%, #5a2a1f 100%)', accent: '#d4a574' },
  { bg: 'linear-gradient(135deg, #1a2818 0%, #3d4a36 100%)', accent: '#b08c3f' },
  { bg: 'linear-gradient(135deg, #1a1a2e 0%, #2d1b3d 100%)', accent: '#c9a978' },
  { bg: 'linear-gradient(135deg, #3d1818 0%, #6b1a1a 100%)', accent: '#e8dcc0' },
  { bg: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)', accent: '#b08c3f' },
  { bg: 'linear-gradient(135deg, #2a1a2a 0%, #4a2a4a 100%)', accent: '#d4a574' },
  { bg: 'linear-gradient(135deg, #1a2a2a 0%, #2a3a3a 100%)', accent: '#c9a978' },
  { bg: 'linear-gradient(135deg, #2a2010 0%, #5a4520 100%)', accent: '#e8dcc0' },
];
export const ORNAMENTS = ['❦', '✦', '✧', '❧', '☩', '✺', '⚜', '☥', '✠', '❈'];
export const SPINE_COLORS = [
  '#6b1a1a', '#3d4a36', '#2d1b3d', '#4a2a4a', '#2a3a3a',
  '#5a4520', '#3d2418', '#1a3d4a', '#5a2a1f', '#2a1a2a', '#4a3a1a',
];

export function hashStr(s) {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Normalize a title for lookup. Strips parenthetical and bracketed annotations
// (e.g. "(2nd ed)", "[hardcover]") and trailing slash content.
//
// IMPORTANT: do NOT strip subtitles after a colon. Many series (Warhammer,
// Star Wars, military SF, etc.) use the convention "Series Name: Volume Title"
// where the part after the colon is the actual book identifier. Stripping it
// collapses every volume in such series to the same lookup query, which
// returns identical (and wrong) data for every book the user adds.
// See: github.com/sacostat-13/Book-Oracle-Prototype/issues/1
export function cleanTitle(t) {
  return t
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\/.*$/, '')
    .trim();
}

export function cleanAuthor(a) {
  return (a || '').split(/[,&]|\sand\s/i)[0].trim();
}

// Open a book page in a new tab. Use this everywhere instead of go('book-page').
// Encodes a minimal book snapshot in the URL so BookPage can render instantly
// without waiting for DataContext to load from Supabase.
export function openBookTab(book, from = 'app') {
  const k = bookKey(book);
  const lang = document.documentElement.lang || 'en';

  // Snapshot: only the fields BookPage needs to render immediately
  const snapshot = {
    bookId:      book.bookId,
    t:           book.t,
    a:           book.a,
    d:           book.d,
    g:           book.g,
    pp:          book.pp,
    c:           book.c,
    p:           book.p,
    coverUrl:    book.coverUrl,
    source:      book.source,
    s:           book.s ? { name: book.s.name, n: book.s.n, total: book.s.total } : undefined,
  };
  // Strip undefined fields to keep URL short
  Object.keys(snapshot).forEach(k => snapshot[k] === undefined && delete snapshot[k]);

  let snapshotParam = '';
  try {
    snapshotParam = '&snap=' + btoa(encodeURIComponent(JSON.stringify(snapshot)));
  } catch (_) {}

  const url = `${window.location.pathname}?lang=${lang}#book-page?bookKey=${encodeURIComponent(k)}&from=${encodeURIComponent(from)}${snapshotParam}`;
  window.open(url, '_blank', 'noopener');
}

// Build the route params for go('book-page', ...) including a snap payload.
// Use this for in-app series/similar navigation where the target book may not
// be in the user's collection. Without snap, BookPage shows "Not Found" for
// uncollected books, and the back button also stays broken.
export function buildBookPageParams(book, from = 'app', fromLabel = '') {
  const k = bookKey(book);
  const snapshot = {
    bookId:   book.bookId,
    t:        book.t,
    a:        book.a,
    d:        book.d,
    g:        book.g,
    pp:       book.pp,
    c:        book.c,
    p:        book.p,
    coverUrl: book.coverUrl,
    source:   book.source,
    s:        book.s ? { name: book.s.name, n: book.s.n, total: book.s.total } : undefined,
  };
  Object.keys(snapshot).forEach(key => snapshot[key] === undefined && delete snapshot[key]);
  let snap = '';
  try { snap = btoa(encodeURIComponent(JSON.stringify(snapshot))); } catch (_) {}
  const params = { bookKey: k, from, fromLabel };
  if (snap) params.snap = snap;
  return params;
}

// ── Shelf state for a book the viewer is looking at elsewhere (v0.63) ────────
//
// "Have I already read this?" — asked by curated lists, where a reader browsing
// somebody else's shelf wants to know what is genuinely new to them. Returns
// 'library' (read), 'wishlist' (wanted) or null.
//
// Two deliberate constraints, both easy to get wrong:
//
//   1. It answers for the VIEWER, never the list's owner. Showing the curator's
//      read state with the same visual would be answering a different question
//      with the same badge, which is worse than showing nothing.
//   2. It returns null for a signed-out visitor, because there are no shelves
//      to compare against. Callers get that for free by passing empty sets.
//
// Takes prebuilt Sets rather than the arrays: this runs once per book per
// render on a page that may show a hundred, and rebuilding the key set inside
// the loop is the O(n²) shape that made the list book-picker lag.
export function shelfStateOf(book, readKeys, wishKeys) {
  if (!book) return null;
  const k = bookKey(book);
  if (readKeys?.has(k)) return 'library';
  if (wishKeys?.has(k)) return 'wishlist';
  return null;
}

// Convenience for the common call: build both sets from DataContext state.
export function shelfKeySets(state) {
  return {
    readKeys: new Set((state?.library || []).map(bookKey)),
    wishKeys: new Set((state?.wishlist || []).map(bookKey)),
  };
}
