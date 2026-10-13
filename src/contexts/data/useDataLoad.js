// src/contexts/data/useDataLoad.js — getting the reader's data into `state`, and
// keeping the caches and the server in step with it.
//
// The initial-load effect (session cache → Supabase → localStorage fallback,
// guests straight from localStorage) and the persist effect that runs on every
// state change. The rules that matter — a failed load is never persisted, the
// cache is trusted only while the catalogue and shelf stamps match — are
// explained inline.

import { useEffect, useState, useRef } from 'react';
import { loadSessionCache, fetchCatalogVersion, catalogVersionRef, shelfStampRef, sameShelfStamp, fetchShelfStamp, saveSessionCache, clearSessionCache, loadLocal, saveLocal } from './cache';
import { loadFromSupabase, savePreferences } from './load';
import { defaultState } from './defaults';

/**
 * Called once by DataProvider; returns loading, hydratedUserId, loadedUserIdRef, supabaseLoadedRef.
 * @param {object} deps  user, authLoading, state, setState — from DataProvider and earlier domains
 */
export function useDataLoad({ user, authLoading, state, setState }) {
  // No-user (guest/logged-out) path has nothing to load from Supabase, so
  // we can render immediately. Only flip to true when fetching for a real user.
  const [loading, setLoading] = useState(false);

  // v0.13.1 follow-up: ref-guarded "already loaded for this user ID". Prevents
  // the load effect from refetching when the user reference changes without
  // the user identity actually changing — defense in depth on top of the
  // AuthContext fix.
  // Use a sentinel that can never equal a real userId or null-after-load, so
  // the first run always executes (fixes guest mode where null === null guard
  // was skipping the effect and leaving loading stuck at its initial value).
  const loadedUserIdRef = useRef('__uninitialized__');
  // True once we have real Supabase data (not just cache or localStorage).
  // Prevents the persist effect from overwriting localStorage with stale data.
  const supabaseLoadedRef = useRef(false);
  // v0.71.2: the same fact as supabaseLoadedRef, but as state and keyed to the
  // user, so components can wait on it. `loading` is not enough: it starts
  // false and is only flipped by this provider's load effect, which runs AFTER
  // its children's effects in the same commit. Public routes (book-page,
  // list-view, plan-view…) mount Nav for a signed-in reader before the load
  // resolves, so anything deciding on `state` there was reading the
  // localStorage snapshot, not the reader's profile.
  const [hydratedUserId, setHydratedUserId] = useState(null);

  // ---------- Initial load ----------
  useEffect(() => {
    if (authLoading) return;
    const userId = user?.id || null;
    // Clear session cache if switching users
    if (loadedUserIdRef.current !== '__uninitialized__' &&
        loadedUserIdRef.current !== null &&
        loadedUserIdRef.current !== userId) {
      clearSessionCache();
    }
    if (loadedUserIdRef.current === userId) return;
    let cancelled = false;
    (async () => {
      if (user) {
        // Check session cache first — render instantly without a spinner
        const cached = loadSessionCache(user.id);
        if (cached) {
          const merged = { ...defaultState, ...cached.state };
          if (!cancelled) {
            supabaseLoadedRef.current = true; // treat cache as authoritative
            catalogVersionRef.current = cached.catalogVersion;
            setState(merged);
            setHydratedUserId(user.id);
            loadedUserIdRef.current = user.id;
            setLoading(false);
          }
          // No background refresh of STATE — mutations keep the cache fresh via
          // saveSessionCache in the persist effect, and a stale Supabase read would
          // overwrite in-memory mutations.
          //
          // v0.57: but we DO check one integer. Changes made outside the app — the
          // weekly maintenance job, fixBook.mjs, a merge_books() call — are invisible
          // to the cache, and for a merge that means holding a book_id that no longer
          // exists. Checking the catalog version overwrites nothing; it only decides
          // whether this cache is still trustworthy.
          // v0.65.3: two checks now, same rule — each only decides whether the
          // cache is trustworthy, neither overwrites in-memory state.
          //   catalogVersion — did the CATALOGUE change under us?
          //   shelfStamp     — did this reader's SHELF change under us?
          // The second is the one that was missing, and it is the one that
          // matters for "I edited a read date somewhere else and this tab never
          // noticed". Fetched together; a null from either means the check is
          // unavailable and we fall back to trusting the cache, as before.
          const [live, liveShelf] = await Promise.all([
            fetchCatalogVersion(),
            fetchShelfStamp(user.id),
          ]);
          const catalogMoved =
            live != null && cached.catalogVersion != null && live !== cached.catalogVersion;
          const shelfMoved = !sameShelfStamp(cached.shelfStamp, liveShelf);
          if (!cancelled && (catalogMoved || shelfMoved)) {
            console.info(
              catalogMoved
                ? `[catalog] cache built at v${cached.catalogVersion}, live is v${live} — reloading`
                : '[shelf] read_books changed since this cache was written — reloading'
            );
            clearSessionCache();
            try {
              const remote = await loadFromSupabase(user.id);
              if (!cancelled) {
                catalogVersionRef.current = live;
                shelfStampRef.current = liveShelf;
                setState(remote);
                saveSessionCache(user.id, remote);
              }
            } catch (e) {
              console.error('[catalog] refresh after version change failed', e);
            }
          } else if (!cancelled) {
            // Cache predates one or both mechanisms — stamp it so the next load
            // has something to compare against.
            if (live != null && cached.catalogVersion == null) catalogVersionRef.current = live;
            if (cached.shelfStamp == null) shelfStampRef.current = liveShelf;
          }
        } else {
          // No cache — fetch from Supabase with spinner
          setLoading(true);
          try {
            const [remote, live, liveShelf] = await Promise.all([
              loadFromSupabase(user.id),
              fetchCatalogVersion(),
              fetchShelfStamp(user.id),
            ]);
            if (!cancelled) {
              supabaseLoadedRef.current = true;
              catalogVersionRef.current = live;
              // v0.65.3: stamped on the no-cache path too, or the FIRST cache
              // written in a session would carry a null shelfStamp and the
              // check would be unavailable for exactly the reader who just
              // loaded fresh.
              shelfStampRef.current = liveShelf;
              setState(remote);
              saveSessionCache(user.id, remote);
              loadedUserIdRef.current = user.id;
              setHydratedUserId(user.id);
            }
          } catch (e) {
            // Deliberately does NOT set supabaseLoadedRef, so the persist effect
            // stays quiet and neither cache learns anything from a failed load.
            console.error('Failed to load from Supabase, falling back to local', e);
            if (!cancelled) setState(loadLocal());
          }
          if (!cancelled) setLoading(false);
        }
      } else {
        // Guest / logged-out: load from localStorage synchronously, no spinner needed
        clearSessionCache();
        setState(loadLocal());
        loadedUserIdRef.current = null;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, setState]);

  // ---------- Persist on every state change ----------
  // Only persist after real Supabase data has loaded — prevents stale cache/localStorage
  // state (with empty genresByBookId) from overwriting good data on mount.
  useEffect(() => {
    if (loading) return;
    if (!supabaseLoadedRef.current) return; // wait for real data before persisting
    saveLocal(state);
    if (user) {
      saveSessionCache(user.id, state); // keep session cache fresh on mutations
      savePreferences(user.id, state).catch(console.error);
    }
  }, [state, loading, user]);

  return { loading, hydratedUserId, loadedUserIdRef, supabaseLoadedRef };
}
