// src/contexts/domains/accomplishments.js — earning accomplishments and the
// completion share moment, plus the retroactive backfill on every load.
// The milestone maths lives in lib/achievements/; this file persists and queues.

import { useCallback, useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/api/supabase';
import { computeCompletionMoments } from '../../lib/achievements/shareMoments';
import { entryFromMoment, computeBackfillAccomplishments } from '../../lib/achievements/accomplishments';

/**
 * Called once by DataProvider; returns earnAccomplishments, fireCompletionMoment, backfillPending.
 * @param {object} deps  user, state, setState, loading, supabaseLoadedRef, loadedUserIdRef, setShareMoment — from DataProvider and earlier domains
 */
export function useAccomplishments({ user, state, setState, loading, supabaseLoadedRef, loadedUserIdRef, setShareMoment }) {
  // v0.45: guards the one-time accomplishments backfill against re-running
  // within a session (belt-and-braces on top of the persisted stamp).
  const backfillRanRef = useRef(false);
  // v0.67: true while the replay is in flight. Now that nothing is gated on a
  // stamp, the recompute runs on every mount, so the Ledger has a real gap
  // between "shelves loaded" and "family rows exist" — this is what lets it
  // draw placeholders in that gap instead of an empty panel that looks final.
  // Deliberately NOT part of `state`: it is session-scoped UI status, and
  // persisting it to localStorage would recreate the stamp we just deleted.
  const [backfillPending, setBackfillPending] = useState(false);

  // v0.45: persist a batch of earned accomplishments. Idempotent via the DB's
  // unique(user_id, key) (on-conflict-do-nothing) and, in memory, by deduping
  // against keys already held. Optimistic: merges into state immediately so the
  // ledger updates without a round-trip; server ids reconcile on next load.
  const earnAccomplishments = useCallback(
    async (entries) => {
      const earnable = (entries || []).filter((e) => e && e.key);
      // Returns whether the rows are SAFELY PERSISTED. Callers that record
      // "this has been done" — the backfill's version stamp — must not treat a
      // failed write as done. Until v0.67 this returned undefined either way,
      // and the backfill stamped success over a 400.
      if (!earnable.length) return { ok: true, written: 0 };

      setState((s) => {
        const have = new Set((s.accomplishments || []).map((a) => a.key));
        const additions = [];
        const seen = new Set();
        for (const e of earnable) {
          if (have.has(e.key) || seen.has(e.key)) continue;
          seen.add(e.key);
          additions.push({
            id: (typeof crypto !== 'undefined' && crypto.randomUUID)
              ? crypto.randomUUID()
              : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            key: e.key,
            kind: e.kind,
            bookId: e.bookId ?? null,
            meta: e.meta || {},
            earnedAt: e.earnedAt || new Date().toISOString(),
          });
        }
        if (!additions.length) return s;
        return { ...s, accomplishments: [...additions, ...(s.accomplishments || [])] };
      });

      if (user) {
        const rows = earnable.map((e) => ({
          user_id: user.id,
          key: e.key,
          kind: e.kind,
          book_id: e.bookId ?? null,
          meta: e.meta || {},
          earned_at: e.earnedAt || new Date().toISOString(),
        }));
        const { error } = await supabase
          .from('reading_accomplishments')
          .upsert(rows, { onConflict: 'user_id,key', ignoreDuplicates: true });
        if (error) {
          console.warn('reading_accomplishments upsert failed', error);
          return { ok: false, written: 0, error };
        }
        return { ok: true, written: rows.length };
      }
      // Guest mode: local state IS the store, so the optimistic update above is
      // the write.
      return { ok: true, written: earnable.length };
    },
    [user, setState]
  );

  // v0.43: after a completion lands in the library, compute the share moment
  // it produced (goal / series / plan / milestone / plain book card) and
  // queue the action-share modal. Skipped for Goodreads imports — a bulk
  // import of 400 books is not 400 celebrations (imported books earn their
  // accomplishments through the retroactive backfill instead, dated to each
  // book's read date, so no modal fires).
  const fireCompletionMoment = useCallback(
    (book, newLibrary, opts = {}) => {
      if (book.fromGoodreads) return null;
      try {
        const moments = computeCompletionMoments({
          book,
          library: newLibrary,
          genresByBookId: state.genresByBookId,
          goal: state.readingGoalCount,
          plans: state.plans,
        });
        // v0.45: the same computation feeds the persistent ledger — every
        // milestone-bearing moment (all but the plain book_completed fallback)
        // is earned. One computation, two consumers.
        earnAccomplishments(moments.map((m) => entryFromMoment(m)).filter((e) => e.key));
        // opts.defer lets the caller open the share modal itself later — e.g. the
        // Book page rates the finished book first, then celebrates — instead of
        // the share modal opening hidden behind the rating modal.
        if (moments[0] && !opts.defer) setShareMoment(moments[0]);
        return moments[0] || null;
      } catch (err) {
        // A share card (or ledger write) must never break a completion.
        console.warn('share moment computation failed', err);
        return null;
      }
    },
    [state.genresByBookId, state.readingGoalCount, state.plans, earnAccomplishments, setShareMoment]
  );

  // v0.45: one-time retroactive backfill. On the first load where this profile
  // has no backfill stamp, replay the milestone ladders over the existing
  // library (dated to each crossing read) and earn everything already implied —
  // pre-feature history and Goodreads imports included. Idempotent against the
  // DB unique key, which is what makes running it every mount safe.
  useEffect(() => {
    if (loading) return;
    if (user && !supabaseLoadedRef.current) return;        // wait for real data
    if (!user && loadedUserIdRef.current !== null) return; // guest not loaded yet
    // v0.67: NO GATE. This used to check a stamp — first a timestamp, then a
    // version — and skip the recompute when it was set.
    //
    // The stamp was only ever an optimisation (the v1 spec says so), and it
    // cost more than it saved. A stamp records "this has been done", so it is
    // only true if the write actually landed; when the kind-check constraint
    // rejected the family rows, the stamp was written anyway and every profile
    // was permanently marked as backfilled against ladders it had never
    // computed. Fixing that meant a version column, a migration to add it, and
    // a second migration to repair the values the flaw had already written.
    //
    // Recomputing every mount is genuinely wasteful — O(library), and it
    // re-sends rows that already exist — and it is entirely safe: every insert
    // is `on conflict (user_id, key) do nothing`. A few hundred redundant rows
    // on load is a cheaper problem than a cache that can lie about work being
    // finished. If this ever becomes a real cost, the fix is to make the write
    // cheaper, not to reintroduce a flag that can be wrong.
    //
    // backfillRanRef stays: it stops the replay firing more than once per
    // mount, which is a different job from remembering across sessions.
    if (backfillRanRef.current) return;
    backfillRanRef.current = true;
    setBackfillPending(true);
    (async () => {
      try {
        const entries = computeBackfillAccomplishments({
          library: state.library,
          genresByBookId: state.genresByBookId,
          plans: state.plans,
          goal: state.readingGoalCount,
        });
        const result = await earnAccomplishments(entries);
        // Nothing gates on this any more, but the check stays: an error path
        // that returns what the success path returns is the failure shape that
        // cost three rounds of debugging here, and a warning is the point.
        if (!result?.ok) {
          backfillRanRef.current = false; // try again on the next mount
        }
      } catch (e) {
        console.warn('accomplishments backfill failed', e);
        backfillRanRef.current = false; // allow a retry on the next mount
      } finally {
        // finally, not the try tail: a skeleton that outlives its failure is a
        // spinner that never stops, which is worse than an empty panel.
        setBackfillPending(false);
      }
    })();
  }, [
    user,
    loading,
    state.library,
    state.genresByBookId,
    state.plans,
    state.readingGoalCount,
    earnAccomplishments,
    loadedUserIdRef,
    supabaseLoadedRef,
  ]);

  return { earnAccomplishments, fireCompletionMoment, backfillPending };
}
