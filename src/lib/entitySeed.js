// entitySeed.js — the record og-prerender.js already resolved, handed to the SPA.
//
// 2026-10-07. Search Console filed 866 unrelated book and genre pages as
// "Duplicate, Google chose different canonical". Its crawled HTML for one of
// them (/book/bemyalibi%7C) showed why: React had replaced the prerendered body
// with BookPage's "Book not found" view, under the placeholder title
// "Book — The Books Oracle". The client-side lookup had failed or not answered
// inside Google's renderer, and every page where that happened rendered
// byte-identical, so Google collapsed them into one.
//
// The edge function already holds the row for that request. It now writes it
// into <head> as <script type="application/json" id="__ENTITY__">, where React
// never touches it, and the views read it here synchronously: the first render
// is the real page, with no request in between.
//
// Only crawlers get a seed today (og-prerender.js passes humans straight
// through). Nothing here may assume one exists; every caller falls back to the
// lookup it always did.

function normalizeKey(k) {
  if (typeof k !== 'string') return '';
  try { return decodeURIComponent(k); } catch { return k; }
}

let cached; // undefined = not read yet; null = no seed on this page

function readRaw() {
  if (cached !== undefined) return cached;
  cached = null;
  if (typeof document === 'undefined') return cached;
  const el = document.getElementById('__ENTITY__');
  if (!el) return cached;
  try {
    const parsed = JSON.parse(el.textContent || 'null');
    if (parsed && typeof parsed === 'object' && parsed.kind && parsed.row) cached = parsed;
  } catch (err) {
    console.warn('[entitySeed] unreadable seed', err?.message || err);
  }
  return cached;
}

/**
 * The seed for this page, if the edge function left one AND it is for the
 * entity being rendered. The key check matters: the seed describes the URL the
 * page was loaded at, and an in-app navigation to another book must not render
 * the first one's data.
 *
 * @param {'book'|'genre'} kind
 * @param {string} key  the route param (bookKey / genreSlug), raw or decoded
 */
export function readEntitySeed(kind, key) {
  const seed = readRaw();
  if (!seed || seed.kind !== kind || !key) return null;
  return normalizeKey(seed.key) === normalizeKey(key) ? seed : null;
}
