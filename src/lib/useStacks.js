// useStacks — the paged book pool behind The Stacks.
//
// Reads the shared `books` catalog directly (world-readable via the "Anyone
// can read books" RLS policy), so browsing costs no external API calls and no
// Oracle quota.
//
// The pool is deliberately WIDE — it excludes only `flagged`. Discovery is not
// gated on review; Oracle Categorize happens once a book reaches a shelf.
//
// ── Randomness (v0.59.1) ────────────────────────────────────────────────────
// The previous version picked ONE random offset per session and then paged
// forward from it. For anyone with favourite genres that made no difference at
// all: the genre phase always started at offset 0, so every visit opened on the
// same books in the same order. Now EVERY query picks a fresh random offset
// into the matching set, and the `seen` set prevents repeats within a session.
// Genuinely different each load, at the cost of no guarantee you'll eventually
// see all N books — which is the right trade for an infinite browse.
//
// ── Exclusion (v0.59.1) ─────────────────────────────────────────────────────
// Books already on a shelf must never appear. Three keys are checked, because
// one is not enough:
//   1. bookId          — same catalog row. Strongest signal, and was missing
//                        entirely, which is why "V for Vendetta" showed up
//                        despite being in the library.
//   2. bookKey         — normalised title+author.
//   3. edition key     — bookKey with parentheticals stripped via cleanTitle,
//                        so "The Well of Ascension" matches
//                        "The Well of Ascension (Mistborn, #2)".
// And `owned` must include currently-reading — its omission is why "The
// Haunting of Hill House" appeared while it was being read.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { bookKey, cleanTitle } from './bookHelpers';

const BATCH_TARGET = 20;   // books actually shown per load
const FETCH_SIZE = 40;     // rows pulled per query; overshoots to absorb filtering
const MAX_QUERIES = 8;     // per load, so a fully-owned catalog can't spin
// Upper bound for the random offset guess. Comfortably above the current
// catalog size so windows spread across it; overshoots walk themselves back.
const OFFSET_CEILING = 4000;

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

// Parenthetical-insensitive key. "The Well of Ascension (Mistborn, #2)" and
// "The Well of Ascension" produce the same value.
function editionKey(b) {
  return bookKey({ t: cleanTitle(b.t || ''), a: b.a });
}

