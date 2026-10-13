// src/contexts/domains/imports.js — bulk adds and the Goodreads import job.
//
// The job state lives here, above the router, so its progress survives
// navigation and onboarding finishing (see the note on importJob).

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/api/supabase';
import { bookKey } from '../../lib/book/bookHelpers';
import { dedupeBooks } from '../data/cache';

/**
 * Called once by DataProvider; returns importGoodreads, bulkAddToLibrary, bulkAddToWishlist, importJob, dismissImportJob, runGoodreadsImport.
 * @param {object} deps  user, state, setState, upsertBookOnServer, startReading — from DataProvider and earlier domains
 */
export function useImports({ user, state, setState, upsertBookOnServer, startReading }) {
  const importGoodreads = useCallback(
    // v0.44: onProgress(done, total) — fired per book on the authed path so
    // large imports (500+ books, one upsert_book RPC each) show progress
    // instead of an indeterminate "Adding…" for minutes.
    async (books, onProgress) => {
      const existingKeys = new Set(state.library.map(bookKey));
      const toAdd = books.filter((b) => !existingKeys.has(bookKey(b)));

      if (!user) {
        setState((s) => ({
          ...s,
          // v0.59: undated imports stay undated. See the note on the authed
          // path below — backfilling today's date here made the guest library
          // disagree with what a signed-in reload would show.
          library: dedupeBooks([...s.library, ...toAdd]),
          profile: { ...s.profile, goodreadsImported: true },
        }));
        return toAdd.length;
      }

      const linked = [];
      for (let i = 0; i < toAdd.length; i++) {
        const b = toAdd[i];
        const bookId = await upsertBookOnServer(
          { ...b, fromGoodreads: true },
          'goodreads_import'
        );
        if (bookId) {
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
          // v0.59: do NOT backfill dateRead here.
          //
          // read_at above is correctly written as NULL when Goodreads has no
          // date (most books — Goodreads only records one when the reader
          // explicitly dated the shelving). Stamping today's date into local
          // state made the two disagree: an undated import counted toward this
          // year's reading challenge, this month's streak, the pace chart and
          // the activity feed — and then silently dropped out of all four on
          // the next page load, when loadUserData maps read_at → undefined.
          //
          // Numbers that change on refresh are worse than numbers that are
          // simply absent. Undated stays undated, on both sides.
          if (!error) linked.push({ ...b, bookId, dateRead: b.dateRead || undefined });
        }
        onProgress?.(i + 1, toAdd.length);
      }

      setState((s) => ({
        ...s,
        library: dedupeBooks([...s.library, ...linked]),
        profile: { ...s.profile, goodreadsImported: true },
      }));
      // v0.59: returns the count instead of toasting. The caller
      // (runGoodreadsImport) owns user-facing reporting now — two overlapping
      // notifications for one action was noise, and this number is also
      // needed to tell "500 added" apart from "500 already there".
      return linked.length;
    },
    [user, state.library, upsertBookOnServer, setState]
  );

  const bulkAddToLibrary = useCallback(
    // v0.44: onProgress(done, total) — same per-book progress as importGoodreads
    //
    // v0.65: UNDATED by default, extending the v0.59 importGoodreads rule to
    // every bulk path.
    //
    // All three callers (The Stacks, OnboardingStacks, BulkImport) are a reader
    // saying "I have read this", not "I finished this today". Stamping today's
    // date turned each of those taps into a fabricated data point: the book
    // counted toward this year's reading challenge, this month's bar on the
    // pace chart, and the streak — so clearing forty cards off the wall in one
    // sitting read as forty books finished that afternoon.
    //
    // A read date the reader never gave us is a guess, and a guess that feeds
    // stats is worse than a blank. Undated stays undated; the date gets set
    // later, deliberately, from the rating editor.
    async (books, onProgress) => {
      const existingKeys = new Set(state.library.map(bookKey));
      const toAdd = books.filter((b) => !existingKeys.has(bookKey(b)));

      if (!user) {
        setState((s) => ({
          ...s,
          library: dedupeBooks([...s.library, ...toAdd.map((b) => ({ ...b, dateRead: b.dateRead || undefined }))]),
        }));
        return toAdd.length;
      }

      const linked = [];
      for (let i = 0; i < toAdd.length; i++) {
        const b = toAdd[i];
        const bookId = b.bookId || (await upsertBookOnServer(b));
        if (bookId) {
          const { error } = await supabase.from('read_books').upsert(
            {
              user_id: user.id,
              book_id: bookId,
              rating: b.rating && b.rating > 0 ? b.rating : null,
              // v0.65: carries a date only when the book already had one (a
              // Goodreads-sourced row re-added, say). Otherwise NULL, matching
              // what loadUserData maps back to `undefined` on the next load —
              // the two sides must agree or the number changes on refresh.
              read_at: b.dateRead || null,
              source: 'manual',
            },
            { onConflict: 'user_id,book_id' }
          );
          if (!error) linked.push({ ...b, bookId, dateRead: b.dateRead || undefined });
        }
        onProgress?.(i + 1, toAdd.length);
      }
      setState((s) => ({
        ...s,
        library: dedupeBooks([...s.library, ...linked]),
      }));
      return linked.length;
    },
    [user, state.library, upsertBookOnServer, setState]
  );

  const bulkAddToWishlist = useCallback(
    // v0.59: wishlist counterpart to bulkAddToLibrary. Needed because the
    // Goodreads RSS import brings the "Want to Read" shelf automatically, and
    // that shelf is routinely the largest one on an account — looping
    // addToWishlist would fire a showToast and a setState per book.
    //
    // One toast (raised by the caller), one state commit, at the end.
    async (books, onProgress) => {
      // Exclude anything already on EITHER list. A book can sit on both
      // "read" and "want-to-read" on Goodreads; the finished state wins and
      // must not be duplicated into the wishlist. Same rule addToWishlist
      // applies for a single book.
      const wishKeys = new Set(state.wishlist.map(bookKey));
      const libKeys = new Set(state.library.map(bookKey));
      const toAdd = books.filter((b) => {
        const k = bookKey(b);
        return !wishKeys.has(k) && !libKeys.has(k);
      });

      if (!user) {
        setState((s) => ({
          ...s,
          wishlist: dedupeBooks([...s.wishlist, ...toAdd]),
        }));
        return toAdd.length;
      }

      const linked = [];
      for (let i = 0; i < toAdd.length; i++) {
        const b = toAdd[i];
        const bookId =
          b.bookId ||
          (await upsertBookOnServer(b, b.fromGoodreads ? 'goodreads_import' : undefined));
        if (bookId) {
          // upsert rather than insert-and-forgive-23505: a book already on the
          // shelf is a no-op at the database, so no 409 is raised in the first
          // place. Still counted as linked — being already present is success.
          const { error } = await supabase
            .from('wishlist_items')
            .upsert(
              { user_id: user.id, book_id: bookId, notes: b.notes || null },
              { onConflict: 'user_id,book_id', ignoreDuplicates: true }
            );
          if (!error) {
            linked.push({ ...b, bookId });
          } else {
            console.error('wishlist bulk upsert failed', error);
          }
        }
        onProgress?.(i + 1, toAdd.length);
      }

      setState((s) => ({
        ...s,
        wishlist: dedupeBooks([...s.wishlist, ...linked]),
      }));
      return linked.length;
    },
    // Deliberately no resolveRecommendation here, unlike addToWishlist:
    // imported books were never recommended, so there is nothing to resolve.
    [user, state.wishlist, state.library, upsertBookOnServer, setState]
  );

  // ---------- v0.59: Goodreads import job ----------
  //
  // Why this lives in DataContext and not in the view that starts it:
  //
  // Onboarding.finish() calls setOnboarded(true), and App.jsx renders
  // <Onboarding/> only while !state.onboarded. So the moment onboarding
  // completes, the Onboarding component unmounts — taking any local progress
  // UI with it — while the import keeps running in a detached closure for
  // another two or three minutes. From the reader's side that looked like the
  // page reloading for no reason, then books quietly appearing much later.
  //
  // The job state lives here, above the router, so progress survives
  // navigation, view swaps and onboarding completion. ImportProgressToast
  // renders it globally.
  //
  // job: null | { phase: 'writing' | 'done', done, total, added, skipped }
  const [importJob, setImportJob] = useState(null);
  const dismissImportJob = useCallback(() => setImportJob(null), []);

  const runGoodreadsImport = useCallback(
    async ({ read = [], toRead = [], currentlyReading = [] }, enrich = (b) => b) => {
      const current = currentlyReading.slice(0, 20);
      const total = read.length + toRead.length + current.length;
      if (total === 0) return { added: 0, total: 0 };

      let offset = 0;
      let added = 0;
      setImportJob({ phase: 'writing', done: 0, total, added: 0, skipped: 0 });
      const step = (done) =>
        setImportJob((j) => (j ? { ...j, done: Math.min(offset + done, total) } : j));

      try {
        if (read.length > 0) {
          // importGoodreads reports its own count via toast; we track the
          // pre-dedupe total here so the bar reaches 100% either way.
          const n = await importGoodreads(read.map(enrich), step);
          offset += read.length;
          added += n || 0;
        }
        if (toRead.length > 0) {
          const n = await bulkAddToWishlist(toRead.map(enrich), step);
          offset += toRead.length;
          added += n || 0;
        }
        for (let i = 0; i < current.length; i++) {
          try { await startReading(enrich(current[i])); added += 1; }
          catch (e) { console.error('startReading failed on import', e); }
          step(i + 1);
        }
      } catch (e) {
        console.error('goodreads import failed', e);
      }

      // Deliberately does NOT auto-clear. The reader has to see this — it is
      // the only confirmation that a multi-minute background job finished.
      setImportJob({ phase: 'done', done: total, total, added, skipped: Math.max(0, total - added) });
      return { added, total };
    },
    [importGoodreads, bulkAddToWishlist, startReading]
  );

  return { importGoodreads, bulkAddToLibrary, bulkAddToWishlist, importJob, dismissImportJob, runGoodreadsImport };
}
