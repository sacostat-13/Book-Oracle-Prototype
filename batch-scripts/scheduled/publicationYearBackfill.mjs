// publicationYearBackfill.mjs — fill public.books.first_published_year.
//
// WHY
// ---
// Migration 20260930120000 added the column. Nothing ever stored a year, so the
// series pages could not answer `<series> publication order` or `chronological
// order` — a real share of the queries Google already shows them for. Both
// upstreams carry the fact; this script copies it in.
//
// SOURCES, AND WHICH ONE WINS
// ---------------------------
//   1. Hardcover by hardcover_id — the strongest identity we have, batched 50 per
//      request. `release_year` on a Hardcover BOOK is the work's year, not an
//      edition's.
//   2. OpenLibrary search (title + author) — `first_publish_year` is exactly the
//      semantic we want. Free, no token; paced at ~1 req/s out of courtesy.
//   3. Hardcover search — only when neither of the above answered.
//
// When 1 and 2 both answer and differ, the EARLIER year is written: a
// translation or reissue can only make a year later, never earlier. A gap over
// CONFLICT_YEARS is also written to batch-scripts/output/publication-year-conflicts.csv
// so the big ones can be eyeballed; `--strict` writes nothing for those rows.
//
// NEVER GUESSES
// -------------
// Every search hit must pass titleMatches() AND authorMatches() (src/lib/titleMatch.js,
// the same guards as isbnBackfill). Rows whose author is empty or a placeholder
// are skipped outright rather than matched on title alone — for an ISBN the
// title guard can stand alone; for a year a wrong answer ships straight into a
// sentence on a public page, so the bar is higher.
//
// Fills NULLs only. Safe to interrupt and re-run: it resumes from what is still null.
//
// Usage (repo root):
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --dry-run --limit 25 --verbose
//   node batch-scripts/scheduled/publicationYearBackfill.mjs                # series books only
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --all          # whole catalog
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --strict       # skip conflicts
//
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:               HARDCOVER_API_TOKEN (without it, OpenLibrary only)

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { titleMatches, authorMatches, titleVariants } from '../../src/lib/titleMatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- Args ---------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const ALL = args.includes('--all');
const STRICT = args.includes('--strict');
function numArg(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  const v = a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const LIMIT = numArg('--limit', null);
const CONFLICT_YEARS = 3;
const THIS_YEAR = new Date().getFullYear();

// -- Env ----------------------------------------------------------------------
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!HARDCOVER_TOKEN) console.warn('No HARDCOVER_API_TOKEN — running on OpenLibrary alone.');

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

const SENTINEL_AUTHOR_RX = /^(unknown(\s+author)?|no\s+author|n\/?a|none|anon(ymous)?|various(\s+authors)?|\?+|-+|null|undefined)$/i;
const realAuthor = (a) => {
  const t = (a || '').trim();
  return !t || SENTINEL_AUTHOR_RX.test(t) ? null : t;
};
const searchTitle = (t) => titleVariants(t).slice(-1)[0] || t || '';
const plausibleYear = (y) => {
  const n = Number(y);
  return Number.isInteger(n) && n >= -800 && n <= THIS_YEAR + 1 && n !== 0 ? n : null;
};

// -- Throttles ----------------------------------------------------------------
// SPACED, not just windowed. The first version was a pure sliding window: 45
// requests allowed per trailing minute, so the opening batch of hardcover_id
// lookups went out as a burst of dozens in the first second — and Hardcover
// limits bursts, not clean minutes (isbnBackfill found the same). The run on
// 2026-09-30 opened with a wall of 429s. Now every request also waits at least
// 60s / perMinute after the previous one, so 40/min means one every 1.5s.
function makeThrottle(perMinute) {
  const times = [];
  const spacing = Math.ceil(60_000 / perMinute);
  let last = 0;
  return async function throttle() {
    for (;;) {
      const now = Date.now();
      const gap = last + spacing - now;
      if (gap > 0) { await sleep(gap); continue; }
      while (times.length && now - times[0] > 60_000) times.shift();
      if (times.length < perMinute) { times.push(now); last = now; return; }
      await sleep(60_000 - (now - times[0]) + 50);
    }
  };
}
const hcThrottle = makeThrottle(Number(env['HARDCOVER_RATE_LIMIT']) > 0 ? Number(env['HARDCOVER_RATE_LIMIT']) : 40);
const olThrottle = makeThrottle(50);

