// splitCompoundGenre.mjs — split one compound genre into its halves, by asking
// the Oracle which half (or both) each book belongs to.
//
// WHY A SCRIPT AND NOT A MIGRATION
// --------------------------------
// "Feminist & Sapphic Gothic" holds 105 books and is genuinely two genres: a
// feminist gothic need not be sapphic, and a sapphic gothic need not be
// feminist. No SQL can tell which books are which — it is a per-book judgment
// about the text, which is exactly what the Oracle is for.
//
// Contrast with the compounds that must NOT be split. `merge_genres()` and the
// naming-rule migration handled two other shapes:
//   - one idea in two words  (Comedy & Wit, Demons & Monsters) — leave alone
//   - one idea said twice    (Japanese & East Asian Horror)    — a rename
// Only "two genuinely different ideas" reaches this script.
//
// SAFETY
// ------
// Nothing is destroyed. The halves are created, links are added, and the
// compound is left in place with its books intact until you run --retire as a
// separate decision. Re-running is harmless: link inserts are ON CONFLICT DO
// NOTHING and books already classified are skipped.
//
// Lives in manual/ because it spends money — batch-scripts/README.md's rule.
// ~105 books at the observed ~$0.0023/book is about 25 cents.
//
// Usage (from project root):
//   node batch-scripts/manual/splitCompoundGenre.mjs --dry-run
//   node batch-scripts/manual/splitCompoundGenre.mjs
//   node batch-scripts/manual/splitCompoundGenre.mjs --retire   # after review

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL = 'claude-sonnet-4-5';
const BATCH_SIZE = 20;
const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;

// The one split we have decided on. Deliberately a constant rather than a CLI
// argument: which compounds are two ideas and which are one is a curation
// judgment that belongs in the repo, reviewed in a diff, not typed at a prompt.
const SPLIT = {
  compound: 'feministsapphicgothic',
  halves: [
    {
      name: 'Feminist Gothic',
      normalized: 'feministgothic',
      description:
        'The house was never neutral. Gothic written from inside women\'s constraint — the marriage, the attic, the doctor, and the long habit of not being believed.',
    },
    {
      name: 'Sapphic Gothic',
      normalized: 'sapphicgothic',
      description:
        'Desire that the house also wants to keep secret. Gothic where the haunting and the longing are the same shape, and both are between women.',
    },
  ],
  // Every book keeps the parent shelf regardless of which half it lands on.
  keepParent: 'gothic',
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RETIRE = args.includes('--retire');
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : null;

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
  })
);
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_KEY'] || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!DRY_RUN && !RETIRE && !ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local');
  process.exit(1);
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

const SYSTEM_PROMPT = `You are the Books Oracle, re-shelving books that were filed under one compound genre that is really two.

For each book decide which of these it belongs to. A book may belong to BOTH, and often will — but do not assign both by default.

- "Feminist Gothic": gothic written from inside women's constraint. Marriage, confinement, medical authority, inheritance, the long habit of not being believed. The horror is what is done to women, or what women are pushed to.
- "Sapphic Gothic": gothic where desire between women is central — explicit or coded — and the haunting and the longing are the same shape.

RULES
- Judge the book, not the author.
- Coded and historical texts count: Carmilla is Sapphic Gothic; a nineteenth-century novel need not say the word.
- A book with a woman protagonist is not automatically Feminist Gothic. The constraint has to be the subject.
- If you do not know the book, return an empty array for it. An honest omission is worth more than a guess — the book keeps its current shelf and a human can look at it.

Return ONLY a JSON array, no prose:
[{"title": "<exact title as given>", "halves": ["Feminist Gothic"] | ["Sapphic Gothic"] | ["Feminist Gothic","Sapphic Gothic"] | []}]`;

async function callClaude(userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return {
    text: d.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || null,
    usage: d.usage || null,
  };
}

