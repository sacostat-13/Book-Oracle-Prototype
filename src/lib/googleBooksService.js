// Google Books lookup — coverage fallback for the bulk-import lookup chain.
//
// The primary chain (Hardcover → OpenLibrary → Wikipedia) is English/US-weighted
// and misses Spanish-language and Latin American titles. Google Books ingests
// publisher metadata feeds worldwide, so it resolves many of these.
//
// IMPORTANT — this is a LAST RESORT only (see bookLookup.lookupByTitle). Google
// Books was historically pulled from the primary chain because its cover
// thumbnails are low quality and inconsistent. We keep that lesson:
//   - the cover is sanitized and treated as low-trust; the merge layer only
//     uses it when nothing else produced a cover.
//   - we only call this when the primary chain returns nothing at all.
//
// Two things this module is careful about, learned from a real miss on
// "Morras Malditas: Apaguemos la luz y entremos a la noche" (Suma / PRH MX):
//   1. Title ORDER is unreliable. In many Spanish titles the part after the
//      colon is the actual title and the part before it is the collective /
//      imprint. We therefore query every segment (and the whole string), not
//      just the pre-colon head.
//   2. Fuzzy matches are dangerous. A free-text query for "Morras Malditas"
//      happily returns "Antes que Morras" — a different book. Every candidate
//      is validated by token overlap against the original query, and rejected
//      if it doesn't share enough distinctive words. Returning null is better
//      than silently polluting the catalog with the wrong book.
//
// Requests go through our Netlify proxy (/.netlify/functions/googlebooks), which
// injects the API key server-side. This is now REQUIRED: Google removed the
// anonymous quota, so keyless calls to the public endpoint return HTTP 429 with
// a per-day limit of 0. See netlify/functions/googlebooks.js for the key setup.

import { cleanTitle, cleanAuthor } from './bookHelpers';

const ENDPOINT = '/.netlify/functions/googlebooks';

// Minimum share of the query's distinctive words a candidate must contain to be
// accepted.
//
// 0.6, not 0.5: a two-word query like "Apaguemos la luz" has only two
// distinctive tokens (apaguemos, luz), and a 0.5 bar was cleared by "No apagues
// la luz" (Bernard Minier) sharing just the common word "luz" — a different
// book. At 0.6 a two-token query effectively needs BOTH distinctive words, so
// the discriminating token ("apaguemos") must be present, while longer queries
// still tolerate one missing word. The real title "Apaguemos la luz y entremos
// a la noche" contains both query tokens (1.0) and is still accepted.
const MATCH_THRESHOLD = 0.6;

// ---------- text helpers ----------

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeForMatch(s) {
  return stripDiacritics((s || '').toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
}

// Words too common (EN + ES) to carry matching signal.
const STOP = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'de', 'del',
  'y', 'o', 'u', 'a', 'en', 'que', 'con', 'por', 'para', 'su', 'sus',
  'the', 'and', 'of', 'to', 'an', 'in', 'on', 'lets', 'let',
]);

function contentTokens(s) {
  return normalizeForMatch(s)
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// Share of the query's distinctive tokens present in the candidate string (0–1).
function matchScore(queryTitle, candidateTitle) {
  const q = contentTokens(queryTitle);
  if (!q.length) return 0;
  const c = new Set(contentTokens(candidateTitle));
  const hits = q.filter((w) => c.has(w)).length;
  return hits / q.length;
}

// Exported so callers (e.g. NavSearch) can judge whether ANOTHER source's hit
// is a real match for the query, using the same accent-insensitive token logic.
// Returns 0–1: the share of the query's distinctive words present in the title.
export function titleMatchScore(queryTitle, candidateTitle) {
  return matchScore(queryTitle, candidateTitle);
}

// Segment-aware match: the best of matching the whole query OR any of its
// colon/dash-separated segments against the candidate. This matters for Spanish
// "Collective: Title" inputs — e.g. a query of "Morras Malditas: Apaguemos la
// luz" should accept the real title "Apaguemos la luz y entremos a la noche"
// (via the segment) even though the full-string match is diluted to 0.5 by the
// "Morras Malditas" prefix. Wrong books like "No apagues la luz" still fail on
// every segment.
export function bestTitleMatch(queryTitle, candidateTitle) {
  let best = matchScore(queryTitle, candidateTitle);
  for (const seg of titleSegments(queryTitle || '')) {
    best = Math.max(best, matchScore(seg, candidateTitle));
    if (best >= 1) break;
  }
  return best;
}

// A canonical key that collapses different EDITIONS of the same work: strip the
// "/ English co-title", subtitle, accents, punctuation and case, then join with
// the first author. Two records that only differ by edition, casing, or an
// appended translated title map to the same key (so we show the book once).
function canonicalKey(book) {
  const mainTitle = (book.t || '')
    .split(/\s+\/\s+/)[0]   // drop "Spanish Title / English Title"
    .split(/\s*:\s+/)[0];   // drop subtitle
  const t = normalizeForMatch(mainTitle).replace(/\s+/g, '');
  const a = normalizeForMatch(book.a || '').replace(/\s+/g, '').slice(0, 12);
  return `${t}|${a}`;
}

// Split a title into its colon / dash-separated segments, longest first — the
// longest segment is the likeliest "real" title in a "Collective: Title" pair.
function titleSegments(title) {
  return title
    .split(/\s*:\s+|\s+[–—-]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

// ---------- cover / normalize ----------

function sanitizeCover(img) {
  if (!img) return null;
  return img
    .replace(/^http:/, 'https:')
    .replace(/&edge=curl/, '')
    .replace(/&zoom=\d/, '&zoom=1');
}

function pickIsbn(ids) {
  if (!Array.isArray(ids)) return null;
  const byType = (t) => ids.find((x) => x.type === t)?.identifier || null;
  return byType('ISBN_13') || byType('ISBN_10') || null;
}

// Full display title as Google Books holds it (title + subtitle), used both for
// the returned record and for match validation.
function displayTitle(vi) {
  return vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title;
}

function normalize(item) {
  const vi = item?.volumeInfo;
  if (!vi || !vi.title) return null;
  return {
    t: displayTitle(vi),
    a: (vi.authors || [])[0] || 'Unknown author',
    d: vi.description || null,
    pp: vi.pageCount || null,
    // Low-trust cover — see file header.
    coverUrl: sanitizeCover(vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail),
    s: null,
    isbn: pickIsbn(vi.industryIdentifiers),
    lang: vi.language || null,
    fromGoogleBooks: true,
  };
}

// ---------- requests ----------

async function runQuery(q, restrict) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, maxResults: 5, langRestrict: restrict || undefined }),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data.items) ? data.items : [];
}

