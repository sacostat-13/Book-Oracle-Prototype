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

// ---------- Supabase loaders ----------
async function loadFromSupabase(userId) {
  const [profileRes, wishlistRes, readBooksRes, plansRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('wishlist_items').select('*').eq('user_id', userId),
    supabase.from('read_books').select('*').eq('user_id', userId),
    supabase.from('plans').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
  ]);

  const profile = profileRes.data || {};
  const wishlist = (wishlistRes.data || []).map((r) => ({
    t: r.book_title,
    a: r.book_author,
    ...(r.book_metadata || {}),
    notes: r.notes || undefined,
    addedAt: r.added_at,
    _id: r.id,
  }));
  const library = (readBooksRes.data || []).map((r) => ({
    t: r.book_title,
    a: r.book_author,
    ...(r.book_metadata || {}),
    rating: r.rating,
    dateRead: r.read_at,
    fromGoodreads: r.source === 'goodreads_import',
    _id: r.id,
  }));
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
    wishlist,
    library,
    readNext: profile.preferences?.readNext || [],
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
  const seedWishlistIfNeeded = useCallback(() => {
    setState((s) => {
      if (!s.onboarded) return s;
      if (s.wishlist && s.wishlist.length > 0) return s;
      const libraryKeys = new Set(s.library.map(bookKey));
      const wishlist = ALL_BOOKS.filter((b) => !libraryKeys.has(bookKey(b))).map((b) => ({ ...b }));
      // Bulk-insert into Supabase (fire and forget)
      if (user) {
        const rows = wishlist.map((b) => ({
          user_id: user.id,
          book_title: b.t,
          book_author: b.a,
          book_metadata: { g: b.g, c: b.c, p: b.p, d: b.d, s: b.s },
        }));
        supabase.from('wishlist_items').upsert(rows, { onConflict: 'user_id,book_title' }).then(({ error }) => {
          if (error) console.error('seedWishlist upsert failed', error);
        });
      }
      return { ...s, wishlist };
    });
  }, [user]);

  const addToWishlist = useCallback(
    async (book) => {
      let added = false;
      setState((s) => {
        const k = bookKey(book);
        if (s.wishlist.some((b) => bookKey(b) === k)) return s;
        if (s.library.some((b) => bookKey(b) === k)) return s;
        added = true;
        return { ...s, wishlist: [...s.wishlist, { ...book }] };
      });
      if (added && user) {
        await supabase.from('wishlist_items').insert({
          user_id: user.id,
          book_title: book.t,
          book_author: book.a,
          book_metadata: { g: book.g, c: book.c, p: book.p, d: book.d, s: book.s, amazonUrl: book.amazonUrl, manuallyAdded: book.manuallyAdded },
          notes: book.notes || null,
        });
        showToast(`"${book.t}" added to your wishlist`);
      } else if (added) {
        showToast(`"${book.t}" added to your wishlist`);
      }
      return added;
    },
    [user, showToast]
  );

  const removeFromWishlist = useCallback(
    async (book, silent = false) => {
      const k = bookKey(book);
      setState((s) => ({ ...s, wishlist: s.wishlist.filter((b) => bookKey(b) !== k) }));
      if (user) {
        await supabase
          .from('wishlist_items')
          .delete()
          .eq('user_id', user.id)
          .eq('book_title', book.t)
          .eq('book_author', book.a);
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
      setState((s) => {
        if (s.library.some((b) => bookKey(b) === k)) return s;
        return {
          ...s,
          readNext: s.readNext.filter((b) => bookKey(b) !== k),
          wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
          library: [...s.library, { ...book, dateRead: new Date().toISOString() }],
        };
      });
      if (user) {
        await supabase.from('read_books').upsert(
          {
            user_id: user.id,
            book_title: book.t,
            book_author: book.a,
            book_metadata: { g: book.g, c: book.c, p: book.p, d: book.d },
            read_at: new Date().toISOString().slice(0, 10),
            source: book.fromGoodreads ? 'goodreads_import' : 'manual',
            rating: book.rating || null,
          },
          { onConflict: 'user_id,book_title' }
        );
        await supabase
          .from('wishlist_items')
          .delete()
          .eq('user_id', user.id)
          .eq('book_title', book.t);
      }
      showToast(`"${book.t}" added to your library`);
    },
    [user, showToast]
  );

  const removeFromLibrary = useCallback(
    async (book) => {
      const k = bookKey(book);
      setState((s) => ({ ...s, library: s.library.filter((b) => bookKey(b) !== k) }));
      if (user) {
        await supabase
          .from('read_books')
          .delete()
          .eq('user_id', user.id)
          .eq('book_title', book.t);
      }
    },
    [user]
  );

  // Bulk-import from Goodreads CSV
  const importGoodreads = useCallback(
    async (books) => {
      setState((s) => {
        const existingKeys = new Set(s.library.map(bookKey));
        const toAdd = books.filter((b) => !existingKeys.has(bookKey(b)));
        return {
          ...s,
          library: [...s.library, ...toAdd.map((b) => ({ ...b, dateRead: b.dateRead || new Date().toISOString() }))],
          profile: { ...s.profile, goodreadsImported: true },
        };
      });
      if (user && books.length > 0) {
        const rows = books.map((b) => ({
          user_id: user.id,
          book_title: b.t,
          book_author: b.a,
          rating: b.rating || null,
          read_at: b.dateRead || null,
          source: 'goodreads_import',
        }));
        await supabase.from('read_books').upsert(rows, {
          onConflict: 'user_id,book_title',
          ignoreDuplicates: true,
        });
      }
      showToast(`Imported ${books.length} books from Goodreads`);
    },
    [user, showToast]
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
    setProfile,
    setOnboarded,
    setShelfSortMode,
    setOracleMode,
    setCurrentPlan,
    resetAll,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
