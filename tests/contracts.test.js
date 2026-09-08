// contracts.test.js — the lists that live in two places and cannot see each other.
//
// WHY THESE AND NOT COMPONENT TESTS
//
// Six bugs have cost real time on this project. Only two of them were rendering
// faults. The rest were CONTRACT DRIFT: a value written down in two files, one
// of which was updated. No amount of React testing catches that, because each
// file is individually correct — it is their disagreement that is the bug, and
// nothing in the language or the build looks at two files at once.
//
// So these tests read the source of both sides and compare. They are ugly (a
// test that greps SQL is not elegant) and they are the cheapest possible
// insurance: they need no database, no browser, no fixtures, and they cannot go
// stale, because they derive both sides from the files that ship.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('accomplishment kinds: app vs database', () => {
  // THE BUG THIS EXISTS FOR: `female_authors_count` was added to EARNABLE_TYPES
  // in v0.55 and never added to the CHECK constraint. Every women-authors
  // milestone since then was rejected by Postgres, logged, and swallowed — the
  // share card rendered from the in-memory moment, so the reader saw the
  // celebration and the row was never written. It went unnoticed for twelve
  // versions and was only found because v0.67's family kinds hit the same wall.
  //
  // The migration that fixed it ends with: "this list exists in TWO places that
  // cannot see each other." This test is the place they see each other.
  const appKinds = () => {
    const src = read('src/lib/accomplishments.js');
    const grab = (name) => {
      const m = src.match(new RegExp(`export const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
      if (!m) throw new Error(`${name} not found in accomplishments.js — did it get renamed?`);
      return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    };
    return { earnable: grab('EARNABLE_TYPES'), legacy: grab('LEGACY_TYPES') };
  };

  // The constraint's current state is whichever migration last rewrote it —
  // reading only the newest file that mentions it is what makes this survive
  // future migrations without being edited.
  const dbKinds = () => {
    const dir = 'supabase/migrations';
    const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.sql')).sort();
    let latest = null;
    for (const f of files) {
      const sql = read(join(dir, f));
      if (/add constraint reading_accomplishments_kind_check/i.test(sql)) latest = sql;
    }
    if (!latest) throw new Error('no migration defines reading_accomplishments_kind_check');
    const m = latest.match(/kind = any \(array\[([\s\S]*?)\]\)/i);
    if (!m) throw new Error('could not parse the kind list out of the constraint');
    // Strip SQL comments first: '-- current' would otherwise contribute nothing,
    // but a commented-out kind would be counted as allowed when it is not.
    const body = m[1].replace(/--[^\n]*/g, '');
    return [...body.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };

  it('every kind the app can earn is permitted by the constraint', () => {
    const { earnable } = appKinds();
    const allowed = new Set(dbKinds());
    const rejected = earnable.filter((k) => !allowed.has(k));
    expect(rejected, `these kinds would 400 on insert: ${rejected.join(', ')}`).toEqual([]);
  });

  it('every legacy kind is still permitted, so old rows can be read back', () => {
    // Legacy kinds are no longer awarded but are still rendered and shared.
    // Dropping one from the constraint would not break a write (nothing writes
    // them) — it would strand rows readers already earned.
    const { legacy } = appKinds();
    const allowed = new Set(dbKinds());
    expect(legacy.filter((k) => !allowed.has(k))).toEqual([]);
  });
});

describe('the genre index floor', () => {
  // THE BUG THIS EXISTS FOR: the floor decides two things that must agree —
  // whether a genre page says noindex, and whether the sitemap submits it. A
  // URL in the sitemap that answers with noindex is a contradiction Search
  // Console reports as an error. The number lives in three files; until v0.68
  // one of them was a bare literal.
  const floors = () => ({
    client: read('src/lib/genreService.js').match(/export const INDEX_FLOOR = (\d+)/)?.[1],
    sitemap: read('netlify/functions/sitemap.js').match(/const INDEX_FLOOR = (\d+)/)?.[1],
    prerender: read('netlify/edge-functions/og-prerender.js').match(/const INDEX_FLOOR = (\d+)/)?.[1],
  });

  it('is written down as a named constant in all three places', () => {
    const f = floors();
    for (const [where, value] of Object.entries(f)) {
      expect(value, `INDEX_FLOOR is not a named constant in ${where}`).toBeDefined();
    }
  });

  it('has the same value in all three', () => {
    const f = floors();
    expect(new Set(Object.values(f)).size, `disagreement: ${JSON.stringify(f)}`).toBe(1);
  });

  it('is actually used, not just declared', () => {
    // A constant nobody reads is the same bug wearing a better name.
    expect(read('netlify/edge-functions/og-prerender.js')).toMatch(/< INDEX_FLOOR/);
    expect(read('netlify/functions/sitemap.js')).toMatch(/gte\.\$\{INDEX_FLOOR\}/);
    expect(read('src/views/GenrePage.jsx')).toMatch(/< INDEX_FLOOR/);
  });
});

describe('page titles: client hook vs prerendered head', () => {
  // THE BUG THIS EXISTS FOR: the prerender emitted the title written to catch
  // "what to read in horror"; useDocumentMeta then overwrote it with a shorter
  // one when React mounted. Google fetches the prerendered head AND runs the JS,
  // so the indexed title was not the one anyone had chosen. Invisible in a
  // build, invisible in a browser, and only findable by reading both files.
  //
  // Compared as TEMPLATES, not rendered strings — the interpolations differ by
  // variable name (fam vs family) and that is not drift.
  const norm = (s) => s.replace(/\$\{[^}]+\}/g, '${}').trim();
  const prerender = read('netlify/edge-functions/og-prerender.js');

  it('the family page agrees', () => {
    const client = read('src/views/FamilyPage.jsx').match(/title: `([^`]+)`/)[1];
    const server = prerender.match(/title: `(\$\{fam\.name\}[^`]+)`/)[1];
    expect(norm(server)).toBe(norm(client));
  });

  it('the genre page agrees', () => {
    const client = read('src/views/GenrePage.jsx').match(/title: `([^`]+books[^`]*)`/)[1];
    const server = prerender.match(/title: `(\$\{genre\.name\} books[^`]+)`/)[1];
    expect(norm(server)).toBe(norm(client));
  });

  it('the family and genre titles stay distinct', () => {
    // Six families share a name with a genre on them (horror, fantasy, science
    // fiction, gothic, romance, adventure), so /genres/horror and /genre/horror
    // are one character apart. Identical titles would put them in competition
    // for the same query, and Google would pick one — usually the weaker.
    const fam = prerender.match(/title: `\$\{fam\.name\}([^`]+)`/)[1];
    const gen = prerender.match(/title: `\$\{genre\.name\}([^`]+)`/)[1];
    expect(fam).not.toBe(gen);
  });
});

describe('series volume lists: three callers, one source', () => {
  // THE BUG THIS EXISTS FOR: on 2026-09-08 the six highest-impression series
  // pages were sampled live. Five were wrong. Crescent City — the single
  // highest-impression URL on the site, ranking for "how many books in crescent
  // city series" — said 3 and listed House of Sky and Breath twice under
  // "BOOK 2", with neither other volume. Wicked rendered positions
  // 1,1,1,1,2,3,3,4,4,5. Duplicate editions sharing a position_in_series,
  // nowhere collapsed.
  //
  // Three files list the volumes of a series and all three must return the same
  // rows: the human page (seriesService), the crawler's series page, and the
  // "in reading order" block on a book page. The dedupe therefore lives in SQL,
  // in the series_volumes view, and this test is what stops a fourth caller —
  // or a revert of one of these three — from quietly going back to raw `books`.
  //
  // Same shape as the accomplishment-kinds drift above, and the fourth time
  // this codebase has paid for one rule written in several places (bookKey in
  // three copies until v0.63.3; the status filter reconciled by hand on
  // 2026-08-24; the index floor in three files as of v0.68).
  const VIEW = 'series_volumes';

  it('the migration defines the view and grants it to anon', () => {
    const files = readdirSync(join(root, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql') && f.includes(VIEW));
    expect(files.length, `no migration defines ${VIEW}`).toBeGreaterThan(0);
    const sql = read(`supabase/migrations/${files.sort().at(-1)}`);
    expect(sql).toMatch(new RegExp(`create or replace view public\\.${VIEW}`, 'i'));
    // The dedupe itself: one row per series per volume key.
    expect(sql).toMatch(/row_number\(\)\s*over\s*\(\s*partition by r\.series_id, r\.volume_key/i);
    expect(sql).toMatch(/edition_rank = 1/i);
    expect(sql).toMatch(new RegExp(`grant select on public\\.${VIEW} to anon`, 'i'));
  });

  it('seriesService reads the view, not the books table', () => {
    const src = read('src/lib/seriesService.js');
    const fn = src.slice(src.indexOf('export async function fetchBooksInSeriesByName'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain(`.from('${VIEW}')`);
    expect(body, 'fetchBooksInSeriesByName went back to raw books').not.toContain(".from('books')");
  });

  it('every series-scoped query in og-prerender targets the view', () => {
    const src = read('netlify/edge-functions/og-prerender.js');
    // A query filtering on series_id is by definition listing the volumes of a
    // series. The same-genre neighbour query is deliberately NOT caught here:
    // it filters on `genre`, lists unrelated books, and correctly stays on
    // books_share_key.
    //
    // The series-page query is assembled from several concatenated template
    // literals, so the table name and the filter are not in the same string.
    // Match the endpoint, then look ahead over the next few lines for the
    // filter — which is what "this query is scoped to one series" means here.
    const seriesQueries = [...src.matchAll(/\/rest\/v1\/([a-z_]+)\?/g)]
      .filter((m) => /series_id=eq\./.test(src.slice(m.index, m.index + 400)))
      .map((m) => m[1]);
    expect(seriesQueries.length, 'no series-scoped queries found — did the URLs change shape?')
      .toBeGreaterThanOrEqual(2);
    for (const table of seriesQueries) {
      expect(table, `a series volume list still reads ${table}`).toBe(VIEW);
    }
  });
});

describe('the series index floor: three files, one number', () => {
  // THE BUG THIS EXISTS FOR: not one yet, and that is the point. The genre
  // floor already lives in three places -- genreService.js, og-prerender.js and
  // sitemap.js -- and og-prerender.js carries a comment saying so, ending "All
  // three must agree: a URL in the sitemap that answers with noindex is a
  // contradiction Search Console reports as an error." It was a bare `5` in one
  // of them until v0.68.
  //
  // The series floor added on 2026-09-08 has exactly the same shape, so it gets
  // the check the genre floor never had. Both are asserted here: a drift in
  // either is the same error.
  const floors = (label, sources) => {
    const found = sources.map(([file, re]) => {
      const m = read(file).match(re);
      if (!m) throw new Error(`${label}: no floor found in ${file} — was it renamed?`);
      return { file, value: Number(m[1]) };
    });
    const distinct = [...new Set(found.map((f) => f.value))];
    expect(distinct.length,
      `${label} disagrees across files: ${found.map((f) => `${f.file}=${f.value}`).join(', ')}`
    ).toBe(1);
    return distinct[0];
  };

  it('the series floor is the same number in all three files', () => {
    const v = floors('SERIES_INDEX_FLOOR', [
      ['src/lib/seriesService.js', /export const SERIES_INDEX_FLOOR = (\d+)/],
      ['netlify/edge-functions/og-prerender.js', /const SERIES_INDEX_FLOOR = (\d+)/],
      ['netlify/functions/sitemap.js', /const SERIES_INDEX_FLOOR = (\d+)/],
    ]);
    // A floor of 1 would be a no-op and a floor of 0 a mistake; both would pass
    // the agreement check above while meaning "there is no floor".
    expect(v).toBeGreaterThanOrEqual(2);
  });

  it('the genre floor is the same number in all three files', () => {
    floors('INDEX_FLOOR', [
      ['src/lib/genreService.js', /export const INDEX_FLOOR = (\d+)/],
      ['netlify/edge-functions/og-prerender.js', /const INDEX_FLOOR = (\d+)/],
      ['netlify/functions/sitemap.js', /const INDEX_FLOOR = (\d+)/],
    ]);
  });

  it('a series below the floor is noindexed AND withheld from the sitemap', () => {
    // The two halves of the contradiction the comments warn about: submitting a
    // URL that answers noindex. Neither half is useful without the other.
    expect(read('netlify/edge-functions/og-prerender.js'))
      .toMatch(/noindex:\s*held\s*<\s*SERIES_INDEX_FLOOR/);
    expect(read('netlify/functions/sitemap.js'))
      .toMatch(/vols\.size\s*>=\s*SERIES_INDEX_FLOOR/);
    expect(read('src/views/SeriesPage.jsx'))
      .toMatch(/noindex:\s*catalogCount != null && catalogCount < SERIES_INDEX_FLOOR/);
  });
});