function parseJSON(raw) {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const a = body.indexOf('['), b = body.lastIndexOf(']');
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

async function genreByNorm(norm) {
  const { data } = await supabase.from('genres').select('id, name, family_id, parent_id').eq('normalized_name', norm).maybeSingle();
  return data || null;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Book Oracle — split a compound genre    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const compound = await genreByNorm(SPLIT.compound);
  if (!compound) { console.error(`No genre with normalized_name "${SPLIT.compound}".`); process.exit(1); }
  console.log(`  Splitting: ${compound.name}`);

  // ── retire ────────────────────────────────────────────────────────────────
  if (RETIRE) {
    const halves = await Promise.all(SPLIT.halves.map((h) => genreByNorm(h.normalized)));
    if (halves.some((h) => !h)) { console.error('  Halves not created yet — run without --retire first.'); process.exit(1); }
    const { count: unclassified } = await supabase
      .from('book_genres').select('book_id', { count: 'exact', head: true }).eq('genre_id', compound.id);
    const { data: links } = await supabase.from('book_genres').select('book_id').eq('genre_id', compound.id);
    const ids = (links || []).map((r) => r.book_id);
    let stranded = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { data } = await supabase.from('book_genres').select('book_id')
        .in('book_id', chunk).in('genre_id', halves.map((h) => h.id));
      stranded += chunk.length - new Set((data || []).map((r) => r.book_id)).size;
    }
    console.log(`  ${unclassified} book(s) on the compound, ${stranded} of them on NEITHER half.`);
    if (stranded > 0) {
      console.error('\n  Refusing to retire: those books would lose their only specific shelf.');
      console.error('  Re-run the classification, or assign them by hand, then retire.\n');
      process.exit(1);
    }
    console.log('\n  Every book is on at least one half. Retire with:');
    console.log(`    select merge_genres('${compound.id}', '<the id of Gothic>');`);
    console.log('  (merge_genres moves any remaining links, repoints books.genre, and deletes the row.)\n');
    return;
  }

  // ── create the halves ─────────────────────────────────────────────────────
  const gothic = await genreByNorm(SPLIT.keepParent);
  for (const h of SPLIT.halves) {
    const existing = await genreByNorm(h.normalized);
    if (existing) { console.log(`  ${h.name} — already exists`); continue; }
    if (DRY_RUN) { console.log(`  ${h.name} — would create`); continue; }
    const { error } = await supabase.from('genres').insert({
      name: h.name, normalized_name: h.normalized, description: h.description,
      source: 'admin',
      parent_id: gothic?.id || compound.parent_id || null,
      family_id: compound.family_id || null,
    });
    if (error) { console.error(`  failed to create ${h.name}: ${error.message}`); process.exit(1); }
    console.log(`  ${h.name} — created`);
  }

  const halfRows = {};
  for (const h of SPLIT.halves) {
    const row = await genreByNorm(h.normalized);
    if (row) halfRows[h.name] = row.id;
  }

  // ── the books still needing a half ────────────────────────────────────────
  const { data: links } = await supabase.from('book_genres').select('book_id').eq('genre_id', compound.id);
  const allIds = (links || []).map((r) => r.book_id);
  const done = new Set();
  const halfIds = Object.values(halfRows);
  if (halfIds.length) {
    for (let i = 0; i < allIds.length; i += 50) {
      const { data } = await supabase.from('book_genres').select('book_id')
        .in('book_id', allIds.slice(i, i + 50)).in('genre_id', halfIds);
      for (const r of data || []) done.add(r.book_id);
    }
  }
  let todo = allIds.filter((id) => !done.has(id));
  console.log(`\n  ${allIds.length} book(s) on the compound; ${done.size} already classified; ${todo.length} to do.`);
  if (LIMIT) todo = todo.slice(0, LIMIT);
  if (!todo.length) { console.log('  Nothing to do.\n'); return; }

  const books = [];
  for (let i = 0; i < todo.length; i += 50) {
    const { data } = await supabase.from('books').select('id, title, author, description')
      .in('id', todo.slice(i, i + 50));
    books.push(...(data || []));
  }

  const batches = Math.ceil(books.length / BATCH_SIZE);
  console.log(`  ${books.length} book(s) in ${batches} batch(es)\n`);
  if (DRY_RUN) {
    console.log('  Sample of what would be sent:\n');
    console.log(books.slice(0, 3).map((b, i) => `${i + 1}. "${b.title}" — ${b.author || 'unknown'}`).join('\n'));
    console.log('\n  DRY RUN — no API calls, no writes.\n');
    return;
  }

  let written = 0, unresolved = 0, cost = 0;
  for (let bi = 0; bi < batches; bi++) {
    const batch = books.slice(bi * BATCH_SIZE, (bi + 1) * BATCH_SIZE);
    process.stdout.write(`  Batch ${bi + 1}/${batches} (${batch.length})... `);
    const prompt = batch.map((b, i) =>
      `${i + 1}. Title: "${b.title}"\n   Author: ${b.author || 'unknown'}` +
      (b.description ? `\n   Description: ${b.description.slice(0, 240)}` : '')
    ).join('\n\n');

    let parsed = null;
    try {
      const { text, usage } = await callClaude(prompt);
      if (usage) cost += (usage.input_tokens / 1e6) * INPUT_COST_PER_M + (usage.output_tokens / 1e6) * OUTPUT_COST_PER_M;
      parsed = parseJSON(text);
    } catch (e) { console.log(`FAILED: ${e.message}`); continue; }
    if (!Array.isArray(parsed)) { console.log('FAILED: not a JSON array'); continue; }

    const byTitle = new Map(parsed.map((r) => [String(r.title || '').trim().toLowerCase(), r]));
    const rows = [];
    for (const b of batch) {
      const hit = byTitle.get(String(b.title).trim().toLowerCase());
      const halves = Array.isArray(hit?.halves) ? hit.halves.filter((h) => halfRows[h]) : [];
      if (!halves.length) { unresolved++; continue; }
      for (const h of halves) rows.push({ book_id: b.id, genre_id: halfRows[h] });
    }
    if (rows.length) {
      // assigned_by_source names the pass that wrote the link — see the note in
      // batch-scripts/README.md about the column that was called `source` and
      // silently rejected every insert.
      const { error } = await supabase.from('book_genres')
        .upsert(rows.map((r) => ({ ...r, assigned_by_source: 'oracle' })), { onConflict: 'book_id,genre_id', ignoreDuplicates: true });
      if (error) { console.log(`write failed: ${error.message}`); continue; }
      written += rows.length;
    }
    console.log(`OK  (${rows.length} link(s))`);
  }

  // No recount call here: `bump_genre_usage` is a trigger on book_genres, so
  // usage_count is already correct for both halves. A .rpc() to a function that
  // does not exist would have failed silently inside a .catch() and looked like
  // it worked — which is the failure shape this codebase keeps rediscovering.

  console.log('\n  ┌─ Results ─────────────────────────────────');
  console.log(`  │  Links written:      ${written}`);
  console.log(`  │  Oracle had no view: ${unresolved} (kept on the compound)`);
  console.log(`  │  Actual cost:        ~$${cost.toFixed(4)}`);
  console.log('  └───────────────────────────────────────────\n');
  console.log('  Review the two new shelves, then run with --retire to check');
  console.log('  nothing was stranded before folding the compound away.\n');
}

main().catch((e) => { console.error('\nFatal:', e); process.exit(1); });
