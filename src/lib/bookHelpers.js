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

export function bookKey(b) {
  return (
    (b.t || '').toLowerCase().replace(/[^a-z0-9]/g, '') +
    '|' +
    (b.a || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  );
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
