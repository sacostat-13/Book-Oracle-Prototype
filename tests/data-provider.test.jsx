// @vitest-environment jsdom
//
// data-provider.test.jsx — what DataProvider DOES, recorded.
//
// Written before DataContext was split into domain modules (Sprint 4), against
// the code as it stood, so the snapshots in __snapshots__/ are a record of the
// provider's behaviour: for each action, the state it leaves, the share moment
// and toast it raises, the import job, what it logs, and every request it sends
// to Supabase, in order. Moving code must not change any of it. A snapshot that
// changes is a behaviour change: deliberate ones are re-recorded with
// `vitest -u` and called out in review; anything else is a bug.
//
// Runs the real provider (React, effects, persistence) in jsdom with:
//   - a fake Supabase that records calls and answers through `db.handler`;
//   - a fake AuthContext whose user each test chooses;
//   - Date and crypto.randomUUID frozen, so ids and timestamps are stable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';

// ── fakes ───────────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({ calls: [], handler: null }));
const auth = vi.hoisted(() => ({ user: null, loading: false }));

vi.mock('../src/lib/api/supabase.js', () => {
  const defaultReply = (call) => {
    if (call.rpc === 'upsert_book') return { data: `bk:${call.args._title}`, error: null };
    const ops = (call.ops || []).map((o) => o[0]);
    if (ops.includes('single') || ops.includes('maybeSingle')) return { data: null, error: null };
    return { data: [], error: null };
  };
  const reply = (call) => {
    const r = db.handler ? db.handler(call) : undefined;
    return r === undefined ? defaultReply(call) : r;
  };
  const builder = (table) => {
    const call = { table, ops: [] };
    db.calls.push(call);
    const b = {};
    for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'gte', 'lte',
      'order', 'limit', 'range', 'single', 'maybeSingle', 'match', 'filter', 'not', 'or']) {
      b[m] = (...args) => { call.ops.push([m, ...args]); return b; };
    }
    b.then = (res, rej) => Promise.resolve().then(() => reply(call)).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t) => builder(t),
      rpc: (name, args) => {
        const call = { rpc: name, args, ops: [] };
        db.calls.push(call);
        const p = Promise.resolve().then(() => reply(call));
        // .range() on an rpc (loadVault pages): record and return the same promise shape
        p.range = (...a) => { call.ops.push(['range', ...a]); return Promise.resolve().then(() => reply(call)); };
        return p;
      },
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

vi.mock('../src/contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));

const { DataProvider, useData } = await import('../src/contexts/DataContext.jsx');

// ── harness ─────────────────────────────────────────────────────────────────
const USER = { id: 'u1', email: 'reader@example.com' };
const LOCAL_KEY = 'wishlist_oracle_state_v2';
const SESSION_KEY = 'wishlist_oracle_session_v3';
const api = { current: null };
let logs = [];

function Probe() { api.current = useData(); return null; }

const book = (t, a, extra = {}) => ({ t, a, pp: 300, ...extra });
const REBECCA = book('Rebecca', 'Daphne du Maurier', { bookId: 'b-reb', g: 'Gothic', c: 3, p: 4 });
const DRACULA = book('Dracula', 'Bram Stoker', { bookId: 'b-dra', g: 'Horror', c: 3, p: 3 });
const PIRANESI = book('Piranesi', 'Susanna Clarke', { g: 'Fantasy' }); // not yet in the catalogue
const KINDRED = book('Kindred', 'Octavia E. Butler', { bookId: 'b-kin', dateRead: '2026-03-02', rating: 5 });

const BASE = {
  onboarded: true,
  profile: { displayName: 'Test', readingLevel: 3, accomplishmentsBackfilledAt: '2026-01-01' },
  library: [KINDRED],
  wishlist: [REBECCA],
  readNext: [],
  currentlyReading: [{ ...DRACULA, startedAt: '2026-10-01', pagesRead: 40 }],
  plans: [],
  lists: [],
  clubs: [],
  readingGoalCount: 10,
  genresByBookId: { 'b-reb': [{ genreId: 'g1', name: 'Gothic', usageCount: 3 }] },
  categoriesByBookId: {},
  memories: {},
  accomplishments: [],
  editionsByBookId: {},
  coachmarksSeen: [],
  lastSeenVersion: '0.1.0',
};

async function mount({ signedIn, seed = BASE, viaCache = signedIn, expectHydrated = signedIn }) {
  auth.user = signedIn ? USER : null;
  if (seed) localStorage.setItem(LOCAL_KEY, JSON.stringify(seed));
  if (signedIn && viaCache && seed) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      uid: USER.id, state: seed, ts: Date.now(), catalogVersion: 7, shelfStamp: null,
    }));
  }
  render(<DataProvider><Probe /></DataProvider>);
  await waitFor(() => expect(api.current && !api.current.loading && (!expectHydrated || api.current.dataHydrated)).toBe(true));
  await settle();
}

