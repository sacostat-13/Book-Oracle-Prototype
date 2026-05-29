// Book lookup helpers for bulk import.
//
// Lookup chain: Hardcover (best metadata + series) → OpenLibrary (broader
// coverage, no auth). Hardcover requires our Netlify Function proxy; if
// `netlify dev` isn't running locally the proxy 404s and we fall through
// to OL gracefully.

import { cleanTitle, cleanAuthor } from './bookHelpers';
import {
  hardcoverLookupByIsbn,
  hardcoverLookupByAsin,
  hardcoverSearch,
} from './hardcoverService';

// Merge two book records, preferring `primary` for every populated field but
// borrowing from `secondary` for anything `primary` left null.
function mergeBookData(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const out = { ...secondary, ...primary };
  // Only borrow fields that are actually missing on primary
  for (const key of ['d', 'pp', 'g', 'coverUrl', 's', 'isbn']) {
    if (primary[key] == null && secondary[key] != null) out[key] = secondary[key];
  }
  return out;
}

// ---------- Amazon URL parsing ----------

// Matches the ASIN/ISBN in any Amazon URL we've seen in the wild:
//   amazon.com/dp/B07XYZ12345
//   amazon.com/Title-Of-Book/dp/B07XYZ12345
//   amazon.com/gp/product/B07XYZ12345/ref=...
//   amzn.to/abc123  ← short link, can't resolve client-side, returns null
//   smile.amazon.com/.../dp/...
const ASIN_REGEX = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function extractAsinFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(ASIN_REGEX);
  return m ? m[1].toUpperCase() : null;
}

// ---------- OpenLibrary lookup (fallback) ----------

// Look up a book by ASIN (which OL treats as ISBN-10 in many cases) or ISBN.
// Returns { t, a, g?, d?, pp?, amazonUrl } or null.
export async function lookupByAsin(asin, amazonUrl) {
  if (!asin) return null;

  // Try Hardcover first
  const hc = await hardcoverLookupByAsin(asin);
  if (hc) {
    hc.amazonUrl = amazonUrl || null;
    hc.manuallyAdded = true;
    // If Hardcover gave us complete data, return it. Otherwise also hit OL.
    if (hc.t && hc.a && hc.pp) return hc;
    const ol = await _lookupByAsinOL(asin, amazonUrl);
    return mergeBookData(hc, ol);
  }

  // Fall back to OpenLibrary
  return _lookupByAsinOL(asin, amazonUrl);
}

async function _lookupByAsinOL(asin, amazonUrl) {
  try {
    // Try ISBN endpoint first (works for ASIN when it's actually a valid ISBN-10)
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
          amazonUrl: amazonUrl || null,
          fromOpenLibrary: true,
          manuallyAdded: true,
        };
      }
    }

    // Fallback: search by ASIN as a generic identifier
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
      amazonUrl: amazonUrl || null,
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

// Look up a book by title (+ optional author). Used for the title-list paste flow.
// Returns { t, a, g?, d?, pp? } or null.
export async function lookupByTitle(title, author) {
  if (!title) return null;

  // Try Hardcover first
  const hc = await hardcoverSearch(title, author);
  if (hc && hc.t) {
    hc.manuallyAdded = true;
    if (hc.a && hc.pp) return hc;
    // Hit OL too for missing fields (e.g. genre, page count)
    const ol = await _lookupByTitleOL(title, author);
    return mergeBookData(hc, ol);
  }

  return _lookupByTitleOL(title, author);
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

    // Prefer a doc whose title roughly matches the cleaned input
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

// OpenLibrary returns a long list of LCSH/BISAC-style subjects. Pull the first
// recognizable high-level genre from it so the book lands in a sensible bucket.
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
    // Try em-dash, en-dash, " - ", " — ", " by "
    const sep = line.match(/^(.+?)\s+(?:—|–|-|by)\s+(.+)$/i);
    if (sep) {
      return { t: sep[1].trim(), a: sep[2].trim(), raw: line };
    }
    return { t: line, a: null, raw: line };
  });
}
