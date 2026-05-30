// Builds purchase URLs for Amazon and Bookshop.org based on what data we have
// for a book. Falls back to a search query when we don't have a direct identifier.
//
// Affiliate tags can be configured later via env vars:
//   VITE_AMAZON_AFFILIATE_TAG
//   VITE_BOOKSHOP_AFFILIATE_ID
// Both are optional — links work fine without them.

import { extractAsinFromUrl } from './bookLookup';

const AMAZON_TAG = import.meta.env.VITE_AMAZON_AFFILIATE_TAG || null;
const BOOKSHOP_ID = import.meta.env.VITE_BOOKSHOP_AFFILIATE_ID || null;

function appendQuery(url, params) {
  const sep = url.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${url}${sep}${qs}` : url;
}

// ---------- Amazon ----------

export function amazonLink(book) {
  if (!book) return null;
  let url;
  let kind;

  // 1. If we have a stored Amazon URL (from bulk import), use it
  if (book.amazonUrl) {
    url = book.amazonUrl;
    kind = 'product';
  }
  // 2. ISBN/ASIN gives us a direct /dp/ URL
  else if (book.isbn) {
    // Amazon's /dp/ accepts ISBN-10 directly but not ISBN-13. The 9-digit-plus-check
    // forms are ISBN-10; longer ones are ISBN-13 and need a search query.
    const cleanIsbn = book.isbn.replace(/[-\s]/g, '');
    if (/^\d{9}[\dX]$/i.test(cleanIsbn)) {
      url = `https://www.amazon.com/dp/${cleanIsbn}`;
      kind = 'product';
    } else {
      url = `https://www.amazon.com/s?k=${encodeURIComponent(cleanIsbn)}`;
      kind = 'search';
    }
  }
  // 3. Fall back to a title+author search
  else if (book.t) {
    const q = book.a ? `${book.t} ${book.a}` : book.t;
    url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=stripbooks`;
    kind = 'search';
  } else {
    return null;
  }

  // Add affiliate tag if configured. Don't overwrite an existing tag in a stored URL.
  if (AMAZON_TAG && !url.includes('tag=')) {
    url = appendQuery(url, { tag: AMAZON_TAG });
  }
  return { url, kind, label: kind === 'product' ? 'Buy on Amazon' : 'Search on Amazon' };
}

// ---------- Bookshop.org ----------

export function bookshopLink(book) {
  if (!book) return null;
  let url;
  let kind;

  // Bookshop.org's product pages are /book/<ISBN-13> with no hyphens
  if (book.isbn) {
    const cleanIsbn = book.isbn.replace(/[-\s]/g, '');
    if (/^\d{13}$/.test(cleanIsbn)) {
      url = `https://bookshop.org/book/${cleanIsbn}`;
      kind = 'product';
    } else if (/^\d{9}[\dX]$/i.test(cleanIsbn)) {
      // ISBN-10 — Bookshop doesn't directly accept these, fall back to search
      url = `https://bookshop.org/search?keywords=${encodeURIComponent(cleanIsbn)}`;
      kind = 'search';
    } else {
      url = `https://bookshop.org/search?keywords=${encodeURIComponent(cleanIsbn)}`;
      kind = 'search';
    }
  } else if (book.t) {
    const q = book.a ? `${book.t} ${book.a}` : book.t;
    url = `https://bookshop.org/search?keywords=${encodeURIComponent(q)}`;
    kind = 'search';
  } else {
    return null;
  }

  if (BOOKSHOP_ID && !url.includes('aid=')) {
    url = appendQuery(url, { aid: BOOKSHOP_ID });
  }
  return { url, kind, label: kind === 'product' ? 'Buy on Bookshop.org' : 'Search on Bookshop.org' };
}

// Convenience: build all purchase options for a book at once.
export function purchaseLinks(book) {
  return [amazonLink(book), bookshopLink(book)].filter(Boolean);
}

// Re-export so callers can extract ASINs without importing bookLookup
export { extractAsinFromUrl };
