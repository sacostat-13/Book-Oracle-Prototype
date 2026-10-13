// src/lib/api/listsApi.js — Anthologies (the `lists` tables) in Supabase.
//
// Every read and write the app makes for a reader's own Anthologies, and the
// row → client mapping, with no React in sight. State updates live in
// src/contexts/domains/lists.js; views reach both through useLists().
//
// Each function does one request (or one replace-in-full pair) and returns
// what Supabase said, so the caller decides what a failure means. Moved out of
// DataContext in Sprint 4 with behaviour unchanged.

import { supabase } from './supabase';
import { bookRowToClient } from '../book/bookRow';
import { knownMoods } from '../../data/moods';

// ── Mapping ──────────────────────────────────────────────────────────────────

/**
 * A `lists` row with its joins → the client Anthology.
 * Books come back ordered by position, carrying `_listNote` and `_listPos`.
 * Genres stay ids (the editor's picker is keyed on id); retired mood ids are dropped.
 *
 * @param {object} row  lists row with list_items(book), list_genres, list_moods
 * @returns {object}    { ...row, books, genreIds, moods }
 */
export function listFromRow(row) {
  return {
    ...row,
    books: (row.list_items || [])
      .sort((a, b) => a.position - b.position)
      .map((li) => li.book ? { ...bookRowToClient(li.book), _listNote: li.note, _listPos: li.position } : null)
      .filter(Boolean),
    genreIds: (row.list_genres || []).map((g) => g.genre_id),
    moods: knownMoods((row.list_moods || []).map((m) => m.mood)),
  };
}

/** A `get_followed_lists` row → the card shape for "Anthologies you follow". */
export function followedListFromRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    ownerUsername: r.owner_username,
    ownerDisplay: r.owner_display,
    ownerAvatar: r.owner_avatar,
    bookCount: Number(r.book_count) || 0,
    followerCount: Number(r.follower_count) || 0,
    coverUrls: r.cover_urls || [],
    hasUpdates: !!r.has_updates,
  };
}

/** A `search_public_lists` row → the Discover card shape. */
export function publicListFromRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    createdAt: r.created_at,
    ownerUsername: r.owner_username,
    ownerDisplay: r.owner_display,
    ownerAvatar: r.owner_avatar,
    bookCount: Number(r.book_count) || 0,
    followerCount: Number(r.follower_count) || 0,
    genreNames: r.genre_names || [],
    moods: knownMoods(r.moods || []),
    coverUrls: r.cover_urls || [],
    callerFollows: !!r.caller_follows,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The reader's own Anthologies, newest first, books and tags included.
 * Degrades to [] (with a warning) on failure: a list failure must never block
 * the shelves loading alongside it.
 *
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function fetchMyLists(userId) {
  let res = { data: [] };
  try {
    res = await supabase
      .from('lists')
      // Genres and moods ride along: tiny join tables, and the alternative is two
      // more round-trips on every load to render chips the editor needs anyway.
      .select('*, list_items(position, note, added_at, book:books(*, position_in_series, series:series(*))), list_genres(genre_id), list_moods(mood)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
  } catch (e) {
    console.warn('Lists query failed — continuing without lists', e);
  }
  return (res?.data || []).map(listFromRow);
}

/** Anthologies the signed-in reader follows. [] on failure (logged). */
export async function fetchFollowedLists() {
  const { data, error } = await supabase.rpc('get_followed_lists');
  if (error) { console.error('get_followed_lists failed', error); return []; }
  return (data || []).map(followedListFromRow);
}

/**
 * Public Anthologies for Discover. Works signed out — a list shared on social
 * has to render for someone who has never signed in.
 *
 * @param {{ query?: string|null, genreIds?: string[]|null, moods?: string[]|null, sort?: string }} [opts]
 * @returns {Promise<object[]>}  [] on failure (logged)
 */
export async function searchPublicLists({ query = null, genreIds = null, moods = null, sort = 'followers' } = {}) {
  const { data, error } = await supabase.rpc('search_public_lists', {
    p_query: query || null,
    p_genre_ids: genreIds && genreIds.length ? genreIds : null,
    p_moods: moods && moods.length ? moods : null,
    p_sort: sort,
  });
  if (error) { console.error('searchPublicLists failed', error); return []; }
  return (data || []).map(publicListFromRow);
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Insert a private Anthology. Resolves to { data: row, error }. */
export function insertList(userId, title, description) {
  return supabase
    .from('lists')
    .insert({ user_id: userId, title, description, is_public: false })
    .select('*')
    .single();
}

/** Update the reader's own Anthology. Resolves to { error }. */
export function updateListRow(userId, listId, updates) {
  return supabase.from('lists').update(updates).eq('id', listId).eq('user_id', userId);
}

/** Delete the reader's own Anthology. */
export function deleteListRow(userId, listId) {
  return supabase.from('lists').delete().eq('id', listId).eq('user_id', userId);
}

/** Add a book at `position`. Resolves to { error }. */
export function insertListItem(listId, bookId, position) {
  return supabase.from('list_items').insert({ list_id: listId, book_id: bookId, position });
}

/** Remove a book from an Anthology. */
export function deleteListItem(listId, bookId) {
  return supabase.from('list_items').delete().eq('list_id', listId).eq('book_id', bookId);
}

/**
 * Replace an Anthology's genres in full (delete, then insert). A list carries a
 * handful, so diffing costs more code than it saves and gets the edge cases
 * (last genre removed, all swapped) wrong more often.
 *
 * @returns {Promise<{ error: object|null }>}  the insert's error, if any
 */
export async function replaceListGenres(listId, genreIds) {
  await supabase.from('list_genres').delete().eq('list_id', listId);
  if (!genreIds.length) return { error: null };
  const { error } = await supabase.from('list_genres').insert(genreIds.map((genre_id) => ({ list_id: listId, genre_id })));
  return { error: error || null };
}

/** Replace an Anthology's moods in full. Same shape as replaceListGenres. */
export async function replaceListMoods(listId, moods) {
  await supabase.from('list_moods').delete().eq('list_id', listId);
  if (!moods.length) return { error: null };
  const { error } = await supabase.from('list_moods').insert(moods.map((mood) => ({ list_id: listId, mood })));
  return { error: error || null };
}

// Follows go through RPCs: follow_list enforces "public only" and "not your
// own" server-side, so the UI is never the only guard on a private list.

/** Resolves to { data: boolean, error }. */
export function followListRpc(listId) {
  return supabase.rpc('follow_list', { p_list_id: listId });
}

/** Resolves to { error }. */
export function unfollowListRpc(listId) {
  return supabase.rpc('unfollow_list', { p_list_id: listId });
}

/** Clear the "updated since you looked" dot on a followed Anthology. */
export function markListSeenRpc(listId) {
  return supabase.rpc('mark_list_seen', { p_list_id: listId });
}
