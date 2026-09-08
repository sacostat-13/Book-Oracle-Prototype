// seriesBackfill.mjs — fill in the volumes a series page is missing, in two passes.
//
// WHY THIS EXISTS
// ---------------
// supabase/diagnostics/series_health.sql, run 2026-09-08 against the 175 series
// pages that earned Search Console impressions in the previous 28 days:
//
//   116 of 175 (66%)  hold exactly ONE book        59% of all impressions
//    12 of 105        with a total_books are complete
//   305               volumes missing in total
//
// Those pages rank around position 58 for "crescent city series in order",
// "dragonlance reading order", "how many godfather books are there" — matched to
// the right query, and then answering it with one book. The rendering was fixed
// (series_volumes, migration 20260908120000); the catalog behind it was not, and
// no rendering fixes an empty catalog.
//
// TWO PASSES, AND WHY
// -------------------
// This writes to the shared `books` catalog with the service role key, for the
// pages that earn most of the site's traffic. So it never writes anything a
// human has not looked at first:
//
//   1. --propose   reads the catalog and Hardcover, writes a CSV, touches NO
//                  database row. Safe to run repeatedly.
//   2. --apply     reads that CSV back and applies ONLY the rows whose `approve`
//                  column says so.
//
// The CSV is the review surface: open it, read the `action`, `title`, `position`
// and `notes` columns, set `approve` to y or n, save, apply. Rows left blank are
// not applied — an unreviewed file is a no-op, which is the safe default when
// the failure mode is silently inventing books in someone else's library.
//
//   node batch-scripts/manual/seriesBackfill.mjs --propose
//   node batch-scripts/manual/seriesBackfill.mjs --propose --series "Crescent City" --verbose
//   node batch-scripts/manual/seriesBackfill.mjs --apply batch-scripts/output/series-backfill.csv --dry-run
//   node batch-scripts/manual/seriesBackfill.mjs --apply batch-scripts/output/series-backfill.csv
//
// FLAGS
//   --propose             pass 1. Read-only. Writes the CSV.
//   --apply FILE          pass 2. Applies approved rows from FILE.
//   --series "Name"       one series only (propose). Repeatable.
//   --all-short           propose for EVERY series short of its total_books,
//                         not just the ranked list below. Much slower.
//   --limit N             at most N series (propose) or N rows (apply)
//   --min-confidence N    below this a proposal is written with approve blank
//                         rather than pre-filled 'y'. Default 80.
//   --status S            status for INSERTED books. Default 'unreviewed'.
//                         See "THE STATUS DECISION" below — it decides whether
//                         the backfill is visible at all.
//   --dry-run             with --apply: print every write, perform none
//   --verbose
//
// THE STATUS DECISION — read before running --apply
// -------------------------------------------------
// SeriesPage and og-prerender both list only books whose status is `verified` or
// `oracle_categorized`. A book inserted as `unreviewed` is in the catalog and
// invisible on the page, so the backfill alone will NOT make Crescent City list
// three volumes.
//
// That is deliberate and it is the honest default. `oracle_categorized` means
// the Oracle classified the book — set it here and every one of these rows
// claims a categorisation that never happened, in the column the whole app uses
// to decide what is trustworthy. The correct second step is the pipeline that
// already exists:
//
//   node batch-scripts/manual/oracleBatch.mjs --limit N
//
// which categorises `unreviewed` rows properly and costs what it costs. If you
// decide Hardcover's metadata is good enough on its own, `--status
// oracle_categorized` is available and the `status` column in the CSV is
// per-row editable — but make that decision deliberately, not by leaving a flag
// at its default.
//
// WHAT IT WILL NOT DO
// -------------------
// Invent a series. If Hardcover's series name does not normalise to the same
// string as ours, every proposal for that series is written with approve blank
// and a note saying why. That guard is not theoretical: our `Wicked` series is
// Janet Evanovich's (one book, *Wicked Appetite*), while the live page had been
// showing Nancy Holder's *Witch & Curse* rows pulled from OpenLibrary at render
// time. Without the guard this script would happily "backfill" one series with
// another author's books.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServiceClient } from '../_shared/supabaseClient.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CSV_PATH = join(ROOT, 'batch-scripts', 'output', 'series-backfill.csv');

// -- Args ---------------------------------------------------------------------
const args = process.argv.slice(2);
const PROPOSE = args.includes('--propose');
const APPLY_IDX = args.indexOf('--apply');
const APPLY = APPLY_IDX !== -1;
const APPLY_FILE = APPLY ? (args[APPLY_IDX + 1] || CSV_PATH) : null;
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const ALL_SHORT = args.includes('--all-short');

