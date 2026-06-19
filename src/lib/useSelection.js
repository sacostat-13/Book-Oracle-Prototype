// src/lib/useSelection.js — v0.27
// Shared multi-select hook for Wishlist, Library, and ListDetail.
// Returns selection state and handlers; views wire these into their UI.

import { useState, useCallback } from 'react';

export function useSelection(allBooks = []) {
  const [active, setActive] = useState(false);   // selection mode on/off
  const [selected, setSelected] = useState(new Set()); // set of bookIds

  const enter = useCallback(() => {
    setActive(true);
    setSelected(new Set());
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((bookId) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(bookId) ? next.delete(bookId) : next.add(bookId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(allBooks.map(b => b.bookId).filter(Boolean)));
  }, [allBooks]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  // Get the full book objects for selected IDs
  const selectedBooks = useCallback(() => {
    return allBooks.filter(b => b.bookId && selected.has(b.bookId));
  }, [allBooks, selected]);

  return {
    active,
    selected,           // Set of bookIds
    selectedBooks,      // fn → array of book objects
    count: selected.size,
    enter,
    exit,
    toggle,
    selectAll,
    clearAll,
  };
}
