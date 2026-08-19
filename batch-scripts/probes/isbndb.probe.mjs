// isbndb.probe.mjs — what does ISBNdb actually return, and what does it cost?
//
//   ISBNDB_API_KEY=... node batch-scripts/probes/isbndb.probe.mjs 9788419680877
//
// Written for the 7-day trial, and deliberately NOT a backfill. See
// docs/isbndb-evaluation.md: the recommendation is not to subscribe, and if you
// do trial it, the thing to spend the week on is answering two questions the
// documentation does not:
//
//   1. IS `language` IN THE RESPONSE AT ALL?
//      The published client model lists title, title_long, isbn, isbn13,
//      dewey_decimal, binding, publisher, date_published, edition, pages,
//      dimensions, overview, synopsis, excerpt, image, msrp, authors, subjects,
//      reviews, prices, related — and no language. Third-party code reads one,
//      so it is probably undocumented rather than absent. `language` is the only
//      field we would be buying this for, so "probably" is not good enough.
//
//   2. DOES A BULK CALL COST ONE SEARCH OR ONE HUNDRED?
//      Basic allows 5,000 searches/day and 100 results per bulk call. If a call
//      costs 1, the whole 3,428-row catalog is 35 calls. If it costs 100, it is
//      the entire daily allowance. The docs do not say. `/key/details` reports
//      usage, so this probe reads it before and after and prints the delta —
//      which answers the question definitively in one run.
//
// Nothing here writes to the database. It prints.

const KEY = process.env.ISBNDB_API_KEY || '';
if (!KEY) {
  console.error('Set ISBNDB_API_KEY. Get it from the user dash after starting the trial.');
  process.exit(1);
}

const BASE = 'https://api2.isbndb.com';
// The key is sent RAW, not as a Bearer token, and query-parameter keys are
// rejected outright — both stated in the v2 docs and both easy to get wrong.
const HEAD = { Authorization: KEY, Accept: 'application/json' };

const ISBNS = process.argv.slice(2).filter((a) => /^\d{9}[\dXx]$|^\d{13}$/.test(a));
const SAMPLE = ISBNS.length ? ISBNS : [
  '9788419680877',   // Aprendiz de asesino — Spanish, Nocturna Ediciones
  '9780060883287',   // One Hundred Years of Solitude — English
];

async function call(path, init) {
  const resp = await fetch(`${BASE}${path}`, { headers: HEAD, ...init });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* printed raw below */ }
  return { status: resp.status, json, text, headers: resp.headers };
}

async function usage() {
  const r = await call('/key/details');
  // Shape is unverified; print whatever comes back rather than guessing at it.
  return r.json ?? r.text;
}

console.log('── key details BEFORE ─────────────────────────');
const before = await usage();
console.log(JSON.stringify(before, null, 2));

console.log('\n── GET /book/{isbn} ───────────────────────────');
const single = await call(`/book/${SAMPLE[0]}`);
console.log(`HTTP ${single.status}`);
if (single.json?.book) {
  const b = single.json.book;
  console.log('FIELDS PRESENT:', Object.keys(b).sort().join(', '));
  console.log('');
  console.log('  language      :', JSON.stringify(b.language ?? '(ABSENT)'));
  console.log('  title         :', JSON.stringify(b.title));
  console.log('  publisher     :', JSON.stringify(b.publisher));
  console.log('  pages         :', JSON.stringify(b.pages));
  console.log('  binding       :', JSON.stringify(b.binding));
  console.log('  date_published:', JSON.stringify(b.date_published));
  console.log('  subjects      :', JSON.stringify(b.subjects));
  console.log('  synopsis      :', (b.synopsis || '').slice(0, 120) || '(none)');
  console.log('  overview      :', (b.overview || '').slice(0, 120) || '(none)');
} else {
  console.log(single.text.slice(0, 600));
}

console.log('\n── POST /books (bulk) ─────────────────────────');
const bulk = await call('/books', {
  method: 'POST',
  headers: { ...HEAD, 'Content-Type': 'application/json' },
  body: JSON.stringify({ isbns: SAMPLE }),
});
console.log(`HTTP ${bulk.status}`);
if (bulk.json) {
  const list = bulk.json.data || bulk.json.books || [];
  console.log(`returned ${list.length} of ${SAMPLE.length} requested`);
  for (const b of list) {
    console.log(`  ${b.isbn13 || b.isbn}  lang=${b.language ?? '(ABSENT)'}  "${(b.title || '').slice(0, 50)}"`);
  }
  if (!list.length) console.log(bulk.text.slice(0, 600));
} else {
  console.log(bulk.text.slice(0, 600));
}

console.log('\n── rate-limit headers ─────────────────────────');
for (const h of ['ratelimit', 'ratelimit-policy', 'x-ratelimit-remaining', 'retry-after']) {
  const v = bulk.headers.get(h);
  if (v) console.log(`  ${h}: ${v}`);
}

console.log('\n── key details AFTER ──────────────────────────');
const after = await usage();
console.log(JSON.stringify(after, null, 2));

console.log(`
Compare the two key-details blocks. The delta across one GET plus one bulk POST
of ${SAMPLE.length} ISBNs is the answer to question 2:

  +2   → a bulk call costs ONE search. 3,428 rows = ~35 calls. Trivial.
  +${SAMPLE.length + 1}   → it costs one PER ISBN. 3,428 rows = 3,428 searches, most of a day
         on Basic, and the bulk endpoint buys latency only, not quota.

And whether "language" printed a value or (ABSENT) is the answer to question 1.
If it is ABSENT, ISBNdb cannot do the job we were considering it for, and the
evaluation's recommendation stands for a second reason.
`);
