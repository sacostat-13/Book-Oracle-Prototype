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
  };
}

/**
 * Resolve a shared book URL key to a book, or null.
 * Never throws — a failed lookup is a 404, not a broken page.
 *
 * @param {string} key e.g. "midnighttimetableanovelinghoststories|borachung"
 */
export async function lookUpByShareKey(key) {
  if (!key || typeof key !== 'string') return null;
  try {
    const { data, error } = await supabase
      .rpc('find_book_by_client_key', { _key: key })
      .maybeSingle();
    if (error) {
      console.warn('[shareKey] lookup failed', error.message);
      return null;
    }
    return rowToBook(data);
  } catch (err) {
    console.warn('[shareKey] lookup threw', err?.message || err);
    return null;
  }
}