export function useStacks({ favoriteGenres = [], owned = [] }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);

  const seenRef = useRef(new Set());
  const hiddenRef = useRef(new Set());
  const genrePhaseRef = useRef(true);
  const genreRoundsRef = useRef(0);

  const ownedIdsRef = useRef(new Set());
  const ownedKeysRef = useRef(new Set());
  const ownedEditionsRef = useRef(new Set());

  useEffect(() => {
    const ids = new Set();
    const keys = new Set();
    const editions = new Set();
    for (const b of owned) {
      if (b?.bookId) ids.add(b.bookId);
      keys.add(bookKey(b));
      editions.add(editionKey(b));
    }
    ownedIdsRef.current = ids;
    ownedKeysRef.current = keys;
    ownedEditionsRef.current = editions;
  }, [owned]);

  const isOwned = useCallback((card) => (
    (card.bookId && ownedIdsRef.current.has(card.bookId)) ||
    ownedKeysRef.current.has(bookKey(card)) ||
    ownedEditionsRef.current.has(editionKey(card))
  ), []);

  // v0.59.3 — this must NOT mutate seenRef.
  //
  // It used to mark every fetched row as seen inline. Under React 18 StrictMode
  // the mount effect runs, is cleaned up, and runs again: the first (discarded)
  // pass had already marked everything seen, so the second pass filtered its
  // own results down to nothing and the wall came up empty. Coming back to the
  // page later "worked" only because fresh random offsets happened to find rows
  // the discarded pass hadn't touched.
  //
  // Seen-marking is now deferred to `commit()`, called only when a batch is
  // actually kept. A cancelled fetch leaves no trace.
  const selectFresh = useCallback((rows, batchSeen) => {
    const out = [];
    for (const r of rows) {
      if (seenRef.current.has(r.id) || batchSeen.has(r.id)) continue;
      if (hiddenRef.current.has(r.id)) continue;
      batchSeen.add(r.id);
      const card = rowToCard(r);
      if (isOwned(card)) continue;
      out.push(card);
    }
    return out;
  }, [isOwned]);

  // ── Windowing (v0.59.2) ───────────────────────────────────────────────────
  //
  // The previous version asked PostgREST for an exact row count and derived a
  // random offset from it. When that count came back null — which it does if
  // the content-range header isn't what supabase-js expects — `total` became 0,
  // every query short-circuited to `return []`, and the wall rendered BOTH
  // "Nothing left to show here" and "You've reached the end". An empty shelf on
  // a catalog of thousands.
  //
  // No count is used now. We take a random offset on spec and walk it back
  // toward zero if it lands past the end of the table, with a guaranteed final
  // read from the top. That can't produce an empty result while the table has
  // rows, and it keeps the per-query randomness that stops every visit looking
  // the same.
  const baseQuery = useCallback((genreScoped) => {
    let q = supabase
      .from('books')
      .select(COLS)
      .neq('status', 'flagged')
      .not('cover_url', 'is', null);
    if (genreScoped) q = q.in('genre', favoriteGenres);
    return q.order('id', { ascending: true });
  }, [favoriteGenres]);

  const fetchWindow = useCallback(async (genreScoped) => {
    let offset = Math.floor(Math.random() * OFFSET_CEILING);

    for (let attempt = 0; attempt < 4 && offset > 0; attempt++) {
      const { data, error } = await baseQuery(genreScoped)
        .range(offset, offset + FETCH_SIZE - 1);
      if (error) return [];
      if (data && data.length > 0) return data;
      // Overshot the end of this set — halve and try nearer the start.
      offset = Math.floor(offset / 2);
    }

    // Guaranteed read from the top. Reached when the set is smaller than the
    // offsets we guessed, which is the normal case for a narrow genre.
    const { data } = await baseQuery(genreScoped).range(0, FETCH_SIZE - 1);
    return data || [];
  }, [baseQuery]);

  const queryWindow = useCallback(async () => {
    // Genre-seeded first so the opening screens look assembled for this reader.
    // Seeds on books.genre (written by upsert_book), not a book_genres join —
    // that table is only populated after Oracle categorisation, so joining it
    // would exclude every crawled and freshly imported title.
    //
    // Capped at a few rounds so a reader isn't locked inside their own five
    // genres for an entire session.
    if (genrePhaseRef.current && favoriteGenres.length > 0) {
      if (genreRoundsRef.current < 6) {
        genreRoundsRef.current += 1;
        const rows = await fetchWindow(true);
        if (rows.length > 0) return rows;
      }
      genrePhaseRef.current = false;
    }

    return fetchWindow(false);
  }, [favoriteGenres, fetchWindow]);

  // Fetch until BATCH_TARGET books are ready to show, so the first load and
  // every "Show more" are a consistent size regardless of how many rows get
  // filtered out as owned/seen/hidden.
  const collectBatch = useCallback(async () => {
    const batchSeen = new Set();
    const collected = [];
    let emptyRounds = 0;
    for (let i = 0; i < MAX_QUERIES && collected.length < BATCH_TARGET; i++) {
      const rows = await queryWindow();
      const fresh = selectFresh(rows, batchSeen);
      collected.push(...fresh);
      // With random windows, an empty round means overlap with what we've
      // already shown rather than a dead catalog — but several in a row means
      // there is genuinely little left.
      emptyRounds = fresh.length === 0 ? emptyRounds + 1 : 0;
      if (emptyRounds >= 3) break;
    }
    // Call only when the batch is kept. A discarded fetch must not poison the
    // seen set for the fetch that replaces it.
    const commit = () => { for (const id of batchSeen) seenRef.current.add(id); };
    return { collected, dry: collected.length === 0, commit };
  }, [queryWindow, selectFresh]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    const { collected, dry, commit } = await collectBatch();
    commit();
    setBooks((prev) => [...prev, ...collected]);
    if (dry) setExhausted(true);
    setLoading(false);
  }, [collectBatch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { collected, dry, commit } = await collectBatch();
      // Bail before committing. Under StrictMode this pass is discarded and the
      // one after it must start from a clean seen set.
      if (cancelled) return;
      commit();
      setBooks(collected);
      if (dry) setExhausted(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drops a book from the wall for this session. Session-scoped on purpose:
  // persisting it needs a `user_hidden_books` table and a decision about
  // whether a dismissal is forever.
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
