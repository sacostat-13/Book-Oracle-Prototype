// src/lib/usePagedList.js
// Chunked progressive rendering hook for Library / Wishlist.
//
// Renders a flat list in pages of `pageSize` items. Exposes a `loadMore`
// callback that appends the next page — wire it to a <ScrollSentinel> so
// the next chunk loads automatically before the user hits the bottom.
//
// `resetKey` must be a stable string that changes whenever the underlying
// filter set changes (e.g. `${genreFilter}|${categoryFilter}|${search}`).
// When it changes the page count resets to 1, preventing stale offsets
// after the user narrows a filter on a scrolled-down view.

import { useState, useEffect, useCallback, useMemo } from 'react';

const DEFAULT_PAGE_SIZE = 100;

/**
 * @param {Array}  items     - The full filtered flat array to page through.
 * @param {string} resetKey  - A string whose identity change triggers a page reset.
 * @param {object} [opts]
 * @param {number} [opts.pageSize=100]
 * @returns {{ visible: Array, hasMore: boolean, loadMore: () => void, total: number }}
 */
export function usePagedList(items, resetKey, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the filter combination changes.
  // We intentionally do NOT add `items` itself as a dep — only the key.
  // This avoids spurious resets when items mutate (add/remove a book) without
  // the filter actually changing, which would snap the user back to the top.
  useEffect(() => {
    setPage(1);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () => items.slice(0, page * pageSize),
    [items, page, pageSize]
  );

  const hasMore = visible.length < items.length;

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  return {
    visible,      // the items to render right now
    hasMore,      // true while there are more items beyond the current page
    loadMore,     // call this to append the next page
    total: items.length,
    showing: visible.length,
  };
}
