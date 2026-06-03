// Builds purchase URLs for Amazon and Bookshop.org based on what data we have
// for a book. Always prefers a title+author search over ISBN-based URLs, because:
//
//   - ISBN-13 doesn't resolve on Amazon's /dp/ endpoint (Amazon uses ASINs, not ISBN-13)
//   - ISBN-10 only matches Amazon's ASIN ~70% of the time (newer editions, audiobooks,
//     and Kindle versions have different ASINs)
//   - Bookshop.org's /book/<isbn> endpoint is unreliable for many ISBNs
//   - ISBNs point to one specific edition; a search surfaces all editions and lets
//     Amazon/Bookshop pick the best match for the user's region (helpful for CR users)
//
// The only ISBN-style direct link we trust is book.amazonUrl when present, because
// that was supplied at import time by the user / scraper and points to a verified page.
//
// Affiliate tags can be configured later via env vars:
//   VITE_AMAZON_AFFILIATE_TAG
//   VITE_BOOKSHOP_AFFILIATE_ID
// Both are optional — links work fine without them.

import {
  extractAsinFromUrl
} from './bookLookup';

const AMAZON_TAG =
  import.meta.env.VITE_AMAZON_AFFILIATE_TAG || null;
const BOOKSHOP_ID =
  import.meta.env.VITE_BOOKSHOP_AFFILIATE_ID || null;

function appendQuery(url, params) {
  const sep = url.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${url}${sep}${qs}` : url;
}

// Build a search query string from title + author. The "(Book)" hint nudges Amazon's
// ranking toward books within already-restricted Books category, since some related
// merch (study guides, sheet music, audiobook companions) still lives there.
// For Bookshop, the (Book) keyword is harmless — everything they sell is a book.
function searchQuery(book) {
  const parts = [];
  if (book.t) parts.push(book.t);
  if (book.a) parts.push(book.a);
  if (parts.length === 0) return null;
  parts.push('(Book)');
  return parts.join(' ');
}

// ---------- Amazon ----------

export function amazonLink(book) {
  if (!book) return null;
  let url;
  let kind;

  // 1. If we have a stored Amazon URL (from bulk import), use it — it's a verified product page
  if (book.amazonUrl) {
    url = book.amazonUrl;
    kind = 'product';
  }
  // 2. Otherwise, always go through search with title + author + (Book) hint,
  //    scoped to the Books department via i=stripbooks
  else {
    const q = searchQuery(book);
    if (!q) return null;
    url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=stripbooks`;
    kind = 'search';
  }

  // Add affiliate tag if configured. Don't overwrite an existing tag in a stored URL.
  if (AMAZON_TAG && !url.includes('tag=')) {
    url = appendQuery(url, {
      tag: AMAZON_TAG
    });
  }
  return {
    url,
    kind,
    label: kind === 'product' ? 'Buy on Amazon' : 'Search on Amazon',
  };
}

// ---------- Bookshop.org ----------

export function bookshopLink(book) {
  if (!book) return null;

  // Always use title+author search. Bookshop's direct /book/<isbn> URLs are unreliable
  // and even when they resolve, they point to one specific edition.
  const q = searchQuery(book);
  if (!q) return null;

  let url = `https://bookshop.org/search?keywords=${encodeURIComponent(q)}`;
  if (BOOKSHOP_ID && !url.includes('aid=')) {
    url = appendQuery(url, {
      aid: BOOKSHOP_ID
    });
  }
  return {
    url,
    kind: 'search',
    label: 'Search on Bookshop.org',
  };
}

// Convenience: build all purchase options for a book at once.
export function purchaseLinks(book) {
  return [amazonLink(book), bookshopLink(book)].filter(Boolean);
}

// Re-export so callers can extract ASINs without importing bookLookup
export {
  extractAsinFromUrl
};