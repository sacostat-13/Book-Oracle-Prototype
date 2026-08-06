// useStacks — the paged book pool behind The Stacks.
//
// Reads the shared `books` catalog directly (world-readable via the "Anyone
// can read books" RLS policy), so browsing costs no external API calls and no
// Oracle quota.
//
// The pool is deliberately WIDE. It excludes only `flagged` (books readers have
// reported) rather than requiring `verified`/`oracle_categorized`. The Stacks
// exists to help people grow their shelves, and a reader can run Oracle
// Categorize once a book reaches their Library or Wishlist, so gating discovery
// behind review would starve the wall. The real bar is `cover_url is not null`
// — an entry with no cover has nothing to show on a wall of covers.
//
// Two things this has to get right, both learned the hard way:
//
//   1. Deliver a FULL batch, not a full *query*. Rows get filtered out after
//      fetching (already owned, already seen, dismissed), so a fixed page size
//      produced wildly uneven results — 6 books, then 4, then 5. Every call now
//      keeps fetching until it has BATCH_TARGET books to show or the catalog
//      runs out.
//   2. Be different every visit. Ordering by id is stable, which is right
//      *within* a session (paging forward must not reshuffle) but wrong
//      *across* sessions — the reader saw an identical wall after every
//      refresh. A random offset is chosen once per mount and the window slides
//      forward from there, wrapping at the end.
//
// v0.59

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { bookKey } from './bookHelpers';

const BATCH_TARGET = 20;   // books actually shown per load
const FETCH_SIZE = 40;     // rows pulled per query; overshoots to absorb filtering
const MAX_QUERIES = 8;     // per load, so a fully-owned catalog can't spin

const COLS = 'id, title, author, cover_url, description, pages, genre, isbn, status, source';

function rowToCard(r) {
  return {
    bookId: r.id,
    t: r.title,
    a: r.author,
    coverUrl: r.cover_url || undefined,
    d: r.description || undefined,
    pp: r.pages || undefined,
    g: r.genre || undefined,
    isbn: r.isbn || undefined,
    status: r.status || 'unreviewed',
    source: r.source,
  };
}

