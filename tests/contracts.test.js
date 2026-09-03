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