// -- Circuit breaker ----------------------------------------------------------
// Same lesson as isbnBackfill v0.62: a source that answers nothing but failures
// must stop the run, not produce a plausible report that every book is undated.
const MAX_CONSECUTIVE_FAILURES = 10;
const fails = { hardcover: 0, openlibrary: 0 };
function noteFailure(src, detail) {
  console.warn(`  ${src}: ${detail}`);
  if (++fails[src] >= MAX_CONSECUTIVE_FAILURES) {
    throw new Error(`${src} returned ${MAX_CONSECUTIVE_FAILURES} consecutive failures — aborting. Last: ${detail}`);
  }
}

async function fetchRetry(url, init, src, attempt = 1) {
  try {
    const res = await fetch(url, init);
    if (res.status === 429 && attempt <= 3) {
      // Retry-After is honoured as a MINIMUM, never as the whole answer:
      // Hardcover sends `1`, and retrying one second into a burst limit just
      // spends the three attempts. Floor: 10s, 30s, 90s.
      const ra = Number(res.headers.get('retry-after'));
      const floor = 10_000 * 3 ** (attempt - 1);
      const wait = Math.min(Math.max(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0, floor), 300_000);
      console.warn(`  ${src}: 429 — waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/3)`);
      await sleep(wait);
      return fetchRetry(url, init, src, attempt + 1);
    }
    return res;
  } catch (e) {
    if (attempt <= 3) {
      await sleep(2000 * 3 ** (attempt - 1));
      return fetchRetry(url, init, src, attempt + 1);
    }
    noteFailure(src, `network: ${e.message}`);
    return null;
  }
}

// -- Hardcover ----------------------------------------------------------------
async function gql(query, variables) {
  if (!HARDCOVER_TOKEN) return null;
  await hcThrottle();
  const res = await fetchRetry('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: {
      Authorization: HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'BooksOracle-publicationYearBackfill/1.0',
    },
    body: JSON.stringify({ query, variables }),
  }, 'hardcover');
  if (!res) return null;
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Hardcover HTTP ${res.status} — token rejected. Check HARDCOVER_API_TOKEN.`);
  }
  if (!res.ok) { noteFailure('hardcover', `HTTP ${res.status}`); return null; }
  const json = await res.json();
  if (json.errors?.length) { noteFailure('hardcover', `graphql: ${JSON.stringify(json.errors).slice(0, 300)}`); return null; }
  fails.hardcover = 0;
  return json.data || null;
}

// Map<hardcover_id, year> for a batch of ids. Non-numeric ids are dropped with a
// warning — JSON.stringify(NaN) is null, and `_in: [null]` silently matches nothing.
async function hardcoverYearsById(ids) {
  const nums = ids.map(Number).filter(Number.isFinite);
  if (nums.length < ids.length) console.warn(`  !! ${ids.length - nums.length} non-numeric hardcover_id value(s) skipped`);
  const out = new Map();
  for (let i = 0; i < nums.length; i += 50) {
    const data = await gql(
      `query Years($ids: [Int!]) { books(where: { id: { _in: $ids } }) { id release_year } }`,
      { ids: nums.slice(i, i + 50) }
    );
    for (const b of data?.books || []) {
      const y = plausibleYear(b.release_year);
      if (y) out.set(String(b.id), y);
    }
  }
  return out;
}

async function hardcoverSearchYear(title, author) {
  const data = await gql(
    `query S($q: String!) { search(query: $q, query_type: "Book", per_page: 25, page: 1) { results } }`,
    { q: `${searchTitle(title)} ${author}` }
  );
  for (const h of data?.search?.results?.hits || []) {
    const doc = h.document || h;
    const names = doc?.author_names || [];
    if (!titleMatches(title, doc?.title) || !authorMatches(author, names)) continue;
    const y = plausibleYear(doc.release_year);
    if (y) { vlog(`hardcover search: "${doc.title}" → ${y}`); return y; }
  }
  return null;
}

// -- OpenLibrary --------------------------------------------------------------
async function openLibraryYear(title, author) {
  await olThrottle();
  const q = `title=${encodeURIComponent(searchTitle(title))}&author=${encodeURIComponent(author)}` +
    `&limit=10&fields=title,author_name,first_publish_year`;
  const res = await fetchRetry(`https://openlibrary.org/search.json?${q}`, {
    headers: { 'User-Agent': 'BooksOracle-publicationYearBackfill/1.0 (thebooksoracle.com)' },
  }, 'openlibrary');
  if (!res) return null;
  if (!res.ok) { noteFailure('openlibrary', `HTTP ${res.status}`); return null; }
  const json = await res.json();
  fails.openlibrary = 0;
  // Several works can pass the guards (a novel and its graphic adaptation share a
  // title and author). The earliest year among the matches is the original.
  let best = null;
  for (const d of json.docs || []) {
    if (!titleMatches(title, d.title) || !authorMatches(author, d.author_name || [])) continue;
    const y = plausibleYear(d.first_publish_year);
    if (y && (best == null || y < best)) best = y;
  }
  if (best) vlog(`openlibrary → ${best}`);
  return best;
}

