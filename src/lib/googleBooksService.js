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

// Explicit .js so this module loads under raw node as well as Vite, matching
// editionPicker.js/isbn.js. batch-scripts/probes/googleBooksByAuthor.probe.mjs
// imports this file directly to check the language passes without a network.
import { cleanTitle, cleanAuthor } from './bookHelpers.js';

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
    // v0.64: the FULL credit list, not just the first name.
    //
    // `a` keeps its old meaning (one author, for display) because everything
    // downstream expects a string. But taking authors[0] and discarding the
    // rest loses a real distinction on co-authored books: Google Books returns
    // *This Is How You Lose the Time War* with Max Gladstone first on some
    // editions and Amal El-Mohtar first on others. An author section that
    // matches on authors[0] therefore drops the book from half its editions and
    // files the other half under a name the reader did not click on.
    authors: Array.isArray(vi.authors) ? vi.authors.filter(Boolean) : [],
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

// `maxResults` defaults to 5 — what every title lookup in this file wants,
// since those queries validate hard against one known title and a longer list
// is just more to discard. The author query (googleBooksByAuthor) is the one
// caller that genuinely wants breadth, so it passes its own. The proxy clamps
// to 20 regardless (netlify/functions/googlebooks.js).
async function runQuery(q, restrict, maxResults = 5) {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, maxResults, langRestrict: restrict || undefined }),
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

// ---------- by author ----------

// Everything Google Books holds for one writer, deduped to one entry per work.
//
// Used by authorWorks.js to top up the "More by this author" section when our
// own catalog holds too few of an author's books to make a strip. See that
// file for why this source and not Hardcover.
//
// Three things are worth knowing about `inauthor:`:
//
//   1. It is a match, not an identity. It returns anthologies the person
//      contributed to, books ABOUT them, and occasionally a different writer
//      with a similar name. This function does not try to fix that — the
//      caller compares author keys, which is the same comparison the SQL side
//      uses, so there is one rule about who counts as the same person rather
//      than two.
//   2. The result set is edition-shaped: one novel comes back as the
//      hardback, the paperback, the film tie-in and the Spanish translation,
//      all as separate volumes. canonicalKey() already collapses exactly this
//      (it is what makes the nav-search dropdown show a book once), so it is
//      reused here rather than reinvented.
//   3. Ordering is relevance, which for an author query puts the
//      best-known books first. That is the right order for this section: a
//      reader looking for "what else did she write" wants the famous one, not
//      the alphabetically first.
//
// LANGUAGE PASSES ARE ALTERNATIVES, NEVER MERGED — AND NEVER UNRESTRICTED
// WHEN A LANGUAGE IS KNOWN.
//
// This is the one that actually broke in testing, so it is worth being precise
// about. `canonicalKey` collapses different EDITIONS of a work, and it does that
// on the title — so two English printings of *This Is How You Lose the Time
// War* collapse, while *Tak prohraješ časovou válku* does not collapse with
// either, because they share no characters at all.
//
// The first version of this function ran a single UNRESTRICTED pass for English
// readers. `inauthor:"Amal El-Mohtar"` with no langRestrict returns every
// edition Google holds in every language, so the section filled up with Czech,
// German and Spanish translations of the two novels it was trying to show. The
// author had only two works; the strip had eight covers.
//
// So: the anchor language is ALWAYS applied when we have one, each pass is an
// alternative rather than an accumulation, and the FIRST pass that yields
// anything is returned whole. The result set is always exactly one language.
//
// The unrestricted pass survives only as a last resort, for the case where an
// author genuinely has nothing catalogued in the anchor language — where the
// choice is between a foreign-language edition and an empty section.
export async function googleBooksByAuthor(author, opts = {}) {
  const { lang = 'en', limit = 12 } = opts;
  const name = (author || '').trim();
  if (name.length < 2) return [];

  const want = Math.min(Math.max(limit, 1), 20);

  // Quoted first: it is the precise form, and unquoted `inauthor:` treats the
  // words as separate terms, which turns "Ann Patchett" into anything by an
  // Ann or a Patchett. The bare form only runs if the quoted one found nothing.
  const queries = [`inauthor:"${name}"`, `inauthor:${name}`];
  const passes = lang ? [lang, null] : [null];

  // Collapsing key for "is this the same person", matching authorKey() in
  // authorWorks.js and client_author_key() in SQL: strip everything that is not
  // alphanumeric, do not unaccent.
  const akey = (a) => (a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = akey(name);

  for (const restrict of passes) {
    const collected = new Map(); // canonical work key → normalized book
    for (const q of queries) {
      const items = await runQuery(q, restrict, want).catch(() => []);
      for (const it of items) {
        const norm = normalize(it);
        if (!norm) continue;

        // Credit the author whose bibliography this is, whenever they are on
        // the book at all.
        //
        // canonicalKey() is title + FIRST author, and Google orders the credits
        // differently per edition: *This Is How You Lose the Time War* comes
        // back with Amal El-Mohtar first on one printing and Max Gladstone
        // first on the next. Two editions of one co-written novel therefore
        // produced two different canonical keys and survived as two entries —
        // which is precisely what the section was reported showing.
        //
        // Rewriting `a` before the key is computed fixes it at the source, so
        // every caller benefits rather than each one re-deriving it.
        if (wanted && norm.authors?.some((c) => akey(c) === wanted)) norm.a = name;

        // FILTER THE RESPONSE, DO NOT TRUST THE REQUEST.
        //
        // langRestrict is a hint Google honours inconsistently for `inauthor:`
        // queries — sometimes it returns nothing at all, sometimes it returns
        // other languages anyway. Both failures were visible in testing as the
        // section flipping between English-only and German/Czech/Spanish on
        // consecutive reloads of the same page, which is the signature of a
        // filter that is applied upstream and nowhere else.
        //
        // Every volume carries volumeInfo.language, so the language of a result
        // is a fact we hold rather than a promise the API made. Checking it here
        // makes the outcome identical whether langRestrict worked, was ignored,
        // or the unrestricted fallback pass ran.
        //
        // A volume with no declared language is kept: absent metadata should
        // not silently empty the section.
        if (lang && norm.lang && norm.lang !== lang) continue;

        const key = canonicalKey(norm);
        const existing = collected.get(key);
        // First edition seen wins, unless a later one actually has a cover —
        // this renders as a strip of covers, so a coverless winner is a hole
        // in the row.
        if (!existing) collected.set(key, norm);
        else if (!existing.coverUrl && norm.coverUrl) collected.set(key, norm);
      }
      if (collected.size >= want) break;
    }
    // Note this returns from inside the pass loop, so a later pass only ever
    // runs when the one before it found nothing at all. Moving this outside the
    // loop, or seeding `collected` above it, reintroduces the merge.
    //
    // The unrestricted fallback is now safe rather than a liability: results are
    // language-filtered above regardless of which pass produced them, so the
    // fallback widens the SEARCH without widening the ANSWER.
    if (collected.size > 0) return [...collected.values()].slice(0, want);
  }

  return [];
}
