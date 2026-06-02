// Book lookup helpers for bulk import.
//
// Lookup chain (per book):
//   1. PRH (best for Spanish/LatAm titles, ISBN lookups)
//   2. Hardcover (best metadata + structured series, anglo-fiction skew)
//   3. OpenLibrary (broadest coverage, no auth, no rate limit)
// Results are merged — first source wins for each field, others fill nulls.
//
// If ALL sources miss, we still return a "raw" book object built from the
// user's input, marked `unverified=true` so it can be flagged for review.
// This means users never lose books they typed in.

import { cleanTitle, cleanAuthor } from './bookHelpers';
import {
  hardcoverLookupByIsbn,
  hardcoverLookupByAsin,
  hardcoverSearch,
} from './hardcoverService';
import { prhLookupByIsbn, prhSearch } from './prhService';

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
  return out;
}

// Merge three sources in priority order: a > b > c.
function mergeThree(a, b, c) {
  return mergeBookData(a, mergeBookData(b, c));
}

// ---------- Amazon URL parsing ----------

const ASIN_REGEX = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function extractAsinFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(ASIN_REGEX);
  return m ? m[1].toUpperCase() : null;
}

// ---------- Lookup chain ----------

// Look up by ASIN (Amazon URL identifier). Tries PRH → Hardcover → OL.
// `amazonUrl` is preserved on the result so "View on Amazon" keeps working.
export async function lookupByAsin(asin, amazonUrl) {
  if (!asin) return null;
  const isbnLike = /^\d{9}[\dX]$/i.test(asin);

  // Run all three in parallel — they don't depend on each other and the user
  // is waiting. We merge results afterwards.
  const [prh, hc, ol] = await Promise.all([
    isbnLike ? prhLookupByIsbn(asin).catch(() => null) : Promise.resolve(null),
    hardcoverLookupByAsin(asin).catch(() => null),
    _lookupByAsinOL(asin).catch(() => null),
  ]);

  const merged = mergeThree(hc, prh, ol);
  if (!merged) return null;

  merged.amazonUrl = amazonUrl || null;
  merged.manuallyAdded = true;
  return merged;
}

// Look up by title (+ optional author). Used for the title-list paste flow.
export async function lookupByTitle(title, author) {
  if (!title) return null;

  // All three in parallel
  const [prh, hc, ol] = await Promise.all([
    prhSearch(title, author).catch(() => null),
    hardcoverSearch(title, author).catch(() => null),
    _lookupByTitleOL(title, author).catch(() => null),
  ]);

  // Priority order: Hardcover > PRH > OL for general metadata.
  // PRH wins on Spanish/LatAm if it's the only one with a hit, since the merge
  // is null-fill — Hardcover's null fields get replaced by PRH's values.
  const merged = mergeThree(hc, prh, ol);
  if (!merged) {
    // ALL sources missed. Don't lose the user's input — return a raw record
    // marked as unverified so it surfaces for review.
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
      unverified: true, // flagged for editor review
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
