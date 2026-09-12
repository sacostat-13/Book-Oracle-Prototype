// probeHardcoverContributions.mjs — which contribution is the AUTHOR?
//
// WHY THIS EXISTS
//
// src/lib/hardcoverService.js line 59 takes the first contribution and calls it
// the author:
//
//   const author = (node.contributions || [])
//     .map((c) => c?.author?.name)
//     .filter(Boolean)[0] || null;
//
// Hardcover's contributions are not author-first. The 2026-09-10 Dresden Files
// query found two duplicate rows this created, both in the fortnight before:
//
//   ec760b50  "Death Masks"  by James Marsters   created 2026-09-02
//   0dd12f7a  "White Night"  by Chris McGrath    created 2026-08-28
//
// Marsters narrates the Dresden audiobooks. McGrath paints the covers. Both
// landed on positions the real volume already held, hidden by series_volumes
// picking one row per position. The same bug threw the English "House of Sky
// and Breath" out of a Crescent City proposal on 2026-09-09, credited to its
// narrator Elizabeth Evans — that one was fixed in seriesBackfill by reading
// EVERY contribution, and the app path never got the fix.
//
// seriesBackfill can read every contribution because it compares them against a
// known author. hardcoverService has to pick ONE, for a books.author column, so
// it needs to know which contribution is the author — and that means a field
// this codebase has never queried.
//
// AND AN UNPROVEN FIELD NAME IS NOT A SMALL RISK. Hasura rejects the whole
// query, so a wrong guess costs every book lookup in the app rather than one
// column. That is exactly why LANGUAGE_RUNGS exists in seriesBackfill.mjs. So:
// probe first, then fix with a proven name and no ladder.
//
//   node batch-scripts/probes/probeHardcoverContributions.mjs
//
// Read-only. Touches no database row. Prints what it finds and nothing else.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

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

// The free tier answered 429 after about eight quick requests during the
// 2026-09-09 language probe, which left six of its ten cases untested. This one
// makes five requests and waits between them.
async function gql(query, label) {
  await sleep(3500);
  const resp = await fetch('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: {
      Authorization: TOKEN.startsWith('Bearer ') ? TOKEN : `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'BooksOracle-probeContributions/1.0',
    },
    body: JSON.stringify({ query }),
  });
  if (resp.status === 429) return { rateLimited: true };
  if (!resp.ok) return { httpError: `${resp.status}: ${(await resp.text()).slice(0, 200)}` };
  const json = await resp.json();
  if (json.errors?.length) return { graphqlError: json.errors.map((e) => e.message).join(' | ') };
  return { data: json.data };
}

console.log('\n  PHASE 1 — what fields does a contribution actually have?\n');

const introspect = await gql(`{
  __type(name: "contributions") {
    name
    fields { name type { name kind ofType { name kind } } }
  }
}`);

let fieldNames = [];
if (introspect.data?.__type?.fields) {
  fieldNames = introspect.data.__type.fields.map((f) => f.name);
  for (const f of introspect.data.__type.fields) {
    const t = f.type?.name || f.type?.ofType?.name || f.type?.kind;
    console.log(`    ${f.name.padEnd(24)} ${t}`);
  }
} else {
  console.log('    introspection unavailable:', JSON.stringify(introspect).slice(0, 220));
  console.log('    (Hardcover may disable __type. Phase 2 tests the candidates empirically.)');
}

// The plausible names for "what role did this person play". Tried one at a
// time so a rejection costs one field, not the probe.
const ROLE_CANDIDATES = ['contribution', 'contribution_type', 'role', 'contributable_type'];

console.log('\n  PHASE 2 — which role field can be selected?\n');

const usable = [];
for (const field of ROLE_CANDIDATES) {
  if (fieldNames.length && !fieldNames.includes(field)) {
    console.log(`    ${field.padEnd(22)} not in the introspected field list — skipped`);
    continue;
  }
  const r = await gql(`{
    books(where: { id: { _eq: 446322 } }, limit: 1) {
      title
      contributions { ${field} author { name } }
    }
  }`);
  if (r.rateLimited) { console.log(`    ${field.padEnd(22)} RATE LIMITED — rerun in a minute`); break; }
  if (r.graphqlError) { console.log(`    ${field.padEnd(22)} rejected: ${r.graphqlError.slice(0, 90)}`); continue; }
  if (r.httpError) { console.log(`    ${field.padEnd(22)} http ${r.httpError.slice(0, 60)}`); continue; }
  const book = r.data?.books?.[0];
  console.log(`    ${field.padEnd(22)} WORKS — "${book?.title}"`);
  for (const c of book?.contributions || []) {
    console.log(`        ${String(c[field] ?? '(null)').padEnd(18)} ${c.author?.name}`);
  }
  usable.push(field);
}

// The books that produced the actual bad rows. If the role field is real, the
// narrator and the cover artist should be distinguishable from Jim Butcher
// here — and if they are not, the fix is not available and the honest answer is
// to leave hardcoverService alone.
console.log('\n  PHASE 3 — the three books this bug got wrong\n');

if (!usable.length) {
  console.log('    no usable role field, so nothing to test. hardcoverService cannot');
  console.log('    tell an author from a narrator with the schema available, and the');
  console.log('    contributions[0] line should NOT be changed on a guess.\n');
} else {
  const field = usable[0];
  const CASES = [
    ['Death Masks', 'credited to James Marsters (narrator) in our catalog'],
    ['White Night', 'credited to Chris McGrath (cover artist) in our catalog'],
    ['House of Sky and Breath', 'credited to Elizabeth Evans (narrator) on 2026-09-09'],
  ];
  for (const [title, why] of CASES) {
    const r = await gql(`{
      books(where: { title: { _eq: ${JSON.stringify(title)} } }, limit: 2) {
        id title
        contributions { ${field} author { name } }
      }
    }`);
    console.log(`    ${title}  — ${why}`);
    if (r.rateLimited) { console.log('        RATE LIMITED — rerun in a minute'); break; }
    if (r.graphqlError) { console.log('        ' + r.graphqlError.slice(0, 120)); continue; }
    for (const b of r.data?.books || []) {
      console.log(`        book ${b.id}`);
      for (const c of b.contributions || []) {
        const role = c[field] ?? '(null)';
        const flag = (c[field] == null || /author|writer/i.test(String(c[field]))) ? '  <-- author?' : '';
        console.log(`          ${String(role).padEnd(18)} ${c.author?.name}${flag}`);
      }
    }
    console.log('');
  }
  console.log(`  If the author consistently carries a null (or "Author") role while the`);
  console.log(`  narrator and artist carry something else, then hardcoverService can select`);
  console.log(`  \`contributions { ${field} author { name } }\` and prefer that entry.`);
  console.log(`  If the roles are null for EVERYONE, the field is useless and the current`);
  console.log(`  behaviour should stay — a guess here breaks every lookup in the app.\n`);
}
