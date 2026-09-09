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
// Rows left blank are not applied — an unreviewed file is a no-op, which is the
// safe default when the failure mode is silently inventing books in someone
// else's library.
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
//   --all-short           propose for EVERY series with a total_books, not just
//                         the ranked list below. Much slower.
//   --limit N             at most N series (propose) or N rows (apply)
//   --min-confidence N    below this a proposal is written with approve blank
//                         rather than pre-filled 'y'. Default 80.
//   --status S            status for INSERTED books. Default 'unreviewed'.
//                         See "THE STATUS DECISION" below.
//   --show-rejected       also write the candidates the filters threw out, as
//                         action=rejected rows. Never approvable; for auditing
//                         the filters when a volume you expected is missing.
//   --dry-run             with --apply: print every write, perform none
//   --verbose
//
// WHAT HARDCOVER ACTUALLY RETURNS  (the 2026-09-08 lesson)
// --------------------------------------------------------
// The first version of this script asked Hardcover for a series' book_series
// entries, filtered to `position <= primary_books_count`, and proposed every one
// that sat at a position we did not hold. For Crescent City — a THREE book
// series — that produced twenty proposals, fifteen of them pre-approved at
// confidence 100:
//
//   position 1    House of Earth and Blood            (x4, four editions)
//                 House of Earth and Blood, House of Sky and Breath   (omnibus)
//                 Crescent City ebook Bundle: A 3 Book Bundle  (4,379 pages)
//                 Crescent City Bundle: A 2-book bundle
//                 Crescent City Hardcover Box Set
//                 Dom Ziemi i Krwi                    (Polish translation)
//                 Toprak ve Kan Hanesi                (Turkish, credited to its
//                                                      translator)
//   position 1.1  House of Earth and Blood, Part 1 of 2
//   position 1.2  House of Earth and Blood, Part 2 of 2
//   position 3    Huis van vuur & schaduw             (Dutch translation)
//                 House of Flame and Shadow           (the actual volume)
//
// Applying it would have put eight junk rows into a three-book series, and
// series_volumes would then have picked ONE of them per position by its own
// preference order — most likely the 4,379-page ebook bundle, on page count.
// The catalog would have been worse than when it started.
//
// A "book" in Hardcover's book_series is not a volume. It is a work record, and
// translations, omnibuses, box sets and split-volume editions all get their own,
// all attached to the series, often all at the same position. So the useful
// output of a propose pass is not "everything upstream has" — it is ONE
// candidate per missing position, or an honest admission that there are several
// and a human has to choose.
//
// FOUR FILTERS, THEN A CHOICE
// ---------------------------
//   1. Integer positions only. 1.1 and 2.2 are split editions of one volume.
//   2. Bundle/box-set/omnibus titles out, by pattern.
//   3. Omnibus by containment: a title that contains another candidate's whole
//      title is a collection of it. Catches "House of Earth and Blood, House of
//      Sky and Breath" without needing it to say "omnibus".
//   4. Page-count outliers out: more than 1.6x the median of the candidates at
//      that position is a collection, whatever it calls itself.
//
// Then candidates are deduped by normalised title — four editions of "House of
// Earth and Blood" are one candidate, keeping the edition with a cover and a
// page count — and grouped by position.
//
// **A position with more than one surviving candidate is never pre-approved.**
// That is the rule the first version was missing. Translations cannot be told
// from originals with the fields this script can safely query (Hardcover's
// language lives on editions, and guessing at a field name would 400 the whole
// query — see hcGql), so where the choice is real, the CSV states it and a
// person makes it. `candidates` says how many; `notes` says what they are.
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
// If you decide Hardcover's metadata is good enough on its own, `--status
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
// time.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { candidatesByPosition } from '../_shared/seriesCandidates.mjs';

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
const SHOW_REJECTED = args.includes('--show-rejected');

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
// The language this CATALOG is written in — not a claim about the work. The
// Books Oracle holds English titles for Japanese works (Ring, Love Hina, the
// JoJo volumes), so 'eng' is right there even though it is not the original
// language. `none` turns the filter off and leaves the bundle heuristic alone.
const PREFER_LANGUAGE = strArg('--prefer-language', 'eng');

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

