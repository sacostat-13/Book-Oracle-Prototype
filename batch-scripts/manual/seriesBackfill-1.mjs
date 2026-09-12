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
//                  (One exception, and only with --stale: the queue stamps
//                  volumes_checked_at and clears volumes_stale on the series it
//                  examined. That is bookkeeping about the LOOK, not a change
//                  to the catalog, and plain --propose still writes nothing.)
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
//   --stale               THE QUEUE. Propose for series series_completeness
//                         reports as needs_check, never-looked-at first, and
//                         stamp each one as looked at. This is the flag a
//                         schedule uses; see "THE QUEUE" below.
//   --limit N             at most N series (propose) or N rows (apply)
//   --min-confidence N    below this a proposal is written with approve blank
//                         rather than pre-filled 'y'. Default 80.
//   --status S            status for INSERTED books. Default 'unreviewed'.
//                         See "THE STATUS DECISION" below.
// ACTIONS IN THE CSV
//   insert         a volume Hardcover has and we do not
//   link           a book already in the catalog, attached to this series
//   set-position   a book in this series given a number -- OR one of ours moved
//                  to the number Hardcover uses, when that slot is free
//   unnumber       one of ours whose position is removed, because Hardcover
//                  does not list it in this series at all. The book stays; only
//                  the number goes. This is what lets a blocked position be
//                  filled by the volume that belongs in it.
//   mismatch       a disagreement neither of the above can safely fix
//   held           already in the catalog, informational
//   rejected       filtered out, informational (--show-rejected)
//   unresolved     nothing could be proposed, and why
//
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

// THE QUEUE  (--stale)
// -------------------
// The hardcoded TOP_SERIES list below is a snapshot of one Search Console
// export. It was the right way to start -- it put the first pass where the
// impressions were -- and it is the wrong way to continue, because it cannot
// learn that a series got worse and it will still be listing the same 25 names
// a year from now.
//
//   --stale  targets whatever series_completeness says needs_check: a series
//            whose books changed since it was last examined, or that has never
//            been examined at all. A trigger on `books` sets the flag, so the
//            queue fills itself from ordinary catalog activity -- somebody
//            adding a book, the curation pass flipping a status, an --apply
//            from this very script.
//
// NEVER-CHECKED FIRST, and not by staleness.
//
// The 2026-09-09 description pass is the argument. The descriptions that read
// worst were not on stale series; they were on series that entered the catalog
// at position 3 with no total_books and were never looked at again -- Tiffany
// Aching, Hyperion Cantos, The Witcher, Lockwood & Co. A series' FIRST look is
// worth more than any later one, because that is when the three facts
// everything downstream depends on get established: does it start at 1, how
// long is it, who wrote it. It is also the cheapest look, because there is
// nothing to reconcile yet.
//
// So: never-checked, then demand, then size. And a stamp either way -- a series
// that was examined and could not be completed leaves the queue, because
// detection is series_completeness's job and re-queueing a known gap forever
// only hides the ones that are new.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { candidatesByPosition, rankSeriesHits, normSeries, languagesOf, splitAuthors, cleanTitle } from '../_shared/seriesCandidates.mjs';

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
const STALE = args.includes('--stale');
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

// normSeries now comes from _shared/seriesCandidates.mjs — it was a fourth copy
// of a rule this codebase has already been bitten by duplicating.
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
//
// THREE EDITIONS WAS THE BUG.  (Malazan, 2026-09-09)
// ---------------------------------------------------
// Each rung used to ask for `editions(limit: 3)` and take the FIRST language it
// found there, as though a work had one. It does not: Hardcover hangs every
// edition of a work off the same record, and `limit: 3` with no order takes an
// arbitrary three of them. Gardens of the Moon came back `spa`. Deadhouse
// Gates `spa`. Dust of Dreams `ita`. Eight of Malazan's ten English volumes
// were deleted as translations, and the actual translations, now unopposed at
// their positions, were proposed in their place.
//
// So: read MANY editions, keep them ALL, and return a set. The filter's
// question changes with it, from "what language is this" — unanswerable — to
// "does this have an edition in ours", which a set can answer honestly and
// which is the thing we actually need to know.
//
// EDITION_SAMPLE is a sample and not a census: a work with more editions than
// this can still hide its English one, and the failure is then the old failure
// in miniature. 40 covers every volume in the series that exposed this. It is
// one nested selection on a query that already runs once per series, so the
// cost is payload, not requests.
const EDITION_SAMPLE = 40;