export function useStacks({ favoriteGenres = [], owned = [] }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);

  const cursorRef = useRef(0);        // absolute row offset into the ordered set
  const startRef = useRef(null);      // random session start; null until measured
  const totalRef = useRef(null);      // total matching rows
  const wrappedRef = useRef(false);   // true once the window has looped past the end
  const seenRef = useRef(new Set());
  const hiddenRef = useRef(new Set());
  const genrePhaseRef = useRef(true);

  const ownedKeysRef = useRef(new Set());
  useEffect(() => {
    ownedKeysRef.current = new Set(owned.map(bookKey));
  }, [owned]);

  const filterOut = useCallback((rows) => {
    const out = [];
    for (const r of rows) {
      if (seenRef.current.has(r.id)) continue;
      if (hiddenRef.current.has(r.id)) continue;
      seenRef.current.add(r.id);
      const card = rowToCard(r);
      if (ownedKeysRef.current.has(bookKey(card))) continue;
      out.push(card);
    }
    return out;
  }, []);

  // How many rows match, so the random start offset lands somewhere real.
  const measure = useCallback(async () => {
    const { count } = await supabase
      .from('books')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'flagged')
      .not('cover_url', 'is', null);
    const total = count || 0;
    totalRef.current = total;
    // Leave room for at least one full batch after the start point, so a high
    // roll doesn't drop the reader onto the last three books in the table.
    const span = Math.max(1, total - BATCH_TARGET);
    startRef.current = total > 0 ? Math.floor(Math.random() * span) : 0;
    return total;
  }, []);

  // One query. Returns raw rows; caller handles filtering and accumulation.
  const queryWindow = useCallback(async () => {
    const total = totalRef.current ?? (await measure());
    if (!total) return { rows: [], done: true };

    // Genre-seeded first, so the opening screen looks assembled for this
    // reader. Seeds on books.genre (written by upsert_book) rather than a
    // book_genres join — that table is only populated after Oracle
    // categorisation, so joining it would exclude every crawled and freshly
    // imported title, i.e. the books keeping this wall stocked.
    if (genrePhaseRef.current && favoriteGenres.length > 0) {
      const from = cursorRef.current;
      const { data, error } = await supabase
        .from('books')
        .select(COLS)
        .in('genre', favoriteGenres)
        .neq('status', 'flagged')
        .not('cover_url', 'is', null)
        .order('id', { ascending: true })
        .range(from, from + FETCH_SIZE - 1);

      if (!error && data && data.length > 0) {
        cursorRef.current += data.length;
        if (data.length < FETCH_SIZE) {
          // Genre pool spent — hand over to the general pool, starting at the
          // random offset so the fallback isn't alphabetical either.
          genrePhaseRef.current = false;
          cursorRef.current = startRef.current || 0;
        }
        return { rows: data, done: false };
      }
      genrePhaseRef.current = false;
      cursorRef.current = startRef.current || 0;
    }

    const from = cursorRef.current;
    const { data, error } = await supabase
      .from('books')
      .select(COLS)
      .neq('status', 'flagged')
      .not('cover_url', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + FETCH_SIZE - 1);

    if (error) return { rows: [], done: true };

    const rows = data || [];
    cursorRef.current += rows.length;

    // Reached the end of the table. Wrap to the top once so a reader who
    // started at a high offset still sees the books before it; stop on the
    // second pass rather than looping forever.
    if (rows.length < FETCH_SIZE) {
      if (!wrappedRef.current && (startRef.current || 0) > 0) {
        wrappedRef.current = true;
        cursorRef.current = 0;
        return { rows, done: false };
      }
      return { rows, done: true };
    }
    // Wrapped all the way back around to where we began.
    if (wrappedRef.current && cursorRef.current >= (startRef.current || 0)) {
      return { rows, done: true };
    }
    return { rows, done: false };
  }, [favoriteGenres, measure]);

  // Fetch until BATCH_TARGET books are ready to show. This is what makes the
  // first load and every "Show more" a consistent size regardless of how many
  // rows get filtered out.
  const collectBatch = useCallback(async () => {
    const collected = [];
    let done = false;
    for (let i = 0; i < MAX_QUERIES && collected.length < BATCH_TARGET && !done; i++) {
      const res = await queryWindow();
      collected.push(...filterOut(res.rows));
      done = res.done;
    }
    return { collected, done };
  }, [queryWindow, filterOut]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    const { collected, done } = await collectBatch();
    setBooks((prev) => [...prev, ...collected]);
    if (done) setExhausted(true);
    setLoading(false);
  }, [collectBatch]);

  // Initial load uses the exact same accumulation path. Previously it made a
  // single query, so a first page that happened to be entirely owned/filtered
  // rendered the empty state — "Nothing left to show here" — on a catalog with
  // thousands of books in it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await measure();
      cursorRef.current = genrePhaseRef.current && favoriteGenres.length > 0
        ? 0
        : (startRef.current || 0);
      const { collected, done } = await collectBatch();
      if (!cancelled) {
        setBooks(collected);
        if (done) setExhausted(true);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Not for me" — drops a book from the wall for this session.
  //
  // Session-scoped on purpose: persisting it needs a `user_hidden_books` table
  // and a decision about whether a dismissal is forever. Until then, hiding
  // survives scrolling but not a reload, which is the honest behaviour for
  // something with no storage behind it.
  const hide = useCallback((bookId) => {
    hiddenRef.current.add(bookId);
    setBooks((prev) => prev.filter((b) => b.bookId !== bookId));
  }, []);

  return { books, loading, exhausted, loadMore, hide };
}

/**
 * Local-first search. Hits the catalog only; the caller decides whether to
 * offer a wider lookup when this returns nothing, so no external call is made
 * per keystroke.
 */
export async function searchStacks(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const pattern = `%${q}%`;
  const { data, error } = await supabase
    .from('books')
    .select(COLS)
    .or(`title.ilike.${pattern},author.ilike.${pattern}`)
    .neq('status', 'flagged')
    .not('cover_url', 'is', null)
    .limit(48);
  if (error) return [];
  return (data || []).map(rowToCard);
}