// COLLECTION_RE and candidatesByPosition live in _shared/seriesCandidates.mjs.
// They are the half of this script that got Crescent City wrong, they are pure,
// and tests/series-candidates.test.js pins them to the exact API payload that
// broke — which a function defined inside a CLI script cannot be.

// -- Hardcover ----------------------------------------------------------------
// The probe on 2026-09-09 hit "API rate limit exceeded for tier 'Free'" after
// about eight requests in quick succession, which left six of its ten
// candidates untested. 55/min was read off nothing; 20 is a guess with evidence
// behind it. hcGql already sleeps a full minute on a 429, so the cost of being
// wrong is slow rather than broken.
const RATE_LIMIT = 20, WINDOW_MS = 60_000, requestTimes = [];
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
//
// It is also why the GraphQL selection below is limited to the fields
// src/lib/hardcoverService.js already proves exist. Asking for a `language` to
// filter translations would be useful and would 400 the entire query if the
// field is named something else — and there is no way to check from here.
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

// Language, by a ladder rather than a guess.
//
// The probe (batch-scripts/probes/probeHardcoverLanguage.mjs, run 2026-09-09)
// settled where language lives: NOT on `books` — that type has no language
// field at all — but on `editions`, which carries both `language : languages`
// and `language_id : Int`. `books` reaches editions through `editions` and
// through `default_physical_edition` / `default_ebook_edition` /
// `default_audio_edition`.
//
// It proved `editions { id language_id }` works and returns real values (14 of
// 25 books, 5 distinct). It could NOT test `language { code3 }`, because
// Hardcover's free tier started answering 429 half way through the run. So the
// nicer, self-describing selection is plausible and unproven, and an unproven
// field name is not a small risk here: Hasura rejects the whole query, so a
// wrong guess costs the entire series list rather than one column.
//
// Hence a ladder. Try the best selection, and on a GraphQL field error drop to
// the next. Whichever rung works is remembered for the rest of the run, so this
// costs one wasted request per process, not one per series.
const LANGUAGE_RUNGS = [
  {
    key: 'code3',
    selection: 'editions(limit: 3) { id language { code3 } }',
    read: (b) => (b.editions || []).map((e) => e?.language?.code3).find(Boolean) ?? null,
    want: (pref) => pref,
  },
  {
    key: 'language_id',
    selection: 'editions(limit: 3) { id language_id }',
    // 1 is English. Evidence, from the probe's per-book output: every title
    // carrying id 1 was English (House of Earth and Blood, House of Sky and
    // Breath, and the English bundles), while the Turkish editions came back
    // 168, the Portuguese 130 and a Polish one 129. An inference from one
    // series, so it is named and sourced rather than inlined as a magic number.
    read: (b) => (b.editions || []).map((e) => e?.language_id).find((v) => v != null) ?? null,
    want: (pref) => (pref === 'eng' ? 1 : null),
  },
  { key: 'none', selection: '', read: () => null, want: () => null },
];
let languageRung = null; // resolved on the first series, then reused

const seriesQuery = (languageSelection) => `query GetSeries($id: Int!) {
  series(where: { id: { _eq: $id } }, limit: 1) {
    id name books_count primary_books_count
    book_series(order_by: { position: asc }) {
      position
      book {
        id title pages description
        image { url }
        contributions { author { name } }
        ${languageSelection}
      }
    }
  }
}`;

