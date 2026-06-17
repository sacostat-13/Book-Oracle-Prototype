// Central app data store. Mirrors the original `state` shape (library, readNext,
// wishlist, currentPlan, profile, etc.) but loads from and persists to Supabase
// when a user is signed in. When signed out, falls back to localStorage so the
// app still works for anonymous prototyping.
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
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
  // v0.12: a Map keyed by book_id (uuid) → array of { categoryId, name,
  // verified, usageCount, source: 'verified' | 'user' }. Populated on load
  // and kept in sync by addCategoryToBook / removeCategoryFromBook.
  // Books not in this map have no categories (empty array, not null).
  categoriesByBookId: {},
  // v0.15 phase 2.3: canonical genre taxonomy. keyed by book_id (uuid) →
  // array of { genreId, name, normalizedName, source, usageCount, assignedBySource, description }.
  // Global (not user-scoped). Populated from book_genres_view on load.
  genresByBookId: {},
  // Full genre catalog: [{ id, name, normalizedName, source, usageCount, description }]
  // Sorted alphabetically. Used by PlanCreate genre select and genre browsers.
  genres: [],
};

const DataContext = createContext(null);

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
      wishlist: dedupeBooks(parsed.wishlist || []),
      library: dedupeBooks(parsed.library || []),
      readNext: dedupeBooks(parsed.readNext || []),
      // v0.12: guest-mode categories live in localStorage too
      categoriesByBookId: parsed.categoriesByBookId || {},
      // v0.15 phase 2.3: genres are globally loaded on sign-in; for guests
      // they remain empty (genres require Supabase access).
      genresByBookId: {},
      genres: [],
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

function bookRowToClient(b, extra = {}) {
  if (!b) return null;
  const series = b.series
    ? {
        name: b.series.name,
        n: b.position_in_series || null,
        total: b.series.total_books || null,
        // v0.15: status replaces verified. 'oracle_categorized' counts as verified in the UI.
        status: b.series.status || 'unreviewed',
        verifiedSource: b.series.verified_source || null,
        verifiedAt: b.series.verified_at || null,
        verifiedBy: b.series.verified_by || null,
        // v0.14: series.status was renamed to publication_status. Old API rows
        // may still have `status` populated with publication state during the
        // brief transition; fall back to it if publication_status is null.
        publicationStatus: b.series.publication_status || 'unknown',
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
    // v0.15: status replaces verified. 'oracle_categorized' counts as verified in the UI.
    status: b.status || 'unreviewed',
    verifiedSource: b.verified_source || null,
    verifiedAt: b.verified_at || null,
    verifiedBy: b.verified_by || null,
    source: b.source,
    bookId: b.id,
    ...extra,
  };
}

// v0.15: helper for UI "verified" checks. Both 'verified' and 'oracle_categorized'
// render as verified (gilt ☩). 'incomplete', 'unreviewed', 'flagged' don't.
// Use this everywhere we used to check `book.verified`.
export function isBookVerified(bookOrSeries) {
  const s = bookOrSeries?.status;
  return s === 'verified' || s === 'oracle_categorized';
}

