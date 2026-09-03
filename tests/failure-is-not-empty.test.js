// failure-is-not-empty.test.js
//
// ONE BUG, SIX TIMES. This project's most expensive recurring defect is not a
// crash: it is a rejected request rendering as an ordinary empty result.
//
//   gql()                     returned {} on a GraphQL error
//   getJson()                 returned null on a non-200
//   the series volume query   returned [] on a 400
//   three og-prerender fetches swallowed their status
//   earnAccomplishments()     returned undefined on success AND on failure, so
//                             the backfill stamped "done" over a rejected write
//   book_genres_view          400'd on a column that does not exist, and every
//                             prerendered genre page shipped bookless for two
//                             weeks
//
// Every one of them looked like "there is nothing here" to the caller, and "no
// books in this genre" is a perfectly plausible answer, so nobody looked.
//
// These tests do not check that a read works. They check that a read can TELL
// YOU IT DIDN'T. Each function is called twice against a fake Supabase — once
// where the query errors, once where it legitimately returns nothing — and the
// two must be distinguishable, either by return value or by a warning on the
// console. A function that answers identically in both cases is the bug.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the mock factory below can see it; vi.mock is lifted above imports.
const state = vi.hoisted(() => ({ mode: 'empty' }));

// A minimal Supabase query-builder double. Every method returns `this` so any
// chain works, and awaiting it resolves to the shape postgrest-js gives:
// { data, error }. `mode` decides which.
vi.mock('../src/lib/supabase.js', () => {
  const result = () =>
    state.mode === 'error'
      ? { data: null, error: { message: 'column x does not exist', code: '42703' } }
      : { data: [], error: null };

  const builder = () => {
    const b = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'range', 'limit', 'gte']) {
      b[m] = () => b;
    }
    b.maybeSingle = () => Promise.resolve(state.mode === 'error'
      ? { data: null, error: { message: 'boom' } }
      : { data: null, error: null });
    b.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return { supabase: { from: () => builder() } };
});

const svc = await import('../src/lib/genreService.js');

let warn;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

/**
 * Runs `fn` in both worlds and asserts the caller could tell them apart.
 *
 * A warning counts as distinguishable: this codebase's convention is to degrade
 * rather than throw (a broken shelf must not take down the page), so "return
 * empty AND say so loudly" is the accepted contract. What is not acceptable is
 * silence in both worlds.
 */
async function mustDistinguish(name, fn) {
  state.mode = 'error';
  const onError = await fn();
  const warnedOnError = warn.mock.calls.length;
  warn.mockClear();

  state.mode = 'empty';
  const onEmpty = await fn();
  const warnedOnEmpty = warn.mock.calls.length;

  const sameValue = JSON.stringify(onError ?? null) === JSON.stringify(onEmpty ?? null);
  const distinguishable = !sameValue || (warnedOnError > 0 && warnedOnEmpty === 0);
  expect(
    distinguishable,
    `${name}: a failed query and an empty result are indistinguishable to the caller ` +
    `(same value: ${sameValue}, warned on error: ${warnedOnError > 0}, ` +
    `warned on empty: ${warnedOnEmpty > 0}). This is the shape that has cost ` +
    `this project six bugs — see the header of this file.`
  ).toBe(true);
}

describe('genreService reads report failure', () => {
  it('fetchFamilies', () => mustDistinguish('fetchFamilies', () => svc.fetchFamilies()));
  it('fetchFamily', () => mustDistinguish('fetchFamily', () => svc.fetchFamily('horror')));
  it('fetchGenre', () => mustDistinguish('fetchGenre', () => svc.fetchGenre('folkhorror')));
  it('fetchGenreShelf', () => mustDistinguish('fetchGenreShelf', () => svc.fetchGenreShelf('g1', 'seed')));
  it('fetchFamilyShelf', () => mustDistinguish('fetchFamilyShelf', () => svc.fetchFamilyShelf(['g1'], 'horror')));
  it('fetchBooksByIds', () => mustDistinguish('fetchBooksByIds', () => svc.fetchBooksByIds(['b1'])));
});