// Every candidate Hardcover attaches to the series, unfiltered except for the
// primary_books_count ceiling. Filtering happens in candidatesByPosition() so
// the reasons are visible and testable rather than buried in the fetch.
async function hcSeriesCandidates(name) {
  const search = await hcGql(
    `query S($q: String!, $type: String!) { search(query: $q, query_type: $type, per_page: 5, page: 1) { results } }`,
    { q: name, type: 'Series' }
  );
  const hits = search?.search?.results?.hits || search?.search?.results?.results || [];
  if (!hits.length) return { name: null, candidates: [], total: null };

  const want = normSeries(name);
  let best = null, bestScore = -1;
  for (const h of hits) {
    const doc = h.document || h;
    const got = normSeries(doc?.name);
    const score = got === want ? 2 : (got && (got.includes(want) || want.includes(got))) ? 1 : 0;
    if (score > bestScore) { bestScore = score; best = doc; }
  }
  if (!best?.id) return { name: null, candidates: [], total: null };
  const id = typeof best.id === 'string' ? parseInt(best.id, 10) : best.id;

  // Walk the ladder until something answers. A field error is the only thing
  // worth stepping down for — a 429 or a network failure is hcGql's problem and
  // it throws, which must stay loud rather than silently costing us language.
  let data = null;
  const rungs = languageRung ? [languageRung] : LANGUAGE_RUNGS;
  for (const rung of rungs) {
    try {
      data = await hcGql(seriesQuery(rung.selection), { id });
      if (!languageRung) {
        languageRung = rung;
        if (rung.key === 'none') console.log('    (no usable language field — falling back to title signals alone)');
        else vlog(`language via ${rung.key}`);
      }
      break;
    } catch (e) {
      const isFieldError = /not found in type|Cannot query field|unknown field|field '[^']+' not found/i.test(e.message);
      if (!isFieldError || rung.key === 'none') throw e;
      vlog(`language rung "${rung.key}" rejected: ${e.message.slice(0, 80)}`);
    }
  }

  const s2 = data?.series?.[0];
  if (!s2?.book_series) return { name: null, candidates: [], total: null };

  const primaryTotal = s2.primary_books_count || null;
  const wanted = languageRung.want(PREFER_LANGUAGE === 'none' ? null : PREFER_LANGUAGE);
  return {
    name: s2.name || best.name || null,
    total: primaryTotal,
    wantLanguage: PREFER_LANGUAGE === 'none' ? null : wanted,
    candidates: s2.book_series
      .filter((bs) => bs.position != null && (primaryTotal == null || bs.position <= primaryTotal))
      .map((bs) => {
        const b = bs.book || {};
        // EVERY contribution, not the first. Hardcover's contributions are not
        // author-first: the English "House of Sky and Breath" comes back
        // credited to Elizabeth Evans, who narrates the audiobook. Reading only
        // [0] threw the real volume out as a translation.
        const authors = (b.contributions || [])
          .map((c) => (c?.author?.name || '').trim())
          .filter(Boolean);
        return {
          position: Number(bs.position),
          hardcoverId: b.id ?? null,
          // Trimmed: Hardcover has titles with leading and trailing spaces, and
          // an untrimmed title becomes an untrimmed normalized_key — a
          // permanent identity with a space in it.
          title: (b.title || '').trim(),
          authors,
          author: authors[0] || '',
          language: languageRung.read(b),
          pages: b.pages ?? null,
          description: b.description || '',
          coverUrl: b.image?.url || '',
        };
      })
      .filter((v) => v.title),
  };
}

