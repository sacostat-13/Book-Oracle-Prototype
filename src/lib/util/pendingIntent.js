// src/lib/util/pendingIntent.js
//
// What a signed-out visitor was trying to do when we asked them to sign up —
// "save this book", "start this series" — kept until they have an account, so
// IntentResumer can finish it for them and bring them back to the page they
// were on instead of dropping them on an empty dashboard.
//
// localStorage, not sessionStorage: a magic link or an email confirmation opens
// in a NEW tab, and the intent has to survive that. Short-lived (2 h) and
// cleared the moment it is used, so a stale "save this book" never fires on a
// later, unrelated sign-in.
//
// Only catalogue data is stored (title, author, cover, ids) — nothing about
// the person.

const KEY = 'tbo_intent';
export const INTENT_TTL_MS = 2 * 3600e3;

const BOOK_FIELDS = ['t', 'a', 'coverUrl', 'isbn', 'bookId', 'g', 'pp', 'lang'];
const ROUTES = new Set(['book-page', 'series-page']);
const TYPES = new Set(['wishlist']);

/** The fields of a book worth carrying through sign-up. */
export function slimBook(book) {
  if (!book?.t) return null;
  const out = {};
  for (const k of BOOK_FIELDS) {
    if (book[k] !== undefined && book[k] !== null && book[k] !== '') out[k] = book[k];
  }
  return out;
}

/**
 * Shape check. Returns the intent, or null when it is malformed, expired or
 * names a route the resumer does not handle.
 * @param {any} intent
 * @param {number} [now]
 */
export function validIntent(intent, now = Date.now()) {
  if (!intent || typeof intent !== 'object') return null;
  if (!TYPES.has(intent.type)) return null;
  if (!intent.at || now - intent.at > INTENT_TTL_MS || intent.at > now + 60e3) return null;
  if (intent.type === 'wishlist' && !intent.book?.t) return null;
  if (intent.route && (!ROUTES.has(intent.route.name) || typeof intent.route.params !== 'object')) return null;
  return intent;
}

/**
 * @param {{ type: 'wishlist', book: object, route?: { name: string, params: object } }} intent
 */
export function saveIntent(intent) {
  const record = { ...intent, book: slimBook(intent.book), at: Date.now() };
  if (!validIntent(record)) return;
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { /* private mode: nothing to resume */ }
}

export function readIntent() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const intent = validIntent(JSON.parse(raw));
    if (!intent) localStorage.removeItem(KEY);
    return intent;
  } catch { return null; }
}

export function clearIntent() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function hasPendingIntent() {
  return !!readIntent();
}
