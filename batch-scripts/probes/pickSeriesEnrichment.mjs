// pickSeriesEnrichment.mjs — choose WHICH books to pay to enrich, and nothing else.
//
// WHY THIS IS A PICKER AND NOT AN ENRICHER
//
// oracleBatch.mjs drains `books_needing_curation` ordered by created_at
// ascending — oldest first, which its own comment calls "the intended drain
// order". That was right when the backlog was the original import. It is wrong
// now: every volume the series backfill applies lands as 'unreviewed' and is
// among the NEWEST rows in the table, so the pages just repaired sort to the
// back of ~1,300 books. At --limit 100 nightly that is a fortnight before a
// series page renders the volumes that were added to it.
//
// The obvious shortcut — a second script that enriches these books itself — is
// the one thing not to do. oracleBatch's header records why: buildPrompt() was
// duplicated in oracleCategorizationService, the two drifted, and "mirrors
// buildPrompt() is a claim no test checks". A second copy of the prompt would
// be the third. So this script picks ids and oracleBatch --ids-file spends the
// money, with one prompt between them.
//
// It never invents eligibility either. Every id it emits is INTERSECTED with
// books_needing_curation, the same view oracleBatch selects from, so a book that
// only wants a description (metadataBackfill's job, and never a billable call)
// cannot get into the file.
//
// Usage:
//   node batch-scripts/probes/pickSeriesEnrichment.mjs          # report only
//   node batch-scripts/probes/pickSeriesEnrichment.mjs --out     # write the default file
//   node batch-scripts/probes/pickSeriesEnrichment.mjs --out somewhere/ids.txt
//   node batch-scripts/probes/pickSeriesEnrichment.mjs --limit 200 --min-held 3
//
// Then:
//   node batch-scripts/manual/oracleBatch.mjs --ids-file batch-scripts/output/series-enrichment-ids.txt --dry-run
//
// A bare --out writes to batch-scripts/output/, which .gitignore already keeps
// for exactly this ("Generated results, never hand-edited, never committed").
// Any other path is taken relative to where you ran the command, and its parent
// directories are created — a Unix-shaped /tmp/ids.txt on Windows becomes
// C:\tmp\ids.txt and used to fail here with ENOENT.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createServiceClient } from '../_shared/supabaseClient.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const a = args.find((x) => x === name || x.startsWith(`${name}=`));
  if (!a) return fallback;
  return a.includes('=') ? a.split('=').slice(1).join('=') : (args[args.indexOf(a) + 1] ?? true);
};
const DEFAULT_OUT = join(__dirname, '..', 'output', 'series-enrichment-ids.txt');
const outFlag = flag('--out');
// `--out` with no value, or trailed by another flag, means the default path.
const OUT = outFlag === null ? null
  : (outFlag === true || String(outFlag).startsWith('--')) ? DEFAULT_OUT
  : (isAbsolute(String(outFlag)) ? String(outFlag) : resolve(process.cwd(), String(outFlag)));
const LIMIT = Number(flag('--limit', 0)) || null;
// A series floor of three is the one proposed in the 2026-09-07 indexing doc.
// Series at or above it are the ones an enrichment pass actually un-hides.
const MIN_HELD = Number(flag('--min-held', 3));

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  })
);
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

// oracleBatch's own estimate constants, so the two agree on what a run costs.
const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;
const EST_INPUT_TOKENS_PER_BOOK = 800;
const EST_OUTPUT_TOKENS_PER_BOOK = 300;

const chunk = (xs, n) => xs.reduce((a, x, i) => (i % n ? a[a.length - 1].push(x) : a.push([x]), a), []);

async function main() {
  // 1. Series carrying enrichment debt, worst first. The ordering is the point:
  //    a series that would be hidden by a three-volume floor purely because its
  //    volumes are 'unreviewed' is the most valuable thing to spend on.
  const { data: series, error: sErr } = await supabase
    .from('series_completeness')
    .select('series_id,name,held,held_live,total_books,gap_count,description_len');
  if (sErr) { console.error('series_completeness read failed:', sErr.message); process.exit(1); }

  const waiting = (series || [])
    .filter((s) => s.held > s.held_live)
    .map((s) => ({ ...s, waiting: s.held - s.held_live, hidden: s.held >= MIN_HELD && s.held_live < MIN_HELD }))
    .sort((a, b) => (Number(b.hidden) - Number(a.hidden)) || (b.waiting - a.waiting) || (b.held - a.held));

  console.log(`\n  ${waiting.length} series carry enrichment debt (held > held_live).`);
  console.log(`  ${waiting.filter((s) => s.hidden).length} of them hold ${MIN_HELD}+ volumes but show fewer than ${MIN_HELD} —`);
  console.log(`  a floor counting held_live would hide those, and the catalog is not the reason.\n`);

  for (const s of waiting.slice(0, 15)) {
    console.log(`    ${s.hidden ? '!' : ' '} ${String(s.held_live).padStart(3)}/${String(s.held).padEnd(3)} live  ${s.name}`);
  }
  if (waiting.length > 15) console.log(`    … and ${waiting.length - 15} more`);

  // 2. The books behind that debt, in series order so a page completes at once
  //    rather than half-filling twenty pages.
  const ids = [];
  for (const group of chunk(waiting.map((s) => s.series_id), 50)) {
    const { data, error } = await supabase
      .from('books')
      .select('id,series_id,position_in_series,status')
      .in('series_id', group)
      .not('status', 'in', '("verified","oracle_categorized")');
    if (error) { console.error('books read failed:', error.message); process.exit(1); }
    ids.push(...(data || []));
  }

  // 3. INTERSECT with what oracleBatch would actually pay for. Without this the
  //    file could name a book whose only need is a description, and the run
  //    would quietly do nothing for it.
  const eligible = new Set();
  for (const group of chunk(ids.map((b) => b.id), 200)) {
    const { data, error } = await supabase
      .from('books_needing_curation')
      .select('id')
      .in('id', group);
    if (error) { console.error('books_needing_curation read failed:', error.message); process.exit(1); }
    for (const r of data || []) eligible.add(r.id);
  }

  const rank = new Map(waiting.map((s, i) => [s.series_id, i]));
  let chosen = ids
    .filter((b) => eligible.has(b.id))
    .sort((a, b) =>
      (rank.get(a.series_id) ?? 1e9) - (rank.get(b.series_id) ?? 1e9) ||
      (Number(a.position_in_series ?? 1e9) - Number(b.position_in_series ?? 1e9)));
  if (LIMIT) chosen = chosen.slice(0, LIMIT);

  const cost =
    (chosen.length * EST_INPUT_TOKENS_PER_BOOK / 1e6) * INPUT_COST_PER_M +
    (chosen.length * EST_OUTPUT_TOKENS_PER_BOOK / 1e6) * OUTPUT_COST_PER_M;

  console.log(`\n  ${ids.length} books in those series are not live;`);
  console.log(`  ${chosen.length} of them are eligible for a billable call${LIMIT ? ` (capped at ${LIMIT})` : ''}.`);
  console.log(`  Estimated cost: ~$${cost.toFixed(3)}  (oracleBatch's own per-book estimate)\n`);

  if (!OUT) {
    console.log('  Report only. Pass --out <file> to write the id list.\n');
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, chosen.map((b) => b.id).join('\n') + '\n');
  console.log(`  Wrote ${chosen.length} ids to ${OUT}`);
  console.log(`  Next:  node batch-scripts/manual/oracleBatch.mjs --ids-file ${OUT} --dry-run\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