// -- CSV ----------------------------------------------------------------------
const COLUMNS = [
  'approve', 'action', 'series_name', 'position', 'candidates', 'title', 'author',
  // `language` is what the API reported, blank when it reported nothing. It is
  // in the file because it is now the difference between a pre-approved row and
  // one that needs a look, and a reviewer cannot check a decision whose
  // evidence is not on the page.
  'language', 'pages', 'status', 'confidence', 'notes', 'book_id', 'series_id',
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
  let seriesDone = 0;

  for (const [name] of targets) {
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

    const heldByPos = new Set(
      (held || []).filter((b) => b.position_in_series != null).map((b) => Number(b.position_in_series))
    );
    const heldTitles = new Set((held || []).map((b) => normTitle(b.title)));
    const heldAuthors = new Set((held || []).map((b) => normTitle(b.author)).filter(Boolean));

    let hc;
    try { hc = await hcSeriesCandidates(name); }
    catch (e) { console.log(`    ! hardcover: ${e.message} — skipped, nothing proposed`); continue; }
    if (!hc.candidates.length) { console.log('    ! hardcover has no volume list — skipped'); continue; }

    // THE CORROBORATION GUARD. Our `Wicked` is Janet Evanovich's. A mismatch
    // does not skip the series — the rows are still written so the mismatch is
    // visible in the review file — but every one lands at confidence 0.
    const nameMatches = normSeries(hc.name) === normSeries(srow.name);
    if (!nameMatches) {
      console.log(`    ! hardcover calls this "${hc.name}", ours is "${srow.name}" — nothing will be pre-approved`);
    }

    // The held authors go in so the module can drop translations credited to
    // their translator. Real names, not normalised — it does its own.
    const heldAuthorNames = [...new Set((held || []).map((b) => b.author).filter(Boolean))];
    const { byPosition, rejected } = candidatesByPosition(hc.candidates, {
      seriesAuthors: heldAuthorNames,
      wantLanguage: hc.wantLanguage ?? null,
    });
    let proposed = 0, open = 0;

    for (const [position, list] of [...byPosition.entries()].sort((a, b) => a[0] - b[0])) {
      if (heldByPos.has(position)) continue;
      if (!list.length) continue;

      for (const v of list) {
        const key = bookKey(v.title, v.author);
        const { data: found, error: fErr } = await supabase
          .rpc('find_book_by_client_key', { _key: key });
        if (fErr) vlog(`lookup failed for ${v.title}: ${fErr.message}`);
        const existing = Array.isArray(found) ? found[0] : found;

        let action, notes = [], bookId = '';
        if (existing?.id) {
          bookId = existing.id;
          if (!existing.series_id) { action = 'link'; notes.push('already in the catalog, unlinked'); }
          else if (existing.series_id === srow.id) { action = 'set-position'; notes.push('in this series, no position'); }
          else { action = 'skip'; notes.push(`belongs to a different series (${existing.series_id})`); }
        } else if (heldTitles.has(normTitle(v.title))) {
          action = 'skip'; notes.push('this title is already in the series');
        } else {
          action = 'insert';
        }

        let confidence = 100;
        if (!nameMatches) { confidence = 0; notes.push('series name does not match ours'); }
        if (heldAuthors.size && v.author && !heldAuthors.has(normTitle(v.author))) {
          confidence -= 40; notes.push(`author "${v.author}" differs from the series — often a translator`);
        }
        if (!v.author) { confidence -= 20; notes.push('no author'); }
        if (normTitle(v.title).length < 3) { confidence -= 40; notes.push('title too short'); }
        if (srow.total_books && position > srow.total_books) {
          confidence -= 20; notes.push(`beyond total_books (${srow.total_books})`);
        }
        confidence = Math.max(0, confidence);

        // THE RULE THE FIRST VERSION WAS MISSING.
        //
        // More than one candidate at a position is a real choice — an original
        // and its translations, most often — and this script cannot make it
        // from the fields it can safely query. So it states the choice and
        // pre-approves nothing. One candidate, high confidence, and a real
        // action is the only combination that gets a 'y'.
        // `pick` is the module's answer to "which of these is the original":
        // a lone candidate, or the one the series' own collection editions
        // quote. Everything else at the position stays in the file as a
        // visible, unapproved alternative rather than being deleted — the
        // signal is good, and it is still a signal.
        // Say which signal decided, not which signals exist. The 25-series run
        // produced "chosen over 1 other candidate(s) — quoted in 0 collection
        // edition(s)", which reads as a reason and is the absence of one: the
        // language had picked it and the note described the wrong test.
        if (v.pickReason) notes.push(v.pick ? `chosen: ${v.pickReason}` : v.pickReason);
        if (list.length > 1 && !v.pick) {
          notes.push(`alternative at position ${position} — approve this instead only if the chosen one is wrong`);
        }

        // Two positions that Hardcover uses for things that are not volumes,
        // and that the run got wrong in both directions:
        //
        //   position 0          prequels, omnibuses and oddities. Dragonlance
        //                       had five, Hellboy five Italian editions, and
        //                       The Witcher's was a French box set.
        //   beyond total_books  Red God at 7 of 6, The Second Generation at 4
        //                       of 3 — a different sub-series entirely.
        //
        // Both were confidence penalties that landed on exactly 80 and sailed
        // through a >= 80 threshold. A penalty that still passes is not a
        // guard, so these now disqualify the pre-approval outright and leave
        // the row for review.
        const structurallyOdd =
          position === 0 || (srow.total_books && position > srow.total_books);
        if (structurallyOdd && v.pick) notes.push('not pre-approved: unusual position for a volume');

        const preApprove =
          action !== 'skip' && v.pick && !structurallyOdd && confidence >= MIN_CONFIDENCE;

        out.push({
          approve: preApprove ? 'y' : '',
          action,
          series_name: srow.name,
          position,
          candidates: list.length,
          title: v.title,
          author: (v.authors || [v.author]).filter(Boolean).join(' / '),
          language: v.language ?? '',
          pages: v.pages ?? '',
          status: action === 'insert' ? INSERT_STATUS : '',
          confidence,
          notes: notes.join('; '),
          book_id: bookId,
          series_id: srow.id,
          hardcover_id: v.hardcoverId ?? '',
          cover_url: v.coverUrl,
        });
        proposed++;
      }
      if (!list.some((c) => c.pick)) open++;
    }

    // What the series already has. Informational, never approvable — but
    // without it the CSV shows a proposal for 1 and 3 and simply says nothing
    // about 2, which reads like the volume went missing rather than like it is
    // the one book we hold.
    if (proposed) {
      for (const b of (held || []).slice().sort((x, y) => (x.position_in_series ?? 999) - (y.position_in_series ?? 999))) {
        out.push({
          approve: '', action: 'held', series_name: srow.name,
          position: b.position_in_series ?? '', candidates: '', title: b.title,
          author: b.author || '', language: '', pages: '', status: b.status, confidence: '',
          notes: 'already in the catalog — nothing to do', book_id: b.id,
          series_id: srow.id, hardcover_id: '', cover_url: '',
        });
      }
    }

    if (SHOW_REJECTED) {
      for (const r of rejected) {
        out.push({
          approve: '', action: 'rejected', series_name: srow.name, position: r.position,
          candidates: '', title: r.title, author: (r.authors || [r.author]).filter(Boolean).join(' / '),
          language: r.language ?? '', pages: r.pages ?? '',
          status: '', confidence: 0, notes: r.reason, book_id: '', series_id: srow.id,
          hardcover_id: r.hardcoverId ?? '', cover_url: '',
        });
      }
    }

    seriesDone++;
    console.log(
      `    holds ${(held || []).length}` +
      `${srow.total_books ? ` of ${srow.total_books}` : ''}` +
      ` · hardcover offered ${hc.candidates.length}, ${rejected.length} filtered out` +
      ` → ${proposed} proposed${open ? `, ${open} position(s) still need a choice` : ''}`
    );
  }

  const body = out.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  writeFileSync(CSV_PATH, COLUMNS.join(',') + '\n' + body + '\n');

  const approvable = out.filter((r) => r.approve === 'y').length;
  const applicable = out.filter((r) => r.action !== 'rejected');
  console.log(`\n  ${applicable.length} proposals across ${seriesDone} series — ${approvable} pre-approved, ${applicable.length - approvable} need a decision.`);
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
const APPLICABLE = new Set(['insert', 'link', 'set-position']);

async function apply() {
  if (!existsSync(APPLY_FILE)) { console.error(`No such file: ${APPLY_FILE}`); process.exit(1); }
  const all = parseCsv(readFileSync(APPLY_FILE, 'utf8'));
  let rows = all.filter((r) => APPROVED.has((r.approve || '').toLowerCase()) && APPLICABLE.has(r.action));
  if (LIMIT) rows = rows.slice(0, LIMIT);

  console.log(`\n  ${APPLY_FILE}`);
  console.log(`  ${all.length} rows, ${rows.length} approved and applicable.${DRY_RUN ? '  DRY RUN — nothing will be written.' : ''}\n`);
  if (!rows.length) { console.log('  Nothing to do. Set `approve` to y on the rows you want.\n'); return; }

  // An approved position with two approved candidates is a review mistake, and
  // it would put both into the series at the same position — the exact shape
  // series_volumes exists to paper over. Refuse rather than half-apply.
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.series_id}::${r.position}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(r.title);
  }
  const clashes = [...seen.entries()].filter(([, t]) => t.length > 1);
  if (clashes.length) {
    console.error('  Two or more approved rows share a position. Approve one per position:\n');
    for (const [k, titles] of clashes) console.error(`    position ${k.split('::')[1]}: ${titles.join(' | ')}`);
    console.error('');
    process.exit(1);
  }

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
      }
    } catch (e) {
      console.log(`  ! ${label}: ${e.message}`);
      counts.failed++;
    }
  }

  console.log(`\n  inserted ${counts.insert}, linked ${counts.link}, positioned ${counts['set-position']}, skipped ${counts.skipped}, failed ${counts.failed}`);
  if (!DRY_RUN) {
    console.log(`\n  Re-run supabase/diagnostics/series_health.sql to see the result.`);
    if (rows.some((r) => (r.status || INSERT_STATUS) === 'unreviewed')) {
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