// From a batch of items, return the best one that clears the match threshold
// against `queryTitle`, or null. `wantLang` breaks ties toward the UI language.
function pickValidated(items, queryTitle, wantLang) {
  let best = null;
  let bestScore = 0;
  for (const it of items) {
    const vi = it?.volumeInfo;
    if (!vi?.title) continue;
    const base = bestTitleMatch(queryTitle, displayTitle(vi));
    if (base < MATCH_THRESHOLD) continue;
    let score = base;
    if (wantLang && vi.language === wantLang) score += 0.1; // gentle tiebreak
    if (vi.imageLinks) score += 0.05;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return best;
}

// ---------- public API ----------

// Exact lookup by ISBN — the most reliable path when an ISBN is available.
export async function googleBooksLookupByIsbn(isbn) {
  if (!isbn) return null;
  const clean = String(isbn).replace(/[^0-9Xx]/g, '');
  if (!clean) return null;
  const items = await runQuery(`isbn:${clean}`, null).catch(() => []);
  return items.length ? normalize(items[0]) : null;
}

// Look up a single book by title (+ optional author, + UI language).
// Returns a normalized book object, or null if nothing clears validation.
export async function googleBooksLookup(title, author, lang = 'en') {
  if (!title) return null;
  const full = cleanTitle(title);
  const auth = author ? cleanAuthor(author) : null;
  const segments = titleSegments(full);

  // Build a query ladder that is agnostic to title order. We try the full
  // string and each segment (longest first), both as a phrase-title query and
  // as free text, with the author appended when we have one.
  const phrases = [full, ...segments];
  const seen = new Set();
  const queries = [];
  for (const p of phrases) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (auth) queries.push(`intitle:"${p}" inauthor:"${auth}"`);
    queries.push(`intitle:"${p}"`);
    queries.push(auth ? `${p} ${auth}` : p);
  }

  // In Spanish mode, prefer Spanish editions first, then an unrestricted pass.
  const passes = lang === 'es' ? ['es', null] : [null];

  for (const restrict of passes) {
    for (const q of queries) {
      const items = await runQuery(q, restrict).catch(() => []);
      if (!items.length) continue;
      const hit = pickValidated(items, full, lang);
      if (hit) return normalize(hit);
    }
  }
  return null;
}

// Multiple validated results for the nav-search dropdown. Same order-agnostic,
// accent-insensitive, validated matching as googleBooksLookup — but returns up
// to `limit` distinct books instead of a single best. Returns as soon as one
// query yields any validated hits, so it stays fast (one or two calls) even
// though it's only invoked when Hardcover has no strong match.
export async function googleBooksSearchMulti(query, lang = 'en', limit = 6) {
  if (!query || query.trim().length < 2) return [];
  const full = cleanTitle(query.trim());
  const segments = titleSegments(full);

  const phrases = [full, ...segments];
  const seen = new Set();
  const queries = [];
  for (const p of phrases) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    queries.push(`intitle:"${p}"`);
    queries.push(p);
  }

  const passes = lang === 'es' ? ['es', null] : [null];

  for (const restrict of passes) {
    for (const q of queries) {
      const items = await runQuery(q, restrict).catch(() => []);
      if (!items.length) continue;
      const collected = new Map(); // dedupe by canonical work (not by edition)
      for (const it of items) {
        const vi = it?.volumeInfo;
        if (!vi?.title) continue;
        if (bestTitleMatch(full, displayTitle(vi)) < MATCH_THRESHOLD) continue;
        const norm = normalize(it);
        if (!norm) continue;
        const key = canonicalKey(norm);
        const existing = collected.get(key);
        // First edition wins, but prefer one that actually has a cover.
        if (!existing) {
          collected.set(key, norm);
        } else if (!existing.coverUrl && norm.coverUrl) {
          collected.set(key, norm);
        }
        if (collected.size >= limit) break;
      }
      if (collected.size) return [...collected.values()];
    }
  }
  return [];
}
