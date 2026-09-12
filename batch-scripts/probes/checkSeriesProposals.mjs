// checkSeriesProposals.mjs — does a propose run still agree with the human?
//
// WHY THIS EXISTS
//
// seriesBackfill.mjs cannot be unit-tested end to end. Its correctness depends
// on what Hardcover returns for a live series, and the filters have already
// been wrong four times in four different ways, each one invisible until real
// data arrived. tests/series-candidates.test.js pins the pure filtering against
// captured payloads, which catches a regression in the RULES. It cannot catch
// the rules being right and the ANSWER still being wrong.
//
// The 25-series run of 2026-09-09 is the only ground truth there is: 24
// pre-approved rows, sixteen right and eight wrong, judged by hand. That CSV was
// deliberately not applied, precisely so the catalog still stands where it stood
// when those proposals were made and a later run remains comparable.
//
// This diffs a fresh propose CSV against that judgement, in both directions —
// which is the point. A filter that stops approving translations by refusing to
// approve anything has not improved; it has traded a visible failure for an
// invisible one. So LOST (something correct that is no longer approved) is
// reported as loudly as REGRESSION (something wrong that is approved again).
//
// Read-only. Reads two CSV files and prints. No network, no database, which is
// what probes/ is for.
//
//   node batch-scripts/probes/checkSeriesProposals.mjs
//   node batch-scripts/probes/checkSeriesProposals.mjs --expected F --actual G
//   node batch-scripts/probes/checkSeriesProposals.mjs --strict   (exit 1 on any
//                                                                  regression or loss)
//
// The fixture has a shelf life: it describes a catalog state. Applying volumes
// invalidates the rows it touches, so retake it after any apply. The header of
// the fixture says so too.

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const strArg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : (args[i + 1] || d); };
const STRICT = args.includes('--strict');
const EXPECTED = strArg('--expected', join(ROOT, 'batch-scripts', 'fixtures', 'series-backfill-2026-09-09.expected.csv'));
const ACTUAL = strArg('--actual', join(ROOT, 'batch-scripts', 'output', 'series-backfill.csv'));