// Let effects, persistence and fire-and-forget promises finish.
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function run(fn) {
  db.calls = []; logs = [];
  let result;
  await act(async () => { result = await fn(api.current); });
  await settle();
  return result;
}

const SHELF_KEYS = ['onboarded', 'profile', 'library', 'wishlist', 'readNext', 'currentlyReading', 'plans',
  'currentPlan', 'readingGoalCount', 'categoriesByBookId', 'genresByBookId', 'memories', 'accomplishments',
  'editionsByBookId', 'coachmarksSeen', 'lastSeenVersion', 'shelfSortMode', 'oracleMode', 'dashboardLayout'];

function snapshot(result) {
  const d = api.current;
  const state = Object.fromEntries(SHELF_KEYS.map((k) => [k, d.state[k]]));
  return {
    result: result === undefined ? '<undefined>' : result,
    state,
    shareMoment: d.shareMoment ? { type: d.shareMoment.type, key: d.shareMoment.key, title: d.shareMoment.book?.t } : null,
    toast: d.toast ? { msg: d.toast.msg, isError: d.toast.isError } : null,
    importJob: d.importJob,
    logs,
    calls: db.calls,
  };
}

let uuid = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T15:00:00Z'));
  uuid = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `uuid-${++uuid}`);
  for (const level of ['error', 'warn', 'info']) {
    vi.spyOn(console, level).mockImplementation((...a) => logs.push(`${level}: ${typeof a[0] === 'string' ? a[0].split('\n')[0] : JSON.stringify(a[0])}`));
  }
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  db.calls = []; db.handler = null; logs = [];
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── loading ─────────────────────────────────────────────────────────────────
describe('loading', () => {
  it('guest: state comes from localStorage, and the accomplishments backfill runs', async () => {
    await mount({ signedIn: false });
    expect(snapshot()).toMatchSnapshot();
  });

  it('signed in, fresh: every table is read and mapped into state', async () => {
    localStorage.clear();
    db.handler = (c) => {
      if (c.table === 'profiles' && c.ops.some((o) => o[0] === 'maybeSingle')) {
        return { data: {
          id: 'u1', display_name: 'Reader', username: 'reader', avatar_url: null, is_curator: false,
          shelf_visibility: 'public', favorite_genres: ['Gothic'], email_notifications: false,
          preferences: { onboarded: true, readingLevel: 4, readNext: [{ t: 'Middlemarch', a: 'George Eliot' }], readingGoalCount: 12 },
        }, error: null };
      }
      if (c.table === 'wishlist_items') return { data: [{ id: 'w1', notes: 'gift', added_at: '2026-09-01', book: { id: 'b-reb', title: 'Rebecca', author: 'Daphne du Maurier', genre: 'Gothic' } }], error: null };
      if (c.table === 'read_books' && c.ops.some((o) => o[0] === 'range')) return { data: [{ id: 'r1', rating: 5, read_at: '2026-03-02', source: 'goodreads_import', book: { id: 'b-kin', title: 'Kindred', author: 'Octavia E. Butler', pages: 264 } }], error: null };
      if (c.table === 'currently_reading') return { data: [{ started_at: '2026-10-01', pages_read: 40, user_page_count: null, progress_minutes: null, book: { id: 'b-dra', title: 'Dracula', author: 'Bram Stoker', series: { id: 's1', name: 'Gothic Classics', total_books: 3 }, position_in_series: 1 } }], error: null };
      if (c.table === 'plans') return { data: [{ id: 'p1', title: 'Autumn', created_at: '2026-09-20', content: { type: 'genre', steps: [] } }], error: null };
      if (c.table === 'reader_editions') return { data: [{ book_id: 'b-dra', language: 'en', page_count: 418 }], error: null };
      if (c.table === 'reading_memories') return { data: [{ id: 'm1', book_id: 'b-dra', kind: 'progress', body: 'Ominous.', pages_at: 40, pct_at: null, created_at: '2026-10-02' }], error: null };
      if (c.table === 'book_genres_view') return { data: [{ book_id: 'b-reb', genre_id: 'g1', genre_name: 'Gothic', normalized_name: 'gothic', genre_source: 'oracle', usage_count: 9, assigned_by_source: 'oracle' }], error: null };
      if (c.table === 'genres') return { data: [{ id: 'g1', name: 'Gothic', normalized_name: 'gothic', source: 'oracle', usage_count: 9, genre_families: { slug: 'dark', name: 'Dark', sort_order: 2 } }], error: null };
      return undefined;
    };
    await mount({ signedIn: true, seed: null, viaCache: false });
    expect(snapshot()).toMatchSnapshot();
  });

  it('signed in, a shelf query fails: falls back to localStorage and caches nothing', async () => {
    db.handler = (c) => (c.table === 'read_books' && c.ops.some((o) => o[0] === 'range')
      ? { data: null, error: { message: 'column progress does not exist' } } : undefined);
    await mount({ signedIn: true, viaCache: false, expectHydrated: false });
    expect({ ...snapshot(), hydrated: api.current.dataHydrated, session: sessionStorage.getItem(SESSION_KEY) }).toMatchSnapshot();
  });

  it('signed in, cached: renders from the session cache, then checks the catalogue version', async () => {
    db.handler = (c) => (c.table === 'catalog_meta' ? { data: { version: 7 }, error: null } : undefined);
    await mount({ signedIn: true });
    expect(snapshot()).toMatchSnapshot();
  });
});

