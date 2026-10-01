// publicationYearBackfill.mjs — fill public.books.first_published_year.
//
// WHY
// ---
// Migration 20260930120000 added the column. Nothing ever stored a year, so the
// series pages could not answer `<series> publication order` or `chronological
// order` — a real share of the queries Google already shows them for.
//
// SOURCES
// -------
//   hc   Hardcover by hardcover_id (batched 50/request), or Hardcover search when
//        the row has no id. `release_year` on a Hardcover BOOK is the work's year.
//   ol   OpenLibrary search, `first_publish_year` of the FIRST doc (by relevance)
//        that passes the title + author guards.
//   wd   Wikidata P577, the tiebreaker — only asked when hc and ol do not already
//        agree. See _shared/wikidataYear.mjs.
//
// THE RULE: CORROBORATE, DON'T GUESS  (_shared/publicationYear.mjs)
// ---------------------------------
// A year is written when two sources agree within 3 years (the earliest of the
// agreeing ones), or when exactly one source answered with a year >= 1000.
// Everything else is left NULL and listed in
// batch-scripts/output/publication-year-conflicts.csv.
//
// The first version wrote the EARLIEST of any two disagreeing years. The first
// full run (2026-09-30) showed both sources carry junk — OpenLibrary sentinel
// years (Frankenstein 1718, Lolita 1777, "1800", "1900"), Hardcover fragments
// (8, 20, 197) and reissue years (Harry Potter 2016) — and "earliest" picked
// the junk every time. `--repair` undoes that run's conflict rows.
//
// NEVER GUESSES
// -------------
// Every search hit must pass titleMatches() AND authorMatches() (src/lib/titleMatch.js).
// Rows whose author is empty or a placeholder are skipped.
//
// Fill-only by default, resumable. `--recheck-days N` additionally re-derives
// rows CREATED in the last N days that already have a year — the year the app
// wrote at add time from a single Hardcover lookup — and corrects it when the
// corroborated answer differs. The weekly catalog-maintenance run uses 8.
//
// Usage (repo root):
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --dry-run --limit 25 --verbose
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --all
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --all --repair
//   node batch-scripts/scheduled/publicationYearBackfill.mjs --all --recheck-days 8
//
// --repair  Before running: set first_published_year back to NULL for every row
//           in the EXISTING conflicts CSV (or --repair-from <path>) whose stored
//           year still equals the CSV's `written` value — a year someone fixed by
//           hand since is left alone — and for every stored year below 1000.
//           Those rows then go through the new rule like any other NULL.
//
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:               HARDCOVER_API_TOKEN (without it, OpenLibrary + Wikidata)

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { titleMatches, authorMatches, titleVariants } from '../../src/lib/titleMatch.js';
import { decideYear, plausibleYear, TOLERANCE } from '../_shared/publicationYear.mjs';
import { makeWikidataYear, FAILED as WD_FAILED } from '../_shared/wikidataYear.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- Args ---------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const ALL = args.includes('--all');
const REPAIR = args.includes('--repair');
function strArg(name) {
  const a = args.find((x) => x === name || x.startsWith(name + '='));
  if (!a) return null;
  return a.includes('=') ? a.split('=').slice(1).join('=') : args[args.indexOf(a) + 1] ?? null;
}
function numArg(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  const v = a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const LIMIT = numArg('--limit', null);
const RECHECK_DAYS = numArg('--recheck-days', null);

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
// Wikidata asks for well-behaved clients; ~1 request per 250ms is well inside it.
const wdThrottle = makeThrottle(240);
const wikidataYear = makeWikidataYear({
  userAgent: 'BooksOracle-publicationYearBackfill/1.1 (https://thebooksoracle.com; simont@mozillafoundation.org)',
  throttle: wdThrottle,
  sleep,
  log: (m) => console.warn('  ' + m),
});

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
  // The FIRST doc that passes the guards, in OpenLibrary's relevance order.
  // This used to be the EARLIEST year among all passing docs, which is exactly
  // how a stray mis-dated work record (Frankenstein 1718, Lolita 1777) beat the
  // real one: the junk is almost always older than the truth, never newer.
  for (const d of json.docs || []) {
    if (!titleMatches(title, d.title) || !authorMatches(author, d.author_name || [])) continue;
    const y = plausibleYear(d.first_publish_year);
    if (y) { vlog(`openlibrary → ${y}`); return y; }
  }
  return null;
}

