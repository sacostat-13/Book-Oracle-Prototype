// Central app data store. Mirrors the original `state` shape (library, readNext,
// wishlist, currentPlan, profile, etc.) but loads from and persists to Supabase
// when a user is signed in. When signed out, falls back to localStorage so the
// app still works for anonymous prototyping.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';
import { ALL_BOOKS, bookKey } from './bookHelpers';

const LOCAL_KEY = 'wishlist_oracle_state_v2';

const defaultState = {
  onboarded: false,
  profile: {
    readingLevel: null,
    goal: null,
    goodreadsImported: false,
    displayName: null,
    avatarUrl: null,
  },
  library: [],
  readNext: [],
  wishlist: [],
  currentPlan: null,
  shelfSortMode: 'recent',
  oracleMode: 'wishlist',
};

const DataContext = createContext(null);

// Defensive dedupe: removes books with duplicate bookKey from a list, keeping
// the first occurrence. Used at every insertion point so accidental duplicates
// (from re-imports, race conditions, etc.) can't sneak in and cause React
// "duplicate key" warnings.
function dedupeBooks(books) {
  if (!books || books.length === 0) return books;
  const seen = new Set();
  const out = [];
  for (const b of books) {
    const k = bookKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

// ---------- localStorage fallback ----------
function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw);
    return {
      ...defaultState,
      ...parsed,
      profile: { ...defaultState.profile, ...(parsed.profile || {}) },
      // Defensively dedupe lists from localStorage too — could be stale data
      // from a previous version of the app.
      wishlist: dedupeBooks(parsed.wishlist || []),
      library: dedupeBooks(parsed.library || []),
      readNext: dedupeBooks(parsed.readNext || []),
    };
  } catch {
    return { ...defaultState };
  }
}
function saveLocal(state) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {}
}

// Convert a v3 `books` row joined into a wishlist/library row into the
// flat client shape the rest of the app expects. With v3, series info lives
// on the joined `series` row.
function bookRowToClient(b, extra = {}) {
  if (!b) return null;
  const series = b.series
    ? {
        name: b.series.name,
        n: b.position_in_series || null,
        total: b.series.total_books || null,
        verified: b.series.verified || false,
        status: b.series.status || 'unknown',
        seriesId: b.series.id,
        fromHardcover: b.series.source === 'hardcover',
        fromOpenLibrary: b.series.source === 'openlibrary',
      }
    : undefined;
  return {
    t: b.title,
    a: b.author,
    g: b.genre || undefined,
    c: b.complexity || undefined,
    p: b.depth || undefined,
    d: b.description || undefined,
    pp: b.pages || undefined,
    coverUrl: b.cover_url || undefined,
    isbn: b.isbn || undefined,
    s: series,
    verified: b.verified || false,
    source: b.source,
    bookId: b.id,
    ...extra,
  };
}