// Shared with seriesBackfill.mjs by copy, deliberately: a probe that imports the
// thing it is checking can be fooled by the same bug twice.
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
  // Comment lines are the fixture's documentation. Dropped before the header is
  // read so the file can explain itself to whoever opens it next.
  const body = rows.filter((r) => !(r[0] || '').startsWith('#'));
  const header = body.shift() || [];
  return body.filter((r) => r.some((c) => c !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = (series, position) => `${norm(series)}#${position}`;

for (const [label, f] of [['expected', EXPECTED], ['actual', ACTUAL]]) {
  if (!existsSync(f)) { console.error(`No ${label} file at ${f}`); process.exit(1); }
}

const expected = parseCsv(readFileSync(EXPECTED, 'utf8'));
const actual = parseCsv(readFileSync(ACTUAL, 'utf8'));

const approvedRows = actual.filter((r) => (r.approve || '').toLowerCase() === 'y'
  && ['insert', 'link', 'set-position'].includes(r.action));
const proposalRows = actual.filter((r) => ['insert', 'link', 'set-position'].includes(r.action));

const approvedAt = new Map();
for (const r of approvedRows) approvedAt.set(key(r.series_name, r.position), r);
const proposedBySeries = new Map();
for (const r of proposalRows) {
  const k = norm(r.series_name);
  if (!proposedBySeries.has(k)) proposedBySeries.set(k, []);
  proposedBySeries.get(k).push(r);
}

const held = { kept: [], lost: [], surfaced: [], landed: [], fixed: [], regressed: [], wrongTitle: [], reviewed: [], autoReviewed: [], silent: [], noisy: [] };

for (const e of expected) {
  const k = key(e.series_name, e.position);
  const got = approvedAt.get(k);

  if (e.verdict === 'approve') {
    if (!got) {
      // NOT EVERY UNAPPROVED ROW IS A LOSS.
      //
      // A `mismatch` row says: we hold something at this position and Hardcover
      // puts something else there. It is deliberately never approvable — the
      // fix might be to move OUR row rather than to insert theirs — but the
      // volume is named, in the file, in front of the reviewer. Scoring that
      // as LOST reads as "the tool went blind" when the tool in fact started
      // seeing. Dungeon Crawler Carl #6 is the case: The Eye of the Bedlam
      // Bride is missing because our Butcher's Masquerade sits at 6 and
      // Hardcover has it at 5, and no insert can fix a shifted series.
      // APPLIED IS NOT LOST.
      //
      // The shelf-life problem, made harmless. This fixture describes a catalog
      // state, and the moment you apply the rows it approves, those volumes stop
      // being proposed — they are in the catalog now, and the propose pass
      // correctly says nothing about them. Scored naively that reads as fifteen
      // LOST rows and looks like the tool collapsed, which is the opposite of
      // what happened.
      //
      // A `held` row at the same position with the same title is the fixture's
      // own prediction coming true. Report it as such, and the fixture survives
      // the apply it was written to justify.
      const landed = actual.find((r) => r.action === 'held' &&
        key(r.series_name, r.position) === k && norm(r.title) === norm(e.title));
      if (landed) { held.landed.push({ e, got: landed }); continue; }

      const any = proposalRows.find((r) => key(r.series_name, r.position) === k);
      const mismatch = actual.filter((r) => r.action === 'mismatch')
        .find((r) => key(r.series_name, r.position) === k &&
                     norm(r.notes || '').includes(norm(e.title)));
      if (mismatch) held.surfaced.push({ e, got: mismatch });
      else held.lost.push({ e, got: any });
    }
    else if (norm(got.title) !== norm(e.title)) held.wrongTitle.push({ e, got });
    else held.kept.push({ e, got });
  } else if (e.verdict === 'reject') {
    if (!got) held.fixed.push({ e });
    else if (norm(got.title) === norm(e.title)) held.regressed.push({ e, got });
    else if (e.expected_title && norm(got.title) === norm(e.expected_title)) held.fixed.push({ e, got, upgraded: true });
    else held.regressed.push({ e, got, different: true });
  } else if (e.verdict === 'review') {
    (got ? held.autoReviewed : held.reviewed).push({ e, got });
  } else if (e.verdict === 'expects') {
    const p = proposedBySeries.get(norm(e.series_name)) || [];
    if (!p.length) held.silent.push({ e });
  } else if (e.verdict === 'complete') {
    const p = proposedBySeries.get(norm(e.series_name)) || [];
    if (p.length) held.noisy.push({ e, count: p.length });
  }
}

const line = (t, series, position, title, extra = '') =>
  `    ${t} ${String(series).slice(0, 26).padEnd(27)} #${String(position).padEnd(4)} ${String(title).slice(0, 42).padEnd(43)} ${extra}`;

console.log(`\n  expected: ${EXPECTED.split(/[\\/]/).pop()}`);
console.log(`  actual:   ${ACTUAL.split(/[\\/]/).pop()}`);
console.log(`\n  ${proposalRows.length} proposals, ${approvedRows.length} pre-approved\n`);

console.log(`  KEPT — correct and still approved: ${held.kept.length} of ${expected.filter((e) => e.verdict === 'approve').length}`);
for (const { e } of held.kept) console.log(line('·', e.series_name, e.position, e.title));

if (held.wrongTitle.length) {
  console.log(`\n  WRONG TITLE — right position, different book: ${held.wrongTitle.length}`);
  for (const { e, got } of held.wrongTitle) console.log(line('!', e.series_name, e.position, got.title, `expected ${e.title}`));
}

console.log(`\n  FIXED — was wrong, no longer approved: ${held.fixed.length} of ${expected.filter((e) => e.verdict === 'reject').length}`);
for (const { e, upgraded } of held.fixed) {
  console.log(line('✓', e.series_name, e.position, e.title, upgraded ? `→ now proposes ${e.expected_title}` : ''));
}

if (held.regressed.length) {
  console.log(`\n  REGRESSION — a known-bad row is pre-approved again: ${held.regressed.length}`);
  for (const { e, got } of held.regressed) console.log(line('✗', e.series_name, e.position, got.title, e.note));
}

if (held.lost.length) {
  console.log(`\n  LOST — was correct, no longer approved: ${held.lost.length}`);
  console.log('    (a filter that stops being wrong by stopping being useful)');
  for (const { e, got } of held.lost) {
    console.log(line('−', e.series_name, e.position, e.title,
      got ? `still proposed, not approved: ${(got.notes || '').slice(0, 46)}` : 'not proposed at all'));
  }
}

if (held.autoReviewed.length) {
  console.log(`\n  NEEDS A HUMAN BUT WAS AUTOMATIC: ${held.autoReviewed.length}`);
  for (const { e, got } of held.autoReviewed) console.log(line('?', e.series_name, e.position, got.title, e.note));
}

if (held.silent.length) {
  console.log(`\n  STILL SILENT — short, and proposing nothing: ${held.silent.length}`);
  for (const { e } of held.silent) console.log(line('∅', e.series_name, '-', '', e.note));
}

if (held.noisy.length) {
  console.log(`\n  UNEXPECTED — a complete series proposing volumes: ${held.noisy.length}`);
  for (const { e, count } of held.noisy) console.log(line('!', e.series_name, '-', `${count} proposals`, e.note));
}

if (held.landed.length) {
  console.log(`\n  LANDED — approved, applied, and now in the catalog: ${held.landed.length}`);
  for (const { e } of held.landed) {
    console.log(line('•', e.series_name, e.position, e.title));
  }
}

if (held.surfaced.length) {
  console.log(`\n  SURFACED — not approved, but reported as a position mismatch: ${held.surfaced.length}`);
  console.log('    (the volume is named in the file; our position is what disagrees)');
  for (const { e } of held.surfaced) {
    console.log(line('~', e.series_name, e.position, e.title));
  }
}

const bad = held.regressed.length + held.lost.length + held.wrongTitle.length + held.autoReviewed.length;
console.log(`\n  ${held.kept.length} kept · ${held.landed.length} landed · ${held.fixed.length} fixed · ${held.surfaced.length} surfaced · ${held.regressed.length} regressed · ${held.lost.length} lost · ${held.silent.length} silent\n`);

if (bad === 0 && held.silent.length === 0) {
  console.log('  Agrees with the human review on every row it covers.\n');
} else if (held.regressed.length === 0 && held.wrongTitle.length === 0 && held.autoReviewed.length === 0) {
  console.log('  No wrong row is approved. What is left is caution, not error —\n' +
              '  check the LOST rows are ones you are content to approve by hand.\n');
}

if (STRICT && bad > 0) process.exit(1);
