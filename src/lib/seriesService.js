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

// Fetch all known books in a series by name. Joins the books table on series_id.
export async function fetchBooksInSeriesByName(name) {
  const series = await fetchSeriesByName(name);
  if (!series) return { series: null, books: [] };
  const { data, error } = await supabase
    .from('books')
    .select('*, position_in_series, series:series(*)')
    .eq('series_id', series.id)
    .order('position_in_series', { ascending: true });
  if (error) {
    console.warn('books-in-series fetch failed', error);
    return { series, books: [] };
  }
  return { series, books: data || [] };
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
