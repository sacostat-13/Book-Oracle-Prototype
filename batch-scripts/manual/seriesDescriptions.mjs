// seriesDescriptions.mjs — give every series page a description of ITSELF.
//
// WHY THIS EXISTS
//
// The 2026-09-09 post-apply diagnostic: description_len = 0 on all 175 series
// pages that earned Search Console impressions. The consequence is not a blank
// space. og-prerender.js falls back to the FIRST VOLUME'S description, so every
// series page has been describing itself to Google with one book's jacket copy
// — the Malazan page's meta description is the blurb for Gardens of the Moon,
// on a page whose entire purpose is the set. A wrong answer, not a missing one.
//
// This writes a description assembled from facts the catalog already holds. It
// invents nothing, calls no API, costs nothing, and can run before the money
// for an Oracle pass exists.
//
// WHAT IT IS NOT
//
// It is not good writing, and it is not pretending to be. 175 pages of
// templated prose is exactly what Google's helpful-content system discounts,
// so this is deliberately scoped to the two jobs a template can actually do:
//
//   1. Replace a WRONG description (volume one's) with a correct one.
//   2. Answer the query these pages already rank for. They are matched to
//      "crescent city series in order", "dragonlance reading order", "how many
//      godfather books are there" — order and count questions. The sentences
//      below answer exactly those, in the first 160 characters, which is the
//      part a meta description keeps.
//
// The page's real content is the ordered volume list, and that is already
// there. This is the sentence above it.
//
// It is also explicitly a PLACEHOLDER. Every row it writes is stamped
// description_source = 'composed', which is how the Oracle pass knows what it
// may replace and a human reading the table knows what a machine wrote.
//
// WHAT IT WILL NOT OVERWRITE
//
// Anything whose description_source is not 'composed'. A NULL source means the
// description predates the column or somebody wrote it by hand, and an
// unlabelled description is far more likely to be work than leftovers. --force
// exists and says so on the way past.
//
//   node batch-scripts/manual/seriesDescriptions.mjs --dry-run
//   node batch-scripts/manual/seriesDescriptions.mjs --dry-run --series "Malazan Book of the Fallen"
//   node batch-scripts/manual/seriesDescriptions.mjs --min-held 2
//   node batch-scripts/manual/seriesDescriptions.mjs
//
// FLAGS
//   --dry-run          print every description, write nothing
//   --series "Name"    one series only. Repeatable.
//   --min-held N       skip series holding fewer than N volumes. Default 1.
//                      2 matches SERIES_INDEX_FLOOR — the pages below it are
//                      noindex, so their meta description reaches nobody.
//   --limit N          at most N series
//   --force            also rewrite descriptions whose source is not 'composed'
//   --verbose

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServiceClient } from '../_shared/supabaseClient.mjs';
// cleanTitle is shared with the backfill: the Dresden Files mismatch storm of
// 2026-09-10 was the same suffix breaking a different comparison.
import { cleanTitle } from '../_shared/seriesCandidates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const VERBOSE = args.includes('--verbose');
const numArg = (n, d) => {
  const i = args.indexOf(n);
  if (i === -1) return d;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : d;
};
const allStrArgs = (n) => {
  const out = [];
  args.forEach((a, i) => { if (a === n && args[i + 1]) out.push(args[i + 1]); });
  return out;
};
const LIMIT = numArg('--limit', null);
const MIN_HELD = numArg('--min-held', 1);
const ONLY_SERIES = allStrArgs('--series');

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
for (const [k, v] of [['VITE_SUPABASE_URL', SUPABASE_URL], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY]]) {
  if (!v) { console.error(`Missing ${k} in .env.local`); process.exit(1); }
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

// Mirrors compute_series_key / normalizeSeriesName: lowercase, strip a leading
// "the ", strip non-alphanumerics.
const normSeries = (s) => (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

// -- The composer -------------------------------------------------------------
//
// PURE, and exported, so tests/series-descriptions.test.js can pin it against
// the real shapes without a database. Everything it says has to be true of the
// row it was given; there is no cleverness here on purpose, because the failure
// mode of a description generator is confident invention across 175 pages at
// once.
// "a 8-book series" was in the first 701-row dry run. English, not arithmetic:
// 8, 11 and 18 take "an", and so does anything in the 80s.
const article = (n) => (/^(8|11|18|8\d)/.test(String(n)) ? 'an' : 'a');


// The name to credit. series.author is empty for a great many rows — Malazan
// among them — and the volumes know perfectly well who wrote them, so fall back
// to the name that appears on most of what we hold. Modal, not first: a series
// with one translated edition should still be credited to its author.
function modalAuthor(volumes) {
  const counts = new Map();
  for (const v of volumes) {
    const a = (v.author || '').trim();
    if (!a) continue;
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  if (!counts.size) return null;
  const [top] = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  // Only if it is actually typical. A comics series with a different creative
  // team per volume has no single author, and picking one would be a claim.
  return top[1] * 2 >= volumes.length ? top[0] : null;
}

export function composeSeriesDescription({ name, author, totalBooks, publicationStatus, volumes }) {
  if (!name) return null;
  const held = volumes.length;
  const numbered = volumes.filter((v) => v.position_in_series != null);
  const ordered = numbered.slice().sort(
    (a, b) => Number(a.position_in_series) - Number(b.position_in_series)
  );
  const first = ordered[0] || volumes[0] || null;
  const last = ordered.length > 1 ? ordered[ordered.length - 1] : null;

  // ONLY the two values the app is known to use. publication_status is a free
  // text column and rowToSeriesBook defaults it to 'unknown'; asserting
  // "completed" off an unrecognised value would put a checkably wrong claim on
  // the page, which is the one thing worse than a thin one.
  const status = String(publicationStatus || '').toLowerCase();
  const statusWord = status === 'completed' ? 'completed '
    : status === 'ongoing' ? 'ongoing '
    : '';

  // The count clause. total_books is what the series HAS; held is what we can
  // list. Claiming "all 3" for a series holding 2 is the overclaim the whole
  // 2026-09-08 series push was about, so the two numbers are never conflated.
  //
  // AND held IS NEVER A SUBSTITUTE FOR IT. The first draft of this fell back to
  // `${held}-book series` when total_books was null, which described Hellboy —
  // a series with dozens of volumes, of which we hold eleven — as "an 11-book
  // series". That is not a thin description, it is a false one, published on
  // the page as a fact. When nothing knows the length, the sentence says
  // nothing about the length.
  //
  // AND A TOTAL WE ALREADY EXCEED IS NOT A TOTAL. The 701-row dry run produced
  // "Villains is a 2-book series ... lists all 3 volumes", and the same
  // contradiction on Night Lords (3, holding 4) and Harry Potter (7, holding
  // 9). Holding more than the claim is proof the claim is wrong, so the claim
  // goes — same rule as never having one.
  const claimed = Number(totalBooks) || null;
  const known = claimed && claimed >= held && claimed > 1 ? claimed : null;
  const countClause = known
    ? `${statusWord}${known}-book series`
    : `${statusWord}series`;
  const indefinite = known ? article(known) : 'a';

  const credited = author || modalAuthor(volumes);
  const byClause = credited ? ` by ${credited}` : '';

  // Sentence 1 — the answer to "how many books are in X", inside the first 160
  // characters so it survives into the meta description.
  const sentences = [`${name} is ${indefinite} ${countClause}${byClause}.`];

  // Sentence 2 — the answer to "X in order". Naming the first volume is the
  // single most useful fact for a reader who has found the page by searching
  // for a reading order, and it is the fact a template can state without
  // risk.
  //
  // "ends with" REQUIRES A COMPLETE SHELF. The last volume we hold is the end
  // of the series only when we hold all of it. Discworld: Tiffany Aching came
  // out of the first draft as "ends with A Hat Full of Sky" — the second of
  // five — which tells a reader looking for a reading order the wrong place to
  // stop. Same error as above, in the other direction.
  //
  // AND "begins with" REQUIRES POSITION 1. This is the same error at the other
  // end, and the 701-row dry run was full of it: Tiffany Aching "begins with A
  // Hat Full of Sky" (book two), Hyperion Cantos with Endymion (book three),
  // The Witcher with Season of Storms, Lockwood & Co. with The Whispering
  // Skull. `first` is the lowest position we HOLD, which is the start of the
  // series only when that position is 1. On a page that ranks for "reading
  // order", sending a reader to book two is the single worst thing it can say,
  // so the sentence appears only when the shelf actually starts at the start.
  const complete = known != null && held === known;
  const startsAtOne = Number(first?.position_in_series) === 1;
  const firstTitle = cleanTitle(first?.title);
  const lastTitle = cleanTitle(last?.title);
  if (startsAtOne && firstTitle && lastTitle && complete) {
    sentences.push(`It begins with ${firstTitle} and ends with ${lastTitle}.`);
  } else if (startsAtOne && firstTitle) {
    sentences.push(`It begins with ${firstTitle}.`);
  }

  // Sentence 3 — what THIS page can actually show, stated honestly. A reader
  // who arrives expecting ten and finds six should learn that here rather than
  // by counting.
  //
  // NOTHING AT ALL FOR A SHELF OF ONE. "The Books Oracle lists 1 volume so far"
  // was in every one of the hundreds of single-volume rows in the dry run, and
  // Simon's read of it is the right one: it advertises a gap, and it makes the
  // page sound unsure of itself on the one line a reader is most likely to see.
  // A page holding one book has nothing to say about reading order. It can
  // still say what the series IS -- "Hatchet is a 5-book series by Gary
  // Paulsen." is short, true and confident -- and then stop.
  //
  // Those pages are below SERIES_INDEX_FLOOR and noindex anyway, so the
  // sentence was reaching humans in the app and nobody else.
  if (held >= 2) {
    sentences.push(
      complete
        ? `The Books Oracle lists all ${held} volumes, in reading order.`
        : known
          ? `The Books Oracle lists ${held} of ${known}, in reading order.`
          : `The Books Oracle lists ${held} volumes, in reading order.`
    );
  }

  return sentences.join(' ');
}

// -- Go -----------------------------------------------------------------------
async function main() {
  let query = supabase
    .from('series')
    .select('id,name,author,total_books,publication_status,description,description_source');
  if (ONLY_SERIES.length) {
    query = query.in('normalized_name', ONLY_SERIES.map(normSeries));
  }
  const { data: allSeries, error } = await query;
  if (error) throw new Error(`series list failed: ${error.message}`);

  let series = (allSeries || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (LIMIT) series = series.slice(0, LIMIT);

  console.log(`\n  ${series.length} series.${DRY_RUN ? '  DRY RUN — nothing will be written.' : ''}\n`);

  const counts = { written: 0, unchanged: 0, protected: 0, tooShort: 0, failed: 0 };

  for (const s of series) {
    // KEEP WHAT SOMEBODY WROTE.
    //
    // 'composed' is this script's own previous output and is always safe to
    // replace. Anything else -- 'oracle', 'manual', or a NULL source from
    // before the column existed -- is somebody's work, and quietly replacing it
    // with a template would be the most expensive kind of helpfulness.
    const hasDescription = (s.description || '').trim().length > 0;
    if (hasDescription && s.description_source !== 'composed' && !FORCE) {
      vlog(`${s.name}: has a ${s.description_source || 'hand-written'} description — kept`);
      counts.protected++;
      continue;
    }

    const { data: volumes, error: vErr } = await supabase
      .from('series_volumes')
      .select('title,author,position_in_series')
      .eq('series_id', s.id)
      .in('status', ['verified', 'oracle_categorized'])
      .order('position_in_series', { ascending: true, nullsFirst: false });
    if (vErr) { console.log(`  ! ${s.name}: volumes failed — ${vErr.message}`); counts.failed++; continue; }

    // The status filter above matches og-prerender, the sitemap and
    // seriesService: the description must describe the list the page will
    // actually render, not the catalog behind it. A series whose volumes are
    // all `unreviewed` reads as empty here, and correctly so — its page shows
    // nothing either.
    const held = (volumes || []).length;
    if (held < MIN_HELD) { vlog(`${s.name}: holds ${held}, below --min-held ${MIN_HELD}`); counts.tooShort++; continue; }

    const description = composeSeriesDescription({
      name: s.name,
      author: s.author,
      totalBooks: s.total_books,
      publicationStatus: s.publication_status,
      volumes: volumes || [],
    });
    if (!description) { counts.failed++; continue; }

    if (description === (s.description || '').trim()) {
      vlog(`${s.name}: unchanged`);
      counts.unchanged++;
      continue;
    }

    console.log(`  ${DRY_RUN ? '~' : '✓'} ${s.name}`);
    console.log(`      ${description}`);
    if (DRY_RUN) { counts.written++; continue; }

    const { error: uErr } = await supabase
      .from('series')
      .update({ description, description_source: 'composed' })
      .eq('id', s.id);
    if (uErr) { console.log(`  ! ${s.name}: ${uErr.message}`); counts.failed++; continue; }
    counts.written++;
  }

  console.log(
    `\n  ${DRY_RUN ? 'would write' : 'wrote'} ${counts.written}` +
    `, unchanged ${counts.unchanged}` +
    `, kept ${counts.protected}` +
    `, below --min-held ${counts.tooShort}` +
    `, failed ${counts.failed}\n`
  );
  if (!DRY_RUN && counts.written) {
    console.log(`  These are placeholders, stamped description_source = 'composed'.`);
    console.log(`  The Oracle pass replaces them highest-demand first; nothing else will.\n`);
  }
}

// Importable for tests without running the CLI.
if (process.argv[1] && process.argv[1].endsWith('seriesDescriptions.mjs')) {
  main().catch((e) => { console.error(`\n  FAILED: ${e.message}\n`); process.exit(1); });
}
