// shareKey.js — resolving a shared /book/:key URL back to a book.
//
// The key in the URL is bookKey() from bookHelpers.js: the title with every
// non-alphanumeric stripped, a pipe, then the first 10 characters of the author
// given the same treatment. It is an ADDRESS, not an identity — books.normalized_key
// is the identity, it is built differently (spaces kept, accents folded, author
// not truncated), and the two are not interchangeable:
//
//   URL bookKey      midnighttimetableanovelinghoststories|borachung
//   normalized_key   midnight timetable a novel in ghost stories|bora chung
//
// So a shared link cannot be resolved with `.eq('normalized_key', key)`. Before
// v0.63.3 the SPA did not try: BookPage checked the reader's shelves, then the
// `?snap=` snapshot the app embeds in its own URLs, then gave up. A shared link
// carries neither, so it 404'd for every recipient who did not already own the
// book — while the share card rendered perfectly, because og-prerender.js does
// the lookup server-side.
//
// The matching now lives in SQL (find_book_by_client_key, migration
// 20260813120000) so there is one authoritative definition instead of a copy
// per runtime. This module is the client's door to it.

import { supabase } from './supabase';

// Map a `books` row to the shape the app uses everywhere else.
//
// Deliberately not importing DataContext's bookRowToClient: that function also
// unpacks series joins and per-user fields (rating, notes, dateRead) that this
// query does not select and a non-owner does not have. Sharing its signature
// without sharing its inputs would invite someone to assume the extras are
// populated.
function rowToBook(r) {
  if (!r) return null;
  return {
    bookId: r.id,
    t: r.title,
    a: r.author || '',
    d: r.description || undefined,
    pp: r.pages || undefined,
    g: r.genre || undefined,
    c: r.complexity || undefined,
    p: r.depth || undefined,
    coverUrl: r.cover_url || undefined,
    isbn: r.isbn || undefined,
    status: r.status || 'unreviewed',
    source: r.source,
    // 2026-09-29: carried so BookPage and the enrich merge can see the book is in a
    // series. `s` itself is built in lookUpByShareKey once the series row has
    // been read — the RPC returns only the id, not the name.
    seriesId: r.series_id || undefined,
    seriesPosition: r.position_in_series ?? undefined,
  };
}

// 2026-09-29 — SERIES ON SHARED LINKS.
//
// rowToBook used to drop series_id entirely, on the reasoning above that
// series joins belong to bookRowToClient. The consequence: every book reached
// by a shared link (or a fresh ?preview=true URL) that the viewer did not
// already own rendered with NO series block, unless OpenLibrary happened to
// know the series by title — which it does not for most manga and comics
// ("Fruits Basket, Vol. 1" returns nothing). The catalogue knew perfectly well.
// Googlebot lands on exactly this path, so the rendered page it indexed never
// said the book was part of a series, and never linked to the series page.
//
// Builds the same `s` shape as DataContext's bookRowToClient for the fields a
// public reader can see. Never throws: no series is a missing block, not a
// broken page.
// The `s` shape for a catalogue series row. Shared by attachSeries (which
// fetches the row) and bookFromSeed (which is handed it by the prerender).
function withSeries(book, data) {
  if (!book || !data?.name) return book;
  return {
    ...book,
    s: {
      name: data.name,
      n: book.seriesPosition ?? null,
      total: data.total_books || null,
      status: data.status || 'unreviewed',
      publicationStatus: data.publication_status || 'unknown',
      seriesId: data.id,
      fromHardcover: data.source === 'hardcover',
      fromOpenLibrary: data.source === 'openlibrary',
    },
  };
}

async function attachSeries(book) {
  if (!book?.seriesId) return book;
  try {
    const { data, error } = await supabase
      .from('series')
      .select('id,name,total_books,status,publication_status,source')
      .eq('id', book.seriesId)
      .maybeSingle();
    if (error || !data?.name) {
      if (error) console.warn('[shareKey] series lookup failed', error.message);
      return book;
    }
    return withSeries(book, data);
  } catch (err) {
    console.warn('[shareKey] series lookup threw', err?.message || err);
    return book;
  }
}

/**
 * 2026-10-07 — the book og-prerender.js already resolved for this URL (see
 * src/lib/entitySeed.js), in the same shape lookUpByShareKey returns. Sync, so
 * BookPage can render it on its first pass.
 *
 * @param {{ row: object, series?: object|null }} seed
 */
export function bookFromSeed(seed) {
  const book = rowToBook(seed?.row);
  if (!book) return null;
  return seed.series && book.seriesId ? withSeries(book, seed.series) : book;
}

/**
 * Resolve a shared book URL key to a book, or null.
 * Never throws — a failed lookup is a 404, not a broken page.
 *
 * @param {string} key e.g. "midnighttimetableanovelinghoststories|borachung"
 */
export async function lookUpByShareKey(key) {
  const { book } = await lookUpByShareKeyResult(key);
  return book;
}

/**
 * 2026-10-07 — like lookUpByShareKey, but says WHY there is no book.
 *
 * lookUpByShareKey returns null both when the catalogue has no such book and
 * when the request failed, and BookPage rendered "Book not found" for both. In
 * Google's renderer the request sometimes fails, so real books were indexed as
 * not-found pages -- identical ones, which Search Console then reported as
 * duplicates of each other. Callers that decide what to render need the
 * difference: not found is a page; a failed request is a retry.
 *
 * @returns {Promise<{ book: object|null, error: string|null }>}
 */
export async function lookUpByShareKeyResult(key) {
  if (!key || typeof key !== 'string') return { book: null, error: null };
  try {
    const { data, error } = await supabase
      .rpc('find_book_by_client_key', { _key: key })
      .maybeSingle();
    if (error) {
      console.warn('[shareKey] lookup failed', error.message);
      return { book: null, error: error.message || 'lookup failed' };
    }
    return { book: await attachSeries(rowToBook(data)), error: null };
  } catch (err) {
    console.warn('[shareKey] lookup threw', err?.message || err);
    return { book: null, error: String(err?.message || err || 'lookup threw') };
  }
}
