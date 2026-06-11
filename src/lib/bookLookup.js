// Book lookup helpers for bulk import.
//
// Lookup chain (per book), v0.10:
//   1. PRH        (best for Spanish/LatAm titles, ISBN lookups)
//   2. Hardcover  (best metadata + structured series, anglo-fiction skew)
//   3. OpenLibrary (broadest coverage, no auth, no rate limit)
//   4. Wikipedia  (best descriptions, esp. when others are sparse — v0.10)
//
// All four fire in parallel via Promise.all. Merge is null-fill (first
// non-null source wins) for most fields, with ONE special case:
//
//   description (`d`): Wikipedia wins when other sources are null OR very
//   short (< 200 chars). Wikipedia's lede paragraphs are usually richer
//   than Hardcover/OL/PRH blurbs, which is the main reason we pull it.
//
// If ALL sources miss, we still return a "raw" book object built from the
// user's input, marked `needsReview=true` so it can be flagged for review.
// At the upsert site this maps to status='incomplete' on the books row.
// This means users never lose books they typed in.

import { cleanTitle, cleanAuthor } from './bookHelpers';
import {
  hardcoverLookupByIsbn,
  hardcoverLookupByAsin,
  hardcoverSearch,
} from './hardcoverService';
import { prhLookupByIsbn, prhSearch } from './prhService';
import { wikipediaLookup } from './wikipediaService';

// What counts as a "rich enough" description that we won't let Wikipedia
// overwrite it. Set low enough that one-paragraph blurbs still win, high
// enough that a 4-word stub gets replaced.
const RICH_DESCRIPTION_MIN_CHARS = 200;

// Merge book records. `primary` is the higher-priority source; `secondary`
// fills in nulls. Both can be null/undefined.
function mergeBookData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  // Start with secondary as base, overlay primary on top, but for fields where
  // primary is null/undefined, keep secondary's value.
  const out = { ...secondary };
  for (const key of Object.keys(primary)) {
    if (primary[key] !== null && primary[key] !== undefined) {
      out[key] = primary[key];
    }
  }
  // Combine source attribution tags so we know what was consulted.
  out.fromHardcover = primary.fromHardcover || secondary.fromHardcover || false;
  out.fromOpenLibrary = primary.fromOpenLibrary || secondary.fromOpenLibrary || false;
  out.fromPrh = primary.fromPrh || secondary.fromPrh || false;
  out.fromWikipedia = primary.fromWikipedia || secondary.fromWikipedia || false;
  return out;
}

// Merge three sources in priority order: a > b > c.
function mergeThree(a, b, c) {
  return mergeBookData(a, mergeBookData(b, c));
}

// v0.10: merge four sources. The first three follow standard priority
// (a > b > c). Wikipedia (`wiki`) is special-cased: it fills nulls
// like any other source, BUT also wins on `description` when the merged
// description from the first three is null or too short to be useful.
function mergeFour(a, b, c, wiki) {
  const baseMerge = mergeThree(a, b, c);
  if (!wiki) return baseMerge;
  if (!baseMerge) {
    // Only Wikipedia hit. That's fine for description, but we want to
    // be careful: Wikipedia alone shouldn't be the entire record because
    // it doesn't provide author, pages, ISBN reliably. Return what we
    // have so the caller can decide.
    return wiki;
  }

  const merged = mergeBookData(baseMerge, wiki);

  // Description override: prefer Wikipedia if the existing description
  // is missing or too short. This is the main reason we added Wikipedia.
  if (wiki.d) {
    const existing = baseMerge.d;
    if (!existing || existing.trim().length < RICH_DESCRIPTION_MIN_CHARS) {
      merged.d = wiki.d;
      merged.descriptionSource = 'wikipedia';
    } else {
      // Existing description is rich enough — keep it.
      merged.d = existing;
    }
  }

  // Preserve Wikipedia's specific fields regardless of overall merge order
  // — these are unique to it and useful in BookModal (v0.11).
  if (wiki.wikipediaUrl) merged.wikipediaUrl = wiki.wikipediaUrl;
  if (wiki.wikipediaLang) merged.wikipediaLang = wiki.wikipediaLang;
  if (wiki.descriptionShort) merged.descriptionShort = wiki.descriptionShort;

  // Wikipedia's thumbnail is low-quality — only use it if NOTHING else
  // produced a cover.
  if (!baseMerge.coverUrl && wiki.coverUrl) {
    merged.coverUrl = wiki.coverUrl;
  } else if (baseMerge.coverUrl) {
    merged.coverUrl = baseMerge.coverUrl;
  }

  return merged;
}

