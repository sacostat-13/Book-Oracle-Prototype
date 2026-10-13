// src/contexts/domains/catalog.js — writing books into the shared catalogue.
//
// upsertBookOnServer() is the single point where a client book becomes a `books`
// row (upsert_book RPC); every shelf action that needs a book_id goes through it.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';
import { bookKey, storableAuthor } from '../../lib/book/bookHelpers';
import { isOracleSuggested } from '../../lib/oracle/oracleProvenance';

/**
 * Called once by DataProvider; returns upsertBookOnServer, cacheBookFields, upsertDiscoveredBook.
 * @param {object} deps  user, state, setState — from DataProvider and earlier domains
 */
export function useCatalogWrites({ user, state, setState }) {
  const upsertBookOnServer = useCallback(
    async (book, source = 'user_manual') => {
      if (!user) return null;
      const resolvedSource = book.fromHardcover
        ? 'hardcover'
        : book.fromOpenLibrary
          ? 'openlibrary'
          : book.fromGoodreads
            ? 'goodreads_import'
            // v0.63: a book that arrived from an Oracle recommendation was
            // being written to `books.source` as 'user_manual', because this
            // chain only ever knew about the three lookup providers. The
            // provenance was already known — `read_books.source` is set to
            // 'oracle' a few hundred lines below from the same predicate — so
            // the catalogue and the shelf were disagreeing about where the same
            // book came from. `books.source` is free text with no CHECK, so
            // 'oracle' is safe to write.
            : isOracleSuggested(book)
              ? 'oracle'
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
        // v0.63 — THIS IS THE DUPLICATE-ROW BUG.
        //
        // "Unknown author" is a DISPLAY placeholder. bookLookup, hardcoverService
        // and googleBooksService all fall back to it when a provider returns no
        // author (six call sites), which is fine on screen and wrong in the
        // database — it was being stored as though it were a person's name.
        //
        // Book identity is compute_book_key(title, author), so the placeholder
        // does not merely look untidy, it FORKS THE BOOK. "Like Water for
        // Chocolate" + "Laura Esquivel" and "Like Water for Chocolate" +
        // "Unknown author" are two rows with two ids, two sets of genre links
        // and two shelf lives, for one novel — with the same ISBN on both.
        //
        // Sanitising here rather than at the six call sites is deliberate: the
        // placeholder is still wanted on screen, and this is the single point
        // where a book crosses from the client into the catalogue. Nothing the
        // reader sees changes; only what is persisted.
        _author: storableAuthor(book.a),
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
          // v0.59: true when a lookup STAGE NEVER RAN (free-search throttle saturated,
          // a source threw, quota spent) rather than when every source ran and missed.
          // The weekly catalog job retries these; genuine dead ends it leaves for the
          // Claude curate pass. Without the distinction a book that was simply never
          // looked at is indistinguishable from one that doesn't exist.
          lookupIncomplete: book.lookupIncomplete || false,
        },
        _series_source: book.s
          ? book.s.fromHardcover
            ? 'hardcover'
            : book.s.fromOpenLibrary
              ? 'openlibrary'
              : resolvedSource
          : null,
        // v0.64. `lang` is what googleBooksService.normalize has always
        // returned from volumeInfo.language and nothing ever read; `language`
        // is what a book already carrying the field passes back through
        // cacheBookFields. upsert_book merges these with
        // coalesce(existing, incoming), so the first source to know wins and a
        // later lookup cannot relabel a row's language.
        _language: book.language || book.lang || null,
        _original_language: book.originalLanguage || null,
        // 20260930140000. The lookup chain already fetched it (Hardcover
        // release_year, OpenLibrary first_publish_year); nothing stored it.
        _first_published_year: book.fy || null,
      };
      let { data, error } = await supabase.rpc('upsert_book', args);
      // PostgREST schema-cache miss (PGRST202): the first RPC after a cold
      // start or a fresh migration can 404 because the function isn't in the
      // cached schema yet. The cache reloads within a moment, so retry once
      // rather than silently dropping the user's action.
      if (error && (error.code === 'PGRST202' || error.status === 404 || error.message?.includes('schema cache'))) {
        await new Promise((r) => setTimeout(r, 600));
        ({ data, error } = await supabase.rpc('upsert_book', args));
      }
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
    [user, upsertBookOnServer, setState]
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
        // v0.63 — the SECOND write path into `books`, and the one that actually
        // produced the reported duplicate.
        //
        // upsertBookOnServer is not the only caller of upsert_book; this
        // function calls the RPC directly, so the storableAuthor() sanitising
        // added there did not apply here. Viewing a book page from search
        // silently upserts with status='discovered' (see NavSearch.jsx), and
        // when the result came from Hardcover without an author,
        // hardcoverService's 'Unknown author' display placeholder went straight
        // into the key column.
        //
        // That is exactly the shape of the row in the report: source
        // 'hardcover', status 'discovered', author 'Unknown author', same ISBN
        // as the real row — created by looking at a search result, not by
        // adding anything.
        _author: storableAuthor(book.a),
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
        // v0.64. Worth having on THIS path in particular: a discovered row is
        // created by viewing a search result, and a Spanish search result is
        // how a translated duplicate enters the catalog in the first place.
        // Recording its language is what later lets the two rows be shown as
        // one book.
        _language: book.language || book.lang || null,
        _first_published_year: book.fy || null,
      });
    },
    [user, state.wishlist, state.library, state.readNext]
  );

  return { upsertBookOnServer, cacheBookFields, upsertDiscoveredBook };
}
