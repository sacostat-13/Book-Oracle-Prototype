// amazonByIsbn.probe.mjs — is there a free, deterministic cover source we are not using?
//
// The claudeCover probe showed Claude "finding" covers by CONSTRUCTING the URL
//   https://images-na.ssl-images-amazon.com/images/P/{isbn10}.01.LZZZZZZZ.jpg
// from the ISBN. That construction needs no model — and books.isbn is at zero nulls.
// This measures how often it actually resolves, and where the placeholder floor is.
//
// IT PROVES ONLY THAT AN IMAGE EXISTS AT THAT PATH. Amazon returns a valid image for
// any ISBN-10 in its catalog, so a 200 here is NOT evidence the cover is the right
// book — it is only as trustworthy as books.isbn already is.
//
// Usage:
//   node batch-scripts/probes/amazonByIsbn.probe.mjs --db --limit 40
//   node batch-scripts/probes/amazonByIsbn.probe.mjs 9781454965121 9781632150066
//   node batch-scripts/probes/amazonByIsbn.probe.mjs --db --limit 40 --csv out.csv
//
// Writes nothing to the database.

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const USE_DB = args.includes('--db');
function numArg(flag, dflt) {
  const a = args.find((x) => x.startsWith(flag));
  if (!a) return dflt;
  return parseInt(a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1], 10);
}
const LIMIT = numArg('--limit', 40);
const csvArg = args.find((a) => a.startsWith('--csv'));
const CSV = csvArg ? (csvArg.includes('=') ? csvArg.split('=')[1] : args[args.indexOf(csvArg) + 1]) : null;

// -- ISBN-13 -> ISBN-10 -------------------------------------------------------
// Only defined for 978-prefixed ISBN-13s. A 979 ISBN has no ISBN-10 at all, which
// is itself a finding: those rows can never use this source.
function isbn13to10(isbn13) {
  const d = String(isbn13).replace(/[^0-9Xx]/g, '');
  if (d.length === 10) return d.toUpperCase();
  if (d.length !== 13 || d.slice(0, 3) !== '978') return null;
  const core = d.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

const PATTERNS = [
  ['P-LZZ', (i10) => `https://images-na.ssl-images-amazon.com/images/P/${i10}.01.LZZZZZZZ.jpg`],
  ['P-MZZ', (i10) => `https://images-na.ssl-images-amazon.com/images/P/${i10}.01._SCLZZZZZZZ_.jpg`],
];

async function probeUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const len = Number(res.headers.get('content-length') || 0);
    return { status: res.status, ct, len, ok: res.ok && ct.indexOf('image/') === 0 };
  } catch (e) {
    return { status: 0, ct: 'THREW ' + e.message.slice(0, 30), len: 0, ok: false };
  }
}

// -- Input --------------------------------------------------------------------
let rows = [];
if (USE_DB) {
  const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
  const env = Object.fromEntries(
    envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
  );
  const supabase = createServiceClient(env['VITE_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);
  const { data, error } = await supabase
    .from('books').select('id, title, author, isbn')
    .is('cover_url', null).not('isbn', 'is', null)
    .order('created_at', { ascending: true }).limit(LIMIT);
  if (error) { console.error('Fetch failed: ' + error.message); process.exit(1); }
  rows = data;
} else {
  const isbns = args.filter((a) => /^[0-9Xx-]{10,17}$/.test(a));
  if (!isbns.length) { console.error('Pass --db or one or more ISBNs.'); process.exit(1); }
  rows = isbns.map((isbn) => ({ title: isbn, author: '', isbn }));
}

console.log(`\nAmazon-by-ISBN probe — ${rows.length} row(s), no writes\n`);

const sizes = [];
const tally = { hit: 0, tiny: 0, miss: 0, 'no-isbn10': 0 };
const csvRows = [['title', 'author', 'isbn', 'isbn10', 'pattern', 'status', 'bytes', 'outcome']];

for (const r of rows) {
  const i10 = isbn13to10(r.isbn);
  const label = `${r.title.slice(0, 44).padEnd(44)}`;
  if (!i10) {
    tally['no-isbn10']++;
    console.log(`${label} ${String(r.isbn).padEnd(15)} —  no ISBN-10 (979 prefix or malformed)`);
    csvRows.push([r.title, r.author || '', r.isbn, '', '', '', '', 'no-isbn10']);
    continue;
  }
  let done = false;
  for (const [pname, build] of PATTERNS) {
    const url = build(i10);
    const res = await probeUrl(url);
    if (res.ok) {
      sizes.push(res.len);
      const outcome = res.len > 0 && res.len < 2000 ? 'tiny' : 'hit';
      tally[outcome]++;
      console.log(`${label} ${i10.padEnd(11)} ${pname} ${res.status} ${String(res.len).padStart(7)}b  ${outcome === 'tiny' ? '<-- likely placeholder' : ''}`);
      csvRows.push([r.title, r.author || '', r.isbn, i10, pname, res.status, res.len, outcome]);
      done = true;
      break;
    }
  }
  if (!done) {
    tally.miss++;
    console.log(`${label} ${i10.padEnd(11)} —      miss`);
    csvRows.push([r.title, r.author || '', r.isbn, i10, '', '', '', 'miss']);
  }
  await new Promise((r2) => setTimeout(r2, 250));
}

// -- Where does the placeholder floor sit? ------------------------------------
sizes.sort((a, b) => a - b);
const pct = (p) => (sizes.length ? sizes[Math.floor((sizes.length - 1) * p)] : 0);
console.log('\n--- byte-size distribution of resolving images ---');
console.log(`  n=${sizes.length}  min=${sizes[0] || 0}  p10=${pct(0.1)}  p50=${pct(0.5)}  p90=${pct(0.9)}  max=${sizes[sizes.length - 1] || 0}`);
console.log('  A tight cluster of identical small sizes is Amazon\'s "no image" placeholder.');
console.log('  Set the floor above it, the way tryPRH() does at coverBackfill.mjs:231.');

console.log('\n--- outcomes ---');
for (const k of Object.keys(tally)) console.log(`  ${k.padEnd(11)} ${tally[k]}`);
console.log(`\n[amazonByIsbn] rows=${rows.length} hit=${tally.hit} tiny=${tally.tiny} miss=${tally.miss} noIsbn10=${tally['no-isbn10']}`);
console.log('\nReminder: a hit proves an image exists at that ISBN, not that the ISBN is the right book.\n');

if (CSV) {
  writeFileSync(CSV, csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
  console.log('Wrote ' + CSV);
}
