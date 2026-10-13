// src/contexts/domains/shelves.js — the wishlist and Read Next.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';
import { ALL_BOOKS, bookKey } from '../../lib/book/bookHelpers';
import { resolveRecommendation, isOracleSuggested } from '../../lib/oracle/oracleProvenance';
import { dedupeBooks } from '../data/cache';

/**
 * Called once by DataProvider; returns seedWishlistIfNeeded, addToWishlist, removeFromWishlist, addToReadNext, removeFromReadNext.
 * @param {object} deps  user, state, setState, showToast, upsertBookOnServer — from DataProvider and earlier domains
 */
export function useShelfActions({ user, state, setState, showToast, upsertBookOnServer }) {
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
      // No .select().single() here any more. It was there to read the row back,
      // but it turned an already-seeded book into an error twice over: the
      // insert raised 23505, and .single() then raised again on zero rows. The
      // book was dropped from `linked` and vanished from the seeded wishlist.
      // Nothing downstream needs the returned row — bookId is already known.
      const { error } = await supabase
        .from('wishlist_items')
        .upsert(
          { user_id: user.id, book_id: bookId },
          { onConflict: 'user_id,book_id', ignoreDuplicates: true }
        );
      if (!error) linked.push({ ...b, bookId, status: 'verified', verifiedSource: 'curated_seed', source: 'curated' });
    }
    setState((s) => ({ ...s, wishlist: dedupeBooks([...s.wishlist, ...linked]) }));
  }, [state.onboarded, state.wishlist, state.library, user, upsertBookOnServer, setState]);

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
      // upsert, not insert: matches bulkAddToLibrary, and means a book already
      // on the shelf is a no-op instead of a 409. The old code forgave 23505 in
      // JS, so the UI was correct — but the request still failed at the network
      // layer and filled the console with errors that looked like real ones.
      const { error } = await supabase
        .from('wishlist_items')
        .upsert(
          { user_id: user.id, book_id: bookId, notes: book.notes || null },
          { onConflict: 'user_id,book_id', ignoreDuplicates: true }
        );
      if (error) {
        console.error('wishlist upsert failed', error);
        return false;
      }
      // v0.58 provenance: the reader took the Oracle up on it.
      //
      // Fire-and-forget and unconditional — resolveRecommendation is a no-op
      // for a book that was never recommended, so this path does not need to
      // branch on where the book came from. Deliberately NOT awaited: an add
      // must feel instant, and the accept stamp only matters in aggregate.
      // book_id is passed so the recommendation row can be backfilled with the
      // catalog link it could not have when it was only an impression.
      if (isOracleSuggested(book)) {
        resolveRecommendation({
          recommendationId: book.recommendationId ?? null,
          title: book.t,
          bookId,
        });
      }

      setState((s) => ({ ...s, wishlist: [...s.wishlist, { ...book, bookId }] }));
      showToast(`"${book.t}" added to your wishlist`);
      return true;
    },
    [user, state.wishlist, state.library, showToast, upsertBookOnServer, setState]
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
    [user, showToast, setState]
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
    [showToast, setState]
  );

  const removeFromReadNext = useCallback((book) => {
    const k = bookKey(book);
    setState((s) => ({ ...s, readNext: s.readNext.filter((b) => bookKey(b) !== k) }));
  }, [setState]);

  return { seedWishlistIfNeeded, addToWishlist, removeFromWishlist, addToReadNext, removeFromReadNext };
}
