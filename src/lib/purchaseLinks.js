// Builds purchase URLs for Amazon and Bookshop.org.
//
// v0.56 rewrite. Previously this file always used title+author *search* URLs on the
// theory that ISBN-based links were unreliable. That was the wrong trade once we
// joined both affiliate programs: a search result page makes the reader do the work
// of picking a book, and every extra click between the link and the product page is
// a click where attribution can be lost. Direct product links convert better and
// still carry the affiliate cookie.
//
// Strategy, in order of preference:
//
//   Amazon
//     1. book.amazonUrl (verified product page supplied at import time)
//     2. https://www.amazon.com/dp/<ISBN-10>  — for print books the ASIN *is* the
//        ISBN-10, so this resolves straight to the product page
//     3. title+author search scoped to the Books department
//
//   Bookshop.org
//     1. https://bookshop.org/a/<affiliate-id>/<ISBN-13> — Bookshop's own affiliate
//        deep-link form. It redirects to the product page *and* sets the affiliate
//        cookie in one hop, so the ID is baked into the path rather than a query param.
//     2. title+author search
//
// Every branch carries the affiliate identifier. Configure via env vars:
//   VITE_AMAZON_AFFILIATE_TAG    (e.g. thebooksoracl-20)
//   VITE_BOOKSHOP_AFFILIATE_ID   (e.g. 126628)
// Links still work without them, they just earn nothing.

import { extractAsinFromUrl } from './bookLookup';
import { isbnFromBook, isbn13to10, isbn10to13 } from './isbn';

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

// Remove any pre-existing Amazon tracking tag. Stored amazonUrls come from user
// pastes and may carry someone else's associate tag — which would hand our
// commission to a stranger. Strip first, then apply ours.
function stripAmazonTag(url) {
  return url
    .replace(/([?&])tag=[^&]*/gi, '$1')
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?')
    .replace(/&&+/g, '&');
}

// Build a search query string from title + author. The "(Book)" hint nudges Amazon's
// ranking toward books within the already-restricted Books category, since some
// related merch (study guides, sheet music, audiobook companions) still lives there.
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

  const stored = book.amazonUrl;
  const isbn = isbnFromBook(book);
  // Prefer an ASIN the lookup gave us outright over one derived from the ISBN-10:
  // it's authoritative, and 979- ISBNs have no ISBN-10 form to derive from.
  const asin = book.asin || (isbn ? isbn13to10(isbn) : null);

  // 1. Verified product page from bulk import
  if (stored) {
    url = stripAmazonTag(stored);
    kind = 'product';
  }
  // 2. ISBN-10 doubles as the ASIN for print editions
  else if (asin) {
    url = `https://www.amazon.com/dp/${asin}`;
    kind = 'product';
  }
  // 3. Fall back to a scoped search
  else {
    const q = searchQuery(book);
    if (!q) return null;
    url = `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=stripbooks`;
    kind = 'search';
  }

  if (AMAZON_TAG) url = appendQuery(url, { tag: AMAZON_TAG });

  return {
    url,
    kind,
    label: kind === 'product' ? 'Buy on Amazon' : 'Search on Amazon',
  };
}

// ---------- Bookshop.org ----------

export function bookshopLink(book) {
  if (!book) return null;

  const isbn = isbnFromBook(book);
  const isbn13 = isbn ? isbn10to13(isbn) : null;

  // 1. Affiliate deep link. The ID lives in the path, so there's nothing to append.
  if (isbn13 && BOOKSHOP_ID) {
    return {
      url: `https://bookshop.org/a/${BOOKSHOP_ID}/${isbn13}`,
      kind: 'product',
      label: 'Buy on Bookshop.org',
    };
  }

  // 1b. Same deep link without an affiliate ID configured — still lands on the book.
  if (isbn13) {
    return {
      url: `https://bookshop.org/book/${isbn13}`,
      kind: 'product',
      label: 'Buy on Bookshop.org',
    };
  }

  // 2. No usable ISBN — fall back to search. Note: Bookshop attributes via the /a/
  //    path, so a search URL carries no affiliate credit. This branch earns nothing;
  //    it exists so the link still works. Books hitting it are worth backfilling ISBNs for.
  const q = searchQuery(book);
  if (!q) return null;

  return {
    url: `https://bookshop.org/beta-search?keywords=${encodeURIComponent(q)}`,
    kind: 'search',
    label: 'Search on Bookshop.org',
  };
}

// Convenience: build all purchase options for a book at once.
export function purchaseLinks(book) {
  return [amazonLink(book), bookshopLink(book)].filter(Boolean);
}

// Re-export so callers can extract ASINs without importing bookLookup
export { extractAsinFromUrl };