// -- Worklist -----------------------------------------------------------------
async function fetchWorklist(limit) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('books')
      .select('id, title, author, hardcover_id, series_id, status')
      .is('first_published_year', null)
      .in('status', ['verified', 'oracle_categorized'])
      .order('series_id', { ascending: true, nullsFirst: false })
      .order('title')
      .range(from, from + PAGE - 1);
    if (!ALL) q = q.not('series_id', 'is', null);
    const { data, error } = await q;
    if (error) throw new Error(`worklist: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE || (limit && out.length >= limit)) break;
  }
  return limit ? out.slice(0, limit) : out;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// -- Main ---------------------------------------------------------------------
async function main() {
  const rows = await fetchWorklist(LIMIT);
  console.log(`${rows.length} book(s) missing first_published_year${ALL ? '' : ' (series books only; --all for the catalog)'}${DRY_RUN ? ' — DRY RUN' : ''}`);
  if (!rows.length) return;

  const hcById = await hardcoverYearsById(rows.map((r) => r.hardcover_id).filter((x) => x != null));
  console.log(`hardcover_id lookups answered for ${hcById.size} book(s)`);

  const stats = { written: 0, noAuthor: 0, notFound: 0, conflicts: 0, skippedStrict: 0, errors: 0 };
  const conflicts = [['book_id', 'title', 'author', 'hardcover', 'openlibrary', 'written']];

  for (const [i, b] of rows.entries()) {
    const author = realAuthor(b.author);
    process.stdout.write(`[${i + 1}/${rows.length}] ${b.title} — ${b.author || '?'}\n`);
    if (!author) { stats.noAuthor++; vlog('skip: no real author to corroborate'); continue; }

    const hc = b.hardcover_id != null ? hcById.get(String(b.hardcover_id)) ?? null : null;
    const ol = await openLibraryYear(b.title, author);
    const hcs = hc == null && ol == null ? await hardcoverSearchYear(b.title, author) : null;

    const candidates = [hc, ol, hcs].filter((y) => y != null);
    if (!candidates.length) { stats.notFound++; vlog('no year from any source'); continue; }

    let year = Math.min(...candidates);
    if (hc != null && ol != null && Math.abs(hc - ol) > CONFLICT_YEARS) {
      stats.conflicts++;
      if (STRICT) { stats.skippedStrict++; conflicts.push([b.id, b.title, b.author, hc, ol, '']); continue; }
      conflicts.push([b.id, b.title, b.author, hc, ol, year]);
    }

    vlog(`→ ${year} (hardcover ${hc ?? '–'}, openlibrary ${ol ?? '–'}, hc-search ${hcs ?? '–'})`);
    if (DRY_RUN) { stats.written++; continue; }
    // `.is(null)` in the filter keeps this a fill-only write even if another run
    // got there first.
    const { error } = await supabase
      .from('books')
      .update({ first_published_year: year })
      .eq('id', b.id)
      .is('first_published_year', null);
    if (error) { stats.errors++; console.warn(`  write failed: ${error.message}`); } else stats.written++;
  }

  if (conflicts.length > 1) {
    const dir = join(__dirname, '..', 'output');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'publication-year-conflicts.csv');
    writeFileSync(file, conflicts.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
    console.log(`conflicts written to ${file}`);
  }
  console.log(
    `\n${DRY_RUN ? 'would write' : 'written'}: ${stats.written}  not found: ${stats.notFound}  ` +
    `no author: ${stats.noAuthor}  conflicts >${CONFLICT_YEARS}y: ${stats.conflicts}` +
    `${STRICT ? ` (skipped ${stats.skippedStrict})` : ''}  errors: ${stats.errors}`
  );
  if (stats.errors) process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