// ---------- Supabase loaders ----------
async function loadFromSupabase(userId) {
  const [profileRes, wishlistRes, readBooksRes, plansRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase
      .from('wishlist_items')
      .select('id, added_at, notes, book:books(*, position_in_series, series:series(*))')
      .eq('user_id', userId),
    supabase
      .from('read_books')
      .select('id, rating, read_at, source, book:books(*, position_in_series, series:series(*))')
      .eq('user_id', userId),
    supabase
      .from('plans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const profile = profileRes.data || {};
  const wishlist = (wishlistRes.data || [])
    .map((r) =>
      r.book
        ? bookRowToClient(r.book, {
            notes: r.notes || undefined,
            addedAt: r.added_at,
            _id: r.id,
          })
        : null
    )
    .filter(Boolean);
  const library = (readBooksRes.data || [])
    .map((r) =>
      r.book
        ? bookRowToClient(r.book, {
            rating: r.rating || undefined,
            dateRead: r.read_at || undefined,
            fromGoodreads: r.source === 'goodreads_import',
            _id: r.id,
          })
        : null
    )
    .filter(Boolean);
  const currentPlan =
    plansRes.data && plansRes.data[0]
      ? {
          ...(plansRes.data[0].content || {}),
          _id: plansRes.data[0].id,
          title: plansRes.data[0].title,
        }
      : null;

  return {
    ...defaultState,
    onboarded: !!profile.preferences?.onboarded,
    profile: {
      ...defaultState.profile,
      ...(profile.preferences || {}),
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
    },
    wishlist: dedupeBooks(wishlist),
    library: dedupeBooks(library),
    readNext: dedupeBooks(profile.preferences?.readNext || []),
    currentPlan,
    shelfSortMode: profile.preferences?.shelfSortMode || 'recent',
    oracleMode: profile.preferences?.oracleMode || 'wishlist',
  };
}

// Persist a profile-level scalar field (preferences blob)
async function savePreferences(userId, state) {
  await supabase
    .from('profiles')
    .update({
      preferences: {
        onboarded: state.onboarded,
        readingLevel: state.profile.readingLevel,
        goal: state.profile.goal,
        goodreadsImported: state.profile.goodreadsImported,
        readNext: state.readNext,
        shelfSortMode: state.shelfSortMode,
        oracleMode: state.oracleMode,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
}

export function DataProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState(() => loadLocal());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // ---------- Initial load: from Supabase if signed in, else local ----------
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (user) {
        try {
          const remote = await loadFromSupabase(user.id);
          if (!cancelled) setState(remote);
        } catch (e) {
          console.error('Failed to load from Supabase, falling back to local', e);
          if (!cancelled) setState(loadLocal());
        }
      } else {
        setState(loadLocal());
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // ---------- Persist on every state change ----------
  useEffect(() => {
    if (loading) return;
    saveLocal(state);
    if (user) {
      savePreferences(user.id, state).catch(console.error);
    }
  }, [state, loading, user]);

  // ---------- Toast helper ----------
  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError, id: Math.random() });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // ---------- Mutations ----------

  // Calls the upsert_book RPC and returns the book_id of the inserted/existing row.
  // The RPC handles series upsert internally when _series_name is provided.
  const upsertBookOnServer = useCallback(
    async (book, source = 'user_manual') => {
      if (!user) return null;
      const resolvedSource = book.fromHardcover
        ? 'hardcover'
        : book.fromOpenLibrary
          ? 'openlibrary'
          : book.fromGoodreads
            ? 'goodreads_import'
            : source;
      const args = {
        _title: book.t,
        _author: book.a || null,
        _isbn: book.isbn || null,
        _hardcover_id: book.hardcoverId || null,
        _series_name: book.s?.name || null,
        _series_position: book.s?.n || null,
        _pages: book.pp || null,
        _description: book.d || null,
        _cover_url: book.coverUrl || null,
        _genre: book.g || null,
        _complexity: book.c || null,
        _depth: book.p || null,
        _source: resolvedSource,
        _verified: false, // never auto-verify; curated seed sets this directly
        _metadata: {
          amazonUrl: book.amazonUrl || null,
          manuallyAdded: book.manuallyAdded || false,
        },
        // Inform the RPC where the series data came from so it can record
        // 'hardcover' as the series source rather than inheriting 'user_manual'.
        _series_source: book.s
          ? book.s.fromHardcover
            ? 'hardcover'
            : book.s.fromOpenLibrary
              ? 'openlibrary'
              : resolvedSource
          : null,
      };
      const { data, error } = await supabase.rpc('upsert_book', args);
      if (error) {
        console.error('upsert_book failed', error);
        return null;
      }
      return data; // book_id (uuid)
    },
    [user]
  );

  // On-demand metadata cache. Called when the modal enriches a book with
  // fields like cover_url, pages, description, isbn. We write to the shared
  // `books` row via upsert_book — which only fills nulls (never overwrites
  // existing/verified data), so this is safe to call freely.
  //
  // Also reflects the patch into local state so the wishlist/library cards
  // pick up the new cover immediately without a refetch.
  const cacheBookFields = useCallback(
    async (book, patch) => {
      if (!patch || Object.keys(patch).length === 0) return;

      // 1. Mirror into local state (covers + pages show up on cards right away)
      setState((s) => {
        const k = bookKey(book);
        const apply = (list) =>
          list.map((b) => (bookKey(b) === k ? { ...b, ...patch } : b));
        return {
          ...s,
          wishlist: apply(s.wishlist),
          library: apply(s.library),
          readNext: apply(s.readNext),
        };
      });

      // 2. Persist to the shared books row (signed-in users only)
      if (!user) return;
      const merged = { ...book, ...patch };
      // upsert_book is a coalesce-style merge — only fills nulls.
      await upsertBookOnServer(merged);
    },
    [user, upsertBookOnServer]
  );

  const seedWishlistIfNeeded = useCallback(async () => {
    if (!state.onboarded) return;
    if (state.wishlist && state.wishlist.length > 0) return;
    const libraryKeys = new Set(state.library.map(bookKey));
    const seedBooks = ALL_BOOKS.filter((b) => !libraryKeys.has(bookKey(b)));

    if (!user) {
      // Guest mode: just stuff them into local state
      setState((s) => ({ ...s, wishlist: seedBooks.map((b) => ({ ...b, verified: true, source: 'curated' })) }));
      return;
    }

    // Upsert each book into the shared catalog, then link via wishlist_items.
    // Done serially to be gentle on the RPC.
    const linked = [];
    for (const b of seedBooks) {
      const bookId = await upsertBookOnServer(b, 'curated');
      if (!bookId) continue;
      const { error } = await supabase
        .from('wishlist_items')
        .insert({ user_id: user.id, book_id: bookId })
        .select()
        .single();
      if (!error) linked.push({ ...b, bookId, verified: true, source: 'curated' });
    }
    setState((s) => ({ ...s, wishlist: dedupeBooks([...s.wishlist, ...linked]) }));
  }, [state.onboarded, state.wishlist, state.library, user, upsertBookOnServer]);

  const addToWishlist = useCallback(
    async (book) => {
      const k = bookKey(book);
      // local dedup
      if (state.wishlist.some((b) => bookKey(b) === k)) return false;
      if (state.library.some((b) => bookKey(b) === k)) return false;

      if (!user) {
        // Guest path
        setState((s) => ({ ...s, wishlist: [...s.wishlist, { ...book }] }));
        showToast(`"${book.t}" added to your wishlist`);
        return true;
      }

      // Server path: upsert into books, then link
      const bookId = await upsertBookOnServer(book);
      if (!bookId) {
        showToast(`Couldn't save "${book.t}"`, true);
        return false;
      }
      const { error } = await supabase
        .from('wishlist_items')
        .insert({ user_id: user.id, book_id: bookId, notes: book.notes || null });
      if (error && error.code !== '23505') {
        console.error('wishlist insert failed', error);
        return false;
      }
      setState((s) => ({ ...s, wishlist: [...s.wishlist, { ...book, bookId }] }));
      showToast(`"${book.t}" added to your wishlist`);
      return true;
    },
    [user, state.wishlist, state.library, showToast, upsertBookOnServer]
  );

  const removeFromWishlist = useCallback(
    async (book, silent = false) => {
      const k = bookKey(book);
      setState((s) => ({ ...s, wishlist: s.wishlist.filter((b) => bookKey(b) !== k) }));
      if (user && book.bookId) {
        await supabase
          .from('wishlist_items')
          .delete()
          .eq('user_id', user.id)
          .eq('book_id', book.bookId);
      }
      if (!silent) showToast(`"${book.t}" removed from wishlist`);
    },
    [user, showToast]
  );

  const addToReadNext = useCallback(
    (book) => {
      setState((s) => {
        const k = bookKey(book);
        if (s.readNext.some((b) => bookKey(b) === k)) return s;
        if (s.library.some((b) => bookKey(b) === k)) return s;
        return { ...s, readNext: [...s.readNext, book] };
      });
      showToast(`"${book.t}" added to Read Next`);
    },
    [showToast]
  );

  const removeFromReadNext = useCallback((book) => {
    const k = bookKey(book);
    setState((s) => ({ ...s, readNext: s.readNext.filter((b) => bookKey(b) !== k) }));
  }, []);

  const markAsRead = useCallback(
    async (book) => {
      const k = bookKey(book);
      if (state.library.some((b) => bookKey(b) === k)) return;
      const today = new Date().toISOString().slice(0, 10);

      if (!user) {
        setState((s) => ({
          ...s,
          readNext: s.readNext.filter((b) => bookKey(b) !== k),
          wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
          library: [...s.library, { ...book, dateRead: today }],
        }));
        showToast(`"${book.t}" added to your library`);
        return;
      }

      // Make sure the book exists in the catalog
      const bookId = book.bookId || (await upsertBookOnServer(book));
      if (!bookId) {
        showToast(`Couldn't save "${book.t}"`, true);
        return;
      }

      // Insert into read_books (or update if it exists somehow)
      const { error: rbErr } = await supabase
        .from('read_books')
        .upsert(
          {
            user_id: user.id,
            book_id: bookId,
            read_at: today,
            source: book.fromGoodreads ? 'goodreads_import' : 'manual',
            rating: book.rating || null,
          },
          { onConflict: 'user_id,book_id' }
        );
      if (rbErr) {
        console.error('read_books upsert failed', rbErr);
      }
      // Remove from wishlist
      await supabase
        .from('wishlist_items')
        .delete()
        .eq('user_id', user.id)
        .eq('book_id', bookId);

      setState((s) => ({
        ...s,
        readNext: s.readNext.filter((b) => bookKey(b) !== k),
        wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
        library: [...s.library, { ...book, bookId, dateRead: today }],
      }));
      showToast(`"${book.t}" added to your library`);
    },
    [user, state.library, showToast, upsertBookOnServer]
  );

  const removeFromLibrary = useCallback(
    async (book) => {
      const k = bookKey(book);
      setState((s) => ({ ...s, library: s.library.filter((b) => bookKey(b) !== k) }));
      if (user && book.bookId) {
        await supabase
          .from('read_books')
          .delete()
          .eq('user_id', user.id)
          .eq('book_id', book.bookId);
      }
    },
    [user]
  );

  // Bulk-import from Goodreads CSV
  const importGoodreads = useCallback(
    async (books) => {
      const existingKeys = new Set(state.library.map(bookKey));
      const toAdd = books.filter((b) => !existingKeys.has(bookKey(b)));

      if (!user) {
        setState((s) => ({
          ...s,
          library: dedupeBooks([...s.library, ...toAdd.map((b) => ({ ...b, dateRead: b.dateRead || new Date().toISOString() }))]),
          profile: { ...s.profile, goodreadsImported: true },
        }));
        showToast(`Imported ${toAdd.length} books from Goodreads`);
        return;
      }

      // For each, upsert book + insert read_books row
      const linked = [];
      for (const b of toAdd) {
        const bookId = await upsertBookOnServer(
          { ...b, fromGoodreads: true },
          'goodreads_import'
        );
        if (!bookId) continue;
        const { error } = await supabase.from('read_books').upsert(
          {
            user_id: user.id,
            book_id: bookId,
            rating: b.rating || null,
            read_at: b.dateRead || null,
            source: 'goodreads_import',
          },
          { onConflict: 'user_id,book_id' }
        );
        if (!error) linked.push({ ...b, bookId, dateRead: b.dateRead || new Date().toISOString() });
      }

      setState((s) => ({
        ...s,
        library: dedupeBooks([...s.library, ...linked]),
        profile: { ...s.profile, goodreadsImported: true },
      }));
      showToast(`Imported ${linked.length} books from Goodreads`);
    },
    [user, state.library, showToast, upsertBookOnServer]
  );

  const setProfile = useCallback((patch) => {
    setState((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  }, []);

  const setOnboarded = useCallback((v) => {
    setState((s) => ({ ...s, onboarded: v }));
  }, []);

  const setShelfSortMode = useCallback((mode) => {
    setState((s) => ({ ...s, shelfSortMode: mode }));
  }, []);

  const setOracleMode = useCallback((mode) => {
    setState((s) => ({ ...s, oracleMode: mode }));
  }, []);

  const setCurrentPlan = useCallback(
    async (plan) => {
      setState((s) => ({ ...s, currentPlan: plan }));
      if (user && plan) {
        const { data, error } = await supabase
          .from('plans')
          .insert({
            user_id: user.id,
            title: plan.title || 'Untitled Plan',
            content: plan,
          })
          .select()
          .single();
        if (!error && data) {
          setState((s) => ({ ...s, currentPlan: { ...plan, _id: data.id } }));
        }
      }
    },
    [user]
  );

  const resetAll = useCallback(async () => {
    setState({ ...defaultState });
    saveLocal({ ...defaultState });
    if (user) {
      await Promise.all([
        supabase.from('wishlist_items').delete().eq('user_id', user.id),
        supabase.from('read_books').delete().eq('user_id', user.id),
        supabase.from('plans').delete().eq('user_id', user.id),
      ]);
    }
  }, [user]);

  // ---------- The Vault: query the curated catalog ----------
  // Fetched lazily on demand. Cached in memory for the session.
  const [vault, setVault] = useState(null);
  const loadVault = useCallback(async () => {
    if (vault) return vault;
    if (!user) {
      // Guest: use bundled BOOKS_DATA as a stand-in
      const v = ALL_BOOKS.map((b) => ({ ...b, verified: true, source: 'curated' }));
      setVault(v);
      return v;
    }
    const { data, error } = await supabase
      .from('books')
      .select('*, position_in_series, series:series(*)')
      .eq('source', 'curated')
      .eq('verified', true)
      .order('title', { ascending: true });
    if (error || !data) {
      console.error('Vault fetch failed', error);
      // Fallback to bundled catalog
      const v = ALL_BOOKS.map((b) => ({ ...b, verified: true, source: 'curated' }));
      setVault(v);
      return v;
    }
    const v = data.map((b) => bookRowToClient(b));
    setVault(v);
    return v;
  }, [user, vault]);

  const value = {
    state,
    loading,
    toast,
    showToast,
    // mutations
    seedWishlistIfNeeded,
    addToWishlist,
    removeFromWishlist,
    addToReadNext,
    removeFromReadNext,
    markAsRead,
    removeFromLibrary,
    importGoodreads,
    cacheBookFields,
    setProfile,
    setOnboarded,
    setShelfSortMode,
    setOracleMode,
    setCurrentPlan,
    resetAll,
    // vault
    vault,
    loadVault,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
