// src/contexts/domains/reading.js — the library and Currently Reading:
// marking read (markAsRead), starting and finishing, progress (pages and
// minutes), the edition a reader read, and editing or removing a read book.
//
// markAsRead is the most connected action in the app: one finish updates four
// shelves, earns accomplishments, queues the share moment and can write a
// memory. tests/data-provider.test.jsx records exactly what it does.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';
import { bookKey } from '../../lib/book/bookHelpers';
import { resolveRecommendation, isOracleSuggested } from '../../lib/oracle/oracleProvenance';

/**
 * Called once by DataProvider; returns markAsRead, startReading, removeFromCurrentlyReading, finishReading, saveReaderEdition, updateListeningProgress, updateReadingProgress, updateReadBook, removeFromLibrary.
 * @param {object} deps  user, state, setState, showToast, upsertBookOnServer, fireCompletionMoment, addReadingMemory — from DataProvider and earlier domains
 */
export function useReadingActions({ user, state, setState, showToast, upsertBookOnServer, fireCompletionMoment, addReadingMemory }) {
  const markAsRead = useCallback(
    async (book, extra = {}, opts = {}) => {
      const k = bookKey(book);

      // v0.63 — this was a bare `return`, and it is the whole of the reported
      // bug: "marked a book as read, it shows the Read label, it is not in the
      // library, the share modal never appeared, and there were no errors."
      //
      // All four symptoms are this one line. The guard fires BEFORE any server
      // write, so no read_books row is created; it returns undefined, so
      // fireCompletionMoment never runs and no share modal opens; it shows no
      // toast, so nothing is reported; and the Read label the reader sees is
      // real — it is keyed on bookKey, and the OTHER row's library entry
      // matches, which is precisely what tripped the guard.
      //
      // bookKey is normalised-title + the first 10 characters of the author, so
      // two DIFFERENT rows in `books` collide whenever they agree on those.
      // That is not hypothetical: compute_book_key on the server has the same
      // shape and no subtitle handling, so a catalogue can hold several rows
      // for one work ("Like Water for Chocolate" / "…: A Novel in Monthly
      // Installments…"), and a reader who adds one and then the other lands
      // here.
      //
      // Treating them as the same book is right — the reader thinks of it as
      // one book and a second library entry would be wrong. Doing it in silence
      // is not. Say so, and leave a breadcrumb when the collision is between
      // two distinct catalogue rows, because that is a data defect worth
      // finding rather than a reader repeating themselves.
      const already = state.library.find((b) => bookKey(b) === k);
      if (already) {
        if (book.bookId && already.bookId && book.bookId !== already.bookId) {
          console.warn(
            '[markAsRead] two catalogue rows share a book key — treating as the ' +
            'same book and not adding a second library entry.\n' +
            `  incoming: ${book.bookId} "${book.t}" by ${book.a || '(no author)'}\n` +
            `  in library: ${already.bookId} "${already.t}" by ${already.a || '(no author)'}\n` +
            '  See docs/sql/duplicate-books-diagnostic.sql to find every affected work.'
          );
        }
        showToast(`"${already.t}" is already in your library`);
        return null;
      }

      const today = new Date().toISOString().slice(0, 10);
      // v0.65: honour a date the reader actually chose.
      //
      // RatingModal has offered a "Finished on" field since v0.63 and BookCard
      // has been passing it through as `extra.readAt` — but this function
      // hard-coded `today`, so picking a date in that modal silently did
      // nothing on the create path. Only the edit path (updateReadBook) ever
      // respected it. Explicit date wins; today remains the default, which is
      // right here because marking a book read IS a deliberate act.
      const readAt = extra.readAt ? String(extra.readAt).slice(0, 10) : today;

      const ratingRaw = extra.rating != null ? extra.rating : book.rating;
      const rating = ratingRaw && ratingRaw > 0 ? ratingRaw : null;
      const notes =
        extra.notes != null ? (extra.notes.trim() || null) : (book.notes || null);

      const enriched = { ...book, dateRead: readAt };
      if (rating != null) enriched.rating = rating;
      if (notes != null) enriched.notes = notes;

      if (!user) {
        setState((s) => ({
          ...s,
          readNext: s.readNext.filter((b) => bookKey(b) !== k),
          wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
          // A book can only live in one shelf. Marking it read must clear any
          // currently-reading entry, or it shows in Library and Currently
          // Reading at once (e.g. "Mark as Read" on a book that was started).
          currentlyReading: s.currentlyReading.filter((b) => bookKey(b) !== k),
          library: [...s.library, enriched],
        }));
        showToast(`"${book.t}" added to your library`);
        const moment = fireCompletionMoment(enriched, [...state.library, enriched], opts);
        // v0.44: a note written at the finish moment joins the book's memory
        // thread (kind 'finished'). Only notes typed in this flow — not
        // wishlist notes carried on the book object.
        if (extra.notes != null && extra.notes.trim()) {
          addReadingMemory(enriched, extra.notes, { kind: 'finished' });
        }
        return moment;
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
            read_at: readAt,
            // v0.58: 'oracle' is the cheap join key behind the whole point of
            // provenance — "did the Oracle pick better books than you did?" is
            // one filter on this column against `rating`. Ordered before the
            // Goodreads check because a book can be both (imported long ago,
            // then recommended and read); the Oracle origin is the newer and
            // more specific fact, and it is the one being measured.
            source: isOracleSuggested(book)
              ? 'oracle'
              : (book.fromGoodreads ? 'goodreads_import' : 'manual'),
            rating,
            notes,
          },
          { onConflict: 'user_id,book_id' }
        );
      if (rbErr) {
        console.error('read_books upsert failed', rbErr);
      }

      // v0.58 provenance. Also stamped here, not only in addToWishlist: a
      // reader can go straight from a recommendation to "mark as read" without
      // the book ever passing through the wishlist. Idempotent server-side, so
      // a book that took the wishlist route is not counted twice.
      if (isOracleSuggested(book)) {
        resolveRecommendation({
          recommendationId: book.recommendationId ?? null,
          title: book.t,
          bookId,
        });
      }

      await supabase
        .from('wishlist_items')
        .delete()
        .eq('user_id', user.id)
        .eq('book_id', bookId);
      // Clear any currently-reading row so a direct "Mark as Read" (from the
      // Book page or Read Next) can't leave the book in both Library and
      // Currently Reading. Harmless no-op when there's no such row.
      await supabase
        .from('currently_reading')
        .delete()
        .eq('user_id', user.id)
        .eq('book_id', bookId);

      setState((s) => ({
        ...s,
        readNext: s.readNext.filter((b) => bookKey(b) !== k),
        wishlist: s.wishlist.filter((b) => bookKey(b) !== k),
        currentlyReading: s.currentlyReading.filter((b) => bookKey(b) !== k),
        library: [...s.library, { ...enriched, bookId }],
      }));
      showToast(`"${book.t}" added to your library`);
      const moment = fireCompletionMoment({ ...enriched, bookId }, [...state.library, { ...enriched, bookId }], opts);
      // v0.44: same finished-moment memory as the guest path
      if (extra.notes != null && extra.notes.trim()) {
        addReadingMemory({ ...enriched, bookId }, extra.notes, { kind: 'finished' });
      }
      return moment;
    },
    [user, state.library, showToast, upsertBookOnServer, fireCompletionMoment, addReadingMemory, setState]
  );

  // v0.22: Currently Reading actions

  const startReading = useCallback(
    async (book, startedAt) => {
      const k = bookKey(book);
      if (state.currentlyReading.some((b) => bookKey(b) === k)) return;
      const date = startedAt || new Date().toISOString().slice(0, 10);
      const enriched = { ...book, startedAt: date };

      if (!user) {
        setState((s) => ({
          ...s,
          currentlyReading: [...s.currentlyReading, enriched],
          readNext: s.readNext.filter((b) => bookKey(b) !== k),
        }));
        showToast(`Started reading "${book.t}"`);
        return;
      }

      const bookId = book.bookId || (await upsertBookOnServer(book));
      if (!bookId) { showToast(`Couldn't save "${book.t}"`, true); return; }

      const { error } = await supabase
        .from('currently_reading')
        .upsert({ user_id: user.id, book_id: bookId, started_at: date }, { onConflict: 'user_id,book_id' });
      if (error) console.error('currently_reading upsert failed', error);

      setState((s) => ({
        ...s,
        currentlyReading: [...s.currentlyReading, { ...enriched, bookId }],
        readNext: s.readNext.filter((b) => bookKey(b) !== k),  // fix: was missing in authed path
      }));
      showToast(`Started reading "${book.t}"`);
    },
    [user, state.currentlyReading, showToast, upsertBookOnServer, setState]
  );

  const removeFromCurrentlyReading = useCallback(
    async (book) => {
      const k = bookKey(book);
      if (user && book.bookId) {
        await supabase
          .from('currently_reading')
          .delete()
          .eq('user_id', user.id)
          .eq('book_id', book.bookId);
      }
      // Remove startedAt before returning the book to Read Next so it
      // doesn't carry stale reading-session metadata into the queue.
      const { startedAt: _dropped, ...bookWithoutStartedAt } = book;
      setState((s) => {
        const alreadyQueued = s.readNext.some((b) => bookKey(b) === k);
        return {
          ...s,
          currentlyReading: s.currentlyReading.filter((b) => bookKey(b) !== k),
          readNext: alreadyQueued ? s.readNext : [...s.readNext, bookWithoutStartedAt],
        };
      });
    },
    [user, setState]
  );

  // Finishes a currently-reading book: removes it from currentlyReading and
  // delegates to markAsRead for the read_books upsert + library update.
  //
  // Note: this deliberately does NOT go through removeFromCurrentlyReading,
  // which re-queues the book into readNext (that's the "stop reading / put it
  // back" action). Routing finish through it left the book in readNext whenever
  // markAsRead short-circuited, producing the Library + Read Next duplicate.
  const finishReading = useCallback(
    async (book, extra = {}) => {
      const k = bookKey(book);
      if (user && book.bookId) {
        const { error } = await supabase
          .from('currently_reading')
          .delete()
          .eq('user_id', user.id)
          .eq('book_id', book.bookId);
        if (error) console.error('currently_reading delete failed', error);
      }
      setState((s) => ({
        ...s,
        currentlyReading: s.currentlyReading.filter((b) => bookKey(b) !== k),
      }));
      await markAsRead(book, extra);
    },
    [user, markAsRead, setState]
  );

  // v0.28: update how many pages the user has read for a currently-reading book.
  // Optimistically updates local state; persists to currently_reading.pages_read.
  // v0.65 — record (or clear) which edition this reader read.
  //
  // Upsert on (user_id, book_id), which the table declares unique, so a reader
  // editing their edition twice does not accumulate rows. Passing null for
  // every field clears the edition rather than storing an empty one: a row of
  // all-nulls is indistinguishable from "no edition recorded" to every reader
  // of this data, and keeping it would make editionIsNotable() lie.
  const saveReaderEdition = useCallback(
    async (book, patch) => {
      if (!book?.bookId) return;

      const next = {
        language: patch?.language ?? null,
        isbn: patch?.isbn ?? null,
        edition_title: patch?.edition_title ?? null,
        translator: patch?.translator ?? null,
        page_count: patch?.page_count ?? null,
        format: patch?.format ?? null,
        // v0.65.1 — audiobooks. duration_minutes is the audio counterpart of
        // page_count and narrator of translator; both are nullable and both are
        // included in the emptiness check below, so an edition consisting of
        // nothing but a narrator still counts as recorded.
        duration_minutes: patch?.duration_minutes ?? null,
        narrator: patch?.narrator ?? null,
      };
      const empty = Object.values(next).every((v) => v == null || v === '');

      // Optimistic, so the modal closes on a decision rather than on a round
      // trip — the same pattern updateReadingProgress uses below.
      setState((s) => {
        const map = { ...s.editionsByBookId };
        if (empty) delete map[book.bookId];
        else map[book.bookId] = { book_id: book.bookId, ...next, source: patch?.source || 'manual' };
        return { ...s, editionsByBookId: map };
      });

      if (!user) return;

      if (empty) {
        const { error } = await supabase
          .from('reader_editions')
          .delete()
          .eq('user_id', user.id)
          .eq('book_id', book.bookId);
        if (error) console.error('saveReaderEdition (clear) failed', error);
        return;
      }

      const { error } = await supabase
        .from('reader_editions')
        .upsert(
          {
            user_id: user.id,
            book_id: book.bookId,
            ...next,
            source: patch?.source || 'manual',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,book_id' }
        );
      if (error) console.error('saveReaderEdition failed', error);
    },
    [user, setState]
  );

  /**
   * How far into an audio edition this reader is, in minutes.
   *
   * A sibling of updateReadingProgress rather than a parameter on it, and the
   * separation is the point: pages and minutes are different units on different
   * columns, and a reader who switches format mid-book must not have one
   * reinterpreted as the other. See docs/specs/audiobook-progress-v1-spec.md.
   *
   * `null` clears the position — a reader who empties the field is saying they
   * do not know where they are, which is different from saying zero.
   */
  const updateListeningProgress = useCallback(
    async (book, minutes) => {
      if (!book?.bookId) return;
      const value = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;

      // Optimistic, matching updateReadingProgress: the modal closes on the
      // decision, not on the round trip.
      setState((s) => ({
        ...s,
        currentlyReading: s.currentlyReading.map((b) =>
          b.bookId === book.bookId ? { ...b, progressMinutes: value } : b
        ),
      }));

      if (!user) return;

      const { error } = await supabase
        .from('currently_reading')
        .update({ progress_minutes: value })
        .eq('user_id', user.id)
        .eq('book_id', book.bookId);

      if (error) console.error('updateListeningProgress failed', error);
    },
    [user, setState]
  );

  const updateReadingProgress = useCallback(
    // userPageCount: pass a positive integer to set a per-user page-count
    // override for this book (e.g. a different edition), or null to clear
    // the override and fall back to the catalog book.pages. Passing
    // undefined leaves whatever override is already stored untouched.
    async (book, pagesRead, userPageCount) => {
      const pages = Math.max(0, Math.floor(pagesRead));
      const hasOverrideArg = userPageCount !== undefined;

      // Optimistic local update
      setState((s) => ({
        ...s,
        currentlyReading: s.currentlyReading.map((b) =>
          b.bookId === book.bookId
            ? { ...b, pagesRead: pages, ...(hasOverrideArg ? { userPageCount } : {}) }
            : b
        ),
      }));

      if (!user || !book.bookId) return;

      const update = { pages_read: pages };
      // v0.65: user_page_count is still written for ONE more release.
      //
      // reader_editions is now the home for this number, but the previously
      // deployed bundle reads the old column, and a reader with two tabs open
      // (or a stale service worker — it happens) would otherwise see their
      // page count vanish. effectivePages() reads the new table first and this
      // second. Drop both this line and the column together.
      if (hasOverrideArg) update.user_page_count = userPageCount;

      // The durable write. Merged into any edition already recorded rather than
      // replacing it, so setting a page count from the progress modal does not
      // silently erase the ISBN or translator the reader entered earlier.
      if (hasOverrideArg) {
        const existing = state.editionsByBookId?.[book.bookId] || null;
        await saveReaderEdition(book, { ...(existing || {}), page_count: userPageCount });
      }

      const { error } = await supabase
        .from('currently_reading')
        .update(update)
        .eq('user_id', user.id)
        .eq('book_id', book.bookId);

      if (error) console.error('updateReadingProgress failed', error);
    },
    [user, state.editionsByBookId, saveReaderEdition, setState]
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
      // v0.65: a plain YYYY-MM-DD string, not an ISO timestamp.
      //
      // read_books.read_at is a DATE column, and the old
      // `new Date(patch.readAt).toISOString()` round-trip shifted the value by
      // a timezone: '2025-11-15' parses as UTC midnight, so a reader west of
      // Greenwich got '2025-11-14' back out of `new Date()` on every stats
      // pass. It also wrote a full timestamp into local state while
      // loadUserData maps the column back as a bare date, so the value the
      // reader saw before a refresh was not the value they saw after one.
      //
      // The input is already YYYY-MM-DD (RatingModal's <input type="date">), so
      // the correct handling is to leave it alone.
      if (patch.readAt) {
        update.read_at = String(patch.readAt).slice(0, 10);
      }

      // v0.65: build the CLIENT patch explicitly rather than spreading the DB
      // row. `update` is keyed by column name (read_at, not dateRead), and
      // spreading it stamped those column names onto the book object alongside
      // the client fields — harmless until something reads the wrong one.
      const localPatch = {};
      if (update.rating !== undefined) localPatch.rating = update.rating || undefined;
      if (update.notes !== undefined) localPatch.notes = update.notes || undefined;
      if (update.read_at !== undefined) localPatch.dateRead = update.read_at;
      setState((s) => ({
        ...s,
        library: s.library.map((b) =>
          bookKey(b) === k ? { ...b, ...localPatch } : b
        ),
      }));

      if (!user) return;
      // v0.39.6: previously `if (!user || !book.bookId) return;` silently
      // skipped the Supabase write whenever bookId was missing — the
      // optimistic local update above made the edit *look* successful in
      // the moment, but it reverted on the next fresh load since nothing
      // was ever persisted. Mirrors the same resolve-or-create fallback
      // markAsRead already uses.
      const bookId = book.bookId || (await upsertBookOnServer(book));
      if (!bookId) {
        showToast("Couldn't save your changes", true);
        return;
      }

      // v0.65: `.select()` so we can tell "saved" from "matched nothing".
      //
      // A PostgREST UPDATE that matches zero rows is not an error — it returns
      // 204 with no error object. So an edit aimed at a book_id with no
      // read_books row (the catalogue holds duplicate rows for the same work;
      // a library entry created against one of them, then re-resolved to the
      // other, lands here) reported success, patched local state, and then
      // reverted on the next load. That is exactly the shape of "I changed the
      // read date to last year and the stats still count it this year, even
      // after a hard reset": the number never left the browser.
      //
      // Zero rows now falls through to an upsert, which writes the row the
      // update was looking for.
      // v0.65.2: update EVERY read_books row for this work, not one book_id.
      //
      // This is the actual reason a corrected read date came back wrong after a
      // reload. The catalogue holds duplicate rows for the same work — the
      // v0.63 note in useStacks counts 17 pairs that share an ISBN while
      // disagreeing on title or author, and markAsRead has a warning for the
      // same condition. When The Stacks serves one of those rows for a book the
      // reader already finished under the other, they end up with TWO
      // read_books rows for one book.
      //
      // The local patch below already fixes both, because it matches on
      // bookKey — which is why the edit looked like it worked. The server write
      // matched on a single book_id and fixed one. On the next load the
      // untouched row came back carrying the old date, and the stats counted
      // it. Hence "still showing this month, even after a hard reset".
      //
      // Collecting the ids from the shelf rather than the argument means the
      // edit reaches every copy the reader can actually see.
      const workIds = Array.from(new Set(
        [bookId, ...state.library.filter((b) => bookKey(b) === k).map((b) => b.bookId)]
          .filter(Boolean)
      ));

      const { data: updated, error } = await supabase
        .from('read_books')
        .update(update)
        .eq('user_id', user.id)
        .in('book_id', workIds)
        .select('id');
      if (error) {
        console.error('read_books update failed', error);
        showToast("Couldn't save your changes", true);
        return;
      }
      if (updated && updated.length > 1) {
        // Not an error, but it IS the duplicate-catalogue-row condition, and
        // the reader has one book counted twice in every stat on the Profile.
        console.warn(
          `[updateReadBook] "${book.t}" has ${updated.length} read_books rows ` +
          `(book_ids: ${workIds.join(', ')}). All were updated, so the edit holds — ` +
          'but the book is still double-counted in reading stats. ' +
          'See docs/sql/duplicate-read-books-diagnostic.sql.'
        );
      }
      if (!updated || updated.length === 0) {
        console.warn(
          `[updateReadBook] no read_books row for book_id ${bookId} — upserting one. ` +
          'Usually means this library entry predates the current catalogue row for the work; ' +
          'see docs/sql/duplicate-books-diagnostic.sql.'
        );
        const { error: upsertError } = await supabase.from('read_books').upsert(
          { user_id: user.id, book_id: bookId, source: 'manual', ...update },
          { onConflict: 'user_id,book_id' }
        );
        if (upsertError) {
          console.error('read_books upsert fallback failed', upsertError);
          showToast("Couldn't save your changes", true);
        }
      }
    },
    [user, state.library, showToast, upsertBookOnServer, setState]
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
    [user, setState]
  );

  return { markAsRead, startReading, removeFromCurrentlyReading, finishReading, saveReaderEdition, updateListeningProgress, updateReadingProgress, updateReadBook, removeFromLibrary };
}