// -- Worklist -----------------------------------------------------------------
async function fetchPaged(build, limit) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`worklist: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE || (limit && out.length >= limit)) break;
  }
  return limit ? out.slice(0, limit) : out;
}

const COLS = 'id, title, author, hardcover_id, series_id, status, first_published_year';

function fetchMissing(limit) {
  return fetchPaged(() => {
    let q = supabase.from('books').select(COLS)
      .is('first_published_year', null)
      .in('status', ['verified', 'oracle_categorized'])
      .order('series_id', { ascending: true, nullsFirst: false })
      .order('title');
    if (!ALL) q = q.not('series_id', 'is', null);
    return q;
  }, limit);
}

// Rows the app dated at add time from one Hardcover answer. Any status: a book
// is added as unreviewed/discovered, and waiting for categorisation to check
// its year would leave a wrong one on public pages in the meantime.
function fetchRecent(days, limit) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return fetchPaged(() => supabase.from('books').select(COLS)
    .not('first_published_year', 'is', null)
    .gte('created_at', since)
    .order('created_at'), limit);
}

// -- Repair -------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function repair() {
  const file = strArg('--repair-from') || join(__dirname, '..', 'output', 'publication-year-conflicts.csv');
  let rows = [];
  try { rows = parseCsv(readFileSync(file, 'utf8')); } catch (e) {
    console.warn(`--repair: could not read ${file} (${e.message}) — only the <1000 sweep will run`);
  }
  const fromCsv = rows.filter((r) => r.book_id && r.written !== '' && Number.isFinite(Number(r.written)));
  let reset = 0, skipped = 0;
  for (const r of fromCsv) {
    if (DRY_RUN) { reset++; continue; }
    // Only if the value is still the one the bad run wrote.
    const { data, error } = await supabase.from('books')
      .update({ first_published_year: null })
      .eq('id', r.book_id)
      .eq('first_published_year', Number(r.written))
      .select('id');
    if (error) { console.warn(`  repair ${r.book_id}: ${error.message}`); continue; }
    if (data?.length) reset++; else skipped++;
  }
  console.log(`--repair: ${reset} conflict row(s) ${DRY_RUN ? 'would be ' : ''}reset from ${file}${skipped ? `, ${skipped} already changed since and left alone` : ''}`);

  const { count, error: cErr } = await supabase.from('books')
    .select('id', { count: 'exact', head: true })
    .lt('first_published_year', 1000);
  if (cErr) throw new Error(`repair count: ${cErr.message}`);
  if (!DRY_RUN && count) {
    const { error } = await supabase.from('books').update({ first_published_year: null }).lt('first_published_year', 1000);
    if (error) throw new Error(`repair <1000: ${error.message}`);
  }
  console.log(`--repair: ${count || 0} year(s) below 1000 ${DRY_RUN ? 'would be ' : ''}reset`);
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// -- Resolve one row ----------------------------------------------------------
// hc and ol first. Wikidata only when they have not already agreed — it costs
// three or four requests a book, and for most of the catalog two sources agree.
async function resolve(b, author, hcById) {
  const hcId = b.hardcover_id != null ? hcById.get(String(b.hardcover_id)) ?? null : null;
  const ol = await openLibraryYear(b.title, author);
  let hc = hcId;
  let decision = decideYear({ hc, ol });
  if (decision.basis === 'hc+ol') return { hc, ol, wd: null, ...decision };

  if (hc == null) hc = await hardcoverSearchYear(b.title, author);
  const w = await wikidataYear(b.title, author);
  const wd = w === WD_FAILED ? null : w.year;
  if (w !== WD_FAILED && w.qid) vlog(`wikidata ${w.qid} → ${wd}`);
  decision = decideYear({ hc, ol, wd });
  return { hc, ol, wd, ...decision };
}

// -- Main ---------------------------------------------------------------------
async function main() {
  if (REPAIR) await repair();

  const missing = await fetchMissing(LIMIT);
  const recent = RECHECK_DAYS ? await fetchRecent(RECHECK_DAYS, LIMIT) : [];
  const rows = [...missing, ...recent.filter((r) => !missing.some((m) => m.id === r.id))];
  console.log(
    `${missing.length} book(s) missing first_published_year${ALL ? '' : ' (series books only; --all for the catalog)'}` +
    `${RECHECK_DAYS ? `, ${recent.length} dated in the last ${RECHECK_DAYS} day(s) to recheck` : ''}` +
    `${DRY_RUN ? ' — DRY RUN' : ''}`
  );
  if (!rows.length) return;

  const hcById = await hardcoverYearsById(rows.map((r) => r.hardcover_id).filter((x) => x != null));
  console.log(`hardcover_id lookups answered for ${hcById.size} book(s)`);

  const stats = { written: 0, corrected: 0, confirmed: 0, notFound: 0, noAuthor: 0, conflicts: 0, implausible: 0, errors: 0 };
  const bases = {};
  const conflicts = [['book_id', 'title', 'author', 'hardcover', 'openlibrary', 'wikidata', 'stored', 'reason']];

  for (const [i, b] of rows.entries()) {
    const author = realAuthor(b.author);
    const recheck = b.first_published_year != null;
    process.stdout.write(`[${i + 1}/${rows.length}] ${b.title} — ${b.author || '?'}${recheck ? ` (recheck ${b.first_published_year})` : ''}\n`);
    if (!author) { stats.noAuthor++; vlog('skip: no real author to corroborate'); continue; }

    const r = await resolve(b, author, hcById);
    vlog(`→ ${r.year ?? '—'} [${r.basis}] (hc ${r.hc ?? '–'}, ol ${r.ol ?? '–'}, wd ${r.wd ?? '–'})`);

    if (r.year == null) {
      if (r.basis === 'none') stats.notFound++;
      else {
        stats[r.basis === 'conflict' ? 'conflicts' : 'implausible']++;
        conflicts.push([b.id, b.title, b.author, r.hc, r.ol, r.wd, b.first_published_year, r.basis]);
      }
      continue;
    }
    bases[r.basis] = (bases[r.basis] || 0) + 1;

    if (recheck) {
      if (r.year === b.first_published_year) { stats.confirmed++; continue; }
      // Overwrite ONLY on a corroborated answer. A lone source disagreeing with
      // the stored lone source is one opinion against another.
      if (!r.basis.includes('+')) { stats.confirmed++; continue; }
      if (DRY_RUN) { stats.corrected++; continue; }
      const { error } = await supabase.from('books').update({ first_published_year: r.year })
        .eq('id', b.id).eq('first_published_year', b.first_published_year);
      if (error) { stats.errors++; console.warn(`  write failed: ${error.message}`); } else stats.corrected++;
      continue;
    }

    if (DRY_RUN) { stats.written++; continue; }
    const { error } = await supabase.from('books')
      .update({ first_published_year: r.year })
      .eq('id', b.id)
      .is('first_published_year', null);
    if (error) { stats.errors++; console.warn(`  write failed: ${error.message}`); } else stats.written++;
  }

  const dir = join(__dirname, '..', 'output');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'publication-year-conflicts.csv');
  writeFileSync(file, conflicts.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
  console.log(`unresolved rows written to ${file}`);
  console.log(
    `\n${DRY_RUN ? 'would write' : 'written'}: ${stats.written}` +
    `${RECHECK_DAYS ? `  corrected: ${stats.corrected}  confirmed: ${stats.confirmed}` : ''}` +
    `  not found: ${stats.notFound}  no author: ${stats.noAuthor}` +
    `  conflicts (>${TOLERANCE}y, left NULL): ${stats.conflicts}  implausible lone year: ${stats.implausible}  errors: ${stats.errors}`
  );
  console.log(`basis: ${Object.entries(bases).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
  if (stats.errors) process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
