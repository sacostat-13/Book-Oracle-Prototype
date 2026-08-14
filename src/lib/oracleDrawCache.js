// src/lib/oracleDrawCache.js — v0.63.3
//
// Keeps the last Oracle result set alive across a reload or a trip to a book
// page.
//
// Why this exists: a draw cost the reader one of five monthly calls, and it
// lived in a `useState` that any of the following threw away —
//   - tapping a result to read more about it, then coming back;
//   - the browser discarding a backgrounded tab to reclaim memory;
//   - a service-worker update reloading the page (see vite.config.js);
//   - an accidental refresh.
// In every one of those the reader sees an empty grid and reasonably concludes
// the call was wasted. It wasn't — the recommendations were logged to
// oracle_recommendations — but nothing was reading them back.
//
// sessionStorage rather than localStorage on purpose. The scope we want is
// "this tab, until it is closed": it survives reload and back-navigation, which
// is the whole complaint, and it does NOT leak one tab's draw into another or
// hand yesterday's suggestions to someone opening the app fresh. A draw is a
// moment, not a saved artifact — Read Next is where a book goes if it mattered.
//
// Deliberately not the database. oracle_recommendations stores title, author
// and reason, not the genre/complexity/depth/match a card renders, and turning
// a provenance log into a UI cache would make the impression data answerable to
// rendering needs. Session-scoped restore is the smaller, more honest fix.

const PREFIX = 'oracle:draw:';
const VERSION = 1;

// An hour. Long enough that stepping away for lunch still finds the draw
// waiting, short enough that a tab left open overnight doesn't greet the reader
// with recommendations made against a shelf they have since changed.
const TTL_MS = 60 * 60 * 1000;

function key(surface) {
  return `${PREFIX}${surface}`;
}

/**
 * @param {string} surface  'categories' | 'ask' | 'similar'
 * @param {object} payload  whatever the view needs to re-render its results
 */
export function saveDraw(surface, payload) {
  try {
    sessionStorage.setItem(
      key(surface),
      JSON.stringify({ v: VERSION, at: Date.now(), payload })
    );
  } catch {
    // Quota exceeded, Safari private mode, storage disabled — a draw that
    // cannot be cached is not an error the reader should ever hear about.
  }
}

/**
 * Returns the cached payload, or null if there is none, it has expired, or it
 * was written by an older shape of this module.
 */
export function loadDraw(surface) {
  try {
    const raw = sessionStorage.getItem(key(surface));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== VERSION) return null;
    if (!parsed.at || Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(key(surface));
      return null;
    }
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

export function clearDraw(surface) {
  try {
    sessionStorage.removeItem(key(surface));
  } catch {
    // see saveDraw
  }
}
