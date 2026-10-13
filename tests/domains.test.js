// domains.test.js — Anthologies and clubs, the first two domains moved out of
// DataContext (Sprint 4). Runs the real action code against a fake Supabase
// that records every request and answers with whatever the test queues, and a
// fake setState that applies updates to a plain object.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ calls: [], replies: [] }));

// Query-builder double: records table/rpc + every chained call, resolves to the
// next queued reply (default { data: null, error: null }).
vi.mock('../src/lib/api/supabase.js', () => {
  const next = () => (db.replies.length ? db.replies.shift() : { data: null, error: null });
  const builder = (table) => {
    const call = { table, ops: [] };
    db.calls.push(call);
    const b = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'single']) {
      b[m] = (...args) => { call.ops.push([m, ...args]); return b; };
    }
    b.then = (resolve, reject) => {
      const r = next();
      return (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)).then(resolve, reject);
    };
    return b;
  };
  return {
    supabase: {
      from: (t) => builder(t),
      rpc: (name, args) => { db.calls.push({ rpc: name, args }); return Promise.resolve(next()); },
    },
  };
});

const { createListActions, listsState } = await import('../src/contexts/domains/lists.js');
const { createClubActions, clubsState } = await import('../src/contexts/domains/clubs.js');
const listsApi = await import('../src/lib/api/listsApi.js');
const clubsApi = await import('../src/lib/api/clubsApi.js');

const USER = { id: 'u1' };
function harness(initial = {}) {
  const store = { lists: [], clubs: [], ...initial };
  const setState = (fn) => Object.assign(store, fn(store));
  return { store, setState, getLists: () => store.lists };
}
const ops = (i) => db.calls[i].ops.map((o) => o[0]);