// ── actions, for a guest and for a signed-in reader ─────────────────────────
const ACTIONS = {
  'addToWishlist: new book': (d) => d.addToWishlist(PIRANESI),
  'addToWishlist: already on a shelf': (d) => d.addToWishlist(KINDRED),
  'removeFromWishlist': (d) => d.removeFromWishlist(REBECCA),
  'addToReadNext then removeFromReadNext': async (d) => { d.addToReadNext(PIRANESI); },
  'removeFromReadNext': (d) => d.removeFromReadNext(PIRANESI),
  'startReading': (d) => d.startReading(REBECCA, '2026-10-10'),
  'startReading: already reading': (d) => d.startReading(DRACULA),
  'removeFromCurrentlyReading (back to Read Next)': (d) => d.removeFromCurrentlyReading(d.state.currentlyReading[0]),
  'updateReadingProgress with a page-count override': (d) => d.updateReadingProgress(DRACULA, 120.7, 410),
  'updateReadingProgress without override': (d) => d.updateReadingProgress(DRACULA, 55),
  'updateListeningProgress': (d) => d.updateListeningProgress(DRACULA, 93.4),
  'saveReaderEdition then clear it': async (d) => { await d.saveReaderEdition(DRACULA, { language: 'es', translator: 'X' }); },
  'saveReaderEdition: all empty clears': (d) => d.saveReaderEdition(DRACULA, {}),
  'markAsRead from the wishlist, rated, with a note and a date': (d) => d.markAsRead(REBECCA, { rating: 4, notes: ' Haunting. ', readAt: '2026-10-11' }),
  'markAsRead: not yet catalogued': (d) => d.markAsRead(PIRANESI),
  'markAsRead: already in the library': (d) => d.markAsRead({ ...KINDRED, bookId: 'b-kin-2' }),
  'markAsRead with defer (no share modal)': (d) => d.markAsRead(REBECCA, {}, { defer: true }),
  'finishReading': (d) => d.finishReading(d.state.currentlyReading[0], { rating: 5 }),
  'updateReadBook: new date and rating': (d) => d.updateReadBook(KINDRED, { readAt: '2025-11-15', rating: 3, notes: '  ' }),
  'updateReadBook: nothing to change': (d) => d.updateReadBook(KINDRED, {}),
  'removeFromLibrary': (d) => d.removeFromLibrary(KINDRED),
  'addReadingMemory then deleteReadingMemory': async (d) => { const m = await d.addReadingMemory(DRACULA, '  The count is charming. ', { pagesAt: 60 }); return m; },
  'deleteReadingMemory': (d) => d.deleteReadingMemory(DRACULA, 'nope'),
  'importGoodreads': (d) => d.importGoodreads([KINDRED, book('Beloved', 'Toni Morrison', { rating: 4, dateRead: '2025-02-01' }), book('Possession', 'A. S. Byatt')]),
  'bulkAddToLibrary': (d) => d.bulkAddToLibrary([REBECCA, book('Solaris', 'Stanislaw Lem', { bookId: 'b-sol' })]),
  'bulkAddToWishlist': (d) => d.bulkAddToWishlist([KINDRED, REBECCA, book('Middlemarch', 'George Eliot', { fromGoodreads: true })]),
  'runGoodreadsImport': (d) => d.runGoodreadsImport({ read: [book('Beloved', 'Toni Morrison')], toRead: [book('Solaris', 'Stanislaw Lem')], currentlyReading: [book('Possession', 'A. S. Byatt')] }),
  'addCategoryToBook': (d) => d.addCategoryToBook(REBECCA, '  Haunted houses '),
  'addCategoryToBook: blank': (d) => d.addCategoryToBook(REBECCA, '  '),
  'removeCategoryFromBook': (d) => d.removeCategoryFromBook(REBECCA, 'c1'),
  'searchCategories': (d) => d.searchCategories('hau', 5),
  'getCategoriesForBook': (d) => d.getCategoriesForBook(REBECCA),
  'setBookGenres merges and sorts': (d) => d.setBookGenres([{ bookId: 'b-reb', genres: [{ genreId: 'g2', name: 'Romance', usageCount: 9 }, { genreId: 'g1', name: 'Gothic', usageCount: 3 }] }]),
  'profile setters': async (d) => {
    d.setProfile({ goal: 'explore' }); d.setShelfSortMode('title'); d.setOracleMode('vault');
    d.setDashboardLayout([{ id: 'feed', visible: true }]); d.dismissCoachmark('dash'); d.dismissCoachmark('dash');
    d.setReadingGoalCount(20); d.markReleasesSeen();
  },
  'setOnboarded(false) then true': async (d) => { d.setOnboarded(false); d.setOnboarded(true); },
  'updateUsername / updateDisplayName / updateAvatar / updatePrivacyPrefs': async (d) => [
    await d.updateUsername('  NewName '), await d.updateDisplayName('  '), await d.updateAvatar('/avatars/owl.svg'),
    await d.updatePrivacyPrefs({ isDiscoverable: false }),
  ],
  'setCurrentPlan then deletePlan': async (d) => { const p = await d.setCurrentPlan({ title: 'Climb', type: 'level', steps: [] }); return p; },
  'deletePlan': (d) => d.deletePlan('p-x'),
  'cacheBookFields': (d) => d.cacheBookFields(REBECCA, { coverUrl: 'https://c/reb.jpg' }),
  'upsertDiscoveredBook': async (d) => { await d.upsertDiscoveredBook(PIRANESI); await d.upsertDiscoveredBook(REBECCA); },
  'upsertBookOnServer from an Oracle pick with an unknown author': (d) => d.upsertBookOnServer({ t: 'X', a: 'Unknown author', recommendationId: 'r1', fromOracle: true }),
  'shareAccomplishment / dismissShareMoment': async (d) => { d.shareAccomplishment({ key: 'year:5', kind: 'year_milestone', meta: { count: 5, year: 2026 }, earnedAt: '2026-05-01' }); },
  'resetAll': (d) => d.resetAll(),
};

