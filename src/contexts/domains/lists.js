// src/contexts/domains/lists.js — what the app does with a reader's Anthologies.
//
// The first domain moved out of DataContext (code-health Sprint 4, L1/L2).
// Two layers:
//   - pure state helpers (`listsState`): one array in, one array out, tested
//     on their own;
//   - `createListActions()`: the methods views call. Each does the Supabase
//     write (src/lib/api/listsApi.js) and then the matching state update.
//
// DataProvider still owns the single `state` object (the session cache and the
// load path serialise it whole), so actions receive `setState` and a
// `getLists()` reader instead of a store of their own. Views use useLists()
// (src/hooks/useLists.js); `useData()` keeps exposing the same names for any
// view not yet migrated.
//
// Anthologies are signed-in only: every action is a no-op without a user,
// returning what the old DataContext method returned in that case.

import * as api from '../../lib/api/listsApi';
import { knownMoods } from '../../data/moods';

/** Pure transitions on the `lists` array. Never mutate; always return a new array. */
export const listsState = {
  /** New Anthology goes first (lists are shown newest first). */
  prepend: (lists, list) => [list, ...(lists || [])],
  /** Merge `updates` into one Anthology. */
  patch: (lists, listId, updates) => (lists || []).map((l) => (l.id === listId ? { ...l, ...updates } : l)),
  /** Drop one Anthology. */
  remove: (lists, listId) => (lists || []).filter((l) => l.id !== listId),
  /** Append a book (already carrying `_listPos`) to one Anthology. */
  appendBook: (lists, listId, book) => (lists || []).map((l) =>
    (l.id === listId ? { ...l, books: [...(l.books || []), book] } : l)),
  /** Remove a book by bookId from one Anthology. */
  removeBook: (lists, listId, bookId) => (lists || []).map((l) =>
    (l.id === listId ? { ...l, books: (l.books || []).filter((b) => b.bookId !== bookId) } : l)),
};

/**
 * Build the Anthology methods for one signed-in reader.
 *
 * @param {object} deps
 * @param {{ id: string } | null} deps.user
 * @param {(fn: (s: object) => object) => void} deps.setState  DataProvider's state setter
 * @param {() => object[]} deps.getLists  current `state.lists` (read at call time)
 * @returns {object} createList, updateList, deleteList, addBookToList, removeBookFromList,
 *   setListGenres, setListMoods, followList, unfollowList, markListSeen,
 *   fetchFollowedLists, searchPublicLists
 */
export function createListActions({ user, setState, getLists }) {
  const setLists = (fn) => setState((s) => ({ ...s, lists: fn(s.lists) }));

  /** Create a private Anthology. Resolves to the new list, or null. */
  async function createList(title, description = '') {
    if (!user) return null;
    const { data, error } = await api.insertList(user.id, title, description);
    if (error || !data) return null;
    const newList = { ...data, books: [] };
    setLists((lists) => listsState.prepend(lists, newList));
    return newList;
  }

  /**
   * Update title, description, visibility or cover. Resolves to { error }.
   * State changes only after the server accepts: the cover guard
   * (pro_required:cover) can refuse, and an optimistic update would show a
   * cover the server never stored.
   */
  async function updateList(listId, updates) {
    if (!user) return { error: { message: 'signed_out' } };
    const { error } = await api.updateListRow(user.id, listId, updates);
    if (error) { console.error('updateList failed:', error); return { error }; }
    setLists((lists) => listsState.patch(lists, listId, updates));
    return { error: null };
  }

  /** Delete an Anthology. */
  async function deleteList(listId) {
    if (!user) return;
    await api.deleteListRow(user.id, listId);
    setLists((lists) => listsState.remove(lists, listId));
  }

  /** Add a catalogued book (needs `bookId`) at the end of an Anthology. */
  async function addBookToList(listId, book) {
    if (!user || !book.bookId) return;
    const list = (getLists() || []).find((l) => l.id === listId);
    if (!list) return;
    const position = (list.books || []).length;
    const { error } = await api.insertListItem(listId, book.bookId, position);
    if (error) return;
    setLists((lists) => listsState.appendBook(lists, listId, { ...book, _listPos: position }));
  }

  /** Remove a book from an Anthology. */
  async function removeBookFromList(listId, bookId) {
    if (!user) return;
    await api.deleteListItem(listId, bookId);
    setLists((lists) => listsState.removeBook(lists, listId, bookId));
  }

  /** Replace an Anthology's genres (ids, de-duplicated). */
  async function setListGenres(listId, genreIds) {
    if (!user) return;
    const ids = [...new Set(genreIds || [])];
    const { error } = await api.replaceListGenres(listId, ids);
    if (error) { console.error('setListGenres failed', error); return; }
    setLists((lists) => listsState.patch(lists, listId, { genreIds: ids }));
  }

  /**
   * Replace an Anthology's moods. Filtered against the taxonomy first: `mood`
   * is plain text, so nothing else stops a retired id being stored and later
   * rendering as a raw i18n key.
   */
  async function setListMoods(listId, moods) {
    if (!user) return;
    const vals = knownMoods([...new Set(moods || [])]);
    const { error } = await api.replaceListMoods(listId, vals);
    if (error) { console.error('setListMoods failed', error); return; }
    setLists((lists) => listsState.patch(lists, listId, { moods: vals }));
  }

  /** Follow someone's public Anthology. Resolves to true when followed. */
  async function followList(listId) {
    if (!user) return false;
    const { data, error } = await api.followListRpc(listId);
    if (error) { console.error('followList failed', error); return false; }
    return !!data;
  }

  /** Stop following. Resolves to true on success. */
  async function unfollowList(listId) {
    if (!user) return false;
    const { error } = await api.unfollowListRpc(listId);
    if (error) { console.error('unfollowList failed', error); return false; }
    return true;
  }

  /** Mark a followed Anthology as seen. */
  async function markListSeen(listId) {
    if (!user) return;
    await api.markListSeenRpc(listId);
  }

  /** Anthologies the reader follows ([] when signed out). */
  async function fetchFollowedLists() {
    if (!user) return [];
    return api.fetchFollowedLists();
  }

  return {
    createList,
    updateList,
    deleteList,
    addBookToList,
    removeBookFromList,
    setListGenres,
    setListMoods,
    followList,
    unfollowList,
    markListSeen,
    fetchFollowedLists,
    // Not gated on a user: Discover is a public surface.
    searchPublicLists: api.searchPublicLists,
  };
}