// v0.12: take a list of book_categories_view rows (with bookId + category
// fields) and roll them up into the { bookId → [categories] } shape used
// in state. Dedupes by category_id within each book — a category can appear
// in both the verified-global and user-private rows; we keep one entry but
// prefer 'verified' as the source for the pill style.
function rollupCategories(rows) {
  const map = {};
  for (const r of rows || []) {
    const bookId = r.book_id;
    if (!bookId) continue;
    if (!map[bookId]) map[bookId] = {};
    const existing = map[bookId][r.category_id];
    const incoming = {
      categoryId: r.category_id,
      name: r.category_name,
      verified: r.verified,
      usageCount: r.usage_count,
      source: r.source, // 'verified' | 'user'
    };
    // If we already have this category for this book, prefer 'verified'
    // source over 'user' (the verified pill style wins).
    if (existing) {
      if (existing.source === 'user' && incoming.source === 'verified') {
        map[bookId][r.category_id] = incoming;
      }
    } else {
      map[bookId][r.category_id] = incoming;
    }
  }
  // Convert inner objects → arrays, sorted verified-first then alphabetical.
  const out = {};
  for (const bookId of Object.keys(map)) {
    out[bookId] = Object.values(map[bookId]).sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
}

// v0.15 phase 2.3: roll up book_genres_view rows into { bookId → [genres] }.
// Each genre row: { genreId, name, normalizedName, source, usageCount, description, assignedBySource }.
// Sorted by usage_count desc then alpha — most-used genres surface first.
function rollupGenres(rows) {
  const map = {};
  for (const r of rows) {
    const key = r.book_id;
    if (!map[key]) map[key] = {};
    const gKey = r.genre_id;
    if (!map[key][gKey]) {
      map[key][gKey] = {
        genreId: r.genre_id,
        name: r.genre_name,
        normalizedName: r.normalized_name,
        source: r.genre_source,
        usageCount: r.usage_count,
        description: r.genre_description || null,
        assignedBySource: r.assigned_by_source,
      };
    }
  }
  const out = {};
  for (const bookId of Object.keys(map)) {
    out[bookId] = Object.values(map[bookId]).sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
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
      .select('id, rating, notes, read_at, source, book:books(*, position_in_series, series:series(*))')
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
            notes: r.notes || undefined,
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

  // v0.12: load categories for all books in wishlist + library. One round
  // trip via the book_categories_view (UNION of verified global + this user's
  // private categories). RLS on user_book_categories enforces the user filter
  // automatically.
  const allBookIds = [...new Set([
    ...wishlist.map((b) => b.bookId).filter(Boolean),
    ...library.map((b) => b.bookId).filter(Boolean),
  ])];
  // v0.12 hotfix 3: chunk the book_id list. For users with large libraries
  // (700+ books), a single `in.(...)` query exceeds PostgREST's URL length
  // limit and gets rejected with a bare 400 at the edge layer (not by
  // PostgREST itself, which is why no JSON body comes back). 50 IDs per
  // chunk keeps each URL well under 2KB.
  let categoriesByBookId = {};
  if (allBookIds.length > 0) {
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < allBookIds.length; i += CHUNK_SIZE) {
      chunks.push(allBookIds.slice(i, i + CHUNK_SIZE));
    }

    // Fire all chunked queries in parallel — both tables, every chunk.
    const allQueries = [];
    for (const chunk of chunks) {
      allQueries.push(
        supabase
          .from('book_categories')
          .select('book_id, category_id')
          .in('book_id', chunk)
          .then((r) => ({ kind: 'global', ...r }))
      );
      allQueries.push(
        supabase
          .from('user_book_categories')
          .select('book_id, category_id')
          .in('book_id', chunk)
          .then((r) => ({ kind: 'user', ...r }))
      );
    }
    const results = await Promise.all(allQueries);

    const globalLinks = [];
    const userLinks = [];
    for (const r of results) {
      if (r.error) {
        console.warn(`${r.kind} categories chunk failed`, r.error);
        continue;
      }
      if (r.kind === 'global') globalLinks.push(...(r.data || []));
      else userLinks.push(...(r.data || []));
    }

    const allCategoryIds = [...new Set([
      ...globalLinks.map((r) => r.category_id),
      ...userLinks.map((r) => r.category_id),
    ])];

    // Categories themselves may also be many — chunk this query too. Less
    // likely to hit limits (categories are global, total is small), but
    // belt-and-suspenders.
    let categoriesById = {};
    if (allCategoryIds.length > 0) {
      const catChunks = [];
      for (let i = 0; i < allCategoryIds.length; i += CHUNK_SIZE) {
        catChunks.push(allCategoryIds.slice(i, i + CHUNK_SIZE));
      }
      const catResults = await Promise.all(
        catChunks.map((chunk) =>
          supabase
            .from('categories')
            .select('id, name, normalized_name, verified, usage_count')
            .in('id', chunk)
        )
      );
      for (const r of catResults) {
        if (r.error) {
          console.warn('categories table chunk failed', r.error);
          continue;
        }
        for (const c of (r.data || [])) {
          categoriesById[c.id] = c;
        }
      }
    }

    const buildRow = (linkRow, baseSource) => {
      const c = categoriesById[linkRow.category_id];
      if (!c) return null;
      return {
        book_id: linkRow.book_id,
        category_id: c.id,
        category_name: c.name,
        normalized_name: c.normalized_name,
        verified: c.verified,
        usage_count: c.usage_count,
        source: baseSource === 'verified'
          ? 'verified'
          : (c.verified ? 'verified' : 'user'),
      };
    };

    const merged = [
      ...globalLinks.map((r) => buildRow(r, 'verified')).filter(Boolean),
      ...userLinks.map((r) => buildRow(r, 'user')).filter(Boolean),
    ];
    categoriesByBookId = rollupCategories(merged);
  }

  // v0.15 phase 2.3: load canonical genres for all books in wishlist + library.
  // book_genres_view is globally readable (no user scoping). We chunk the same
  // allBookIds list — genres use the same 50-id chunking strategy as categories.
  let genresByBookId = {};
  if (allBookIds.length > 0) {
    const GENRE_CHUNK = 50;
    const genreChunks = [];
    for (let i = 0; i < allBookIds.length; i += GENRE_CHUNK) {
      genreChunks.push(allBookIds.slice(i, i + GENRE_CHUNK));
    }
    const genreResults = await Promise.all(
      genreChunks.map((chunk) =>
        supabase
          .from('book_genres_view')
          .select('book_id, genre_id, genre_name, normalized_name, genre_source, usage_count, genre_description, assigned_by_source')
          .in('book_id', chunk)
      )
    );
    const allGenreRows = [];
    for (const r of genreResults) {
      if (r.error) {
        console.warn('book_genres_view chunk failed', r.error);
        continue;
      }
      allGenreRows.push(...(r.data || []));
    }
    genresByBookId = rollupGenres(allGenreRows);
  }

  // Load full genre catalog (for PlanCreate select, genre browser, descriptions).
  // Sorted alphabetically by name.
  let genres = [];
  const { data: genreRows, error: genreErr } = await supabase
    .from('genres')
    .select('id, name, normalized_name, source, usage_count, description')
    .order('name', { ascending: true });
  if (!genreErr && genreRows) {
    genres = genreRows.map((g) => ({
      id: g.id,
      name: g.name,
      normalizedName: g.normalized_name,
      source: g.source,
      usageCount: g.usage_count,
      description: g.description || null,
    }));
  }

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
    categoriesByBookId,
    genresByBookId,
    genres,
  };
}

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
  // No-user (guest/logged-out) path has nothing to load from Supabase, so
  // we can render immediately. Only flip to true when fetching for a real user.
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // v0.13.1 follow-up: ref-guarded "already loaded for this user ID". Prevents
  // the load effect from refetching when the user reference changes without
  // the user identity actually changing — defense in depth on top of the
  // AuthContext fix.
  // Use a sentinel that can never equal a real userId or null-after-load, so
  // the first run always executes (fixes guest mode where null === null guard
  // was skipping the effect and leaving loading stuck at its initial value).
  const loadedUserIdRef = useRef('__uninitialized__');

  // ---------- Initial load ----------
  useEffect(() => {
    if (authLoading) return;
    const userId = user?.id || null;
    if (loadedUserIdRef.current === userId) return;
    let cancelled = false;
    (async () => {
      if (user) {
        // Only show spinner when actually fetching from Supabase
        setLoading(true);
        try {
          const remote = await loadFromSupabase(user.id);
          if (!cancelled) {
            setState(remote);
            loadedUserIdRef.current = user.id;
          }
        } catch (e) {
          console.error('Failed to load from Supabase, falling back to local', e);
          if (!cancelled) setState(loadLocal());
        }
        if (!cancelled) setLoading(false);
      } else {
        // Guest / logged-out: load from localStorage synchronously, no spinner needed
        setState(loadLocal());
        loadedUserIdRef.current = null;
        // Ensure loading is false (it starts false, but guard against any edge case)
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
      // v0.15: derive review status from client signals. needsReview is set
      // by bookLookup when all APIs missed (low-confidence add). Curated seed
      // path passes source='curated', which we promote to status='verified' +
      // verified_source='curated_seed'.
      const resolvedStatus = resolvedSource === 'curated'
        ? 'verified'
        : book.needsReview
          ? 'incomplete'
          : 'unreviewed';
      const resolvedVerifiedSource = resolvedSource === 'curated'
        ? 'curated_seed'
        : null;
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
        _status: resolvedStatus,
        _verified_source: resolvedVerifiedSource,
        _metadata: {
          amazonUrl: book.amazonUrl || null,
          manuallyAdded: book.manuallyAdded || false,
        },
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
      return data;
    },
    [user]
  );

  const cacheBookFields = useCallback(
    async (book, patch) => {
      if (!patch || Object.keys(patch).length === 0) return;

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

      if (!user) return;
      const merged = { ...book, ...patch };
      await upsertBookOnServer(merged);
    },
    [user, upsertBookOnServer]
  );

  // Silently upsert a book with status='discovered'.
  // Called when a user views a book page from search without adding it.
  // Creates the books row for catalog enrichment but no wishlist_items row.
  const upsertDiscoveredBook = useCallback(
    async (book) => {
      if (!user || !book?.t) return;
      // Don't overwrite a book that already has a real status
      const k = bookKey(book);
      const inCollection = [
        ...state.wishlist, ...state.library, ...state.readNext
      ].some((b) => bookKey(b) === k);
      if (inCollection) return;
      const resolvedSource = book.fromHardcover ? 'hardcover'
        : book.fromClaude ? 'claude'
        : 'user_manual';
      await supabase.rpc('upsert_book', {
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
        _source: resolvedSource,
        _status: 'discovered',
        _metadata: {},
      });
    },
    [user, state.wishlist, state.library, state.readNext]
  );

  const seedWishlistIfNeeded = useCallback(async () => {
    if (!state.onboarded) return;
    if (state.wishlist && state.wishlist.length > 0) return;
    const libraryKeys = new Set(state.library.map(bookKey));
    const seedBooks = ALL_BOOKS.filter((b) => !libraryKeys.has(bookKey(b)));

    if (!user) {
      setState((s) => ({ ...s, wishlist: seedBooks.map((b) => ({ ...b, status: 'verified', verifiedSource: 'curated_seed', source: 'curated' })) }));
      return;
    }

    const linked = [];
    for (const b of seedBooks) {
      const bookId = await upsertBookOnServer(b, 'curated');
      if (!bookId) continue;
      const { error } = await supabase
        .from('wishlist_items')
        .insert({ user_id: user.id, book_id: bookId })
        .select()
        .single();
      if (!error) linked.push({ ...b, bookId, status: 'verified', verifiedSource: 'curated_seed', source: 'curated' });
    }
    setState((s) => ({ ...s, wishlist: dedupeBooks([...s.wishlist, ...linked]) }));
  }, [state.onboarded, state.wishlist, state.library, user, upsertBookOnServer]);

  const addToWishlist = useCallback(
    async (book) => {
      const k = bookKey(book);
      if (state.wishlist.some((b) => bookKey(b) === k)) return false;
      if (state.library.some((b) => bookKey(b) === k)) return false;

      if (!user) {
        setState((s) => ({ ...s, wishlist: [...s.wishlist, { ...book }] }));
        showToast(`"${book.t}" added to your wishlist`);
        return true;
      }

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
    async (book, extra = {}) => {
      const k = bookKey(book);
      if (state.library.some((b) => bookKey(b) === k)) return;
      const today = new Date().toISOString().slice(0, 10);

      const ratingRaw = extra.rating != null ? extra.rating : book.rating;
      const rating = ratingRaw && ratingRaw > 0 ? ratingRaw : null;
      const notes =
        extra.notes != null ? (extra.notes.trim() || null) : (book.notes || null);

      const enriched = { ...book, dateRead: today };
      if (rating != null) enriched.rating = rating;
      if (notes != null) enriched.notes = notes;

      if (!user) {
        setState((s) => ({
          ...s,
          readNext: s.readNext.filter((b) => bookKey(b) !== k),
          wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
          library: [...s.library, enriched],
        }));
        showToast(`"${book.t}" added to your library`);
        return;
      }

      const bookId = book.bookId || (await upsertBookOnServer(book));
      if (!bookId) {
        showToast(`Couldn't save "${book.t}"`, true);
        return;
      }

      const { error: rbErr } = await supabase
        .from('read_books')
        .upsert(
          {
            user_id: user.id,
            book_id: bookId,
            read_at: today,
            source: book.fromGoodreads ? 'goodreads_import' : 'manual',
            rating,
            notes,
          },
          { onConflict: 'user_id,book_id' }
        );
      if (rbErr) {
        console.error('read_books upsert failed', rbErr);
      }
      await supabase
        .from('wishlist_items')
        .delete()
        .eq('user_id', user.id)
        .eq('book_id', bookId);

      setState((s) => ({
        ...s,
        readNext: s.readNext.filter((b) => bookKey(b) !== k),
        wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
        library: [...s.library, { ...enriched, bookId }],
      }));
      showToast(`"${book.t}" added to your library`);
    },
    [user, state.library, showToast, upsertBookOnServer]
  );

  const updateReadBook = useCallback(
    async (book, patch) => {
      if (!patch || (
        patch.rating === undefined &&
        patch.notes === undefined &&
        patch.readAt === undefined
      )) return;
      const k = bookKey(book);

      const update = {};
      if (patch.rating !== undefined) {
        const r = patch.rating && patch.rating > 0 ? patch.rating : null;
        update.rating = r;
      }
      if (patch.notes !== undefined) {
        const n = patch.notes ? patch.notes.trim() : '';
        update.notes = n.length > 0 ? n : null;
      }
      if (patch.readAt) {
        update.read_at = new Date(patch.readAt).toISOString();
      }

      const localPatch = { ...update };
      if (update.read_at) localPatch.dateRead = update.read_at;
      setState((s) => ({
        ...s,
        library: s.library.map((b) =>
          bookKey(b) === k ? { ...b, ...localPatch } : b
        ),
      }));

      if (!user || !book.bookId) return;

      const { error } = await supabase
        .from('read_books')
        .update(update)
        .eq('user_id', user.id)
        .eq('book_id', book.bookId);
      if (error) {
        console.error('read_books update failed', error);
        showToast("Couldn't save your changes", true);
      }
    },
    [user, showToast]
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
            rating: b.rating && b.rating > 0 ? b.rating : null,
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

  const bulkAddToLibrary = useCallback(
    async (books) => {
      const existingKeys = new Set(state.library.map(bookKey));
      const toAdd = books.filter((b) => !existingKeys.has(bookKey(b)));
      const today = new Date().toISOString().slice(0, 10);

      if (!user) {
        setState((s) => ({
          ...s,
          library: dedupeBooks([...s.library, ...toAdd.map((b) => ({ ...b, dateRead: today }))]),
        }));
        return toAdd.length;
      }

      const linked = [];
      for (const b of toAdd) {
        const bookId = b.bookId || (await upsertBookOnServer(b));
        if (!bookId) continue;
        const { error } = await supabase.from('read_books').upsert(
          {
            user_id: user.id,
            book_id: bookId,
            rating: b.rating && b.rating > 0 ? b.rating : null,
            read_at: today,
            source: 'manual',
          },
          { onConflict: 'user_id,book_id' }
        );
        if (!error) linked.push({ ...b, bookId, dateRead: today });
      }
      setState((s) => ({
        ...s,
        library: dedupeBooks([...s.library, ...linked]),
      }));
      return linked.length;
    },
    [user, state.library, upsertBookOnServer]
  );

  // ---------- v0.12: Category mutations ----------

  // Add a category by raw name to a book. The RPC handles upsert + soft-cap.
  // Updates local state optimistically with a placeholder, then reconciles
  // with the real row once the server responds. Returns true on success.
  const addCategoryToBook = useCallback(
    async (book, rawName) => {
      const trimmed = (rawName || '').trim();
      if (!trimmed) return false;
      if (!book?.bookId && user) {
        showToast("Can't tag this book yet — try reopening it", true);
        return false;
      }

      // Guest path: store local-only categories. No verified flag possible.
      if (!user) {
        const placeholderId = `local:${trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        setState((s) => {
          // Use a synthetic book identity for guest mode (no bookId).
          const key = book.bookId || `key:${bookKey(book)}`;
          const existing = s.categoriesByBookId[key] || [];
          if (existing.some((c) => c.categoryId === placeholderId)) return s;
          if (existing.length >= 10) {
            return s; // soft cap
          }
          return {
            ...s,
            categoriesByBookId: {
              ...s.categoriesByBookId,
              [key]: [
                ...existing,
                {
                  categoryId: placeholderId,
                  name: trimmed,
                  verified: false,
                  usageCount: 1,
                  source: 'user',
                },
              ].sort((a, b) => {
                if (a.verified !== b.verified) return a.verified ? -1 : 1;
                return a.name.localeCompare(b.name);
              }),
            },
          };
        });
        return true;
      }

      // Signed-in path: RPC handles it all.
      const { data, error } = await supabase.rpc('link_user_category', {
        _book_id: book.bookId,
        _raw_name: trimmed,
      });
      if (error) {
        // 23514 = soft-cap violation surfaced from the RPC
        if (error.code === '23514') {
          showToast('You can have up to 10 categories per book.', true);
        } else {
          console.error('link_user_category failed', error);
          showToast("Couldn't add that category", true);
        }
        return false;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return false;

      setState((s) => {
        const existing = s.categoriesByBookId[book.bookId] || [];
        const already = existing.find((c) => c.categoryId === row.id);
        const updated = already
          ? existing.map((c) =>
              c.categoryId === row.id
                ? { ...c, verified: row.verified, source: row.verified ? 'verified' : 'user' }
                : c
            )
          : [
              ...existing,
              {
                categoryId: row.id,
                name: row.name,
                verified: row.verified,
                usageCount: row.usage_count,
                source: row.verified ? 'verified' : 'user',
              },
            ];
        updated.sort((a, b) => {
          if (a.verified !== b.verified) return a.verified ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return {
          ...s,
          categoriesByBookId: {
            ...s.categoriesByBookId,
            [book.bookId]: updated,
          },
        };
      });
      return true;
    },
    [user, showToast]
  );

  // Remove a category from a book for the current user. Verified global links
  // (from book_categories) are not removable from the client — only the
  // user's personal link goes away. After remove, if the category was also
  // verified, it stays in the pill list as 'verified' source.
  const removeCategoryFromBook = useCallback(
    async (book, categoryId) => {
      if (!book || !categoryId) return false;

      // Guest path: just drop from local state
      if (!user) {
        const key = book.bookId || `key:${bookKey(book)}`;
        setState((s) => {
          const existing = s.categoriesByBookId[key] || [];
          return {
            ...s,
            categoriesByBookId: {
              ...s.categoriesByBookId,
              [key]: existing.filter((c) => c.categoryId !== categoryId),
            },
          };
        });
        return true;
      }

      if (!book.bookId) return false;

      const { data, error } = await supabase.rpc('unlink_user_category', {
        _book_id: book.bookId,
        _category_id: categoryId,
      });
      if (error) {
        console.error('unlink_user_category failed', error);
        showToast("Couldn't remove that category", true);
        return false;
      }

      // After unlink, the category might still appear if it's a verified
      // global one. Refetch without embedded-select syntax (some Supabase
      // edge configs reject the `category:categories(...)` shorthand
      // with a bare 400).
      const [refreshGlobal, refreshUser] = await Promise.all([
        supabase
          .from('book_categories')
          .select('book_id, category_id')
          .eq('book_id', book.bookId),
        supabase
          .from('user_book_categories')
          .select('book_id, category_id')
          .eq('book_id', book.bookId),
      ]);
      const refreshErr = refreshGlobal.error || refreshUser.error;

      let refreshed = null;
      if (!refreshErr) {
        const allCategoryIds = [...new Set([
          ...(refreshGlobal.data || []).map((r) => r.category_id),
          ...(refreshUser.data || []).map((r) => r.category_id),
        ])];
        let categoriesById = {};
        if (allCategoryIds.length > 0) {
          const { data: catRows } = await supabase
            .from('categories')
            .select('id, name, normalized_name, verified, usage_count')
            .in('id', allCategoryIds);
          for (const c of (catRows || [])) {
            categoriesById[c.id] = c;
          }
        }
        const buildRow = (linkRow, baseSource) => {
          const c = categoriesById[linkRow.category_id];
          if (!c) return null;
          return {
            book_id: linkRow.book_id,
            category_id: c.id,
            category_name: c.name,
            normalized_name: c.normalized_name,
            verified: c.verified,
            usage_count: c.usage_count,
            source: baseSource === 'verified'
              ? 'verified'
              : (c.verified ? 'verified' : 'user'),
          };
        };
        refreshed = [
          ...(refreshGlobal.data || []).map((r) => buildRow(r, 'verified')).filter(Boolean),
          ...(refreshUser.data || []).map((r) => buildRow(r, 'user')).filter(Boolean),
        ];
      }
      if (refreshErr) {
        // Fall back to optimistic local removal
        setState((s) => {
          const existing = s.categoriesByBookId[book.bookId] || [];
          return {
            ...s,
            categoriesByBookId: {
              ...s.categoriesByBookId,
              [book.bookId]: existing.filter((c) => c.categoryId !== categoryId),
            },
          };
        });
        return true;
      }
      const rolled = rollupCategories(refreshed || []);
      setState((s) => ({
        ...s,
        categoriesByBookId: {
          ...s.categoriesByBookId,
          [book.bookId]: rolled[book.bookId] || [],
        },
      }));
      return true;
    },
    [user, showToast]
  );

  // Autocomplete search. Returns a list of { id, name, verified, usageCount,
  // exactMatch } ranked by the RPC. Empty query returns most-used verified
  // categories. Component handles the "Create new" affordance.
  const searchCategories = useCallback(
    async (query, limit = 8) => {
      // Guest mode: no remote catalog. Return empty so the component shows
      // only the "Create new" affordance. We could enhance this later by
      // scanning local categoriesByBookId for matches, but for now keep
      // guest categorization purely local-input.
      if (!user) {
        return [];
      }
      const { data, error } = await supabase.rpc('search_categories', {
        _query: query || '',
        _limit: limit,
      });
      if (error) {
        console.error('search_categories failed', error);
        return [];
      }
      return (data || []).map((r) => ({
        id: r.id,
        name: r.name,
        normalizedName: r.normalized_name,
        verified: r.verified,
        usageCount: r.usage_count,
        exactMatch: r.exact_match,
      }));
    },
    [user]
  );

  // Lookup for a book's category list. Returns array (possibly empty).
  // Looks up by bookId when available, falling back to a synthetic key
  // for guest-mode books that don't have a Supabase id.
  const getCategoriesForBook = useCallback(
    (book) => {
      if (!book) return [];
      const key = book.bookId || `key:${bookKey(book)}`;
      return state.categoriesByBookId[key] || [];
    },
    [state.categoriesByBookId]
  );

  // ---------- Profile / misc mutations (unchanged) ----------

  // v0.15 phase 2.3: called by the Oracle categorization service (phase 2.4)
  // after it assigns genres to a batch of books. `assignments` is an array of
  // { bookId, genres: [{ genreId, name, normalizedName, source, usageCount, assignedBySource }] }.
  // Merges new genre assignments into state.genresByBookId so the UI updates
  // immediately without a full reload.
  const setBookGenres = useCallback((assignments) => {
    setState((s) => {
      const updated = { ...s.genresByBookId };
      for (const { bookId, genres } of assignments) {
        // Merge: keep existing genres, add/overwrite with new ones (by genreId).
        const existing = updated[bookId] || [];
        const existingMap = {};
        for (const g of existing) existingMap[g.genreId] = g;
        for (const g of genres) existingMap[g.genreId] = g;
        updated[bookId] = Object.values(existingMap).sort((a, b) => {
          if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
          return a.name.localeCompare(b.name);
        });
      }
      return { ...s, genresByBookId: updated };
    });
  }, []);

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
    loadedUserIdRef.current = null;
    if (user) {
      await Promise.all([
        supabase.from('wishlist_items').delete().eq('user_id', user.id),
        supabase.from('read_books').delete().eq('user_id', user.id),
        supabase.from('plans').delete().eq('user_id', user.id),
        supabase.from('user_book_categories').delete().eq('user_id', user.id),
      ]);
    }
  }, [user]);

  // ---------- The Vault ----------
  const [vault, setVault] = useState(null);
  const loadVault = useCallback(async () => {
    if (vault) return vault;
    if (!user) {
      const v = ALL_BOOKS.map((b) => ({ ...b, status: 'verified', verifiedSource: 'curated_seed', source: 'curated' }));
      setVault(v);
      return v;
    }
    const { data, error } = await supabase
      .from('books')
      .select('*, position_in_series, series:series(*)')
      .eq('source', 'curated')
      .eq('status', 'verified')
      .order('title', { ascending: true });
    if (error || !data) {
      console.error('Vault fetch failed', error);
      const v = ALL_BOOKS.map((b) => ({ ...b, status: 'verified', verifiedSource: 'curated_seed', source: 'curated' }));
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
    seedWishlistIfNeeded,
    addToWishlist,
    removeFromWishlist,
    addToReadNext,
    removeFromReadNext,
    markAsRead,
    updateReadBook,
    removeFromLibrary,
    importGoodreads,
    bulkAddToLibrary,
    cacheBookFields,
    upsertDiscoveredBook,
    // v0.12: category mutations
    addCategoryToBook,
    removeCategoryFromBook,
    searchCategories,
    getCategoriesForBook,
    // v0.15 phase 2.3: genre mutations (called by Oracle categorization service)
    setBookGenres,
    setProfile,
    setOnboarded,
    setShelfSortMode,
    setOracleMode,
    setCurrentPlan,
    resetAll,
    vault,
    loadVault,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