const LANGUAGE_RUNGS = [
  {
    // Defaults FIRST. default_physical_edition is Hardcover's own answer to
    // "which edition is this work, really", so a work whose default is English
    // is English even if the sample below is all translations. Unproven field
    // path, which is exactly why it is its own rung: if Hasura rejects it, the
    // ladder drops to the proven `editions` selection instead of losing code3
    // altogether.
    key: 'code3+default',
    selection:
      `editions(limit: ${EDITION_SAMPLE}) { id language { code3 } } ` +
      'default_physical_edition { language { code3 } } ' +
      'default_ebook_edition { language { code3 } }',
    read: (b) => [
      b.default_physical_edition?.language?.code3,
      b.default_ebook_edition?.language?.code3,
      ...(b.editions || []).map((e) => e?.language?.code3),
    ].filter(Boolean),
    want: (pref) => pref,
  },
  {
    key: 'code3',
    selection: `editions(limit: ${EDITION_SAMPLE}) { id language { code3 } }`,
    read: (b) => (b.editions || []).map((e) => e?.language?.code3).filter(Boolean),
    want: (pref) => pref,
  },
  {
    key: 'language_id',
    selection: `editions(limit: ${EDITION_SAMPLE}) { id language_id }`,
    // 1 is English. Evidence, from the probe's per-book output: every title
    // carrying id 1 was English (House of Earth and Blood, House of Sky and
    // Breath, and the English bundles), while the Turkish editions came back
    // 168, the Portuguese 130 and a Polish one 129. An inference from one
    // series, so it is named and sourced rather than inlined as a magic number.
    read: (b) => (b.editions || []).map((e) => e?.language_id).filter((v) => v != null),
    want: (pref) => (pref === 'eng' ? 1 : null),
  },
  { key: 'none', selection: '', read: () => [], want: () => null },
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
    `query S($q: String!, $type: String!) { search(query: $q, query_type: $type, per_page: 8, page: 1) { results } }`,
    { q: name, type: 'Series' }
  );
  const hits = search?.search?.results?.hits || search?.search?.results?.results || [];
  if (!hits.length) return { ok: false, reason: 'Hardcover search returned no series at all', candidates: [] };

  const { ranked, nearMisses } = rankSeriesHits(hits, name);
  if (!ranked.length) {
    return {
      ok: false,
      reason: nearMisses.length
        ? `no hit matched "${name}" — Hardcover offered: ${nearMisses.join(' | ')}`
        : `no hit matched "${name}"`,
      nearMisses,
      candidates: [],
    };
  }

  // Fetch one series by id, walking the language ladder. A field error is the
  // only thing worth stepping down for — a 429 or a network failure is hcGql's
  // problem and it throws, which must stay loud rather than silently costing us
  // the language.
  async function fetchSeries(id) {
    const rungs = languageRung ? [languageRung] : LANGUAGE_RUNGS;
    for (const rung of rungs) {
      try {
        const data = await hcGql(seriesQuery(rung.selection), { id });
        if (!languageRung) {
          languageRung = rung;
          if (rung.key === 'none') console.log('    (no usable language field — falling back to title signals alone)');
          else vlog(`language via ${rung.key}`);
        }
        return data;
      } catch (e) {
        const isFieldError = /not found in type|Cannot query field|unknown field|field '[^']+' not found/i.test(e.message);
        if (!isFieldError || rung.key === 'none') throw e;
        vlog(`language rung "${rung.key}" rejected: ${e.message.slice(0, 80)}`);
      }
    }
    return null;
  }

  // WALK THE HITS, DO NOT STOP AT THE FIRST.
  //
  // An exact name match to an EMPTY Hardcover record beat a containing match to
  // the populated one, and the run said "0 entries" as though Hardcover had
  // never heard of the series. A name is not an identifier there: several
  // series records share a title and the useful one is whichever has books.
  //
  // Costs an extra request only when a record turns out to be a stub, and only
  // up to MAX_HITS of them — so a series that resolves first time is unchanged.
  const MAX_HITS = 4;
  let s2 = null, best = null, exact = false;
  const skipped = [];
  for (const cand of ranked.slice(0, MAX_HITS)) {
    const id = typeof cand.id === 'string' ? parseInt(cand.id, 10) : cand.id;
    const data = await fetchSeries(id);
    const row = data?.series?.[0];
    const positioned = (row?.book_series || []).filter((bs) => bs.position != null);
    if (!positioned.length) {
      skipped.push(`"${cand.name}" (${(row?.book_series || []).length} entries, none positioned)`);
      continue;
    }
    s2 = row; best = cand; exact = cand.exact;
    break;
  }
  if (!s2) {
    return {
      ok: false,
      reason: `no Hardcover series under this name has positioned books — tried ${skipped.join(', ')}`,
      candidates: [],
    };
  }
  if (skipped.length) vlog(`skipped empty Hardcover records: ${skipped.join(', ')}`);

  const primaryTotal = s2.primary_books_count || null;
  const wanted = languageRung.want(PREFER_LANGUAGE === 'none' ? null : PREFER_LANGUAGE);
  return {
    ok: true,
    exact,
    name: s2.name || best.name || null,
    total: primaryTotal,
    offered: s2.book_series.length,
    skipped,
    wantLanguage: PREFER_LANGUAGE === 'none' ? null : wanted,
    // NO primary_books_count CEILING.
    //
    // It used to drop everything above primary_books_count here, silently and
    // before any filter could report it — so --show-rejected could not show
    // what it removed. The Bloodsworn Saga run on 2026-09-09 said "hardcover
    // offered 1, 1 filtered out" for a three-book series holding two: the
    // volumes were gone before the filters ever saw them, and the one thing
    // that survived was the boxed set.
    //
    // The ceiling was inherited from hardcoverService.js, where it keeps
    // novellas out of a DISPLAY list and a wrong answer costs a stray row on a
    // page. Here a wrong answer costs a volume nobody knows is missing. The
    // structural guard added in 4815532 already refuses to pre-approve anything
    // beyond total_books, so an over-long list is now reviewed rather than
    // trusted — which is the right shape for a doubt.
    candidates: s2.book_series
      .filter((bs) => bs.position != null)
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
          languages: [...new Set(languageRung.read(b))],
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
  // `language` is EVERY language the API reported editions in, space separated,
  // and blank when it reported none. Not one language — a work has editions in
  // several, and the 2026-09-09 Malazan run deleted eight English volumes
  // because this column used to hold whichever one came back first. It is in
  // the file because it is the difference between a pre-approved row and one
  // that needs a look, and a reviewer cannot check a decision whose evidence is
  // not on the page.
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
  } else if (STALE) {
    const { data, error } = await supabase
      .from('series_completeness')
      .select('series_id,name,held,total_books,volumes_owed,gap_count,volumes_checked_at,needs_check')
      .eq('needs_check', true);
    if (error) throw new Error(`queue read failed: ${error.message}`);

    // SETTLE WHAT SQL CAN SETTLE, BEFORE SPENDING A REQUEST ON IT.
    //
    // THE BUG THIS EXISTS FOR: the first --stale run, 2026-09-10. Every row
    // starts volumes_stale = true, so volumes_checked_at is null everywhere and
    // "never checked first" cannot separate a genuinely new series from one
    // finished on Tuesday. The tiebreak fell through to the demand rank, which
    // IS the TOP_SERIES list, so the queue's opening move was to re-walk the
    // exact 25 series that had just been reviewed by hand:
    //
    //   Crescent City   holds 3 of 3 · offered 29, 17 filtered → 0 proposed
    //   Fablehaven      holds 5 of 5 · offered  9,  0 filtered → 0 proposed
    //
    // Two API calls each to be told what the database already knew. A series
    // that holds everything it claims, with no gap below its highest volume,
    // has nothing an upstream lookup can add — so it is stamped as examined
    // here, for free, and never reaches Hardcover.
    //
    // This trusts total_books, which is exactly as reliable as whoever curated
    // it: a series claiming 3 that really has 5 settles wrongly and goes quiet.
    // That is the same doubt the pre-approval guard already lives with, it is
    // visible in series_completeness either way, and any book landing in the
    // series puts it straight back in the queue. `--series "Name"` overrides it
    // outright.
    const isSettled = (r) =>
      r.total_books != null && r.volumes_owed == null && Number(r.gap_count) === 0;

    const rows = data || [];
    const settled = rows.filter(isSettled);
    const pending = rows.filter((r) => !isSettled(r));

    if (settled.length && !DRY_RUN) {
      const at = new Date().toISOString();
      for (let i = 0; i < settled.length; i += 50) {
        const chunk = settled.slice(i, i + 50).map((r) => r.series_id);
        const { error: sErr } = await supabase
          .from('series')
          .update({ volumes_checked_at: at, volumes_stale: false })
          .in('id', chunk);
        if (sErr) console.log(`  ! settling failed for ${chunk.length} series: ${sErr.message}`);
      }
    }
    if (settled.length) {
      console.log(
        `\n  ${settled.length} series hold everything they claim — ` +
        `${DRY_RUN ? 'would be settled' : 'settled'} without a request.`
      );
    }

    // Demand, as far as anything here knows it. TOP_SERIES is a fixed snapshot
    // of one GSC export and a poor long-term signal -- when series_demand
    // exists, order by that instead and delete this. Its rank is used only to
    // sort a queue, never to decide what enters one.
    const rank = new Map(TOP_SERIES.map(([n], i) => [normSeries(n), i]));
    targets = pending
      .sort((a, b) =>
        // 1. Never looked at.
        (Number(a.volumes_checked_at != null) - Number(b.volumes_checked_at != null)) ||
        // 2. Then whatever we know about demand.
        ((rank.get(normSeries(a.name)) ?? 999) - (rank.get(normSeries(b.name)) ?? 999)) ||
        // 3. Then the bigger shelf, as a proxy for a series someone cares about.
        (b.held - a.held))
      .map((r) => [r.name, r.series_id]);

    const fresh = pending.filter((r) => r.volumes_checked_at == null).length;
    console.log(`  Queue: ${targets.length} series need a look — ${fresh} never examined.`);
    if (!targets.length) {
      console.log('  Nothing due. (If that is a surprise, check that the books trigger exists:');
      console.log("   select tgname from pg_trigger where tgrelid = 'public.books'::regclass;)\n");
      return;
    }
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
  // Series we reached a verdict on, to be stamped as examined. ONLY under
  // --stale: plain --propose keeps its no-writes guarantee, which is worth more
  // than the convenience of stamping every path.
  const examined = [];
  // ...and of those, the ones that left NOTHING for a human to do. Only these
  // clear volumes_stale; see the stamping block at the foot of propose() for
  // the batch this distinction cost.
  const settled = [];

  for (const [name, queuedId] of targets) {
    process.stdout.write(`  ${name}\n`);

    const { data: srow, error: sErr } = await supabase
      .from('series').select('id,name,total_books')
      .eq('normalized_name', normSeries(name)).maybeSingle();
    if (sErr) { console.log(`    ! series lookup failed: ${sErr.message}`); continue; }
    if (!srow) { console.log('    ! not in the catalog — skipped'); continue; }

    // THE QUEUE ROW THAT CANNOT FIND ITSELF.
    //
    // THE BUG THIS EXISTS FOR: the 2026-09-10 batch ran The Bloodsworn Saga and
    // The Locked Tomb TWICE each. Both have a twin among the 38 rows whose
    // normalized_name was written under the older rule and keeps its leading
    // "the" — and the lookup above resolves by normalized_name, so BOTH queue
    // entries land on the correctly-keyed row and it gets worked twice.
    //
    // Worse than the wasted requests: `examined` collects srow.id, so the
    // mis-keyed row is never stamped and comes back in every future pass. A
    // silent infinite loop, once per affected series.
    //
    // Skip it, stamp it so it leaves the queue, and NAME it in the file. The
    // queue then becomes the thing that finds these rows rather than the thing
    // that trips over them.
    if (queuedId && srow.id !== queuedId) {
      examined.push(queuedId);
      out.push({
        approve: '', action: 'unresolved', series_name: srow.name, position: '',
        candidates: '', title: '', author: '', language: '', pages: '', status: '',
        confidence: 0,
        notes: `series row ${queuedId} is unreachable by its own normalized_name — ` +
               `"${srow.name}" resolves to ${srow.id} instead. These two rows are the same series ` +
               `and need merging; whatever volumes ${queuedId} holds are invisible to the app.`,
        book_id: '', series_id: queuedId, hardcover_id: '', cover_url: '',
      });
      console.log(`    ! unreachable duplicate row (${queuedId}) — skipped, needs merging`);
      continue;
    }

    const { data: held, error: hErr } = await supabase
      .from('series_volumes').select('id,title,author,position_in_series,status')
      .eq('series_id', srow.id);
    if (hErr) { console.log(`    ! held lookup failed: ${hErr.message}`); continue; }

    const heldByPos = new Set(
      (held || []).filter((b) => b.position_in_series != null).map((b) => Number(b.position_in_series))
    );
    // What we hold AT each position, not merely that we hold something there.
    const heldAt = new Map(
      (held || []).filter((b) => b.position_in_series != null)
        .map((b) => [Number(b.position_in_series), b])
    );
    // Suffix-stripped. We hold "Fool Moon (The Dresden Files, #2)"; Hardcover
    // calls it "Fool Moon". Comparing them raw makes the same book look like
    // two.
    const heldTitles = new Set((held || []).map((b) => normTitle(cleanTitle(b.title))));
    // The same books, reachable BY TITLE, so a proposal can find out where we
    // already keep this volume rather than assuming we do not keep it at all.
    const heldByTitle = new Map(
      (held || []).map((b) => [normTitle(cleanTitle(b.title)), b])
    );
    // Individual names, not credit lines — see splitAuthors in
    // _shared/seriesCandidates.mjs for the run this cost.
    const heldAuthors = new Set(
      (held || []).flatMap((b) => splitAuthors(b.author)).map(normTitle).filter(Boolean)
    );

    // A series that proposes nothing must SAY WHY, in the file and not only on
    // the console. Three of the twenty-five went quiet on 2026-09-09 and the
    // message was the same for all of them — "hardcover has no volume list" —
    // while the causes were a failed search, a failed name match and a ceiling
    // that ate the volumes. Silence that could mean four things is the
    // empty-result-versus-failure trap wearing a different hat.
    const unresolved = (reason) => {
      console.log(`    ! ${reason}`);
      out.push({
        approve: '', action: 'unresolved', series_name: srow.name, position: '',
        candidates: '', title: '', author: '', language: '', pages: '', status: '',
        confidence: 0, notes: reason, book_id: '', series_id: srow.id,
        hardcover_id: '', cover_url: '',
      });
    };

    let hc;
    try { hc = await hcSeriesCandidates(name); }
    catch (e) {
      // A REQUEST THAT FAILED IS NOT A SERIES WE LOOKED AT. No stamp: it stays
      // in the queue and gets tried again, which is the whole difference
      // between a timeout and an answer.
      unresolved(`hardcover request failed: ${e.message}`); continue;
    }
    // Everything below this line is a VERDICT -- Hardcover answered, even if
    // the answer was "no such series". Those leave the queue: the gap is still
    // reported by series_completeness, and re-queueing a known gap every night
    // buries the ones that are new.
    if (!hc.ok) { examined.push(srow.id); settled.push(srow.id); unresolved(hc.reason); continue; }
    if (!hc.candidates.length) {
      examined.push(srow.id); settled.push(srow.id);
      unresolved(`"${hc.name}" has ${hc.offered} entries on Hardcover, none with a position`);
      continue;
    }
    if (hc.skipped?.length) vlog(`used "${hc.name}" after skipping ${hc.skipped.length} empty record(s)`);
    if (!hc.exact) {
      console.log(`    ~ matched Hardcover's "${hc.name}" by containment, not exactly`);
    }

    // THE CORROBORATION GUARD — how the series resolved, not whether the names
    // are identical.
    //
    // This used to zero the confidence on every row whenever the names differed
    // at all, and it was written when the resolver could return a hit that
    // matched NOTHING — a real risk that needed a blanket guard. It cannot any
    // more: rankSeriesHits refuses a score of 0, so anything that gets here
    // matched by name or by containment.
    //
    // Containment is corroboration, not a failure. Our catalog says "The Icewind
    // Dale" and Hardcover files it as a trilogy; on 2026-09-09 that produced
    // seven correct proposals with every confidence at 0 and nothing
    // pre-approvable. A different spelling of the same series is worth a small
    // doubt, not a veto.
    if (!hc.exact) {
      console.log(`    ~ hardcover calls this "${hc.name}", ours is "${srow.name}" — matched by containment`);
    }

    // WHAT THIS SERIES CLAIMS TO BE, from whoever will say.
    //
    // THE BUG THIS EXISTS FOR: Dungeon Crawler Carl, 2026-09-09. Hardcover
    // attaches "The Beautiful Place" — Matt Dinniman's standalone horror novel,
    // not a DCC volume — to the series at position 9. Right author, right
    // language, sole candidate: every filter here passes it, and it was
    // pre-approved at confidence 100. The one guard that would have caught it,
    // `position > total_books`, sat idle because OUR series row has no
    // total_books, so the only number that could have said "nine is too far"
    // was the one Hardcover had already told us and this script threw away.
    //
    // Ours first, because it is the one a human curated. Hardcover's
    // primary_books_count is a fallback and is unreliable in both directions —
    // Night Lords holds 4 against a claimed 3 — which is why it may only VETO A
    // PRE-APPROVAL and never remove a row. Over-caution here costs a review;
    // under-caution writes a stranger's book into a series page.
    const claimedTotal = srow.total_books ?? hc.total ?? null;
    const maxHeldPosition = heldByPos.size ? Math.max(...heldByPos) : null;
    const claimedSource = srow.total_books ? 'total_books' : "Hardcover's primary_books_count";

    // The held authors go in so the module can drop translations credited to
    // their translator. Real names, not normalised — it does its own.
    const heldAuthorNames = [...new Set((held || []).map((b) => b.author).filter(Boolean))];
    const { byPosition, rejected } = candidatesByPosition(hc.candidates, {
      seriesAuthors: heldAuthorNames,
      wantLanguage: hc.wantLanguage ?? null,
      // An omnibus quotes the volumes it collects, and some of those are ours.
      heldTitles: (held || []).map((b) => b.title).filter(Boolean),
      // So the quotation signal can refuse a candidate named after the series.
      seriesName: srow.name,
    });
    // CAN WE TRUST UPSTREAM ENOUGH TO RESTRUCTURE OUR OWN ROWS?
    //
    // THE BUG THIS EXISTS FOR: the 2026-09-10 queue batch produced FIFTEEN
    // `unnumber` rows and nearly all of them were wrong. It proposed to
    // unnumber Mort (Discworld book four), The Horse and His Boy and The Voyage
    // of the Dawn Treader (both Narnia), Hellblazer: Original Sins (volume one),
    // Overlord Vol. 1. Real volumes, every one.
    //
    // Two distinct causes, and the structural actions have to refuse both.
    //
    // 1. A THIN UPSTREAM LIST PROVES NOTHING. Discworld: "hardcover offered 1"
    //    for a series we hold 24 of. Mort was absent from a list of one, and
    //    absence from a list of one is not evidence. The unnumber rule fires
    //    hardest exactly where the upstream data is worst, which is backwards.
    //
    // 2. TWO LEGITIMATE ORDERS. Narnia is the case. Hardcover files it in
    //    PUBLICATION order (Prince Caspian at 2, The Magician's Nephew at 6);
    //    our catalog is partly CHRONOLOGICAL (Prince Caspian at 4). Neither is
    //    wrong. Reconciling them would renumber the series into Hardcover's
    //    order and quietly destroy an editorial choice — and it would do it
    //    across every reordered series, forever, because the disagreement never
    //    goes away.
    //
    // So: measure the agreement first. If our numbered volumes mostly sit where
    // upstream puts them, upstream is a usable reference for this series and a
    // single disagreement is worth acting on. If they mostly do NOT, the two
    // lists are answering different questions and no per-row fix is safe.
    const heldNumbered = [...heldAt.values()];
    const upstreamAt = new Map();
    for (const c of hc.candidates) {
      const k = normTitle(cleanTitle(c.title));
      if (!upstreamAt.has(k)) upstreamAt.set(k, Number(c.position));
    }
    let agreeCount = 0, movedCount = 0, absentCount = 0;
    for (const b of heldNumbered) {
      const p = upstreamAt.get(normTitle(cleanTitle(b.title)));
      if (p == null) { absentCount++; continue; }
      if (p === Number(b.position_in_series)) agreeCount++; else movedCount++;
    }
    const matchedCount = agreeCount + movedCount;
    // Fewer positioned entries upstream than volumes we hold: a stub record.
    const upstreamThin = hc.candidates.length < heldNumbered.length;
    // Most of what both sides have, in different places: different orderings.
    const ordersDiffer = movedCount >= 2 && movedCount >= agreeCount;

    // ABSENCE IS ONLY EVIDENCE WHERE PRESENCE IS DEMONSTRABLE.
    //
    // THE BUG THIS EXISTS FOR: the second pass at this guard, 2026-09-10. The
    // thin-list and different-order tests correctly refused Discworld, Overlord
    // and JoJo — and Narnia STILL proposed unnumbering The Horse and His Boy
    // and The Voyage of the Dawn Treader, because `ordersDiffer` is computed
    // only over titles that MATCHED. The very matching failures that produce a
    // bad unnumber also hide themselves from a guard that ignores them:
    // Narnia matched 2 of 4 held volumes, of which 1 agreed and 1 had moved, so
    // movedCount never reached 2.
    //
    // Titles are the only join we have, and they are a bad one — "Hellblazer:
    // Original Sins" against Hardcover's "John Constantine, Hellblazer, Vol. 1:
    // Original Sins" is the same book and no normalisation of ours will say so.
    // So before concluding that a volume is ABSENT from upstream, require proof
    // that we can recognise this series' titles at all: several of our own
    // volumes found, and more found than not.
    //
    // Both counts go in the output, because the right threshold is a question
    // about real data and this is how it gets measured rather than guessed.
    const titlesUsable = matchedCount >= 3 && matchedCount >= absentCount;

    const trustStructural = !upstreamThin && !ordersDiffer && titlesUsable;
    if (!trustStructural && heldNumbered.length) {
      unresolved(
        upstreamThin
          ? `Hardcover offered only ${hc.candidates.length} positioned entries against the ${heldNumbered.length} volumes we hold — ` +
            `too thin to conclude anything about our positions, so no repositioning is proposed`
          : ordersDiffer
          ? `our positions and Hardcover's disagree on ${movedCount} of ${matchedCount} shared volumes — ` +
            `these are probably two different orderings (publication vs chronological), not an error. No repositioning is proposed.`
          : `only ${matchedCount} of our ${heldNumbered.length} numbered volumes could be matched to Hardcover by title ` +
            `(${absentCount} not found) — the titles are too different to read an absence as a missing book, ` +
            `so no repositioning is proposed`
      );
    }

    // NOT EVERY HARDCOVER "SERIES" IS MADE OF BOOKS -- AND THIS SCRIPT CANNOT TELL.
    //
    // Hardcore History, 2026-09-10: thirty-six pre-approvals at confidence 100,
    // every one an episode of Dan Carlin's podcast -- "Alexander versus
    // Hitler", "Guns and Horses", "Steppe Stories". Right author, right
    // language, right positions, sole candidate at each. Hardcover files the
    // podcast as a book_series and every test this script makes was satisfied.
    //
    // A page-count guard was written for it and REPLAYED against ten batches
    // before shipping, which is the only reason it is not here:
    //
    //   * it does not catch Hardcore History. One entry of the 48, "Blueprint
    //     for Armageddon" at position 50, carries 690 pages -- there is a
    //     printed transcript -- so "not one entry has pages" is false.
    //   * it DOES veto Laundry Files: ten real Charles Stross novels, not one
    //     with a page count in Hardcover. Thin records, not a podcast. Lower
    //     coverage than the podcast has, so no proportional threshold
    //     separates them either.
    //
    // Volume does not separate them: 35 proposed inserts puts Hardcore History
    // between William Monk (22) and La Comédie Humaine (29), under One Piece
    // (99) and Hardy Boys (143). Nor does position range.
    //
    // So the honest position is that nothing in the data this script reads
    // distinguishes an episode feed from a long book series, and a guard built
    // on a signal that does not exist costs real volumes to catch nothing.
    // Two things WOULD work, in order of preference:
    //
    //   1. An upstream field that says what a thing is. Unproven -- probe it
    //      before selecting it, the way contributions.contribution was proved
    //      on 2026-09-10, because a wrong field name 400s the whole query.
    //   2. Curation on our own row, the control that already fixed Dungeon
    //      Crawler Carl: a total_books a human filled in once.
    //
    // Until then this is caught by a human reading the CSV, which is what the
    // CSV is for.

    let proposed = 0, open = 0;
    // Rows a human could actually apply. Distinct from `proposed`, which counts
    // every row written, including skips and unapproved alternatives.
    let actionable = 0;

    for (const [position, list] of [...byPosition.entries()].sort((a, b) => a[0] - b[0])) {
      if (heldByPos.has(position)) {
        // A HELD POSITION IS NOT A SETTLED POSITION.
        //
        // THE BUG THIS EXISTS FOR: Dungeon Crawler Carl, 2026-09-09. The catalog
        // holds The Butcher's Masquerade at position 6; Hardcover puts it at 5.
        // Because something sat at 6, this loop skipped 6 — and The Eye of the
        // Bedlam Bride, the real volume 6 and genuinely missing, was never
        // proposed. One wrong position hid a whole book and the run looked
        // complete.
        //
        // So when what we hold at a position matches nothing upstream offers
        // there, say so. It is not a proposal: the fix might be to move our row
        // or to distrust Hardcover. But it is a discrepancy, and silence about
        // it is how a series looks finished while missing a volume.
        const mine = heldAt.get(position);
        const theirs = list.map((c) => c.title);
        const agrees = theirs.some((t) => normTitle(cleanTitle(t)) === normTitle(cleanTitle(mine?.title)));
        if (mine && theirs.length && !agrees) {
          // A MISMATCH THAT ONLY DESCRIBES ITSELF IS A DEAD END.
          //
          // THE BUG THIS EXISTS FOR: The Dresden Files, 2026-09-10. Position 1
          // holds "Welcome to the Jungle" -- the graphic novel -- while Storm
          // Front, book one of a seventeen-book series, is not in the catalog
          // at all. The run reported it, correctly, as a mismatch. And that was
          // the end of it: a mismatch row is deliberately not approvable, the
          // position stays occupied, and so Storm Front can never be proposed
          // by any future run either. The tool could see the hole and had no
          // way to let anyone fill it.
          //
          // Dungeon Crawler Carl showed the same wall from the other side: The
          // Eye of the Bedlam Bride only became proposable once a set-position
          // moved The Butcher's Masquerade off position 6. The unblocking was
          // accidental.
          //
          // So look at what is actually wrong, because there are two different
          // situations here and they have different fixes -- and BOTH of them
          // are reversible field edits on a row we already own. Neither creates
          // anything, which is why they can be offered at all.
          const mineNorm = normTitle(cleanTitle(mine.title));
          let upstreamMine = hc.candidates.find(
            (c) => normTitle(cleanTitle(c.title)) === mineNorm
          );

          // THE SUBTITLE IS THE PART THAT IDENTIFIES THE BOOK.
          //
          // THE BUG THIS EXISTS FOR: Hellblazer, 2026-09-10, second occurrence.
          // The titlesUsable gate refused these four when Hellblazer matched 1
          // of 11. Then the twelve inserts were applied — using UPSTREAM's
          // naming — so our shelf started to look like upstream's, the match
          // rate crossed the threshold, and the gate opened on exactly the four
          // volumes that still carry our older convention:
          //
          //   ours      "Hellblazer, Vol. 4: The Family Man"
          //   upstream  "Hellblazer: The Family Man"
          //
          // An aggregate match rate cannot catch this: it gets WEAKER as the
          // catalog gets mixed, which is the opposite of what a safety gate
          // should do. So test the thing that actually identifies a volume —
          // the part after the last colon. "The Family Man" appears inside
          // upstream's title even though the full strings will never be equal.
          //
          // Long enough to be distinctive (8 characters), and only used to
          // establish PRESENCE — never to pick a candidate or a position.
          if (!upstreamMine) {
            const segs = cleanTitle(mine.title).split(':');
            const tail = segs.length > 1 ? normTitle(segs[segs.length - 1]) : '';
            if (tail.length >= 8) {
              upstreamMine = hc.candidates.find(
                (c) => normTitle(cleanTitle(c.title)).includes(tail)
              );
              if (upstreamMine) vlog(`"${mine.title}" recognised upstream by its subtitle, as "${upstreamMine.title}"`);
            }
          }
          const theirPos = upstreamMine ? Number(upstreamMine.position) : null;
          const destinationHeld = theirPos != null ? heldAt.get(theirPos) : null;

          if (!trustStructural) {
            // Reported, not fixed. See the corroboration block above: the
            // reference is either too thin or in a different order, and either
            // way a per-row edit would be a guess dressed as a correction.
            out.push({
              approve: '', action: 'mismatch', series_name: srow.name, position,
              candidates: list.length, title: mine.title, author: mine.author || '',
              language: '', pages: '', status: mine.status, confidence: 0,
              notes: `we hold "${mine.title}" here; Hardcover puts ${theirs.map((t) => `"${t}"`).join(', ')} at this position — ` +
                     (upstreamThin
                       ? `but its list is too thin (${hc.candidates.length} entries) to act on`
                       : `but the two lists use different orderings, so this is not necessarily wrong`),
              book_id: mine.id, series_id: srow.id, hardcover_id: '', cover_url: '',
            });
          } else if (theirPos != null && theirPos !== position && !destinationHeld) {
            // OUR ROW IS IN THE WRONG SLOT. Upstream lists this exact book at
            // another position and we hold nothing there, so moving it is a
            // single reversible update that also frees this position for the
            // volume that belongs in it.
            out.push({
              approve: '', action: 'set-position', series_name: srow.name, position: theirPos,
              candidates: '', title: mine.title, author: mine.author || '',
              language: '', pages: '', status: mine.status, confidence: 0,
              notes: `we hold "${mine.title}" at ${position}; Hardcover puts it at ${theirPos}, ` +
                     `which is free. Moving it also frees ${position} for ${theirs.map((t) => `"${t}"`).join(', ')}`,
              book_id: mine.id, series_id: srow.id, hardcover_id: '', cover_url: '',
            });
          } else if (theirPos == null) {
            // OUR ROW IS NOT A NUMBERED VOLUME AT ALL. Upstream does not list
            // this book anywhere in the series -- a graphic novel, a companion,
            // an adaptation. Nulling its position keeps it on the page (the
            // unnumbered sort to the end) while it stops claiming to be a
            // volume it is not, and frees the slot.
            out.push({
              approve: '', action: 'unnumber', series_name: srow.name, position,
              candidates: list.length, title: mine.title, author: mine.author || '',
              language: '', pages: '', status: mine.status, confidence: 0,
              notes: `we hold "${mine.title}" at ${position}; Hardcover does not list it in this series at all, ` +
                     `and puts ${theirs.map((t) => `"${t}"`).join(', ')} here. ` +
                     `Approving removes its position only -- the book stays in the series, unnumbered.`,
              book_id: mine.id, series_id: srow.id, hardcover_id: '', cover_url: '',
            });
          } else {
            // The destination is occupied too: the whole run is shifted, and
            // untangling it one row at a time would walk the series into a
            // collision. Say so and leave it.
            out.push({
              approve: '', action: 'mismatch', series_name: srow.name, position,
              candidates: list.length, title: mine.title, author: mine.author || '',
              language: '', pages: '', status: mine.status, confidence: 0,
              notes: `we hold "${mine.title}" here; Hardcover puts it at ${theirPos}, where we already hold ` +
                     `"${destinationHeld.title}" — the positions are shifted, so this needs untangling by hand`,
              book_id: mine.id, series_id: srow.id, hardcover_id: '', cover_url: '',
            });
          }
        }
        continue;
      }
      if (!list.length) continue;

      for (const v of list) {
        const key = bookKey(v.title, v.author);
        const { data: found, error: fErr } = await supabase
          .rpc('find_book_by_client_key', { _key: key });
        if (fErr) vlog(`lookup failed for ${v.title}: ${fErr.message}`);
        const existing = Array.isArray(found) ? found[0] : found;

        let action, notes = [], bookId = '';
        // A proposal that MOVES one of our positioned rows, rather than adding
        // or placing an unplaced one. Never pre-approved.
        let structuralMove = false;
        if (existing?.id) {
          bookId = existing.id;
          if (!existing.series_id) { action = 'link'; notes.push('already in the catalog, unlinked'); }
          else if (existing.series_id === srow.id) {
            // "NO POSITION" HAS TO MEAN NO POSITION.
            //
            // THE BUG THIS EXISTS FOR: the 100-series batch, 2026-09-11. This
            // branch said `set-position` and wrote the note "in this series, no
            // position" without ever CHECKING whether the book had one. Ten of
            // the 517 pre-approvals were therefore silent MOVES of books that
            // were already placed — pre-approved, at confidence 100, described
            // as the opposite of what they were:
            //
            //   Foundation      Prelude to Foundation   held #1  -> #6
            //   Foundation      Foundation and Earth    held #7  -> #5
            //   Practical Magic Practical Magic         held #3  -> #1
            //   Hardy Boys      Secret of Soldier's Gold held #55 -> #182
            //   Nightside       Hell to Pay             held #9  -> #7
            //
            // Foundation is the Narnia problem again: Prelude to Foundation is
            // published sixth and reads first, so that move renumbers a
            // deliberate chronological order into Hardcover's publication one.
            //
            // The mismatch path already refuses this unless trustStructural
            // says our positions and upstream's agree. This path predates that
            // guard and was never gated by it. Now it is, and a real move is
            // never pre-approved: it edits placement a human chose.
            const mine = heldByTitle.get(normTitle(cleanTitle(v.title)));
            const minePos = mine && mine.position_in_series != null ? Number(mine.position_in_series) : null;
            if (minePos == null) {
              action = 'set-position'; notes.push('in this series, no position');
            } else if (minePos === position) {
              action = 'skip'; notes.push('already at this position');
            } else if (!trustStructural) {
              action = 'skip';
              notes.push(
                `we hold this at ${minePos}; Hardcover puts it at ${position}, but our orders do not ` +
                `agree well enough to move it (titles matched ${matchedCount}/${heldNumbered.length})`
              );
            } else {
              action = 'set-position';
              structuralMove = true;
              notes.push(`MOVES this from ${minePos} to ${position} — check that is not a different ordering`);
            }
          }
          else { action = 'skip'; notes.push(`belongs to a different series (${existing.series_id})`); }
        } else if (heldTitles.has(normTitle(cleanTitle(v.title)))) {
          action = 'skip'; notes.push('this title is already in the series');
        } else {
          action = 'insert';
        }

        let confidence = 100;
        if (!hc.exact) { confidence -= 10; notes.push(`series matched by containment ("${hc.name}")`); }
        // Reads EVERY contribution, as the filter does. It read only v.author —
        // the first — which is the NARRATOR on an audiobook: DCC's "This
        // Inevitable Ruin" came back credited to Erik Wilson, took 40 points and
        // fell under the threshold. The penalty is also small now, because the
        // per-position author filter has already removed the case it was built
        // for; what reaches here is a volume with nobody to compare it against,
        // which is a mild doubt rather than a verdict.
        const vAuthors = (v.authors || [v.author]).filter(Boolean).flatMap(splitAuthors);
        if (heldAuthors.size && vAuthors.length && !vAuthors.some((a) => heldAuthors.has(normTitle(a)))) {
          confidence -= 15;
          notes.push(`credited to ${vAuthors.map((a) => `"${a}"`).join(', ')}, not the series author`);
        }
        if (!v.author) { confidence -= 20; notes.push('no author'); }
        if (normTitle(v.title).length < 3) { confidence -= 40; notes.push('title too short'); }
        if (claimedTotal && position > claimedTotal) {
          confidence -= 20; notes.push(`beyond ${claimedSource} (${claimedTotal})`);
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
          position === 0 || (claimedTotal && position > claimedTotal);
        if (structurallyOdd && v.pick) notes.push('not pre-approved: unusual position for a volume');

        // NOTHING BOUNDS THIS SERIES.
        //
        // The guard above is only as good as the number it compares against,
        // and for some series there is no number anywhere. Dungeon Crawler
        // Carl, 2026-09-09: our row has no total_books and Hardcover reports no
        // primary_books_count either, so "The Beautiful Place" — Dinniman's
        // standalone horror novel, which Hardcover files at position 9 — has
        // nothing at all to fail against, and is pre-approved at 100 by every
        // test this script can make. Right author, right language, sole
        // candidate.
        //
        // This does not veto it. Refusing every tail volume of every series
        // with no claimed total would cost far more than it saves, and a
        // genuine last volume looks exactly like this. It SAYS SO instead, on
        // the rows where the risk actually lives — past the end of what we
        // hold, where an appended stranger is indistinguishable from a sequel.
        //
        // The fix is a curated total_books on the series row. That is one field
        // a human fills in once, and it turns this whole class of error back
        // into the structural guard above.
        if (!claimedTotal && maxHeldPosition && position > maxHeldPosition) {
          notes.push(`nothing claims a length for this series — no total_books here or upstream, so position ${position} is unbounded`);
        }

        // NOBODY WE KNOW WROTE THIS.
        //
        // THE BUG THIS EXISTS FOR: 2026-09-09, the run after the language fix.
        // Forty-six pre-approvals, and exactly two of them wrong — both the
        // same shape, both a DIFFERENT SERIES that happens to share a name:
        //
        //   The Inheritance Trilogy #3  Semper Human        Ian Douglas
        //     (ours is N. K. Jemisin's; his is military SF)
        //   Wicked #4                   Spellbound          Nancy Holder
        //     (ours is Janet Evanovich's — the exact confusion the header of
        //      this file already warned about, pre-approved anyway)
        //
        // Both carried `credited to "X", not the series author` and sailed
        // through on a 15-point penalty. The per-position author FILTER cannot
        // help here: it only drops a non-matching candidate when a matching one
        // stands at the same position, and at these positions there was none.
        //
        // So this is a pre-approval veto, not a filter — the row stays in the
        // file, visible and approvable by hand. A candidate that names its
        // authors and names none of ours is not something to write into a
        // shared catalog unattended. It costs nothing measurable: those two
        // rows were the ONLY pre-approvals in the run carrying that note.
        //
        // It fires only when the candidate actually credits somebody. Credited
        // to nobody is a different doubt and already costs 20 points, and an
        // outright veto there would take the narrator case with it.
        const disowned =
          heldAuthors.size > 0 && vAuthors.length > 0 &&
          !vAuthors.some((a) => heldAuthors.has(normTitle(a)));
        if (disowned && v.pick) notes.push('not pre-approved: no author in common with the series');

        if (structuralMove) notes.push('not pre-approved: this moves a volume a human already placed');

        const preApprove =
          action !== 'skip' && v.pick && !structurallyOdd && !disowned && !structuralMove &&
          confidence >= MIN_CONFIDENCE;

        out.push({
          approve: preApprove ? 'y' : '',
          action,
          series_name: srow.name,
          position,
          candidates: list.length,
          title: v.title,
          author: (v.authors || [v.author]).filter(Boolean).join(' / '),
          language: languagesOf(v).join(' '),
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
        if (['insert', 'link', 'set-position', 'unnumber'].includes(action)) actionable++;
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
          language: languagesOf(r).join(' '), pages: r.pages ?? '',
          status: '', confidence: 0, notes: r.reason, book_id: '', series_id: srow.id,
          hardcover_id: r.hardcoverId ?? '', cover_url: '',
        });
      }
    }

    // Short, and yet nothing to propose. The Bloodsworn Saga on 2026-09-09:
    // two volumes of three, and the only thing Hardcover offered was the boxed
    // set, which the filters correctly removed — leaving a series that needs a
    // book and a file that said nothing about it unless --show-rejected was on.
    // A gap the tool cannot close is still a fact about the gap.
    if (!proposed && srow.total_books && (held || []).length < srow.total_books) {
      const why = [...new Set(rejected.map((r) => String(r.reason).replace(/\s*\(.*/, '')))].slice(0, 3);
      unresolved(
        `short ${(held || []).length} of ${srow.total_books}, and every candidate was filtered out` +
        (why.length ? ` — ${why.join('; ')}` : '')
      );
    }

    examined.push(srow.id);
    if (!actionable) settled.push(srow.id);
    seriesDone++;
    console.log(
      `    holds ${(held || []).length}` +
      `${srow.total_books ? ` of ${srow.total_books}` : ''}` +
      ` · hardcover offered ${hc.candidates.length}, ${rejected.length} filtered out` +
      (heldNumbered.length
        ? ` · titles matched ${matchedCount}/${heldNumbered.length}` +
          `${movedCount ? ` (${movedCount} at other positions)` : ''}`
        : '') +
      ` → ${proposed} proposed${open ? `, ${open} position(s) still need a choice` : ''}`
    );
  }

  // LOOKING AT A SERIES IS NOT FINISHING IT.
  //
  // THE BUG THIS EXISTS FOR: 2026-09-11. A --limit 100 run produced 517
  // pre-approvals; the CSV was read and NOT applied; and the next run reported
  // 604 series due instead of 700. All 100 had left the queue on the strength
  // of having been LOOKED at, taking their unapplied work with them. The
  // proposals were still in the file, but the queue no longer knew there was
  // anything outstanding, and only --series could reach them again.
  //
  // The original reasoning — "a series that was examined and could not be
  // completed leaves the queue, because re-queueing a known gap forever only
  // hides the ones that are new" — is right about series with nothing to
  // propose and wrong about every other kind. It conflated "we have looked"
  // with "there is nothing left to do".
  //
  // So the two facts are now recorded separately:
  //
  //   volumes_checked_at  always. When we last looked, and what sorts
  //                       never-examined series to the front of the queue.
  //   volumes_stale       cleared ONLY when the pass produced nothing a human
  //                       could apply. A series with outstanding proposals
  //                       stays in the queue.
  //
  // A series whose proposals a human declines does come round again — sorting
  // behind everything never examined, because it now carries a timestamp. That
  // is the right cost; the alternative is losing work silently, which is what
  // happened.
  //
  // Applying needs to clear nothing: the books trigger marks the series stale
  // on write, it comes round once more, finds nothing left to do, and settles.
  if (STALE && examined.length && !DRY_RUN) {
    const stampedAt = new Date().toISOString();
    const settledSet = new Set(settled);
    const pending = examined.filter((id) => !settledSet.has(id));

    // Chunked: PostgREST puts the id list in the URL, and a few hundred UUIDs
    // is a URL length nobody should be relying on.
    const write = async (ids, patch, label) => {
      let n = 0;
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const { error } = await supabase.from('series').update(patch).in('id', chunk);
        // A failed stamp is not a failed run. The proposals are the output and
        // they are already in hand; the cost of not stamping is that these
        // series come round again, which is the safe direction to be wrong in.
        if (error) console.log(`  ! ${label} failed for ${chunk.length} series: ${error.message}`);
        else n += chunk.length;
      }
      return n;
    };

    const settledCount = settled.length
      ? await write(settled, { volumes_checked_at: stampedAt, volumes_stale: false }, 'settling')
      : 0;
    const pendingCount = pending.length
      ? await write(pending, { volumes_checked_at: stampedAt }, 'stamping')
      : 0;

    console.log(`\n  ${settledCount} series settled — nothing left to apply.`);
    if (pendingCount) {
      console.log(`  ${pendingCount} series STAY in the queue: they have proposals in this file`);
      console.log(`  awaiting a decision, and will sort behind everything never examined.`);
    }
  } else if (STALE && DRY_RUN) {
    console.log(`\n  --dry-run: ${examined.length} series NOT stamped, so the queue is unchanged.`);
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
const APPLICABLE = new Set(['insert', 'link', 'set-position', 'unnumber']);

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

  const counts = { insert: 0, link: 0, 'set-position': 0, unnumber: 0, skipped: 0, failed: 0 };

  for (const r of rows) {
    const label = `${r.series_name} #${r.position} ${r.title}`;
    try {
      if (r.action === 'unnumber') {
        // Position only. The book keeps its series, its status and its row --
        // series_volumes sorts the unnumbered to the end, so it stays on the
        // page. Reversible by putting the number back.
        if (!r.book_id) { console.log(`  - ${label}: no book_id, skipped`); counts.skipped++; continue; }
        const { data: cur, error: cErr } = await supabase
          .from('books').select('id,series_id,position_in_series,title').eq('id', r.book_id).maybeSingle();
        if (cErr) throw new Error(cErr.message);
        if (!cur) { console.log(`  - ${label}: book no longer exists, skipped`); counts.skipped++; continue; }
        if (cur.position_in_series == null) { vlog(`${label}: already unnumbered`); counts.skipped++; continue; }
        if (DRY_RUN) { console.log(`  ~ unnumber ${label} (was ${cur.position_in_series})`); counts.unnumber++; continue; }
        const { error: uErr } = await supabase
          .from('books').update({ position_in_series: null }).eq('id', r.book_id);
        if (uErr) throw new Error(uErr.message);
        console.log(`  ✓ unnumber ${label} (was ${cur.position_in_series})`);
        counts.unnumber++;
      } else if (r.action === 'link' || r.action === 'set-position') {
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
        // THE CLASH THE CSV CANNOT SEE.
        //
        // The check at the top of this function refuses two approved ROWS at
        // one position. It says nothing about the position already being
        // occupied in the DATABASE by a book this file never mentions -- which
        // is exactly what a reposition walks into. Moving The Butcher's
        // Masquerade onto a slot another volume already holds puts two books at
        // one number and leaves series_volumes to pick between them, which is
        // the ambiguity this whole push exists to remove.
        const { data: sitting, error: oErr } = await supabase
          .from('books').select('id,title')
          .eq('series_id', r.series_id).eq('position_in_series', Number(r.position))
          .neq('id', r.book_id).limit(1);
        if (oErr) throw new Error(oErr.message);
        if (sitting && sitting.length) {
          console.log(`  - ${label}: position ${r.position} is already held by "${sitting[0].title}", skipped`);
          counts.skipped++; continue;
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

  console.log(`\n  inserted ${counts.insert}, linked ${counts.link}, positioned ${counts['set-position']}, unnumbered ${counts.unnumber}, skipped ${counts.skipped}, failed ${counts.failed}`);
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
