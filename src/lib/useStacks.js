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
//
// ── Reach (v0.60) ───────────────────────────────────────────────────────────
// The wall shows every book with a cover. Favourite genres shape the ORDER,
// not the eligibility — except while a reader is still building a library, when
// the wall stays inside their favourites so the first impression is curated.
// See queryWindow for the two modes.
//
// This replaces a scheme where genre-scoped rounds ran first and the catalog
// opened up afterwards. It looked similar and behaved very differently: the
// canonical genres hold only a few dozen browsable books each (443 of 1729
// total at the time of writing — most of the catalog carries a null or
// non-canonical genre), so genre-scoped rounds ran dry almost immediately and
// then spent the query budget proving it.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { bookKey, cleanTitle } from './bookHelpers';

const BATCH_TARGET = 20;   // books actually shown per load
const FETCH_SIZE = 40;     // rows pulled per query; overshoots to absorb filtering
const MAX_QUERIES = 8;     // per load, so a fully-owned catalog can't spin
// Upper bound for the random offset guess. Comfortably above the current
// catalog size so windows spread across it; overshoots walk themselves back.
const OFFSET_CEILING = 4000;
// Books across all shelves below which a reader counts as still building a
// library, and The Stacks stays inside their favourite genres. Roughly a
// session's worth of adding — enough for the wall to feel curated, short of
// the point where narrow starts costing them variety.
const BUILDING_LIBRARY_THRESHOLD = 20;

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

// First credited author only.
//
// The same book reaches the catalog with different author strings depending on
// where it came from — Goodreads RSS exposes one author, Hardcover credits the
// full team. "V for Vendetta / Alan Moore" and
// "V for Vendetta / Alan Moore y David Lloyd" are the same book, but bookKey
// includes the author, so they key differently, survived every exclusion check,
// and could be added twice.
//
// Splits on the usual co-author joiners in both languages. Deliberately
// conservative: only separators surrounded by whitespace, so a name containing
// one of these words is untouched.
function primaryAuthor(a) {
  return String(a || '').split(/\s+(?:y|and|with|&|,|;|\/)\s+/i)[0].trim();
}

// Title + first author, parentheticals stripped. The loosest key we're willing
// to match on — still requires an author, so two different books that share a
// title stay distinct.
function authorLooseKey(b) {
  return bookKey({ t: cleanTitle(b.t || ''), a: primaryAuthor(b.a) });
}

