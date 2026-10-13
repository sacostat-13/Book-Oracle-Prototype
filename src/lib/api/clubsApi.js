// src/lib/api/clubsApi.js — book clubs, their discussions and polls, in Supabase.
//
// Reads, writes and row mapping only; no React. State updates live in
// src/contexts/domains/clubs.js and views reach both through useClubs().
// Full club detail (members, sessions) is fetched by the club views
// themselves; this file covers what the shared data layer owns.
// Moved out of DataContext in Sprint 4 with behaviour unchanged.

import { supabase } from './supabase';

// ── Mapping ──────────────────────────────────────────────────────────────────

/**
 * A `book_club_members` row with its embedded club → the club index entry.
 * Returns an entry with `id: undefined` when the club embed is missing
 * (RLS hid it); fetchMyClubs filters those out.
 *
 * @param {{ role: string, club: object|null }} m
 */
export function clubFromMembership(m) {
  return {
    id: m.club?.id,
    name: m.club?.name,
    description: m.club?.description,
    joinToken: m.club?.join_token,
    createdBy: m.club?.created_by,
    createdAt: m.club?.created_at,
    visibility: m.club?.visibility,
    joinMode: m.club?.join_mode,
    maxMembers: m.club?.max_members,
    callerRole: m.role,
  };
}

/** A freshly inserted `book_clubs` row → index entry; the creator is its admin. */
export function clubFromCreatedRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    joinToken: row.join_token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    visibility: row.visibility,
    joinMode: row.join_mode,
    maxMembers: row.max_members,
    callerRole: 'admin',
  };
}

/** A `search_public_clubs` row → the directory card shape. */
export function publicClubFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    joinMode: r.join_mode,
    maxMembers: r.max_members,
    memberCount: Number(r.member_count) || 0,
    createdAt: r.created_at,
    genreNames: r.genre_names || [],
    moods: r.moods || [],
    currentBook: r.current_book_title
      ? { title: r.current_book_title, author: r.current_book_author, coverUrl: r.current_book_cover }
      : null,
    callerStatus: r.caller_status, // 'none' | 'member' | 'pending_approval' | 'waitlisted'
  };
}

/**
 * Client club `updates` (camelCase) → the columns `book_clubs` accepts.
 * Only name, description, visibility, joinMode and maxMembers are writable.
 */
export function clubUpdatesToColumns(updates) {
  const cols = {};
  if (updates.name !== undefined) cols.name = updates.name;
  if (updates.description !== undefined) cols.description = updates.description;
  if (updates.visibility !== undefined) cols.visibility = updates.visibility;
  if (updates.joinMode !== undefined) cols.join_mode = updates.joinMode;
  if (updates.maxMembers !== undefined) cols.max_members = updates.maxMembers;
  return cols;
}

// ── Clubs ────────────────────────────────────────────────────────────────────

/**
 * The clubs the reader belongs to (index only, no members or sessions).
 * Degrades to [] (with a warning) so a club failure never blocks the shelves.
 *
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function fetchMyClubs(userId) {
  let res = { data: [] };
  try {
    res = await supabase
      .from('book_club_members')
      .select('role, club:book_clubs(id, name, description, join_token, created_by, created_at, visibility, join_mode, max_members)')
      .eq('user_id', userId);
  } catch (e) {
    console.warn('Clubs query failed — continuing without clubs', e);
  }
  return (res.data || []).map(clubFromMembership).filter((c) => c.id);
}

/** Insert a club. Resolves to { data: row, error }. */
export function insertClub({ name, description, visibility, joinMode, maxMembers }) {
  return supabase
    .from('book_clubs')
    .insert({
      name,
      description: description || null,
      visibility,
      join_mode: joinMode,
      max_members: maxMembers || null,
    })
    .select()
    .single();
}

/** Make `userId` a member of `clubId` with `role`. */
export function insertMember(clubId, userId, role) {
  return supabase.from('book_club_members').insert({ club_id: clubId, user_id: userId, role });
}

/** Tag a club with genres (ids). */
export function insertClubGenres(clubId, genreIds) {
  return supabase.from('book_club_genres').insert(genreIds.map((gid) => ({ club_id: clubId, genre_id: gid })));
}

/** Tag a club with moods (same taxonomy as onboarding's mood chips). */
export function insertClubMoods(clubId, moods) {
  return supabase.from('book_club_moods').insert(moods.map((mood) => ({ club_id: clubId, mood })));
}

/** Write club columns (already mapped by clubUpdatesToColumns). */
export function updateClubRow(clubId, columns) {
  return supabase.from('book_clubs').update(columns).eq('id', clubId);
}

/** Delete a club (RLS: admins only). */
export function deleteClubRow(clubId) {
  return supabase.from('book_clubs').delete().eq('id', clubId);
}

