// src/hooks/useClubs.js — the reader's book clubs, the public directory,
// session discussion and polls.
//
// The domain-shaped way in (code-health Sprint 4). Same objects and methods as
// useData() exposes — built in src/contexts/domains/clubs.js, requests in
// src/lib/api/clubsApi.js. Only the club index is shared state; members,
// sessions, comments and polls are loaded by the club views.

import { useData } from '../contexts/DataContext';

/**
 * @returns {{
 *   clubs: object[],
 *   createClub: (opts: object) => Promise<object|null>,
 *   updateClub: (clubId: string, updates: object) => Promise<void>,
 *   deleteClub: (clubId: string) => Promise<void>,
 *   leaveClub: (clubId: string) => Promise<void>,
 *   regenerateJoinToken: (clubId: string) => Promise<string|null>,
 *   searchPublicClubs: (opts?: object) => Promise<object[]>,
 *   joinPublicClub: (clubId: string) => Promise<string|null>,
 *   fetchClubJoinRequests: (clubId: string) => Promise<object[]>,
 *   approveJoinRequest: (requestId: string) => Promise<string|null>,
 *   rejectJoinRequest: (requestId: string) => Promise<string|null>,
 *   postComment: (opts: object) => Promise<object|null>,
 *   deleteComment: (commentId: string) => Promise<void>,
 *   editComment: (commentId: string, body: string) => Promise<void>,
 *   addQuestion: (opts: object) => Promise<object|null>,
 *   deleteQuestion: (questionId: string) => Promise<void>,
 *   createPoll: (opts: object) => Promise<object|null>,
 *   castVote: (pollId: string, optionId: string) => Promise<object|null>,
 *   closePoll: (pollId: string) => Promise<void>,
 *   deletePoll: (pollId: string) => Promise<void>,
 * }}
 */
export function useClubs() {
  const d = useData();
  return {
    clubs: d.clubs,
    createClub: d.createClub,
    updateClub: d.updateClub,
    deleteClub: d.deleteClub,
    leaveClub: d.leaveClub,
    regenerateJoinToken: d.regenerateJoinToken,
    searchPublicClubs: d.searchPublicClubs,
    joinPublicClub: d.joinPublicClub,
    fetchClubJoinRequests: d.fetchClubJoinRequests,
    approveJoinRequest: d.approveJoinRequest,
    rejectJoinRequest: d.rejectJoinRequest,
    postComment: d.postComment,
    deleteComment: d.deleteComment,
    editComment: d.editComment,
    addQuestion: d.addQuestion,
    deleteQuestion: d.deleteQuestion,
    createPoll: d.createPoll,
    castVote: d.castVote,
    closePoll: d.closePoll,
    deletePoll: d.deletePoll,
  };
}