// ---------- Amazon URL parsing ----------

const ASIN_REGEX = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function extractAsinFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(ASIN_REGEX);
  return m ? m[1].toUpperCase() : null;
}

// ---------- Lookup chain ----------

// Read the current i18n language from localStorage so we can hit
// es.wikipedia first for Spanish-mode users without threading the lang
// through every caller. The I18nContext writes this key on every change.
//
// We do this lazily inside the lookup functions rather than importing
// the I18n context — that keeps bookLookup.js a pure utility module
// that can be called from anywhere (including non-React code paths
// like importGoodreads).
function currentLang() {
  try {
    const stored = localStorage.getItem('book_oracle_lang');
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    // localStorage might not be available (SSR, private mode, etc.)
  }
  return 'en';
}

// Look up by ASIN (Amazon URL identifier). Tries PRH + Hardcover + OL + Wikipedia.
// `amazonUrl` is preserved on the result so "View on Amazon" keeps working.
//
// Wikipedia for ASIN-only lookups isn't great — we don't know the title yet,
// only the identifier. So for ASIN, Wikipedia only joins the party AFTER one
// of the other sources resolved a title to use as its query.
export async function lookupByAsin(asin, amazonUrl) {
  if (!asin) return null;
  const isbnLike = /^\d{9}[\dX]$/i.test(asin);

  // Run the original three in parallel — they don't depend on each other.
  const [prh, hc, ol] = await Promise.all([
    isbnLike ? prhLookupByIsbn(asin).catch(() => null) : Promise.resolve(null),
    hardcoverLookupByAsin(asin).catch(() => null),
    _lookupByAsinOL(asin).catch(() => null),
  ]);

  // Now do a Wikipedia lookup using the best title we got from above,
  // if any. Skip Wikipedia entirely if nothing resolved a title — there's
  // nothing useful to query.
  const resolvedTitle = hc?.t || prh?.t || ol?.t;
  const resolvedAuthor = hc?.a || prh?.a || ol?.a;
  const wiki = resolvedTitle
    ? await wikipediaLookup(resolvedTitle, resolvedAuthor, currentLang()).catch(() => null)
    : null;

  const merged = mergeFour(hc, prh, ol, wiki);
  if (!merged) return null;

  merged.amazonUrl = amazonUrl || null;
  merged.manuallyAdded = true;
  return merged;
}

// Look up by title (+ optional author). Used for the title-list paste flow.
//
// All four sources fire in parallel here since we already have a title to
// query Wikipedia with.
export async function lookupByTitle(title, author) {
  if (!title) return null;

  const [prh, hc, ol, wiki] = await Promise.all([
    prhSearch(title, author).catch(() => null),
    hardcoverSearch(title, author).catch(() => null),
    _lookupByTitleOL(title, author).catch(() => null),
    wikipediaLookup(title, author, currentLang()).catch(() => null),
  ]);

  // Priority order: Hardcover > PRH > OL > Wikipedia, with the description
  // override rule from mergeFour. PRH wins on Spanish/LatAm when it's the
  // only one with a hit (null-fill semantics).
  const merged = mergeFour(hc, prh, ol, wiki);
  if (!merged) {
    // ALL sources missed. Don't lose the user's input — return a raw record
    // marked as needing review so it surfaces in the editor queue. At the
    // upsert site this maps to status='incomplete' on the books row.
    return {
      t: title.trim(),
      a: (author || '').trim() || null,
      g: null,
      d: null,
      pp: null,
      coverUrl: null,
      s: null,
      isbn: null,
      manuallyAdded: true,
      needsReview: true, // v0.15: was `unverified: true`. Maps to status='incomplete' on insert.
      noApiMatch: true, // useful for telemetry / debug
    };
  }
  merged.manuallyAdded = true;
  return merged;
}