function numArg(name, dflt) {
  const i = args.indexOf(name);
  if (i === -1) return dflt;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : dflt;
}
function strArg(name, dflt) {
  const i = args.indexOf(name);
  return i === -1 ? dflt : (args[i + 1] || dflt);
}
function allStrArgs(name) {
  const out = [];
  args.forEach((a, i) => { if (a === name && args[i + 1]) out.push(args[i + 1]); });
  return out;
}
const LIMIT = numArg('--limit', null);
const MIN_CONFIDENCE = numArg('--min-confidence', 80);
const INSERT_STATUS = strArg('--status', 'unreviewed');
const ONLY_SERIES = allStrArgs('--series');

if (PROPOSE === APPLY) {
  console.error('Pass exactly one of --propose or --apply FILE. See the header of this file.');
  process.exit(1);
}
const VALID_STATUS = ['unreviewed', 'incomplete', 'oracle_categorized', 'verified', 'flagged', 'discovered'];
if (!VALID_STATUS.includes(INSERT_STATUS)) {
  console.error(`--status must be one of: ${VALID_STATUS.join(', ')} (books_status_check)`);
  process.exit(1);
}

// -- Env ----------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || env['SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || '';

for (const [k, v] of [['VITE_SUPABASE_URL', SUPABASE_URL], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY]]) {
  if (!v) { console.error(`Missing ${k} in .env.local`); process.exit(1); }
}
if (PROPOSE && !HARDCOVER_TOKEN) {
  console.error('Missing HARDCOVER_API_TOKEN in .env.local — proposing needs a volume source.');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

// The ranked target list: the top series by Search Console impressions in the 28
// days to 2026-09-06, from the Pages export. A fixed snapshot, like the one in
// supabase/diagnostics/series_health.sql — re-export and edit both when you want
// fresh numbers. Ordered so a --limit cuts the tail, not the head.
const TOP_SERIES = [
  ['Crescent City', 75], ['Dragonlance Chronicles', 74], ['Wicked', 50],
  ['Fablehaven', 40], ['Hyperion Cantos', 33], ['Marvel Zombies', 33],
  ['Red Rising Saga', 32], ['The Godfather', 30], ['Robert Langdon', 27],
  ['Malazan Book of the Fallen', 24], ['The Shepherd King', 22], ['Hellboy', 21],
  ['Night Lords', 21], ['Discworld: Tiffany Aching', 20], ['The Bloodsworn Saga', 18],
  ['Dungeon Crawler Carl', 17], ['The Witcher', 17], ["Howl's Moving Castle", 16],
  ['The Locked Tomb', 16], ['The Chronicles of Narnia', 15], ['John Dies at the End', 14],
  ['Ring', 14], ['The Icewind Dale', 14], ['Hannibal Lecter', 13],
  ['The Inheritance Trilogy', 12],
];

// Mirrors normalizeSeriesName() in src/lib/seriesService.js AND the SQL that
// backs series.normalized_name. Three copies of one rule is what this codebase
// keeps paying for, but a batch script cannot import from src/ and must not
// guess: if this drifts, the corroboration guard below silently stops guarding.
const normSeries = (s) => (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
// Mirrors compute_book_key() (migration 20260806212127) — title, pipe, first 10
// of author, non-alphanumerics stripped from both.
const bookKey = (t, a) =>
  (t || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' +
  (a || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
const normTitle = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// -- Hardcover ----------------------------------------------------------------
const RATE_LIMIT = 55, WINDOW_MS = 60_000, requestTimes = [];
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (requestTimes.length && now - requestTimes[0] > WINDOW_MS) requestTimes.shift();
    if (requestTimes.length < RATE_LIMIT) { requestTimes.push(now); return; }
    await sleep(WINDOW_MS - (now - requestTimes[0]) + 50);
  }
}

// Returns parsed data, or throws. It does NOT return null on failure.
//
// Sixth time this codebase has had to say so: a failed request that returns an
// empty result is indistinguishable from a series with no books, and this script
// would read that as "nothing to propose" and report success having done
// nothing. tests/failure-is-not-empty.test.js exists for this shape.
async function hcGql(query, variables = {}, attempt = 1) {
  await throttle();
  let resp;
  try {
    resp = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        Authorization: HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BooksOracle-seriesBackfill/1.0',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    if (attempt <= 3) { await sleep(2000 * 3 ** (attempt - 1)); return hcGql(query, variables, attempt + 1); }
    throw new Error(`hardcover unreachable after ${attempt} attempts: ${e.message}`);
  }
  if (resp.status === 429) { await sleep(60_000); return hcGql(query, variables, attempt); }
  if (!resp.ok) throw new Error(`hardcover ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const json = await resp.json();
  if (json.errors?.length) throw new Error(`hardcover graphql: ${json.errors[0]?.message}`);
  return json.data;
}

// The volume list for a series name, with positions. Mirrors
// hardcoverFetchSeriesBooks() in src/lib/hardcoverService.js — including its
// primary_books_count filter, which excludes the novellas and companion volumes
// that inflate books_count and would otherwise be proposed as missing volumes.
async function hcSeriesVolumes(name) {
  const search = await hcGql(
    `query S($q: String!, $type: String!) { search(query: $q, query_type: $type, per_page: 5, page: 1) { results } }`,
    { q: name, type: 'Series' }
  );
  const hits = search?.search?.results?.hits || search?.search?.results?.results || [];
  if (!hits.length) return { name: null, volumes: [], total: null };

  const want = normSeries(name);
  let best = null, bestScore = -1;
  for (const h of hits) {
    const doc = h.document || h;
    const got = normSeries(doc?.name);
    const score = got === want ? 2 : (got && (got.includes(want) || want.includes(got))) ? 1 : 0;
    if (score > bestScore) { bestScore = score; best = doc; }
  }
  if (!best?.id) return { name: null, volumes: [], total: null };

  const data = await hcGql(
    `query GetSeries($id: Int!) {
       series(where: { id: { _eq: $id } }, limit: 1) {
         id name books_count primary_books_count
         book_series(order_by: { position: asc }) {
           position
           book {
             id title pages description
             image { url }
             contributions { author { name } }
           }
         }
       }
     }`,
    { id: typeof best.id === 'string' ? parseInt(best.id, 10) : best.id }
  );
  const s = data?.series?.[0];
  if (!s?.book_series) return { name: null, volumes: [], total: null };

  const primaryTotal = s.primary_books_count || null;
  const entries = s.book_series.filter(
    (bs) => bs.position != null && (primaryTotal == null || bs.position <= primaryTotal)
  );
  return {
    name: s.name || best.name || null,
    total: primaryTotal,
    volumes: entries.map((bs) => ({
      position: bs.position,
      hardcoverId: bs.book?.id ?? null,
      title: bs.book?.title || '',
      author: bs.book?.contributions?.[0]?.author?.name || '',
      pages: bs.book?.pages ?? null,
      description: bs.book?.description || '',
      coverUrl: bs.book?.image?.url || '',
    })).filter((v) => v.title),
  };
}

// -- CSV ----------------------------------------------------------------------
const COLUMNS = [
  'approve', 'action', 'series_name', 'position', 'title', 'author',
  'pages', 'status', 'confidence', 'notes', 'book_id', 'series_id',
  'hardcover_id', 'cover_url',
];
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.some((c) => c !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// -- Pass 1: propose ----------------------------------------------------------
async function propose() {
  let targets;
  if (ONLY_SERIES.length) {
    targets = ONLY_SERIES.map((n) => [n, null]);
  } else if (ALL_SHORT) {
    const { data, error } = await supabase
      .from('series').select('name,total_books').not('total_books', 'is', null);
    if (error) throw new Error(`series list failed: ${error.message}`);
    targets = (data || []).map((s) => [s.name, null]);
  } else {
    targets = TOP_SERIES;
  }
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(`\n  Proposing for ${targets.length} series. Reading only — no database writes.\n`);
  const out = [];
  const summary = [];

  for (const [name, impressions] of targets) {
    process.stdout.write(`  ${name}\n`);

    const { data: srow, error: sErr } = await supabase
      .from('series').select('id,name,total_books')
      .eq('normalized_name', normSeries(name)).maybeSingle();
    if (sErr) { console.log(`    ! series lookup failed: ${sErr.message}`); continue; }
    if (!srow) { console.log('    ! not in the catalog — skipped'); continue; }

    const { data: held, error: hErr } = await supabase
      .from('series_volumes').select('id,title,author,position_in_series,status')
      .eq('series_id', srow.id);
    if (hErr) { console.log(`    ! held lookup failed: ${hErr.message}`); continue; }

    const heldByPos = new Map();
    for (const b of held || []) if (b.position_in_series != null) heldByPos.set(Number(b.position_in_series), b);
    const heldTitles = new Set((held || []).map((b) => normTitle(b.title)));

    let hc;
    try { hc = await hcSeriesVolumes(name); }
    catch (e) { console.log(`    ! hardcover: ${e.message} — skipped, nothing proposed`); continue; }
    if (!hc.volumes.length) { console.log('    ! hardcover has no volume list — skipped'); continue; }

    // THE CORROBORATION GUARD. See the header: our `Wicked` is Janet
    // Evanovich's. A mismatch does not skip the series — the rows are still
    // written so the mismatch is visible in the review file — but every one of
    // them lands with approve blank and confidence 0.
    const nameMatches = normSeries(hc.name) === normSeries(srow.name);
    if (!nameMatches) {
      console.log(`    ! hardcover calls this "${hc.name}" — ours is "${srow.name}". Proposals will need approving by hand.`);
    }

    const heldAuthors = new Set((held || []).map((b) => normTitle(b.author)).filter(Boolean));
    let added = 0;

    for (const v of hc.volumes) {
      if (heldByPos.has(Number(v.position))) continue;

      // Is it already in the catalog under a different series, or none?
      const key = bookKey(v.title, v.author);
      const { data: found, error: fErr } = await supabase
        .rpc('find_book_by_client_key', { _key: key });
      if (fErr) vlog(`lookup failed for ${v.title}: ${fErr.message}`);
      const existing = Array.isArray(found) ? found[0] : found;

      let action, notes = '', bookId = '';
      if (existing?.id) {
        bookId = existing.id;
        if (!existing.series_id) {
          action = 'link';
          notes = 'already in the catalog, unlinked';
        } else if (existing.series_id === srow.id) {
          action = 'set-position';
          notes = 'in this series, no position';
        } else {
          action = 'skip';
          notes = `already belongs to a different series (${existing.series_id})`;
        }
      } else if (heldTitles.has(normTitle(v.title))) {
        action = 'skip';
        notes = 'a book with this title is already in the series';
      } else {
        action = 'insert';
      }

      // Confidence: does the author agree with the series we already hold, is
      // the position explicit, is the title substantial. Deliberately blunt —
      // its only job is to decide which rows get a pre-filled 'y'.
      let confidence = 100;
      if (!nameMatches) confidence = 0;
      if (heldAuthors.size && v.author && !heldAuthors.has(normTitle(v.author))) {
        confidence -= 40; notes = notes ? `${notes}; author differs from the series` : 'author differs from the series';
      }
      if (!v.author) { confidence -= 20; notes = notes ? `${notes}; no author` : 'no author'; }
      if (normTitle(v.title).length < 3) { confidence -= 40; notes = notes ? `${notes}; title too short` : 'title too short'; }
      if (srow.total_books && v.position > srow.total_books) {
        confidence -= 20;
        notes = notes ? `${notes}; beyond total_books (${srow.total_books})` : `beyond total_books (${srow.total_books})`;
      }
      confidence = Math.max(0, confidence);

      out.push({
        approve: action !== 'skip' && confidence >= MIN_CONFIDENCE ? 'y' : '',
        action,
        series_name: srow.name,
        position: v.position,
        title: v.title,
        author: v.author,
        pages: v.pages ?? '',
        status: action === 'insert' ? INSERT_STATUS : '',
        confidence,
        notes,
        book_id: bookId,
        series_id: srow.id,
        hardcover_id: v.hardcoverId ?? '',
        cover_url: v.coverUrl,
      });
      added++;
    }

    const heldCount = (held || []).length;
    summary.push({ name: srow.name, impressions, held: heldCount, proposed: added, hcTotal: hc.total });
    console.log(`    holds ${heldCount}, hardcover lists ${hc.volumes.length}${hc.total ? ` (primary ${hc.total})` : ''} → ${added} proposed`);
  }

  const body = out.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  writeFileSync(CSV_PATH, COLUMNS.join(',') + '\n' + body + '\n');

  const approvable = out.filter((r) => r.approve === 'y').length;
  console.log(`\n  ${out.length} proposals across ${summary.length} series — ${approvable} pre-approved, ${out.length - approvable} need a decision.`);
  console.log(`  Actions: ${['insert', 'link', 'set-position', 'skip'].map((a) => `${a} ${out.filter((r) => r.action === a).length}`).join(', ')}`);
  console.log(`\n  Review:  ${CSV_PATH}`);
  console.log(`  Then:    node batch-scripts/manual/seriesBackfill.mjs --apply ${CSV_PATH} --dry-run\n`);
  if (INSERT_STATUS === 'unreviewed') {
    console.log(`  NOTE: inserts are staged as 'unreviewed', which the series page does NOT list.`);
    console.log(`        Run oracleBatch.mjs afterwards, or re-propose with --status oracle_categorized.\n`);
  }
}

// -- Pass 2: apply ------------------------------------------------------------
const APPROVED = new Set(['y', 'yes', '1', 'true']);

async function apply() {
  if (!existsSync(APPLY_FILE)) { console.error(`No such file: ${APPLY_FILE}`); process.exit(1); }
  const all = parseCsv(readFileSync(APPLY_FILE, 'utf8'));
  let rows = all.filter((r) => APPROVED.has((r.approve || '').toLowerCase()) && r.action !== 'skip');
  if (LIMIT) rows = rows.slice(0, LIMIT);

  console.log(`\n  ${APPLY_FILE}`);
  console.log(`  ${all.length} rows, ${rows.length} approved and applicable.${DRY_RUN ? '  DRY RUN — nothing will be written.' : ''}\n`);
  if (!rows.length) { console.log('  Nothing to do. Set `approve` to y on the rows you want.\n'); return; }

  const counts = { insert: 0, link: 0, 'set-position': 0, skipped: 0, failed: 0 };

  for (const r of rows) {
    const label = `${r.series_name} #${r.position} ${r.title}`;
    try {
      if (r.action === 'link' || r.action === 'set-position') {
        if (!r.book_id) { console.log(`  - ${label}: no book_id, skipped`); counts.skipped++; continue; }
        // Re-check before writing. The CSV is a snapshot of a read that may be
        // hours old, and this is the shared catalog: another run, the nightly
        // curation, or a person may have moved this book since.
        const { data: cur, error: cErr } = await supabase
          .from('books').select('id,series_id,position_in_series,title').eq('id', r.book_id).maybeSingle();
        if (cErr) throw new Error(cErr.message);
        if (!cur) { console.log(`  - ${label}: book no longer exists, skipped`); counts.skipped++; continue; }
        if (cur.series_id && cur.series_id !== r.series_id) {
          console.log(`  - ${label}: now belongs to another series, skipped`); counts.skipped++; continue;
        }
        if (String(cur.position_in_series ?? '') === String(r.position)) {
          vlog(`${label}: already correct`); counts.skipped++; continue;
        }
        if (DRY_RUN) { console.log(`  ~ ${r.action} ${label}`); counts[r.action]++; continue; }
        const { error: uErr } = await supabase
          .from('books')
          .update({ series_id: r.series_id, position_in_series: Number(r.position) })
          .eq('id', r.book_id);
        if (uErr) throw new Error(uErr.message);
        console.log(`  ✓ ${r.action} ${label}`);
        counts[r.action]++;
      } else if (r.action === 'insert') {
        if (DRY_RUN) { console.log(`  ~ insert ${label} (${r.status || INSERT_STATUS})`); counts.insert++; continue; }
        // upsert_book, not a raw insert: books.normalized_key is NOT NULL and
        // UNIQUE and is computed by compute_book_key() server-side. Going
        // through the RPC means a row that turns out to already exist is
        // updated rather than duplicated — which is the whole point of a
        // UNIQUE identity column, and not something this script should
        // reimplement.
        const { data: id, error: iErr } = await supabase.rpc('upsert_book', {
          _title: r.title,
          _author: r.author || null,
          _series_id: r.series_id,
          _series_name: r.series_name,
          _series_position: r.position ? Number(r.position) : null,
          _pages: r.pages ? Number(r.pages) : null,
          _cover_url: r.cover_url || null,
          _hardcover_id: r.hardcover_id ? Number(r.hardcover_id) : null,
          _source: 'series_backfill',
          _series_source: 'hardcover',
          _status: r.status || INSERT_STATUS,
        });
        if (iErr) throw new Error(iErr.message);
        console.log(`  ✓ insert ${label} → ${id}`);
        counts.insert++;
      } else {
        console.log(`  - ${label}: unknown action "${r.action}", skipped`);
        counts.skipped++;
      }
    } catch (e) {
      console.log(`  ! ${label}: ${e.message}`);
      counts.failed++;
    }
  }

  console.log(`\n  inserted ${counts.insert}, linked ${counts.link}, positioned ${counts['set-position']}, skipped ${counts.skipped}, failed ${counts.failed}`);
  if (!DRY_RUN) {
    console.log(`\n  Re-run supabase/diagnostics/series_health.sql to see the result.`);
    if ((rows.some((r) => (r.status || INSERT_STATUS) === 'unreviewed'))) {
      console.log(`  Inserts are 'unreviewed' and will NOT appear on the series page until oracleBatch.mjs runs.`);
    }
  }
  console.log('');
}

// -- Go -----------------------------------------------------------------------
(PROPOSE ? propose() : apply()).catch((e) => {
  console.error(`\n  FAILED: ${e.message}\n`);
  process.exit(1);
});