let errSpy, warnSpy;
beforeEach(() => {
  db.calls = []; db.replies = [];
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { errSpy.mockRestore(); warnSpy.mockRestore(); });

// ── pure state ──────────────────────────────────────────────────────────────
describe('state transitions never mutate', () => {
  it('lists', () => {
    const before = Object.freeze([Object.freeze({ id: 'a', books: Object.freeze([{ bookId: 'b1' }]) })]);
    expect(listsState.prepend(before, { id: 'z' }).map((l) => l.id)).toEqual(['z', 'a']);
    expect(listsState.patch(before, 'a', { title: 'T' })[0].title).toBe('T');
    expect(listsState.remove(before, 'a')).toEqual([]);
    expect(listsState.appendBook(before, 'a', { bookId: 'b2' })[0].books.map((b) => b.bookId)).toEqual(['b1', 'b2']);
    expect(listsState.removeBook(before, 'a', 'b1')[0].books).toEqual([]);
    expect(listsState.prepend(undefined, { id: 'z' })).toEqual([{ id: 'z' }]);
  });
  it('clubs', () => {
    const before = Object.freeze([Object.freeze({ id: 'c' })]);
    expect(clubsState.patch(before, 'c', { joinToken: 'x' })[0].joinToken).toBe('x');
    expect(clubsState.remove(before, 'c')).toEqual([]);
    expect(clubsState.prepend(null, { id: 'n' })).toEqual([{ id: 'n' }]);
  });
});

// ── mapping ─────────────────────────────────────────────────────────────────
describe('row mapping', () => {
  it('an Anthology row: books ordered by position, notes carried, missing books and retired moods dropped', () => {
    const l = listsApi.listFromRow({
      id: 'l1', title: 'Gothic',
      list_items: [
        { position: 2, note: 'last', book: { id: 'b2', title: 'Dracula', author: 'Bram Stoker' } },
        { position: 0, note: null, book: { id: 'b0', title: 'Rebecca', author: 'Daphne du Maurier' } },
        { position: 1, note: 'gone', book: null },
      ],
      list_genres: [{ genre_id: 'g1' }],
      list_moods: [{ mood: 'atmospheric' }, { mood: 'retired-mood' }],
    });
    expect(l.books.map((b) => [b.t, b._listPos, b._listNote])).toEqual([['Rebecca', 0, null], ['Dracula', 2, 'last']]);
    expect(l.genreIds).toEqual(['g1']);
    expect(l.moods).toEqual(['atmospheric']);
    expect(l.title).toBe('Gothic');
  });

  it('club index entries, directory cards, writable columns, poll options', () => {
    expect(clubsApi.clubFromMembership({ role: 'member', club: { id: 'c', join_mode: 'approval', max_members: 8 } }))
      .toMatchObject({ id: 'c', joinMode: 'approval', maxMembers: 8, callerRole: 'member' });
    expect(clubsApi.clubFromMembership({ role: 'member', club: null }).id).toBeUndefined();
    expect(clubsApi.publicClubFromRow({ id: 'c', member_count: '3', current_book_title: null }))
      .toMatchObject({ memberCount: 3, currentBook: null, genreNames: [], moods: [] });
    expect(clubsApi.clubUpdatesToColumns({ name: 'N', joinMode: 'auto', maxMembers: null, callerRole: 'admin' }))
      .toEqual({ name: 'N', join_mode: 'auto', max_members: null });
    expect(clubsApi.pollOptionRows('p', [{ label: 'A', bookId: 'b' }, { label: 'B' }]))
      .toEqual([
        { poll_id: 'p', label: 'A', book_id: 'b', book_author: null, cover_url: null, position: 0 },
        { poll_id: 'p', label: 'B', book_id: null, book_author: null, cover_url: null, position: 1 },
      ]);
  });
});

// ── loading ─────────────────────────────────────────────────────────────────
describe('loading degrades to empty, loudly', () => {
  it('a thrown lists query becomes [] with a warning; an errored one becomes []', async () => {
    db.replies.push(new Error('network'));
    expect(await listsApi.fetchMyLists('u1')).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    db.replies.push({ data: null, error: { message: 'rls' } });
    expect(await listsApi.fetchMyLists('u1')).toEqual([]);
  });
  it('clubs hidden by RLS (no embed) are filtered out', async () => {
    db.replies.push({ data: [{ role: 'admin', club: { id: 'c1', name: 'A' } }, { role: 'member', club: null }], error: null });
    expect((await clubsApi.fetchMyClubs('u1')).map((c) => c.id)).toEqual(['c1']);
  });
});

// ── list actions ────────────────────────────────────────────────────────────
describe('Anthology actions', () => {
  it('signed out: every method is a no-op with its old return value, and nothing is requested', async () => {
    const h = harness();
    const a = createListActions({ user: null, setState: h.setState, getLists: h.getLists });
    expect(await a.createList('x')).toBeNull();
    expect(await a.updateList('l', {})).toEqual({ error: { message: 'signed_out' } });
    expect(await a.followList('l')).toBe(false);
    expect(await a.unfollowList('l')).toBe(false);
    expect(await a.fetchFollowedLists()).toEqual([]);
    await a.deleteList('l'); await a.addBookToList('l', { bookId: 'b' }); await a.removeBookFromList('l', 'b');
    await a.setListGenres('l', ['g']); await a.setListMoods('l', ['comfort']); await a.markListSeen('l');
    expect(db.calls).toEqual([]);
  });

  it('createList inserts a private list for the reader and puts it first', async () => {
    const h = harness({ lists: [{ id: 'old' }] });
    const a = createListActions({ user: USER, ...h });
    db.replies.push({ data: { id: 'new', title: 'T' }, error: null });
    const made = await a.createList('T', 'D');
    expect(made).toEqual({ id: 'new', title: 'T', books: [] });
    expect(h.store.lists.map((l) => l.id)).toEqual(['new', 'old']);
    expect(db.calls[0].ops[0]).toEqual(['insert', { user_id: 'u1', title: 'T', description: 'D', is_public: false }]);
  });

  it('createList failure returns null and leaves state alone', async () => {
    const h = harness({ lists: [{ id: 'old' }] });
    db.replies.push({ data: null, error: { message: 'pro_required:lists' } });
    expect(await createListActions({ user: USER, ...h }).createList('T')).toBeNull();
    expect(h.store.lists).toEqual([{ id: 'old' }]);
  });

  it('updateList changes state only after the server accepts (cover guard)', async () => {
    const h = harness({ lists: [{ id: 'l', title: 'A' }] });
    const a = createListActions({ user: USER, ...h });
    db.replies.push({ error: { message: 'pro_required:cover' } });
    expect((await a.updateList('l', { cover_url: 'x' })).error.message).toBe('pro_required:cover');
    expect(h.store.lists[0].cover_url).toBeUndefined();
    db.replies.push({ error: null });
    expect(await a.updateList('l', { title: 'B' })).toEqual({ error: null });
    expect(h.store.lists[0].title).toBe('B');
    expect(db.calls[1].ops).toContainEqual(['eq', 'user_id', 'u1']);
  });

  it('addBookToList appends at the end using the CURRENT lists, and skips uncatalogued books', async () => {
    const h = harness({ lists: [{ id: 'l', books: [{ bookId: 'b1' }] }] });
    const a = createListActions({ user: USER, ...h });
    await a.addBookToList('l', { t: 'No id' });
    expect(db.calls).toEqual([]);
    h.store.lists = [{ id: 'l', books: [{ bookId: 'b1' }, { bookId: 'b2' }] }]; // changed after actions were built
    await a.addBookToList('l', { bookId: 'b3', t: 'Three' });
    expect(db.calls[0].ops[0]).toEqual(['insert', { list_id: 'l', book_id: 'b3', position: 2 }]);
    expect(h.store.lists[0].books.at(-1)).toEqual({ bookId: 'b3', t: 'Three', _listPos: 2 });
  });

  it('addBookToList: unknown list or refused insert changes nothing', async () => {
    const h = harness({ lists: [{ id: 'l', books: [] }] });
    const a = createListActions({ user: USER, ...h });
    await a.addBookToList('missing', { bookId: 'b' });
    expect(db.calls).toEqual([]);
    db.replies.push({ error: { message: 'dup' } });
    await a.addBookToList('l', { bookId: 'b' });
    expect(h.store.lists[0].books).toEqual([]);
  });

  it('setListMoods de-duplicates and drops moods outside the taxonomy before writing', async () => {
    const h = harness({ lists: [{ id: 'l' }] });
    await createListActions({ user: USER, ...h }).setListMoods('l', ['comfort', 'comfort', 'nonsense']);
    const insert = db.calls.find((c) => c.table === 'list_moods' && c.ops[0][0] === 'insert');
    expect(insert.ops[0][1]).toEqual([{ list_id: 'l', mood: 'comfort' }]);
    expect(h.store.lists[0].moods).toEqual(['comfort']);
  });

  it('setListGenres replaces in full; clearing deletes without inserting; a failed insert keeps state', async () => {
    const h = harness({ lists: [{ id: 'l', genreIds: ['old'] }] });
    const a = createListActions({ user: USER, ...h });
    await a.setListGenres('l', []);
    expect(db.calls.map((c) => [c.table, ops(db.calls.indexOf(c))[0]])).toEqual([['list_genres', 'delete']]);
    expect(h.store.lists[0].genreIds).toEqual([]);
    db.replies.push({ error: null }, { error: { message: 'fk' } });
    await a.setListGenres('l', ['g1', 'g1', 'g2']);
    expect(h.store.lists[0].genreIds).toEqual([]);
  });

  it('follow / unfollow report the server answer', async () => {
    const a = createListActions({ user: USER, ...harness() });
    db.replies.push({ data: true, error: null });
    expect(await a.followList('l')).toBe(true);
    db.replies.push({ data: null, error: { message: 'own list' } });
    expect(await a.followList('l')).toBe(false);
    db.replies.push({ error: null });
    expect(await a.unfollowList('l')).toBe(true);
    expect(db.calls.map((c) => c.rpc)).toEqual(['follow_list', 'follow_list', 'unfollow_list']);
  });

  it('searchPublicLists works signed out and sends nulls for empty filters', async () => {
    const a = createListActions({ user: null, ...harness() });
    db.replies.push({ data: [{ id: 'p', book_count: '4', moods: ['comfort', 'gone'] }], error: null });
    const [card] = await a.searchPublicLists({ genreIds: [], moods: [] });
    expect(card).toMatchObject({ id: 'p', bookCount: 4, moods: ['comfort'], callerFollows: false });
    expect(db.calls[0].args).toEqual({ p_query: null, p_genre_ids: null, p_moods: null, p_sort: 'followers' });
  });
});

// ── club actions ────────────────────────────────────────────────────────────
describe('club actions', () => {
  it('signed out: no requests, old return values', async () => {
    const a = createClubActions({ user: null, setState: () => { throw new Error('no state change'); } });
    expect(await a.createClub({ name: 'x' })).toBeNull();
    expect(await a.regenerateJoinToken('c')).toBeNull();
    expect(await a.joinPublicClub('c')).toBeNull();
    expect(await a.fetchClubJoinRequests('c')).toEqual([]);
    expect(await a.postComment({ body: 'hi' })).toBeNull();
    expect(await a.createPoll({ options: [] })).toBeNull();
    expect(await a.castVote('p', 'o')).toBeNull();
    await a.updateClub('c', {}); await a.deleteClub('c'); await a.leaveClub('c');
    await a.deleteComment('x'); await a.editComment('x', 'y'); await a.closePoll('p'); await a.deletePoll('p');
    expect(db.calls).toEqual([]);
  });

  it('createClub: insert, creator as admin, genre and mood tags, then first in the index', async () => {
    const h = harness({ clubs: [{ id: 'old' }] });
    const a = createClubActions({ user: USER, setState: h.setState });
    db.replies.push({ data: { id: 'c1', name: 'Gothic Club', join_token: 't', visibility: 'public', join_mode: 'auto' }, error: null });
    const club = await a.createClub({ name: 'Gothic Club', genreIds: ['g'], moods: ['atmospheric'], visibility: 'public' });
    expect(club).toMatchObject({ id: 'c1', joinToken: 't', callerRole: 'admin', visibility: 'public' });
    expect(db.calls.map((c) => c.table)).toEqual(['book_clubs', 'book_club_members', 'book_club_genres', 'book_club_moods']);
    expect(db.calls[1].ops[0][1]).toEqual({ club_id: 'c1', user_id: 'u1', role: 'admin' });
    expect(db.calls[0].ops[0][1]).toEqual({ name: 'Gothic Club', description: null, visibility: 'public', join_mode: 'auto', max_members: null });
    expect(h.store.clubs.map((c) => c.id)).toEqual(['c1', 'old']);
  });

  it('createClub with no tags skips the tag tables; failure returns null', async () => {
    const a = createClubActions({ user: USER, setState: harness().setState });
    db.replies.push({ data: { id: 'c2' }, error: null });
    await a.createClub({ name: 'Plain' });
    expect(db.calls.map((c) => c.table)).toEqual(['book_clubs', 'book_club_members']);
    db.calls = [];
    db.replies.push({ data: null, error: { message: 'pro_required:clubs' } });
    expect(await a.createClub({ name: 'Second' })).toBeNull();
    expect(db.calls).toHaveLength(1);
  });

  it('updateClub writes only club columns; leave and delete drop it from the index', async () => {
    const h = harness({ clubs: [{ id: 'c', name: 'A' }, { id: 'd' }] });
    const a = createClubActions({ user: USER, setState: h.setState });
    await a.updateClub('c', { name: 'B', callerRole: 'admin' });
    expect(db.calls[0].ops[0]).toEqual(['update', { name: 'B' }]);
    expect(h.store.clubs[0].name).toBe('B');
    await a.leaveClub('c');
    expect(db.calls[1].ops).toEqual([['delete'], ['eq', 'club_id', 'c'], ['eq', 'user_id', 'u1']]);
    await a.deleteClub('d');
    expect(h.store.clubs).toEqual([]);
  });

  it('comments and questions are trimmed; blank text sends nothing', async () => {
    const a = createClubActions({ user: USER, setState: () => {} });
    expect(await a.postComment({ sessionId: 's', clubId: 'c', body: '   ' })).toBeNull();
    expect(db.calls).toEqual([]);
    db.replies.push({ data: { id: 'cm' }, error: null });
    expect(await a.postComment({ sessionId: 's', clubId: 'c', body: '  Loved it  ' })).toEqual({ id: 'cm' });
    expect(db.calls[0].ops[0][1]).toEqual({ session_id: 's', club_id: 'c', body: 'Loved it', question_id: null, parent_id: null, created_by: 'u1' });
    await a.editComment('cm', '  edited ');
    expect(db.calls[1].ops).toEqual([['update', { body: 'edited' }], ['eq', 'id', 'cm'], ['eq', 'created_by', 'u1']]);
  });

  it('createPoll: options failure is logged but the poll is still returned', async () => {
    const a = createClubActions({ user: USER, setState: () => {} });
    db.replies.push({ data: { id: 'p1' }, error: null }, { error: { message: 'options' } });
    expect(await a.createPoll({ clubId: 'c', question: 'Next?', options: [{ label: 'A' }] })).toEqual({ id: 'p1' });
    expect(errSpy).toHaveBeenCalledWith('poll options insert failed', { message: 'options' });
  });

  it('join requests and directory statuses come back as plain statuses', async () => {
    const a = createClubActions({ user: USER, setState: () => {} });
    db.replies.push({ data: { status: 'pending_approval' }, error: null }, { data: { status: 'joined' }, error: null });
    expect(await a.joinPublicClub('c')).toBe('pending_approval');
    expect(await a.approveJoinRequest('r')).toBe('joined');
    db.replies.push({ data: null, error: { message: 'x' } });
    expect(await a.rejectJoinRequest('r')).toBeNull();
  });
});
