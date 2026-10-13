// src/hooks/useLists.js — the reader's Anthologies and everything you can do to them.
//
// The domain-shaped way in (code-health Sprint 4): a view that only deals with
// Anthologies asks for them here instead of reaching into the whole useData()
// object. Same objects and methods as useData() exposes — the methods are built
// in src/contexts/domains/lists.js, the requests live in src/lib/api/listsApi.js.

import { useData } from '../contexts/DataContext';

/**
 * @returns {{
 *   lists: object[],
 *   createList: (title: string, description?: string) => Promise<object|null>,
 *   updateList: (listId: string, updates: object) => Promise<{ error: object|null }>,
 *   deleteList: (listId: string) => Promise<void>,
 *   addBookToList: (listId: string, book: object) => Promise<void>,
 *   removeBookFromList: (listId: string, bookId: string) => Promise<void>,
 *   setListGenres: (listId: string, genreIds: string[]) => Promise<void>,
 *   setListMoods: (listId: string, moods: string[]) => Promise<void>,
 *   followList: (listId: string) => Promise<boolean>,
 *   unfollowList: (listId: string) => Promise<boolean>,
 *   markListSeen: (listId: string) => Promise<void>,
 *   fetchFollowedLists: () => Promise<object[]>,
 *   searchPublicLists: (opts?: object) => Promise<object[]>,
 * }}
 */
export function useLists() {
  const d = useData();
  return {
    lists: d.lists,
    createList: d.createList,
    updateList: d.updateList,
    deleteList: d.deleteList,
    addBookToList: d.addBookToList,
    removeBookFromList: d.removeBookFromList,
    setListGenres: d.setListGenres,
    setListMoods: d.setListMoods,
    followList: d.followList,
    unfollowList: d.unfollowList,
    markListSeen: d.markListSeen,
    fetchFollowedLists: d.fetchFollowedLists,
    searchPublicLists: d.searchPublicLists,
  };
}