/** Remove the reader's own membership. */
export function deleteMembership(clubId, userId) {
  return supabase.from('book_club_members').delete().eq('club_id', clubId).eq('user_id', userId);
}

/** New invite token. Resolves to { data: token, error }. */
export function regenerateJoinTokenRpc(clubId) {
  return supabase.rpc('regenerate_join_token', { p_club_id: clubId });
}

// ── Public directory and join requests ───────────────────────────────────────

/**
 * Public clubs for the directory. [] on failure (logged).
 *
 * @param {{ query?: string|null, genreIds?: string[]|null, moods?: string[]|null, openOnly?: boolean, sort?: string }} [opts]
 */
export async function searchPublicClubs({ query = null, genreIds = null, moods = null, openOnly = false, sort = 'activity' } = {}) {
  const { data, error } = await supabase.rpc('search_public_clubs', {
    p_query: query || null,
    p_genre_ids: genreIds && genreIds.length ? genreIds : null,
    p_moods: moods && moods.length ? moods : null,
    p_open_only: openOnly,
    p_sort: sort,
  });
  if (error) { console.error('searchPublicClubs failed', error); return []; }
  return (data || []).map(publicClubFromRow);
}

/** Resolves to { data: { status }, error }. */
export function joinPublicClubRpc(clubId) {
  return supabase.rpc('join_public_club', { p_club_id: clubId });
}

/** Pending and waitlisted requests for a club, oldest first. Resolves to { data, error }. */
export function selectJoinRequests(clubId) {
  return supabase
    .from('club_join_requests')
    .select('id, user_id, status, created_at, profile:profiles(display_name, username, avatar_url)')
    .eq('club_id', clubId)
    .in('status', ['pending_approval', 'waitlisted'])
    .order('created_at', { ascending: true });
}

/** Resolves to { data: { status }, error }. */
export function approveJoinRequestRpc(requestId) {
  return supabase.rpc('approve_join_request', { p_request_id: requestId });
}

/** Resolves to { data: { status }, error }. */
export function rejectJoinRequestRpc(requestId) {
  return supabase.rpc('reject_join_request', { p_request_id: requestId });
}

// ── Session discussion ───────────────────────────────────────────────────────

/** Insert a comment (body already trimmed). Resolves to { data: row, error }. */
export function insertComment({ sessionId, clubId, body, questionId, parentId, userId }) {
  return supabase
    .from('session_comments')
    .insert({ session_id: sessionId, club_id: clubId, body, question_id: questionId || null, parent_id: parentId || null, created_by: userId })
    .select()
    .single();
}

/** Delete a comment. Resolves to { error }. */
export function deleteCommentRow(commentId) {
  return supabase.from('session_comments').delete().eq('id', commentId);
}

/** Edit the reader's own comment. Resolves to { error }. */
export function updateCommentRow(commentId, userId, body) {
  return supabase.from('session_comments').update({ body }).eq('id', commentId).eq('created_by', userId);
}

/** Insert a discussion question. Resolves to { data: row, error }. */
export function insertQuestion({ sessionId, clubId, body, position, userId }) {
  return supabase
    .from('session_questions')
    .insert({ session_id: sessionId, club_id: clubId, body, position, created_by: userId })
    .select()
    .single();
}

/** Delete a discussion question. */
export function deleteQuestionRow(questionId) {
  return supabase.from('session_questions').delete().eq('id', questionId);
}

// ── Polls ────────────────────────────────────────────────────────────────────

/** Insert a poll. Resolves to { data: row, error }. */
export function insertPoll({ clubId, question, closesAt, isOraclePick }) {
  return supabase
    .from('club_polls')
    .insert({ club_id: clubId, question, closes_at: closesAt, is_oracle_pick: isOraclePick })
    .select()
    .single();
}

/**
 * Poll options → `poll_options` rows, positions in the given order.
 *
 * @param {string} pollId
 * @param {Array<{ label: string, bookId?: string, bookAuthor?: string, coverUrl?: string }>} options
 */
export function pollOptionRows(pollId, options) {
  return options.map((opt, i) => ({
    poll_id: pollId,
    label: opt.label,
    book_id: opt.bookId || null,
    book_author: opt.bookAuthor || null,
    cover_url: opt.coverUrl || null,
    position: i,
  }));
}

/** Insert poll option rows. Resolves to { error }. */
export function insertPollOptions(rows) {
  return supabase.from('poll_options').insert(rows);
}

/** Cast (or move) the reader's vote. Resolves to { data: counts, error }. */
export function castVoteRpc(pollId, optionId) {
  return supabase.rpc('cast_vote', { p_poll_id: pollId, p_option_id: optionId });
}

/** Close a poll. */
export function closePollRow(pollId) {
  return supabase.from('club_polls').update({ closed: true }).eq('id', pollId);
}

/** Delete a poll. */
export function deletePollRow(pollId) {
  return supabase.from('club_polls').delete().eq('id', pollId);
}
