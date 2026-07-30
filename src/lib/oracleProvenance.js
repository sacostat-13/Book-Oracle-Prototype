// src/lib/oracleProvenance.js — v0.58
//
// Records which books the Oracle offered, and what became of them.
// Spec: docs/oracle-provenance-v1-spec.md · Schema: schema_v45_migration.sql
//
// ── The one rule ─────────────────────────────────────────────────────────────
// Nothing in this module may ever surface to the reader or interrupt a caller.
// It is instrumentation attached to a result the reader just spent an Oracle
// call on: if logging fails, the correct outcome is that they never find out.
// Every export therefore swallows its own errors and resolves to a benign
// value. No throws, no toasts, no retries.
//
// ── Why log impressions, not accepts ─────────────────────────────────────────
// Stamping provenance only when a book is added would record exactly the
// recommendations that worked. The Oracle's worst suggestions are the ones
// nobody adds — invisible under that design, and the average would flatter
// itself. So every surfaced book gets a row immediately; the outcome is written
// later, if there is one.

import { supabase } from './supabase';

// Mirrors the allowlist in schema_v45. Kept here too so a typo is caught before
// a round trip rather than quietly collapsing a metric into 'unknown'.
const SURFACES = ['spark', 'ask', 'similar', 'categories', 'plan'];

/**
 * Log a result set the moment it is shown.
 *
 * @param {string} surface  one of SURFACES
 * @param {Array}  books    result objects — { t, a } or { title, author }
 * @param {number|null} callId  oracle_call_log.id, when known
 * @returns {Promise<number[]>} recommendation ids in result order; [] on any
 *          failure or for guests. Callers zip these onto the books they just
 *          rendered — an empty array simply means provenance is unavailable
 *          for this set, which is not an error condition.
 */
export async function logRecommendations(surface, books, callId = null) {
  try {
    if (!Array.isArray(books) || books.length === 0) return [];
    if (!SURFACES.includes(surface)) {
      console.warn(`logRecommendations: unknown surface "${surface}"`);
      return [];
    }

    // Guests have no account to attribute to. Checked here as well as in the
    // RPC so the common case costs nothing at all.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) return [];

    // Accept both result shapes in the codebase: Oracle views build { t, a },
    // the raw parse has { title, author }.
    const payload = books.map((b, i) => ({
      title:    b?.t ?? b?.title ?? null,
      author:   b?.a ?? b?.author ?? null,
      position: i + 1,
    })).filter((b) => b.title);

    if (payload.length === 0) return [];

    const { data, error } = await supabase.rpc('log_oracle_recommendations', {
      p_surface: surface,
      p_books:   payload,
      p_call_id: callId,
    });
    if (error) { console.error('logRecommendations failed:', error); return []; }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('logRecommendations threw:', e);
    return [];
  }
}

/**
 * Attach the returned ids to the result objects, so the accept path can resolve
 * them later without a lookup.
 *
 * Positional zip: the RPC returns ids in insertion order and insertion order is
 * result order. If the arrays disagree in length — a title was dropped as
 * blank, say — the extra books simply go untagged and fall back to title
 * matching on accept. Better a partial link than a wrong one.
 */
export function attachRecommendationIds(books, ids) {
  if (!Array.isArray(books) || !Array.isArray(ids) || ids.length === 0) return books;
  return books.map((b, i) => (
    ids[i] != null ? { ...b, recommendationId: ids[i] } : b
  ));
}

/**
 * Mark a recommendation as taken up.
 *
 * `recommendationId` is the fast path. The title fallback exists because a
 * reader who reloads between seeing a recommendation and adding it loses the
 * in-memory id — common enough that dropping those would bias the accept rate
 * toward people who act immediately.
 *
 * Safe to call for ANY book: one that was never recommended resolves to null
 * and writes nothing, so the accept path does not need to know or care whether
 * a book came from the Oracle.
 */
export async function resolveRecommendation({ recommendationId = null, title = null, bookId = null, outcome = 'accepted' } = {}) {
  try {
    if (recommendationId == null && !title) return null;

    const { data, error } = await supabase.rpc('resolve_oracle_recommendation', {
      p_recommendation_id: recommendationId,
      p_book_title:        title,
      p_book_id:           bookId,
      p_outcome:           outcome,
    });
    if (error) { console.error('resolveRecommendation failed:', error); return null; }
    return data ?? null;
  } catch (e) {
    console.error('resolveRecommendation threw:', e);
    return null;
  }
}

/**
 * True when a book carries any sign of Oracle origin.
 *
 * `aiSuggested` predates provenance and is set by all three Oracle views;
 * `recommendationId` is the v0.58 addition. Either means the same thing to the
 * accept path, and checking both keeps books that were in flight across the
 * deploy from being misfiled as self-chosen.
 */
export function isOracleSuggested(book) {
  return !!(book?.recommendationId != null || book?.aiSuggested);
}
