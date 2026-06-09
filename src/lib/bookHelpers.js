// Pure helpers around the book catalog. No state, no React.
import {
  BOOKS_DATA
} from './booksData';

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
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    } [c])
  );
}

// ---- Placeholder cover generator data ----
export const PALETTES = [{
    bg: 'linear-gradient(135deg, #2a1810 0%, #5a2a1f 100%)',
    accent: '#d4a574'
  },
  {
    bg: 'linear-gradient(135deg, #1a2818 0%, #3d4a36 100%)',
    accent: '#b08c3f'
  },
  {
    bg: 'linear-gradient(135deg, #1a1a2e 0%, #2d1b3d 100%)',
    accent: '#c9a978'
  },
  {
    bg: 'linear-gradient(135deg, #3d1818 0%, #6b1a1a 100%)',
    accent: '#e8dcc0'
  },
  {
    bg: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)',
    accent: '#b08c3f'
  },
  {
    bg: 'linear-gradient(135deg, #2a1a2a 0%, #4a2a4a 100%)',
    accent: '#d4a574'
  },
  {
    bg: 'linear-gradient(135deg, #1a2a2a 0%, #2a3a3a 100%)',
    accent: '#c9a978'
  },
  {
    bg: 'linear-gradient(135deg, #2a2010 0%, #5a4520 100%)',
    accent: '#e8dcc0'
  },
];
export const ORNAMENTS = ['❦', '✦', '✧', '❧', '☩', '✺', '⚜', '☥', '✠', '❈'];
export const SPINE_COLORS = [
  '#6b1a1a', '#3d4a36', '#2d1b3d', '#4a2a4a', '#2a3a3a',
  '#5a4520', '#3d2418', '#1a3d4a', '#5a2a1f', '#2a1a2a', '#4a3a1a',
];

export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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