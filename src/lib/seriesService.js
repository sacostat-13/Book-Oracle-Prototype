// Series lookup helpers. The shared `series` table is the source of truth;
// Hardcover/OpenLibrary are fallbacks for series we don't know about yet.

import { supabase } from './supabase';
import { hardcoverFetchSeriesBooks } from './hardcoverService';
import { fetchSeriesBooks as olFetchSeriesBooks } from './enrichmentService';

// Normalize a name the same way the SQL function does:
// lowercase, strip leading "the ", strip non-alphanumerics.
export function normalizeSeriesName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
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

// Hardcover/OpenLibrary lookup wrapper used when we don't have a series in our
// DB yet, or want to top up with books that aren't in our catalog. Returns
// the standard client book shape.
export async function fetchSeriesBooksFromUpstream(seriesName) {
  if (!seriesName) return [];
  // Hardcover first
  const hc = await hardcoverFetchSeriesBooks(seriesName);
  if (hc && hc.length > 0) return hc;
  // OL fallback
  const ol = await olFetchSeriesBooks(seriesName);
  return ol || [];
}
