// src/contexts/domains/memories.js — Reading Memory: private notes tied to the
// moment a book is put down or finished.

import { useCallback } from 'react';
import { supabase } from '../../lib/api/supabase';
import { bookKey } from '../../lib/book/bookHelpers';

/**
 * Called once by DataProvider; returns memoriesForBook, addReadingMemory, deleteReadingMemory.
 * @param {object} deps  user, state, setState, upsertBookOnServer — from DataProvider and earlier domains
 */
export function useReadingMemories({ user, state, setState, upsertBookOnServer }) {
  // ── v0.44: Reading Memory ────────────────────────────────────────────────
  // Private notes tied to the moment a book is put down or finished.
  // state.memories is keyed by bookId when the book exists on the server,
  // bookKey otherwise (guest mode); bookKey normalization makes the two
  // capture/resurface sides agree on the same key for the same book.

  const memoryKeyFor = (book) => book.bookId || bookKey(book);

  const memoriesForBook = useCallback(
    (book) => (state.memories || {})[memoryKeyFor(book)] || [],
    [state.memories]
  );

  const addReadingMemory = useCallback(
    async (book, body, { pagesAt = null, pctAt = null, kind = 'progress' } = {}) => {
      const text = (body || '').trim().slice(0, 2000);
      if (!text) return null;

      if (!user) {
        const entry = {
          id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `local-${Date.now()}`,
          kind, body: text, pagesAt, pctAt,
          createdAt: new Date().toISOString(),
        };
        const key = memoryKeyFor(book);
        setState((s) => ({
          ...s,
          memories: { ...s.memories, [key]: [entry, ...((s.memories || {})[key] || [])] },
        }));
        return entry;
      }

      const bookId = book.bookId || (await upsertBookOnServer(book));
      if (!bookId) return null;
      const { data, error } = await supabase
        .from('reading_memories')
        .insert({ user_id: user.id, book_id: bookId, kind, body: text, pages_at: pagesAt, pct_at: pctAt })
        .select('id, created_at')
        .single();
      if (error) {
        console.error('reading_memories insert failed', error);
        return null;
      }
      const entry = { id: data.id, kind, body: text, pagesAt, pctAt, createdAt: data.created_at };
      setState((s) => ({
        ...s,
        memories: { ...s.memories, [bookId]: [entry, ...((s.memories || {})[bookId] || [])] },
      }));
      return entry;
    },
    [user, upsertBookOnServer, setState]
  );

  const deleteReadingMemory = useCallback(
    async (book, memoryId) => {
      const key = memoryKeyFor(book);
      setState((s) => ({
        ...s,
        memories: { ...s.memories, [key]: ((s.memories || {})[key] || []).filter((m) => m.id !== memoryId) },
      }));
      if (user) {
        const { error } = await supabase
          .from('reading_memories')
          .delete()
          .eq('user_id', user.id)
          .eq('id', memoryId);
        if (error) console.error('reading_memories delete failed', error);
      }
    },
    [user, setState]
  );

  return { memoriesForBook, addReadingMemory, deleteReadingMemory };
}
