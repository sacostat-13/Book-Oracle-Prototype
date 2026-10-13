// src/contexts/data/cache.js — the two client-side copies of the reader's data.
//
//   localStorage   — the guest store, and the fallback when a signed-in load fails
//   sessionStorage — a per-tab cache of the signed-in state so new tabs render
//                    instantly; trusted only while the catalogue version and the
//                    shelf stamp still match (see the notes on each below).
//
// Moved out of DataContext.jsx in Sprint 4 with behaviour unchanged.

import { supabase } from '../../lib/api/supabase';
import { bookKey } from '../../lib/book/bookHelpers';
import { LOCAL_KEY, SESSION_KEY, defaultState } from './defaults';

// v0.57: the cached payload carries the catalog version it was built from.
// Returns { state, catalogVersion } so the caller can check it against the live value.
export function loadSessionCache(userId) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { uid, state, ts, catalogVersion, shelfStamp } = JSON.parse(raw);
    if (uid !== userId) return null; // wrong user, ignore
    // Expire after 30 minutes — forces a fresh load if stale
    if (Date.now() - ts > 30 * 60 * 1000) return null;
    return {
      state,
      catalogVersion: catalogVersion ?? null,
      shelfStamp: shelfStamp ?? null,
    };
  } catch (_) { return null; }
}

// One integer, bumped by a statement-level trigger on public.books (schema_v43).
// Deliberately a separate, tiny query rather than a full state refetch: this decides
// whether the cache is USABLE, it never overwrites in-memory state, so it does not
// reintroduce the race that the no-background-refresh comment below guards against.
export async function fetchCatalogVersion() {
  try {
    const { data, error } = await supabase.from('catalog_meta').select('version').single();
    return error ? null : (data?.version ?? null);
  } catch (_) { return null; }
}

// Module-scoped so the persist effect can stamp saves without threading it through
// every call site. Set on load and whenever a fresh version is observed.
export const catalogVersionRef = { current: null };

// v0.65.3 — the shelf half of the same idea.
//
// catalogVersionRef above tracks changes to the CATALOGUE. Nothing tracked
// changes to the reader's own SHELF, so a read_books row edited anywhere other
// than this tab's React state — another tab, another device, a hand-run UPDATE
// in the SQL editor, a batch script — stayed invisible for the cache's full
// 30-minute life. sessionStorage is designed to survive F5, so a hard refresh
// did not clear it either. That is how a corrected read date can keep counting
// toward this month while the database has been right the whole time.
//
// `{ n, latest }`: row count plus the newest updated_at. Count alone misses an
// edit (no row created); updated_at alone misses a delete. Together they move
// on any change that matters. Requires migration
// 20260820140000_read_books_updated_at.sql; falls back to the old
// catalog-version-only behaviour when the column is absent, so the client can
// ship before the migration lands.
//
// NOTE ON STALENESS OF THE REF ITSELF: a local mutation bumps updated_at on the
// server but not this ref, so the next load sees a stamp mismatch and refetches
// once. That is the correct direction to fail — an unnecessary refetch costs one
// round trip; a missed one costs a wrong number on the Profile that no amount of
// refreshing will fix.
export const shelfStampRef = { current: null };

export function sameShelfStamp(a, b) {
  if (!a || !b) return true;   // unknown on either side proves nothing
  return a.n === b.n && a.latest === b.latest;
}

export async function fetchShelfStamp(userId) {
  try {
    const { data, error, count } = await supabase
      .from('read_books')
      .select('updated_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);
    // The column does not exist yet — migration not applied. Not an error
    // worth surfacing; it just means this check is unavailable.
    if (error) return null;
    return { n: typeof count === 'number' ? count : null, latest: data?.[0]?.updated_at ?? null };
  } catch (_) { return null; }
}

export function saveSessionCache(userId, state) {
  try {
    // Cache the full state including genres — the full genre list is small
    // (a few dozen rows) and is needed by PlanCreate, genre browsers, etc.
    // Excluding it caused genres to be empty whenever the cache was hit.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      uid: userId,
      state,
      ts: Date.now(),
      // Preserved across saves — the persist effect has no reason to re-fetch it, and a
      // change made outside the app is exactly what the load path is checking for.
      catalogVersion: catalogVersionRef.current,
      shelfStamp: shelfStampRef.current,
    }));
  } catch (_) {} // quota errors — fail silently
}

export function clearSessionCache() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
}

export function dedupeBooks(books) {
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
export function loadLocal() {
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
      currentlyReading: dedupeBooks(parsed.currentlyReading || []),
      // v0.44: guest-mode reading memories ride localStorage too
      memories: parsed.memories || {},
      // v0.45: guest-mode accomplishments ride localStorage too
      accomplishments: parsed.accomplishments || [],
      // v0.46: guest-mode dismissed coach-marks ride localStorage too
      coachmarksSeen: parsed.coachmarksSeen || [],
      // v0.46: guest-mode "what's new" seen-marker rides localStorage too
      lastSeenVersion: parsed.lastSeenVersion || null,
    };
  } catch {
    return { ...defaultState };
  }
}

export function saveLocal(state) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {}
}
