// src/contexts/domains/clubs.js — what the app does with book clubs.
//
// Second domain moved out of DataContext (code-health Sprint 4, L1/L2), built
// like domains/lists.js: pure transitions on `state.clubs` (`clubsState`),
// then `createClubActions()`, whose methods do the Supabase call
// (src/lib/api/clubsApi.js) and the matching state update. Views use
// useClubs() (src/hooks/useClubs.js); `useData()` keeps the same names.
//
// Only the club INDEX lives in shared state. Members, sessions, comments and
// polls are fetched by the club views; the discussion and poll methods here
// write and hand the result back for the view to merge.
//
// Clubs are signed-in only, except the public directory search.

import * as api from '../../lib/api/clubsApi';

/** Pure transitions on the `clubs` array. Never mutate; always return a new array. */
export const clubsState = {
  /** A new club goes first. */
  prepend: (clubs, club) => [club, ...(clubs || [])],
  /** Merge `updates` into one club. */
  patch: (clubs, clubId, updates) => (clubs || []).map((c) => (c.id === clubId ? { ...c, ...updates } : c)),
  /** Drop one club (deleted, or the reader left). */
  remove: (clubs, clubId) => (clubs || []).filter((c) => c.id !== clubId),
};

/**
 * Build the club methods for one signed-in reader.
 *
 * @param {object} deps
 * @param {{ id: string } | null} deps.user
 * @param {(fn: (s: object) => object) => void} deps.setState  DataProvider's state setter
 * @returns {object} club, directory, discussion and poll methods (names as in useClubs())
 */
