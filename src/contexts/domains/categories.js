// src/contexts/domains/categories.js — reader categories (tags) on books, and
// merging Oracle genre assignments into state.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';
import { bookKey } from '../../lib/book/bookHelpers';
import { rollupCategories } from '../data/rollups';

/**
 * Called once by DataProvider; returns addCategoryToBook, removeCategoryFromBook, searchCategories, getCategoriesForBook, setBookGenres.
 * @param {object} deps  user, state, setState, showToast — from DataProvider and earlier domains
 */
export function useCategories({ user, state, setState, showToast }) {
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
    [user, showToast, setState]
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
    [user, showToast, setState]
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
  }, [setState]);

  return { addCategoryToBook, removeCategoryFromBook, searchCategories, getCategoriesForBook, setBookGenres };
}
