// authorGenderBackfill.mjs — one-shot backfill of books.author_gender.
//
// WHY THIS EXISTS
// ---------------
// author_gender and author_gender_checked_at were added in v0.55 for the
// "books by women" accomplishment (see shareMoments.js). The rules for filling
// them live in src/lib/oracleCategorizationService.js — but that module stopped
// running in the browser at v0.61, and oracleBatch.mjs, which is supposed to
// mirror its prompt, never picked the field up. Grep oracleBatch for "gender":
// zero hits. So the column has been empty for every book since the day it
// shipped.
//
// This script fills it, once, for the catalog as it stands. It deliberately
// does NOT touch oracleBatch's selection query — widening that `.or()` would
// make every oracle_categorized book eligible again on the nightly cron, which
// is a recurring charge nobody approved. A one-shot manual pass is the honest
// shape for one-shot work.
//
// KEYED ON AUTHOR, NOT BOOK
// -------------------------
// Gender is a property of a person, not of a book. Asking once per book re-asks
// for every Le Guin title separately. This groups the catalog by author, asks
// once per distinct author, and writes the answer to all of that author's
// books. On a catalog with any repeat authors that is a straight multiple off
// the cost, and — more importantly — it makes the answer consistent: the same
// author can't come back "female" for one book and "unknown" for another.
//
// NO WEB SEARCH, BY DESIGN
// ------------------------
// curateManualBooks.mjs pays ~4c/book for Claude + web search because it is
// repairing identity, where being wrong corrupts normalized_key. This is not
// that. Model knowledge covers the well-known authors, the prompt is strict
// that a name is never evidence, and everything else comes back "unknown" —
// which is a correct and expected answer here, not a failure. Budget ~$0.40 per
// 1,000 distinct authors against ~$40 for the web-search shape.
//
// Re-runnable. Only ever considers rows where author_gender_checked_at IS NULL,
// and stamps that timestamp even for "unknown" — so an honest shrug is recorded
// as asked-and-answered and never re-billed. That timestamp is the same signal
// getBooksNeedingOracle() reads via `agChecked`; without the stamp it loops.
//
// Usage (from repo root):
//   node batch-scripts/manual/authorGenderBackfill.mjs --dry-run --verbose
//   node batch-scripts/manual/authorGenderBackfill.mjs --limit 100
//   node batch-scripts/manual/authorGenderBackfill.mjs
//   node batch-scripts/manual/authorGenderBackfill.mjs --include-discovered
//
// Flags:
//   --dry-run             report scope + cost estimate, call nothing, write nothing
//   --limit N             process at most N distinct AUTHORS (not books)
//   --verbose             per-author results
//   --include-discovered  also sweep 'discovered' books (default: excluded —
//                         nobody has added them to a collection yet)
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
//
// Writes batch-scripts/output/author-gender.csv for review. Gitignored.

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'output', 'author-gender.csv');

const MODEL = 'claude-sonnet-4-5';

// Authors per Anthropic call. The output is one short enum per author — a few
// tokens each — so this is bounded by input length and clerical accuracy, not
// by generation time. 50 keeps the numbered list short enough that index
// alignment stays reliable; oracleBatch's much lower 10 is set by its 2-4
// sentence descriptions, which this prompt does not ask for.
const BATCH_SIZE = 50;

// Approximate token costs (USD per million), Sonnet.
const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;
// Per batch: ~700 token system prompt + ~25 tokens per author line.
const EST_INPUT_TOKENS_PER_BATCH = 700;
const EST_INPUT_TOKENS_PER_AUTHOR = 25;
const EST_OUTPUT_TOKENS_PER_AUTHOR = 20;

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;
const BATCH_DELAY_MS = 500;

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const INCLUDE_DISCOVERED = args.includes('--include-discovered');

function numArg(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  const v = a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
const LIMIT = numArg('--limit', null);

// ── Env ───────────────────────────────────────────────────────────────────────
// Same parser as oracleBatch.mjs / curateManualBooks.mjs. Both ANTHROPIC_API_KEY
// and the legacy short ANTHROPIC_KEY are accepted, matching oracleBatch — CI
// composes .env.local from the long-named secret, hand-written local files
// sometimes carry the short one.
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim().replace(/^export\s+/, ''),
        l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ''),
      ];
    })
);

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
// Legacy service_role JWTs are being retired (docs/KEY_ROTATION.md). That
// runbook's call is that the variable NAME stays SUPABASE_SERVICE_ROLE_KEY and
// only the value changes to an sb_secret_… key — renaming thirteen call sites
// mid-rotation risks more than the inaccurate label costs. SUPABASE_SECRET_KEY
// is accepted first anyway, matching the chain netlify/functions/_shared/auth.js
// already uses, so a .env.local written under either name works.
const SERVICE_KEY = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

