// src/contexts/DataContext.jsx — the reader's data, in one provider.
//
// Holds one `state` object (shape: data/defaults.js) and exposes it, with every
// action on it, through useData(). Signed-in readers load from and persist to
// Supabase; guests live in localStorage.
//
// This file only wires things together. The work lives in:
//   data/        loading, caching and saving preferences (useDataLoad, load.js, cache.js)
//   domains/     one module per area: shelves, reading, accomplishments, memories,
//                imports, categories, profile, plans, vault, catalog, notices,
//                lists (Anthologies) and clubs
// See docs/reference/ARCHITECTURE.md ("Providers"). tests/data-provider.test.jsx
// records what every action does; run it after touching any domain.
import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/api/supabase';
import { useAuth } from './AuthContext';
import { loadLocal, saveLocal } from './data/cache';
import { defaultState } from './data/defaults';
import { useDataLoad } from './data/useDataLoad';
import { createListActions } from './domains/lists';
import { createClubActions } from './domains/clubs';
import { useNotices } from './domains/notices';
import { useCatalogWrites } from './domains/catalog';
import { useShelfActions } from './domains/shelves';
import { useAccomplishments } from './domains/accomplishments';
import { useReadingMemories } from './domains/memories';
import { useReadingActions } from './domains/reading';
import { useImports } from './domains/imports';
import { useCategories } from './domains/categories';
import { useProfileSettings } from './domains/profile';
import { usePlans } from './domains/plans';
import { useVault } from './domains/vault';

export const DataContext = createContext(null);

// v0.15: helper for UI "verified" checks. Both 'verified' and 'oracle_categorized'
// render as verified (gilt ☩). 'incomplete', 'unreviewed', 'flagged' don't.
// Use this everywhere we used to check `book.verified`.
export function isBookVerified(bookOrSeries) {
  const s = bookOrSeries?.status;
  return s === 'verified' || s === 'oracle_categorized';
}

export function DataProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState(() => loadLocal());
  // Latest state for callbacks built once per user (domain actions).
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Domains ────────────────────────────────────────────────────────────────
  // Each hook below owns one slice of behaviour (contexts/domains/*.js) and is
  // called in this order on purpose: later domains use earlier ones, and the
  // effects inside them (load, persist, accomplishments backfill) must keep
  // running in this sequence. tests/data-provider.test.jsx records the result.
  const { toast, showToast, shareMoment, setShareMoment, showShareMoment, dismissShareMoment, shareAccomplishment } = useNotices();
  const { loading, hydratedUserId, loadedUserIdRef, supabaseLoadedRef } = useDataLoad({ user, authLoading, state, setState });
  const { upsertBookOnServer, cacheBookFields, upsertDiscoveredBook } = useCatalogWrites({ user, state, setState });
  const { seedWishlistIfNeeded, addToWishlist, removeFromWishlist, addToReadNext, removeFromReadNext } = useShelfActions({ user, state, setState, showToast, upsertBookOnServer });
  const { fireCompletionMoment, backfillPending } = useAccomplishments({ user, state, setState, loading, supabaseLoadedRef, loadedUserIdRef, setShareMoment });
  const { memoriesForBook, addReadingMemory, deleteReadingMemory } = useReadingMemories({ user, state, setState, upsertBookOnServer });
  const { markAsRead, startReading, removeFromCurrentlyReading, finishReading, saveReaderEdition, updateListeningProgress, updateReadingProgress, updateReadBook, removeFromLibrary } = useReadingActions({ user, state, setState, showToast, upsertBookOnServer, fireCompletionMoment, addReadingMemory });
  const { importGoodreads, bulkAddToLibrary, bulkAddToWishlist, importJob, dismissImportJob, runGoodreadsImport } = useImports({ user, state, setState, upsertBookOnServer, startReading });
  const { addCategoryToBook, removeCategoryFromBook, searchCategories, getCategoriesForBook, setBookGenres } = useCategories({ user, state, setState, showToast });
  const { setProfile, setOnboarded, setShelfSortMode, setOracleMode, setDashboardLayout, dismissCoachmark, markReleasesSeen, setReadingGoalCount, updateUsername, updateDisplayName, updateAvatar, updatePrivacyPrefs } = useProfileSettings({ user, setState });
  const { setCurrentPlan, deletePlan } = usePlans({ user, setState });
  const { vault, loadVault } = useVault();

  // ── Anthologies and clubs: contexts/domains/{lists,clubs}.js ───────────────
  // Built once per signed-in reader. addBookToList reads the CURRENT lists at
  // call time through stateRef (it used to close over state.lists).
  const listActions = useMemo(
    () => createListActions({ user, setState, getLists: () => stateRef.current.lists }),
    [user]
  );
  const clubActions = useMemo(() => createClubActions({ user, setState }), [user]);

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
  }, [user, loadedUserIdRef]);

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
    // v0.22: currently reading
    startReading,
    finishReading,
    removeFromCurrentlyReading,
    // v0.28: reading progress
    updateReadingProgress,
    updateListeningProgress,
    saveReaderEdition,
    // v0.44: reading memory
    memoriesForBook,
    addReadingMemory,
    deleteReadingMemory,
    // v0.45: reading accomplishments (the Ledger)
    accomplishments: state.accomplishments || [],
    // v0.67: the Ledger draws skeleton rows while this is true.
    accomplishmentsBackfilling: backfillPending,
    shareAccomplishment,
    // v0.46: feature-discovery coach-marks
    coachmarksSeen: state.coachmarksSeen || [],
    dismissCoachmark,
    // v0.46: "what's new" seen-marker
    lastSeenVersion: state.lastSeenVersion || null,
    markReleasesSeen,
    // v0.71.2: true once `state` is this reader's real data (session cache or
    // Supabase), never the localStorage snapshot it boots from.
    dataHydrated: !!user && hydratedUserId === user.id,
    importGoodreads,
    bulkAddToLibrary,
    bulkAddToWishlist,
    importJob,
    runGoodreadsImport,
    dismissImportJob,
    cacheBookFields,
    upsertDiscoveredBook,
    upsertBookOnServer,
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
    setDashboardLayout,
    setReadingGoalCount,
    updateUsername,
    updateDisplayName,
    updateAvatar,
    updatePrivacyPrefs,
    plans: state.plans || [],
    lists: state.lists || [],
    clubs: state.clubs || [],
    setCurrentPlan,
    deletePlan,
    // Anthology and club methods (same names as before; prefer useLists() /
    // useClubs() in new code).
    ...listActions,
    ...clubActions,
    resetAll,
    vault,
    loadVault,
    // v0.43: action-share moments
    shareMoment,
    showShareMoment,
    dismissShareMoment,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);

