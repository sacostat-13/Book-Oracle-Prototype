// probeHardcoverLanguage.mjs — does Hardcover tell us what language a book is in?
//
// WHY THIS EXISTS
// ---------------
// seriesBackfill.mjs has now been wrong twice about the same thing. Hardcover's
// `book_series` returns translations, omnibuses and box sets alongside the
// actual volumes, and for Crescent City — a three book series — it returns
// twenty. The bundles are filterable by title. The translations are not:
//
//   Dom Ziemi i Krwi          by Sarah J. Maas   (Polish)
//   Huis van vuur & schaduw   by Sarah J. Maas   (Dutch)
//
// Same author, same position, plausible page count, no keyword to catch. The
// backfill currently separates them with an inference — a collection edition
// quotes its volumes in the original language, so a title appearing inside this
// series' own bundle titles is probably the original. That works on Crescent
// City and it is still an inference. A language field would end the argument.
//
// The reason it was never used is that the field name is unknown, and a wrong
// name does not degrade — Hasura rejects the entire query, so a guess costs the
// whole series list, not one column. That is precisely the failure this
// codebase keeps paying for (see tests/failure-is-not-empty.test.js), so:
// find out first, in a probe that writes nothing, then change the backfill on
// the strength of what it reports.
//
// This is a probe. It reads Hardcover and prints. No database client is even
// constructed — it needs HARDCOVER_API_TOKEN and nothing else.
//
//   node batch-scripts/probes/probeHardcoverLanguage.mjs
//   node batch-scripts/probes/probeHardcoverLanguage.mjs --series "Red Rising Saga" --verbose
//
// TWO PHASES
//
//   1. Introspection. Ask the schema what fields exist on `books` and
//      `editions` and print anything that looks like a language, an edition
//      link or a default/primary pointer. Definitive when it is allowed —
//      Hasura can disable introspection per role, and if it is off here the
//      probe says so rather than concluding the fields do not exist.
//   2. Empirical. Whether or not introspection worked, try each candidate
//      selection in a REAL series query and report which parse and what they
//      return. This is the phase that matters: a field that introspects but
//      returns null for every book is no more useful than a missing one, and
//      only real data shows that.
//
// The output ends with either the exact GraphQL selection to paste into
// hcSeriesCandidates() in seriesBackfill.mjs, or a plain statement that no
// usable field was found and the bundle heuristic stays.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const seriesArg = args.indexOf('--series');
const SERIES = seriesArg !== -1 ? args[seriesArg + 1] : 'Crescent City';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);
const TOKEN = env['HARDCOVER_API_TOKEN'] || '';
if (!TOKEN) { console.error('Missing HARDCOVER_API_TOKEN in .env.local'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns { ok, data, error }. Never throws for a GraphQL-level error, because
// here an error IS the result: the whole point is finding out which selections
// the server rejects and why.
async function gql(query, variables = {}) {
  await sleep(250); // polite; this probe makes a dozen requests at most
  let resp;
  try {
    resp = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        Authorization: TOKEN.startsWith('Bearer ') ? TOKEN : `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BooksOracle-probeLanguage/1.0',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    return { ok: false, error: `unreachable: ${e.message}` };
  }
  if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
  const json = await resp.json();
  if (json.errors?.length) return { ok: false, error: json.errors[0]?.message || 'graphql error' };
  return { ok: true, data: json.data };
}

// -- Phase 1: introspection ---------------------------------------------------
const INTERESTING = /lang|locale|edition|country|region|original|default|primary|translat/i;

function typeName(t) {
  // Unwrap NON_NULL / LIST wrappers to whatever is underneath.
  let cur = t, guard = 0;
  while (cur && !cur.name && cur.ofType && guard++ < 6) cur = cur.ofType;
  return cur?.name || cur?.kind || '?';
}

async function introspect(name) {
  const res = await gql(
    `query T($name: String!) {
       __type(name: $name) {
         name
         fields { name type { name kind ofType { name kind ofType { name kind } } } }
       }
     }`,
    { name }
  );
  if (!res.ok) return { name, available: false, reason: res.error };
  const t = res.data?.__type;
  if (!t) return { name, available: false, reason: 'no such type' };
  return { name, available: true, fields: (t.fields || []).map((f) => ({ name: f.name, type: typeName(f.type) })) };
}

// -- Phase 2: empirical -------------------------------------------------------
//
// Each candidate is a selection inserted into the `book { ... }` of a real
// series query. `control` is known-good from src/lib/hardcoverService.js, so if
// IT fails the problem is the query shape or the token, not the field — without
// it a total failure would read as "no language field anywhere".
const CANDIDATES = [
  ['control (known good)', 'contributions { author { name } }'],
  ['book.language.code3', 'language { code3 }'],
  ['book.language.language', 'language { language }'],
  ['book.lang', 'lang'],
  ['book.language_id', 'language_id'],
  ['book.default_edition.language', 'default_edition { language { code3 } }'],
  ['book.default_physical_edition.language', 'default_physical_edition { language { code3 } }'],
  ['book.editions[].language', 'editions(limit: 2) { id language { code3 } }'],
  ['book.editions[].language_id', 'editions(limit: 2) { id language_id }'],
  ['book.country / region', 'country { name }'],
];

function seriesQuery(selection) {
  return `query P($id: Int!) {
    series(where: { id: { _eq: $id } }, limit: 1) {
      name
      book_series(order_by: { position: asc }, limit: 25) {
        position
        book { id title ${selection} }
      }
    }
  }`;
}

async function resolveSeriesId(name) {
  const res = await gql(
    `query S($q: String!, $type: String!) { search(query: $q, query_type: $type, per_page: 5, page: 1) { results } }`,
    { q: name, type: 'Series' }
  );
  if (!res.ok) return { error: res.error };
  const hits = res.data?.search?.results?.hits || res.data?.search?.results?.results || [];
  const norm = (s) => (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  let best = null, score = -1;
  for (const h of hits) {
    const doc = h.document || h;
    const got = norm(doc?.name);
    const sc = got === want ? 2 : (got && (got.includes(want) || want.includes(got))) ? 1 : 0;
    if (sc > score) { score = sc; best = doc; }
  }
  if (!best?.id) return { error: `no series matched "${name}"` };
  return { id: typeof best.id === 'string' ? parseInt(best.id, 10) : best.id, name: best.name };
}

// Pull whatever the selection produced out of a book node, without knowing its
// shape in advance. Anything that looks like a language code is what we want.
function extractLanguageish(book) {
  const out = [];
  const walk = (node, path, depth) => {
    if (node == null || depth > 3) return;
    if (Array.isArray(node)) { node.slice(0, 2).forEach((n, i) => walk(n, `${path}[${i}]`, depth + 1)); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'id' || k === 'title') continue;
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
      return;
    }
    out.push(`${path}=${node}`);
  };
  for (const [k, v] of Object.entries(book)) {
    if (k === 'id' || k === 'title' || k === 'contributions') continue;
    walk(v, k, 0);
  }
  return out.join(' ');
}

// -- Go -----------------------------------------------------------------------
(async () => {
  console.log(`\n  Hardcover language probe — series "${SERIES}"\n`);

  console.log('  PHASE 1 — schema introspection\n');
  let introspectionWorked = false;
  for (const t of ['books', 'editions', 'book_series', 'series']) {
    const r = await introspect(t);
    if (!r.available) { console.log(`    ${t.padEnd(12)} unavailable — ${r.reason}`); continue; }
    introspectionWorked = true;
    const hits = r.fields.filter((f) => INTERESTING.test(f.name) || INTERESTING.test(f.type));
    console.log(`    ${t.padEnd(12)} ${r.fields.length} fields, ${hits.length} of interest`);
    for (const f of hits) console.log(`      · ${f.name} : ${f.type}`);
    if (VERBOSE) console.log(`      all: ${r.fields.map((f) => f.name).join(', ')}\n`);
  }
  if (!introspectionWorked) {
    console.log('\n    Introspection is off for this token. That is a permission, not an answer —');
    console.log('    phase 2 tests the same fields against real data and is the one that decides.');
  }

  console.log('\n  PHASE 2 — does it work, and does it return anything\n');
  const s = await resolveSeriesId(SERIES);
  if (s.error) { console.error(`    cannot resolve the series: ${s.error}\n`); process.exit(1); }
  console.log(`    resolved to "${s.name}" (id ${s.id})\n`);

  const working = [];
  for (const [label, selection] of CANDIDATES) {
    const res = await gql(seriesQuery(selection), { id: s.id });
    if (!res.ok) {
      console.log(`    ✗ ${label.padEnd(42)} ${res.error.slice(0, 90)}`);
      continue;
    }
    const rows = res.data?.series?.[0]?.book_series || [];
    const values = rows
      .map((bs) => extractLanguageish(bs.book || {}))
      .filter((v) => v && v.length);
    const distinct = new Set(values.map((v) => v.replace(/^[^=]*=/, '')));
    console.log(`    ✓ ${label.padEnd(42)} ${values.length}/${rows.length} books answered, ${distinct.size} distinct value(s)`);
    if (label.startsWith('control')) continue;
    if (values.length) working.push({ label, selection, answered: values.length, of: rows.length, distinct: distinct.size, rows });
  }

  console.log('\n  WHAT THIS MEANS\n');
  if (!working.length) {
    console.log('    No usable language field. Every candidate either failed to parse or');
    console.log('    returned nothing for every book in the series.');
    console.log('    Leave seriesBackfill.mjs as it is: the bundle-quotation heuristic in');
    console.log('    _shared/seriesCandidates.mjs stays the way translations are separated,');
    console.log('    and its limits are documented there.\n');
    return;
  }

  // Most useful = answers for the most books with more than one distinct value.
  // A field that answers for all of them with ONE value tells us nothing: it
  // cannot separate a translation from an original.
  working.sort((a, b) => (b.distinct - a.distinct) || (b.answered - a.answered));
  const best = working[0];

  if (best.distinct < 2) {
    console.log(`    ${working.length} field(s) parse, but the best of them returns a single`);
    console.log('    distinct value across the whole series — it cannot separate a');
    console.log('    translation from an original. Keep the bundle heuristic.\n');
  } else {
    console.log(`    Use: ${best.selection}`);
    console.log(`    It answered for ${best.answered} of ${best.of} books with ${best.distinct} distinct values.\n`);
    console.log('    Per book, so you can see whether the split is the real one:\n');
    for (const bs of best.rows.slice(0, 25)) {
      const b = bs.book || {};
      const v = extractLanguageish(b) || '(none)';
      console.log(`      ${String(bs.position).padStart(5)}  ${(b.title || '').slice(0, 46).padEnd(46)} ${v}`);
    }
    console.log('\n    If the values line up with the languages, add that selection to');
    console.log('    hcSeriesCandidates() in batch-scripts/manual/seriesBackfill.mjs, pass it');
    console.log('    through to candidatesByPosition(), and prefer the original language');
    console.log('    there. Keep the bundle heuristic as the fallback for books the field');
    console.log('    does not answer for — it is the only thing that works when a series has');
    console.log('    no language data at all.\n');
  }
})().catch((e) => { console.error(`\n  FAILED: ${e.message}\n`); process.exit(1); });
