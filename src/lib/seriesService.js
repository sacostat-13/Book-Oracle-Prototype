// Series lookup helpers. The shared `series` table is the source of truth;
// Hardcover/OpenLibrary are fallbacks for series we don't know about yet.
// v0.12: Wikipedia layers a description on top when available.

import { supabase } from './supabase';
import { hardcoverFetchSeriesBooks } from './hardcoverService';
import { fetchSeriesBooks as olFetchSeriesBooks } from './enrichmentService';
import { wikipediaSeriesLookup } from './wikipediaService';

// Normalize a name the same way the SQL function does:
// lowercase, strip leading "the ", strip non-alphanumerics.
export function normalizeSeriesName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

// Read the current i18n language from localStorage so we can hit
// es.wikipedia first for Spanish-mode users. Same pattern as bookLookup.js.
function currentLang() {
  try {
    const stored = localStorage.getItem('book_oracle_lang');
    if (stored === 'es' || stored === 'en') return stored;
  } catch {}
  return 'en';
}

// Look up a series row by name. Returns null if not in our DB yet.
export async function fetchSeriesByName(name) {
  if (!name) return null;
  const normalized = normalizeSeriesName(name);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('normalized_name', normalized)
    .maybeSingle();
  if (error) {
    console.warn('series fetch failed', error);
    return null;
  }
  return data;
}

// Map a `books` row to the client book shape, with the series block populated.
//
// Same deliberate duplication as shareKey.js and authorWorks.js: DataContext's
// bookRowToClient also unpacks per-user fields (rating, notes, dateRead) that
// this query neither selects nor could populate for a signed-out reader.
// SeriesPage overlays those from the caller's own shelves where they exist.
function rowToSeriesBook(r, series) {
  if (!r) return null;
  return {
    bookId: r.id,
    t: r.title,
    a: r.author || '',
    d: r.description || undefined,
    pp: r.pages || undefined,
    coverUrl: r.cover_url || undefined,
    isbn: r.isbn || undefined,
    status: r.status || 'unreviewed',
    s: {
      id:                series.id,
      name:              series.name,
      n:                 r.position_in_series ?? null,
      total:             series.total_books ?? null,
      publicationStatus: series.publication_status ?? 'unknown',
    },
  };
}

// The index floor for a series page, in the FIRST of three places it is written
// down -- the others are a local const in netlify/edge-functions/og-prerender.js
// (which sets the noindex meta a crawler reads) and one in
// netlify/functions/sitemap.js (which decides what to submit). All three must
// agree: a URL in the sitemap that answers with noindex is a contradiction
// Search Console reports as an error. tests/contracts.test.js checks that they do.
//
// WHY 2, AND WHY THERE IS A FLOOR AT ALL
//
// The diagnostic on 2026-09-08 measured the 175 series pages that earned
// impressions in the previous 28 days: 116 of them (66%) hold exactly ONE book,
// and only 12 of the 105 claiming a total_books hold them all. A page titled
// "<series> series in order -- every book" that lists one volume cannot answer
// the query it ranks for, and submitting it teaches Google that this site's
// series pages are not worth crawling -- the same reasoning that produced the
// genre floor in genreService.js.
//
// Two, not three: one volume cannot express an order at all, which is the
// smallest defensible line. A page below the floor stays reachable and linked
// and keeps `follow`, so it still passes its links on; it is simply not
// advertised until the catalog can back it up.
export const SERIES_INDEX_FLOOR = 2;

// Fetch all known books in a series by name. Joins the books table on series_id.
//
// 2026-08-24: this function existed, was exported, and was called from NOWHERE.
// SeriesPage rendered from Hardcover/OpenLibrary at runtime while the crawler
// got a catalog-ordered list out of og-prerender.js — two pages, two sources,
// one URL. It is now the primary source for both.
//
// The status filter matches netlify/functions/sitemap.js and the series branch
// of og-prerender.js. All three must agree: the sitemap advertises the URL, the
// prerender lists the books, and this renders them. A row visible to one and
// not the others is the divergence this change exists to remove.
//
// nullsFirst: false is explicit rather than inherited. Postgres sorts NULLs
// last in ASC by default, but this is a reading-order list and "unnumbered goes
// at the end" is a product decision, not a database default to be relied on.
export async function fetchBooksInSeriesByName(name) {
  const series = await fetchSeriesByName(name);
  if (!series) return { series: null, books: [] };
  const { data, error } = await supabase
    // 2026-09-08: series_volumes, not books. The view collapses duplicate
    // editions sharing a position_in_series -- the Crescent City page listed
    // House of Sky and Breath twice under "BOOK 2" and neither other volume,
    // on the site's highest-impression URL. The embedded `series:series(*)`
    // went with it: rowToSeriesBook takes the series row as its second
    // argument and never read the join.
    .from('series_volumes')
    .select('*')
    .eq('series_id', series.id)
    .in('status', ['verified', 'oracle_categorized'])
    .order('position_in_series', { ascending: true, nullsFirst: false });
  if (error) {
    console.warn('books-in-series fetch failed', error);
    return { series, books: [] };
  }
  return { series, books: (data || []).map((r) => rowToSeriesBook(r, series)) };
}

// Hardcover/OpenLibrary lookup wrapper used when we don't have a series in
// our DB yet, or want to top up with books that aren't in our catalog.
// Returns the standard client book shape.
export async function fetchSeriesBooksFromUpstream(seriesName) {
  if (!seriesName) return [];
  const hc = await hardcoverFetchSeriesBooks(seriesName);
  if (hc && hc.length > 0) return hc;
  const ol = await olFetchSeriesBooks(seriesName);
  return ol || [];
}

// v0.12: Look up a Wikipedia description for a series.
//
// Returns { description, wikipediaUrl, wikipediaLang } or null. Designed to
// be called alongside (not instead of) the existing series resolution paths
// — Hardcover/OL still own the book list and structured metadata; Wikipedia
// adds the narrative description on top.
//
// Caching: the result is not cached at this layer because the calling
// BookModal effect only runs once per opened series. If we start hitting
// this from a list view (e.g. a "Browse series" page), add an in-memory
// LRU here. Wikipedia's REST is fast (~200-400ms) but we don't want to
// pummel it on hot paths.
export async function fetchSeriesDescriptionFromWikipedia(seriesName, author) {
  if (!seriesName) return null;
  const wiki = await wikipediaSeriesLookup(seriesName, author, currentLang());
  if (!wiki || !wiki.d) return null;
  return {
    description: wiki.d,
    descriptionShort: wiki.descriptionShort || null,
    wikipediaUrl: wiki.wikipediaUrl,
    wikipediaLang: wiki.wikipediaLang,
  };
}
