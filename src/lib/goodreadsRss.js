// Client wrapper for the Goodreads RSS import.
//
// Companion to goodreadsImport.js (the CSV path). Both produce the same book
// shape — { t, a, rating, dateRead, fromGoodreads, s? } — so both feed
// importGoodreads()/addToWishlist() in DataContext with no branching
// downstream.
//
// v0.59

const ENDPOINT = '/.netlify/functions/goodreads-rss';

// Readers paste whatever is in their address bar. All of these must work:
//   12345678
//   https://www.goodreads.com/review/list/12345678-simon?shelf=read
//   https://www.goodreads.com/user/show/12345678-simon
//   goodreads.com/user/show/12345678
// Returns the numeric ID, or null.
export function extractGoodreadsId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Bare ID.
  if (/^\d{1,12}$/.test(raw)) return raw;

  // A profile or shelf URL. The ID is the digits immediately after the path
  // segment; the trailing "-simon" slug is ignored.
  const m = raw.match(/goodreads\.com\/(?:user\/show|review\/list(?:_rss)?)\/(\d{1,12})/i);
  if (m) return m[1];

  // Last resort: a pasted string containing exactly one plausible ID run.
  const loose = raw.match(/\b(\d{4,12})\b/);
  if (loose) return loose[1];

  return null;
}

// Fetches one shelf. Resolves to { items, count, truncated, error }.
// Never throws — every failure comes back as a string error code the caller
// maps to copy.
async function fetchShelf(goodreadsId, shelf) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goodreadsId, shelf }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return { items: [], count: 0, truncated: false, error: detail.error || 'upstream' };
    }
    const data = await res.json();
    return {
      items: data.items || [],
      count: data.count || 0,
      truncated: !!data.truncated,
      error: data.error || null,
    };
  } catch {
    return { items: [], count: 0, truncated: false, error: 'network' };
  }
}

/**
 * Imports all three shelves for a Goodreads user.
 *
 * Shelves are fetched SEQUENTIALLY, not in parallel. Two reasons: the
 * function throttles its own page loop to stay inside Goodreads' rate limit,
 * and each call can run ~7s worst case — three in parallel from one client
 * would still be three concurrent page loops against the same upstream IP.
 * Sequential also lets the progress UI report a real shelf name.
 *
 * @param {string} goodreadsId  numeric ID (already extracted)
 * @param {(stage: {shelf: string, index: number, total: number}) => void} onProgress
 * @returns {Promise<{read, toRead, currentlyReading, truncated, error}>}
 */
export async function fetchGoodreadsShelves(goodreadsId, onProgress) {
  const shelves = ['read', 'to-read', 'currently-reading'];
  const results = {};
  let truncated = false;

  for (let i = 0; i < shelves.length; i++) {
    const shelf = shelves[i];
    onProgress?.({ shelf, index: i, total: shelves.length });
    const r = await fetchShelf(goodreadsId, shelf);

    // A hard failure on the FIRST shelf is fatal — a private or missing
    // profile fails identically on all three, so there's no point continuing
    // and no point making the reader wait for two more round trips.
    if (i === 0 && r.error) {
      return { read: [], toRead: [], currentlyReading: [], truncated: false, error: r.error };
    }

    // A failure on a LATER shelf is not fatal. The reader's read history is
    // the valuable part; losing their to-read shelf to a transient blip
    // should not discard an import that already succeeded.
    results[shelf] = r.items;
    if (r.truncated) truncated = true;
  }

  // A book can sit on several shelves at once — "read" and "want-to-read"
  // together is common, since Goodreads doesn't clear the old shelf for
  // everyone. Resolve each book to exactly ONE destination, most-specific
  // state first: finished beats in-progress beats intended.
  //
  // Done here rather than only at write time because the caller writes the
  // library and the wishlist in two separate awaits, and React state is not
  // guaranteed to have settled in between.
  const key = (b) => `${b.t.toLowerCase()}|${b.a.toLowerCase()}`;

  const readKeys = new Set((results['read'] || []).map(key));
  const currentlyReading = (results['currently-reading'] || []).filter(
    (b) => !readKeys.has(key(b))
  );
  const currentKeys = new Set(currentlyReading.map(key));
  const toRead = (results['to-read'] || []).filter(
    (b) => !readKeys.has(key(b)) && !currentKeys.has(key(b))
  );

  // Wishlist entries carry no rating or date — strip them so a to-read book
  // can never arrive looking like a finished one.
  const asWishlist = (list) =>
    list.map(({ rating, dateRead, ...rest }) => ({ ...rest, manuallyAdded: true }));

  return {
    read: results['read'] || [],
    toRead: asWishlist(toRead),
    currentlyReading: asWishlist(currentlyReading),
    truncated,
    error: null,
  };
}

// Maps a function error code to an i18n key under onboarding.import.*
export function importErrorKey(code) {
  switch (code) {
    case 'private_or_missing': return 'onboarding.import.private';
    case 'bad_id':             return 'onboarding.import.badId';
    case 'rate_limited':       return 'onboarding.import.rateLimited';
    case 'network':
    case 'upstream':
    default:                   return 'onboarding.import.down';
  }
}