// `ready` — hold the first fetch until the caller's shelves have loaded, so the
// opening batch can actually be filtered against them. Defaults true so a
// caller that has nothing to wait for behaves as before.
export function useStacks({ favoriteGenres = [], owned = [], ready = true }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);

  const seenRef = useRef(new Set());
  const hiddenRef = useRef(new Set());
  // Set once the genre-only phase has been abandoned for this session, so an
  // empty genre set isn't re-probed on every round.
  const strictSpentRef = useRef(false);

  const totalRef = useRef(null);
  const ownedCountRef = useRef(0);
  const ownedIdsRef = useRef(new Set());
  const ownedKeysRef = useRef(new Set());
  const ownedEditionsRef = useRef(new Set());
  const ownedLooseRef = useRef(new Set());

  useEffect(() => {
    const ids = new Set();
    const keys = new Set();
    const editions = new Set();
    const loose = new Set();
    for (const b of owned) {
      if (b?.bookId) ids.add(b.bookId);
      keys.add(bookKey(b));
      editions.add(editionKey(b));
      loose.add(authorLooseKey(b));
    }
    ownedIdsRef.current = ids;
    ownedKeysRef.current = keys;
    ownedEditionsRef.current = editions;
    ownedLooseRef.current = loose;
    // Drives the building-vs-browsing decision in queryWindow. Counted from
    // `owned` rather than state.library alone so a reader who has been adding
    // to the wishlist counts as building a library — which is what they are
    // doing.
    ownedCountRef.current = owned.length;
  }, [owned]);

  // Four keys, loosest last. Any one matching means the reader already has it.
  const isOwned = useCallback((card) => (
    (card.bookId && ownedIdsRef.current.has(card.bookId)) ||
    ownedKeysRef.current.has(bookKey(card)) ||
    ownedEditionsRef.current.has(editionKey(card)) ||
    ownedLooseRef.current.has(authorLooseKey(card))
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

  // Real size of the browsable catalog — rows passing the same status/cover
  // filters the wall uses. Fetched once per session with a HEAD request, so it
  // costs no rows.
  //
  // v0.60: an earlier version derived offsets from this and broke when the
  // count came back null, so the count was removed entirely. Removing it cost
  // us two things: offsets were guessed against OFFSET_CEILING (4000) on a
  // catalog nearer 2.5K, so most guesses overshot and the halving walked them
  // back toward the head of the table — the same few hundred books, over and
  // over — and there was no way to tell "the random windows overlapped" from
  // "the catalog is finished". It is back, but nullable and never trusted
  // blindly: every caller falls back to the old behaviour when it is null.
  const ensureTotal = useCallback(async () => {
    if (totalRef.current !== null) return totalRef.current;
    const { count, error } = await supabase
      .from('books')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'flagged')
      .not('cover_url', 'is', null);
    totalRef.current = error || typeof count !== 'number' ? null : count;
    return totalRef.current;
  }, []);

  const fetchWindow = useCallback(async (genreScoped) => {
    const total = await ensureTotal();
    // Scope the guess to the catalog we actually have. Genre-scoped sets are
    // smaller still, so the halving below remains the safety net for those.
    const ceiling = total && total > FETCH_SIZE ? total : OFFSET_CEILING;
    let offset = Math.floor(Math.random() * Math.max(1, ceiling - FETCH_SIZE));

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
  }, [baseQuery, ensureTotal]);

  // Two modes, decided by how much of a library the reader has built (v0.60).
  //
  // BUILDING (owned < BUILDING_LIBRARY_THRESHOLD): favourite genres only.
  //   Someone with an empty shelf is trying to answer "is this app for me?",
  //   and a wall of things they already like answers it faster than a wall of
  //   everything. Narrow on purpose.
  //
  // BROWSING (owned >= threshold): the whole catalog, favourites first.
  //   Once the shelf exists, narrow stops helping and starts running out. Each
  //   round now draws a genre window AND a global window and concatenates them
  //   genre-first — `selectFresh` and `collected.push(...)` both preserve
  //   order, so favourites surface at the top of the wall without anything
  //   being excluded from it.
  //
  // A reader with no favourite genres gets the whole catalog in both modes;
  // there is nothing to prefer.
  //
  // Genre matching is on books.genre (written by upsert_book), not a
  // book_genres join — that table is only populated after Oracle
  // categorisation, so joining it would exclude every crawled and freshly
  // imported title.
  const queryWindow = useCallback(async () => {
    if (favoriteGenres.length === 0) return fetchWindow(false);

    const building =
      ownedCountRef.current < BUILDING_LIBRARY_THRESHOLD && !strictSpentRef.current;

    if (building) {
      const rows = await fetchWindow(true);
      if (rows.length > 0) return rows;
      // The genre pool is dry — either the reader's favourites match no book in
      // the catalog (an old taxonomy, a renamed genre), or they have genuinely
      // seen all of it. Both are possible early: the canonical genres hold only
      // a few dozen browsable books each.
      //
      // Opening up rather than showing an end screen is deliberate. A brand-new
      // reader hitting "You've reached the end" in their first session is the
      // worst outcome available to us, and strictness was only ever meant to
      // make the opening feel curated — not to cap it. Latched for the session
      // so we don't re-probe an empty genre set on every round.
      strictSpentRef.current = true;
      return fetchWindow(false);
    }

    // Browsing: favourites first, then everything.
    const [preferred, everything] = await Promise.all([
      fetchWindow(true),
      fetchWindow(false),
    ]);
    return [...preferred, ...everything];
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

    // v0.60: a dry batch is NOT proof the catalog is finished.
    //
    // The windows are random, so several rounds landing entirely on books
    // already shown is ordinary — especially late in a long browse, and
    // especially for a reader with a big library filtering rows out. The old
    // code set `exhausted` on the first dry batch and never cleared it, so
    // "You've reached the end" appeared over a catalog of thousands after a
    // couple of minutes' scrolling.
    //
    // Now a dry batch only ends the wall if the seen set actually accounts for
    // the whole catalog. When the count is unavailable we keep the old
    // behaviour rather than looping forever.
    const total = await ensureTotal();
    const reallyExhausted =
      collected.length === 0 &&
      (total === null || seenRef.current.size + batchSeen.size >= total);

    return { collected, dry: collected.length === 0, reallyExhausted, commit };
  }, [queryWindow, selectFresh, ensureTotal]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    const { collected, reallyExhausted, commit } = await collectBatch();
    commit();
    setBooks((prev) => [...prev, ...collected]);
    setExhausted(reallyExhausted);
    setLoading(false);
  }, [collectBatch]);

  // Gated on `ready` (v0.60).
  //
  // This used to be a bare mount effect. On a page load that lands directly on
  // The Stacks it therefore ran while DataContext was still loading the
  // reader's shelves from Supabase, so `owned` was empty and `isOwned` matched
  // nothing — the opening batch of 20 was drawn with no ownership filter at
  // all. That is why a book already on the wishlist appeared on the wall, and
  // why adding it raised a duplicate-key error the reader had no way to
  // predict. Waiting for the shelves costs a moment on first paint and makes
  // the filter mean something.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { collected, reallyExhausted, commit } = await collectBatch();
      // Bail before committing. Under StrictMode this pass is discarded and the
      // one after it must start from a clean seen set.
      if (cancelled) return;
      commit();
      setBooks(collected);
      setExhausted(reallyExhausted);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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