export function createClubActions({ user, setState }) {
  const setClubs = (fn) => setState((s) => ({ ...s, clubs: fn(s.clubs) }));

  // ── Clubs ──────────────────────────────────────────────────────────────

  /**
   * Create a club, make the reader its admin, tag it. Resolves to the new
   * index entry, or null if the club insert failed (tag failures are ignored,
   * as before).
   */
  async function createClub({
    name, description, genreIds = [],
    moods = [], visibility = 'private', joinMode = 'auto', maxMembers = null,
  }) {
    if (!user) return null;
    const { data, error } = await api.insertClub({ name, description, visibility, joinMode, maxMembers });
    if (error) { console.error('createClub failed', error); return null; }
    await api.insertMember(data.id, user.id, 'admin');
    if (genreIds.length > 0) await api.insertClubGenres(data.id, genreIds);
    if (moods.length > 0) await api.insertClubMoods(data.id, moods);
    const newClub = api.clubFromCreatedRow(data);
    setClubs((clubs) => clubsState.prepend(clubs, newClub));
    return newClub;
  }

  /** Update name, description, visibility, joinMode or maxMembers. */
  async function updateClub(clubId, updates) {
    if (!user) return;
    await api.updateClubRow(clubId, api.clubUpdatesToColumns(updates));
    setClubs((clubs) => clubsState.patch(clubs, clubId, updates));
  }

  /** Delete a club (admins). */
  async function deleteClub(clubId) {
    if (!user) return;
    await api.deleteClubRow(clubId);
    setClubs((clubs) => clubsState.remove(clubs, clubId));
  }

  /** Leave a club. */
  async function leaveClub(clubId) {
    if (!user) return;
    await api.deleteMembership(clubId, user.id);
    setClubs((clubs) => clubsState.remove(clubs, clubId));
  }

  /** Replace the invite token. Resolves to the new token, or null. */
  async function regenerateJoinToken(clubId) {
    if (!user) return null;
    const { data, error } = await api.regenerateJoinTokenRpc(clubId);
    if (error || !data) return null;
    setClubs((clubs) => clubsState.patch(clubs, clubId, { joinToken: data }));
    return data;
  }

  // ── Directory and join requests ───────────────────────────────────────

  /** Resolves to 'joined' | 'pending_approval' | 'waitlisted' | 'already_member', or null. */
  async function joinPublicClub(clubId) {
    if (!user) return null;
    const { data, error } = await api.joinPublicClubRpc(clubId);
    if (error) { console.error('joinPublicClub failed', error); return null; }
    return data?.status || null;
  }

  /** Pending and waitlisted requests for a club ([] when signed out or on failure). */
  async function fetchClubJoinRequests(clubId) {
    if (!user) return [];
    const { data, error } = await api.selectJoinRequests(clubId);
    if (error) { console.error('fetchClubJoinRequests failed', error); return []; }
    return data || [];
  }

  /** Resolves to the request's new status, or null. */
  async function approveJoinRequest(requestId) {
    if (!user) return null;
    const { data, error } = await api.approveJoinRequestRpc(requestId);
    if (error) { console.error('approveJoinRequest failed', error); return null; }
    return data?.status || null;
  }

  /** Resolves to the request's new status, or null. */
  async function rejectJoinRequest(requestId) {
    if (!user) return null;
    const { data, error } = await api.rejectJoinRequestRpc(requestId);
    if (error) { console.error('rejectJoinRequest failed', error); return null; }
    return data?.status || null;
  }

  // ── Session discussion ────────────────────────────────────────────────

  /** Post a comment (or reply). Resolves to the row, or null for blank text / failure. */
  async function postComment({ sessionId, clubId, body, questionId = null, parentId = null }) {
    if (!user || !body?.trim()) return null;
    const { data, error } = await api.insertComment({ sessionId, clubId, body: body.trim(), questionId, parentId, userId: user.id });
    if (error) { console.error('postComment failed', error); return null; }
    return data;
  }

  /** Delete a comment. */
  async function deleteComment(commentId) {
    if (!user) return;
    const { error } = await api.deleteCommentRow(commentId);
    if (error) console.error('deleteComment failed', error);
  }

  /** Edit the reader's own comment (blank text is ignored). */
  async function editComment(commentId, body) {
    if (!user || !body?.trim()) return;
    const { error } = await api.updateCommentRow(commentId, user.id, body.trim());
    if (error) console.error('editComment failed', error);
  }

  /** Add a discussion question. Resolves to the row, or null. */
  async function addQuestion({ sessionId, clubId, body, position = 0 }) {
    if (!user || !body?.trim()) return null;
    const { data, error } = await api.insertQuestion({ sessionId, clubId, body: body.trim(), position, userId: user.id });
    if (error) { console.error('addQuestion failed', error); return null; }
    return data;
  }

  /** Delete a discussion question. */
  async function deleteQuestion(questionId) {
    if (!user) return;
    await api.deleteQuestionRow(questionId);
  }

  // ── Polls ─────────────────────────────────────────────────────────────

  /**
   * Create a poll and its options (in order). Resolves to the poll row, or
   * null if the poll insert failed; an options failure is logged only.
   */
  async function createPoll({ clubId, question, options, closesAt = null, isOraclePick = false }) {
    if (!user) return null;
    const { data: poll, error: pollErr } = await api.insertPoll({ clubId, question, closesAt, isOraclePick });
    if (pollErr) { console.error('createPoll failed', pollErr); return null; }
    const { error: optErr } = await api.insertPollOptions(api.pollOptionRows(poll.id, options));
    if (optErr) console.error('poll options insert failed', optErr);
    return poll;
  }

  /** Vote. Resolves to the updated counts for every option, or null. */
  async function castVote(pollId, optionId) {
    if (!user) return null;
    const { data, error } = await api.castVoteRpc(pollId, optionId);
    if (error) { console.error('castVote failed', error); return null; }
    return data;
  }

  /** Close a poll. */
  async function closePoll(pollId) {
    if (!user) return;
    await api.closePollRow(pollId);
  }

  /** Delete a poll. */
  async function deletePoll(pollId) {
    if (!user) return;
    await api.deletePollRow(pollId);
  }

  return {
    createClub,
    updateClub,
    deleteClub,
    leaveClub,
    regenerateJoinToken,
    // Not gated on a user: the directory is browsable signed out.
    searchPublicClubs: api.searchPublicClubs,
    joinPublicClub,
    fetchClubJoinRequests,
    approveJoinRequest,
    rejectJoinRequest,
    postComment,
    deleteComment,
    editComment,
    addQuestion,
    deleteQuestion,
    createPoll,
    castVote,
    closePoll,
    deletePoll,
  };
}