// A legacy JWT still sitting in .env.local after the rotation fails at the first
// query with an opaque PostgREST 401, which reads like a bug in the script.
// Say so up front instead.
if (SERVICE_KEY.startsWith('eyJ')) {
  console.warn(
    '  ⚠ The Supabase key in .env.local is a legacy service_role JWT.\n' +
    '    If legacy keys are disabled on the project this will 401 on the first\n' +
    '    query. Replace the value with an sb_secret_… key — see docs/KEY_ROTATION.md.\n'
  );
}
if (!DRY_RUN && !ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local (required for non-dry-run)');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

// ── Validation ────────────────────────────────────────────────────────────────
// Mirrors src/lib/oracleCategorizationService.js. Anything else → null → the
// field is not written and the author stays eligible for a later run. Never
// write a value the enum doesn't have; a bad write is worse than a missing one.
const VALID_AUTHOR_GENDERS = new Set(['female', 'male', 'nonbinary', 'mixed', 'unknown']);

function sanitizeAuthorGender(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return VALID_AUTHOR_GENDERS.has(s) ? s : null;
}

// ── Author grouping ───────────────────────────────────────────────────────────
// Group key only — never written anywhere. Case and punctuation vary across the
// lookup chain ("Ursula K. Le Guin" / "Ursula K Le Guin" / "URSULA K. LE GUIN"),
// and three separate Anthropic calls for one person is the exact waste this
// script exists to avoid.
//
// Deliberately NOT normalising word order: "Le Guin, Ursula K." stays a distinct
// key. Reordering names correctly requires knowing which part is the surname,
// which varies by culture, and a wrong merge writes one person's gender onto
// another's books. Paying for one extra call is the cheaper mistake.
function authorKey(author) {
  return (author || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pick the tidiest spelling seen for an author to send to the model: the
// variant with the most capital letters, tie-broken by length. "Ursula K. Le
// Guin" beats "ursula k le guin" — better recognition, and it is what lands in
// the review CSV.
function bestDisplayName(variants) {
  return [...variants].sort((a, b) => {
    const capsA = (a.match(/[A-Z]/g) || []).length;
    const capsB = (b.match(/[A-Z]/g) || []).length;
    if (capsA !== capsB) return capsB - capsA;
    return b.length - a.length;
  })[0];
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
// Supabase caps a select at 1000 rows by default, and this is explicitly a
// whole-catalog sweep — so page it. Ordering by id (stable, unique) rather than
// created_at, which can tie and silently skip or duplicate rows across pages.
const PAGE_SIZE = 1000;

async function fetchUncheckedBooks() {
  const rows = [];
  let from = 0;

  for (;;) {
    let q = supabase
      .from('books')
      .select('id, title, author, status')
      .is('author_gender_checked_at', null)
      .not('author', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (!INCLUDE_DISCOVERED) q = q.neq('status', 'discovered');

    const { data, error } = await q;
    if (error) {
      console.error('Failed to fetch books:', error.message);
      process.exit(1);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function groupByAuthor(books) {
  const map = new Map();
  for (const b of books) {
    const name = (b.author || '').trim();
    if (!name) continue;
    const key = authorKey(name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, variants: new Set(), bookIds: [], titles: [] });
    const g = map.get(key);
    g.variants.add(name);
    g.bookIds.push(b.id);
    if (g.titles.length < 3) g.titles.push(b.title);
  }

  // Most books first: if a --limit cuts the run short, the authors covering the
  // most of the catalog are the ones that got done.
  return [...map.values()]
    .map((g) => ({ ...g, display: bestDisplayName(g.variants) }))
    .sort((a, b) => b.bookIds.length - a.bookIds.length);
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
      }
      if (!res.ok) {
        // 4xx other than 429 is a bad request — retrying sends the same bad
        // request again. Fail loudly instead of burning the retry budget.
        console.error(`Anthropic API error ${res.status}: ${await res.text()}`);
        return null;
      }

      const d = await res.json();
      return d.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || null;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
        vlog(`retry ${attempt}/${MAX_RETRIES - 1} in ${wait}ms — ${e.message}`);
        await sleep(wait);
      }
    }
  }
  console.error(`  ! giving up after ${MAX_RETRIES} attempts: ${lastErr?.message}`);
  return null;
}

function parseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────
// The rules are lifted verbatim from AUTHOR GENDER RULES in
// src/lib/oracleCategorizationService.js. Keep them that way. That block is the
// canonical statement, and this script existing at all is the direct result of
// oracleBatch.mjs paraphrasing a prompt instead of mirroring it.
function buildPrompt(group) {
  const systemPrompt = `You identify the gender of book authors for a library catalog. You are given a numbered list of author names, each with up to three of their titles as disambiguation. Return one answer per author.

AUTHOR GENDER RULES (strict — read carefully):
- Return one of: "female", "male", "nonbinary", "mixed", "unknown".
- Only return "female", "male", or "nonbinary" when you have a real, reliable
  public signal: the author's own stated pronouns/identity, an official bio,
  publisher copy, or a well-known interview. Being confident the name "sounds"
  female or male is NOT a reliable signal — names are not a reliable indicator
  of gender, and guessing from one risks misgendering a real person. If you
  are not certain from an actual biographical fact, return "unknown".
- Use "mixed" for entries crediting multiple authors/editors whose genders are
  not all the same (anthologies, co-authored nonfiction).
- "unknown" is a normal, expected, frequent answer here — do not strain to
  produce a definite value. A wrong guess is worse than an honest "unknown".
- The titles are disambiguation only, for telling two authors of the same name
  apart. They are not evidence of gender. A book about women does not imply a
  female author.
- If the entry is not a person's name at all (a publisher, "Various", "Unknown",
  a corrupted string), return "unknown".

RESPONSE FORMAT (JSON array, one object per author, in input order):
[{"index":1,"gender":"female"}]
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.`;

  const authorList = group.map((g, i) => {
    const titles = g.titles.filter(Boolean).slice(0, 3).map((t) => `"${t}"`).join(', ');
    return `${i + 1}. ${g.display}${titles ? `\n   Titles: ${titles}` : ''}`;
  }).join('\n');

  const userPrompt = `Identify the gender of these ${group.length} authors:\n\n${authorList}`;
  return { systemPrompt, userPrompt };
}

// ── Write-back ────────────────────────────────────────────────────────────────
// Stamps author_gender_checked_at for EVERY resolved author, "unknown"
// included. That is the entire mechanism preventing a re-run from re-billing
// the same shrug: `ag` collapses 'unknown' and never-checked into undefined on
// the client, so the timestamp is the only signal that distinguishes them.
// Dropping this line does not break anything visibly — it just makes the
// catalog permanently, silently eligible forever.
async function writeAuthorGender(group, gender) {
  const checkedAt = new Date().toISOString();

  // Chunked: .in() builds a URL-encoded filter, and a prolific author with
  // hundreds of books would otherwise produce a request line long enough for
  // PostgREST to reject.
  const CHUNK = 100;
  for (let i = 0; i < group.bookIds.length; i += CHUNK) {
    const ids = group.bookIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('books')
      .update({
        author_gender: gender,
        // Constrained to 'oracle_inferred' | 'verified' | 'self_identified'.
        // Everything this script writes is inference from model knowledge with
        // no web search, so it is never anything but the first. Recording it is
        // what makes a later hand-correction distinguishable and protectable.
        author_gender_source: 'oracle_inferred',
        author_gender_checked_at: checkedAt,
      })
      .in('id', ids);
    if (error) {
      console.error(`  ! write failed for ${group.display}: ${error.message}`);
      return false;
    }
  }
  return true;
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(results) {
  const header = 'author,gender,books,sample_title\n';
  const body = results
    .map((r) => [r.display, r.gender, r.bookCount, r.titles[0] || ''].map(csvCell).join(','))
    .join('\n');
  writeFileSync(CSV_PATH, header + body + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n❦  Author gender backfill\n');

  const books = await fetchUncheckedBooks();
  const allGroups = groupByAuthor(books);
  const groups = LIMIT ? allGroups.slice(0, LIMIT) : allGroups;

  const bookCount = groups.reduce((n, g) => n + g.bookIds.length, 0);
  const batches = Math.ceil(groups.length / BATCH_SIZE);

  console.log(`  Books unchecked ....... ${books.length}${INCLUDE_DISCOVERED ? '' : "  (excludes status='discovered')"}`);
  console.log(`  Distinct authors ...... ${allGroups.length}`);
  if (LIMIT) console.log(`  Limited to ............ ${groups.length} authors (${bookCount} books)`);
  console.log(`  Batches ............... ${batches} × ${BATCH_SIZE}`);

  const estIn = batches * EST_INPUT_TOKENS_PER_BATCH + groups.length * EST_INPUT_TOKENS_PER_AUTHOR;
  const estOut = groups.length * EST_OUTPUT_TOKENS_PER_AUTHOR;
  const estCost = (estIn / 1e6) * INPUT_COST_PER_M + (estOut / 1e6) * OUTPUT_COST_PER_M;
  console.log(`  Estimated cost ........ $${estCost.toFixed(2)}\n`);

  if (groups.length === 0) {
    console.log('  Nothing to do — every author has already been checked.\n');
    return;
  }

  if (DRY_RUN) {
    console.log('  --dry-run: no API calls, no writes.\n');
    if (VERBOSE) {
      for (const g of groups.slice(0, 40)) vlog(`${g.display}  (${g.bookIds.length} books)`);
      if (groups.length > 40) vlog(`… and ${groups.length - 40} more`);
    }
    return;
  }

  const results = [];
  const tally = { female: 0, male: 0, nonbinary: 0, mixed: 0, unknown: 0 };
  let booksWritten = 0;
  let failed = 0;

  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    const batch = groups.slice(i, i + BATCH_SIZE);
    const n = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Batch ${n}/${batches} (${batch.length} authors) … `);

    const { systemPrompt, userPrompt } = buildPrompt(batch);
    const raw = await callClaude(systemPrompt, userPrompt);
    const parsed = parseJSON(raw);

    if (!Array.isArray(parsed)) {
      console.log('failed to parse — skipped');
      failed += batch.length;
      continue;
    }

    // Index by the model's own `index` rather than array position. A dropped or
    // reordered element would otherwise shift every subsequent author by one
    // and write real genders onto the wrong people — silently, and to the
    // shared catalog every user reads.
    const byIndex = new Map();
    for (const item of parsed) {
      const idx = Number(item?.index);
      if (Number.isInteger(idx) && idx >= 1 && idx <= batch.length) byIndex.set(idx, item);
    }

    let ok = 0;
    for (let j = 0; j < batch.length; j++) {
      const g = batch[j];
      const item = byIndex.get(j + 1);
      const gender = sanitizeAuthorGender(item?.gender);

      if (!gender) {
        vlog(`? ${g.display} — no valid answer, left unchecked`);
        failed++;
        continue;
      }

      const wrote = await writeAuthorGender(g, gender);
      if (!wrote) { failed++; continue; }

      tally[gender]++;
      booksWritten += g.bookIds.length;
      ok++;
      results.push({ display: g.display, gender, bookCount: g.bookIds.length, titles: g.titles });
      vlog(`${gender === 'unknown' ? '·' : '✓'} ${g.display} → ${gender}  (${g.bookIds.length} books)`);
    }

    console.log(`${ok} written`);
    if (i + BATCH_SIZE < groups.length) await sleep(BATCH_DELAY_MS);
  }

  writeCsv(results);

  const resolved = tally.female + tally.male + tally.nonbinary + tally.mixed;
  console.log('\n  ── Summary ──');
  console.log(`  Authors resolved ...... ${resolved}`);
  console.log(`    female .............. ${tally.female}`);
  console.log(`    male ................ ${tally.male}`);
  console.log(`    nonbinary ........... ${tally.nonbinary}`);
  console.log(`    mixed ............... ${tally.mixed}`);
  console.log(`  Answered "unknown" .... ${tally.unknown}   (stamped as checked — not re-billed)`);
  if (failed) console.log(`  Left unchecked ........ ${failed}   (re-run to retry)`);
  console.log(`  Books updated ......... ${booksWritten}`);
  console.log(`\n  Review: batch-scripts/output/author-gender.csv\n`);
}

main().catch((e) => {
  console.error('\nFatal:', e);
  process.exit(1);
});