// ---------- OpenLibrary implementations (fallback) ----------

async function _lookupByAsinOL(asin) {
  try {
    const isbnLike = /^\d{9}[\dX]$/i.test(asin);
    if (isbnLike) {
      const r = await fetch(`https://openlibrary.org/isbn/${asin}.json`);
      if (r.ok) {
        const d = await r.json();
        const authors = d.authors
          ? await fetchAuthorNames(d.authors.map((a) => a.key))
          : [];
        return {
          t: d.title || 'Unknown title',
          a: authors[0] || 'Unknown author',
          d: typeof d.description === 'string' ? d.description : d.description?.value || null,
          pp: d.number_of_pages || null,
          fromOpenLibrary: true,
          manuallyAdded: true,
        };
      }
    }

    const r = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(asin)}&limit=1&fields=title,author_name,subject,number_of_pages_median,first_publish_year`
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.docs || d.docs.length === 0) return null;
    const doc = d.docs[0];
    return {
      t: doc.title || 'Unknown title',
      a: (doc.author_name || [])[0] || 'Unknown author',
      g: pickGenreFromSubjects(doc.subject),
      pp: doc.number_of_pages_median || null,
      fromOpenLibrary: true,
      manuallyAdded: true,
    };
  } catch {
    return null;
  }
}

async function fetchAuthorNames(keys) {
  try {
    const names = await Promise.all(
      keys.map(async (k) => {
        const r = await fetch(`https://openlibrary.org${k}.json`);
        if (!r.ok) return null;
        const d = await r.json();
        return d.name || null;
      })
    );
    return names.filter(Boolean);
  } catch {
    return [];
  }
}

async function _lookupByTitleOL(title, author) {
  try {
    let q = `title=${encodeURIComponent(cleanTitle(title))}`;
    if (author) q += `&author=${encodeURIComponent(cleanAuthor(author))}`;
    q += '&limit=3&fields=title,author_name,subject,number_of_pages_median,first_publish_year';
    const r = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.docs || d.docs.length === 0) return null;

    const target = cleanTitle(title).toLowerCase();
    const best =
      d.docs.find((x) => x.title?.toLowerCase().includes(target)) || d.docs[0];

    return {
      t: best.title,
      a: (best.author_name || [])[0] || author || 'Unknown author',
      g: pickGenreFromSubjects(best.subject),
      pp: best.number_of_pages_median || null,
      fromOpenLibrary: true,
      manuallyAdded: true,
    };
  } catch {
    return null;
  }
}

// ---------- Genre helper ----------

const GENRE_KEYWORDS = [
  ['Horror', /horror|gothic|ghost|haunt/i],
  ['Fantasy', /fantasy|magic|wizard|dragon/i],
  ['Science Fiction', /science fiction|sci-fi|cyberpunk|dystop/i],
  ['Mystery', /mystery|detective|crime|thriller/i],
  ['Romance', /romance|love stor/i],
  ['Literary Fiction', /literary|literature|fiction/i],
  ['Memoir', /memoir|autobiograph/i],
  ['Biography', /biograph/i],
  ['Nonfiction', /history|politics|essays|nonfiction|non-fiction/i],
  ['Poetry', /poetry|poems/i],
  ['Young Adult', /young adult/i],
  ['Graphic Novel', /graphic novel|comic/i],
];

function pickGenreFromSubjects(subjects) {
  if (!subjects || !Array.isArray(subjects)) return null;
  const joined = subjects.slice(0, 30).join(' ');
  for (const [label, rx] of GENRE_KEYWORDS) {
    if (rx.test(joined)) return label;
  }
  return null;
}

// ---------- Title list parser ----------
// Accepts free-form lines and tries to split "Title — Author", "Title - Author",
// "Title by Author". Falls back to the whole line as title.
export function parseTitleList(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  return lines.map((line) => {
    const sep = line.match(/^(.+?)\s+(?:—|–|-|by)\s+(.+)$/i);
    if (sep) {
      return { t: sep[1].trim(), a: sep[2].trim(), raw: line };
    }
    return { t: line, a: null, raw: line };
  });
}