for (const signedIn of [false, true]) {
  describe(signedIn ? 'signed-in actions' : 'guest actions', () => {
    for (const [name, fn] of Object.entries(ACTIONS)) {
      it(name, async () => {
        await mount({ signedIn });
        if (name === 'removeCategoryFromBook' || name === 'getCategoriesForBook') {
          await run((d) => d.addCategoryToBook(REBECCA, 'Haunted'));
        }
        if (name === 'removeFromReadNext') await run((d) => d.addToReadNext(PIRANESI));
        if (signedIn) {
          db.handler = (c) => {
            if (c.rpc === 'link_user_category') return { data: [{ id: 'c1', name: c.args._raw_name, verified: false, usage_count: 1 }], error: null };
            if (c.rpc === 'search_categories') return { data: [{ id: 'c1', name: 'Haunted', normalized_name: 'haunted', verified: true, usage_count: 4, exact_match: false }], error: null };
            if (c.rpc === 'upsert_book' && c.args._title === 'Piranesi' && name === 'markAsRead: not yet catalogued') return { data: null, error: { message: 'boom' } };
            if (c.table === 'plans' && c.ops.some((o) => o[0] === 'insert')) return { data: { id: 'p-new', created_at: '2026-10-13' }, error: null };
            if (c.table === 'reading_memories' && c.ops.some((o) => o[0] === 'insert')) return { data: { id: 'm-new', created_at: '2026-10-13' }, error: null };
            if (c.table === 'user_book_categories' || c.table === 'book_categories') return { data: [], error: null };
            return undefined;
          };
        }
        const result = await run(fn);
        expect(snapshot(result)).toMatchSnapshot();
        if (name === 'shareAccomplishment / dismissShareMoment') {
          await run((d) => d.dismissShareMoment());
          expect(api.current.shareMoment).toBeNull();
        }
      });
    }
  });
}

it('loadVault: pages through the curated catalogue and caches it', async () => {
  await mount({ signedIn: true });
  let page = 0;
  db.handler = (c) => (c.rpc === 'get_curated_catalog'
    ? { data: page++ === 0 ? [{ id: 'v1', title: 'Solaris', author: 'Stanislaw Lem', vault_source: 'both', curator_rating: 5 }] : [], error: null }
    : undefined);
  const first = await run((d) => d.loadVault());
  const second = await run((d) => d.loadVault());
  expect({ first, secondCalls: db.calls.length, same: first === second || JSON.stringify(first) === JSON.stringify(second) }).toMatchSnapshot();
});
