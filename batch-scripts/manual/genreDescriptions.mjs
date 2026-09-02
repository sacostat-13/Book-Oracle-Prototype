// genreDescriptions.mjs — writes the description for every genre that has none.
//
// WHY THIS EXISTS
// ---------------
// oracleBatch renders the genre catalogue into its prompt as
// "- Name: description", falling back to "- Name" when the description is null.
// A genre that reaches the Oracle as a bare word cannot be matched against, so
// the Oracle does what the prompt tells it to do when nothing fits — it invents
// something. The invention is also created with description = null, so it is
// bare on the next run too.
//
// That is a loop: every undescribed genre is a seed for its own near-duplicate.
// It is the most likely origin of Latin American Literature sitting beside
// International Fiction, and Japanese & East Asian Literary Fiction beside
// East Asian Literary Fiction.
//
// So this is not cosmetic work and it is not a content chore. It is the closing
// half of the categorisation loop, and it belongs immediately AFTER oracleBatch
// in the nightly workflow — genres invented tonight are described tonight,
// before they reach tomorrow's prompt.
//
// IT LIVES IN manual/ BECAUSE IT SPENDS MONEY.
// batch-scripts/README.md: nothing billable belongs in scheduled/. Same rule
// that keeps oracleBatch here; nightly-curation.yml invokes both by explicit
// path and documents the exception. The spend is small — a genre is ~250 input
// tokens of context and ~40 out, so a night that invents five genres costs
// well under a cent — but small is not zero and the rule is about honesty,
// not amount.
//
// IT NEVER OVERWRITES. A description that exists is a curation decision,
// possibly hand-written. This script only fills nulls, and re-checks null at
// write time so a concurrent edit wins.
//
// Usage (from project root):
//   node batch-scripts/manual/genreDescriptions.mjs
//   node batch-scripts/manual/genreDescriptions.mjs --dry-run   # print, no writes
//   node batch-scripts/manual/genreDescriptions.mjs --limit 10

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = 'claude-sonnet-4-5';
const BATCH_SIZE = 12;            // genres per call
const SAMPLE_BOOKS = 6;           // titles shown as evidence per genre
const MAX_DESCRIPTION_CHARS = 320;
const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg
  ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10)
  : null;

// ── Env ───────────────────────────────────────────────────────────────────────
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!DRY_RUN && !ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local (required for non-dry-run)');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

// ── The house voice ───────────────────────────────────────────────────────────
// Locked by example rather than by rule, because the rules alone produce
// competent marketing copy and the examples do not. These are real rows from
// the catalogue, chosen to show the range: a one-line genre, a two-part genre,
// and one that has to draw a boundary against a neighbour.
const VOICE_EXAMPLES = [
  ['French Literature', 'Style treated as a moral question.'],
  ['Pandemic Fiction', 'The disease is fast; the consequences are not.'],
  ['Parallel Worlds', 'The same life, decided differently.'],
  ['Mythology', 'The source material, before the retellings.'],
  ['Dark Comedy', 'Funny, and not entirely a relief.'],
  ['Post-Apocalyptic',
    'After the end, the long business of continuing. Survival, scavenging and the slow reassembly of something like a society in the ruins of the old one.'],
  ['Southern Fiction',
    "Land, kin, and a long memory. Fiction of the American South told without the gothic's dread — small towns, church, cotton and the weight of who your people are."],
  ['Survival Fiction',
    "Food, water, warmth, and nothing else on the list. One person or a few against conditions that do not negotiate — the world is intact, it just isn't helping."],
];

const SYSTEM_PROMPT = `You are the Books Oracle, writing the shelf descriptions for a literary catalogue. You are given genres that have no description yet, and you return one description for each.

THE VOICE — this matters more than anything else here:
- Open with a short declarative sentence that lands what the genre actually is. Not a definition: a judgment. Often it is the best sentence you will write, and sometimes it is the whole description.
- Then, usually, one more sentence naming the concrete territory — what is in it, what it contains, where its edges are.
- One or two sentences. Around 25-35 words. Never more than 45.
- Present tense. Plain, exact, unhurried, a little dry.

NEVER:
- "This genre...", "Books that...", "Stories about...", "A category for..."
- Marketing adjectives: captivating, thrilling, unforgettable, gripping, must-read, beloved, timeless.
- Listing more than three or four concrete nouns in a row.
- Explaining the obvious back to the reader ("Historical fiction is fiction set in history").
- Naming authors unless the genre is genuinely inseparable from them.
- Ending on a hedge.

DRAW THE BOUNDARY. You are given the rest of the catalogue. If a genre could be confused with one already there, the second sentence must say what makes it different, in the genre's own terms — never by naming the other genre. "Fiction of the American South told without the gothic's dread" does this work; "not to be confused with Southern Gothic" does not.

EVIDENCE. Some genres come with sample titles already filed under them. Read them: they tell you what the shelf actually holds, which may be narrower or odder than the name suggests. Describe the real shelf, not the ideal one. If the samples clearly contradict the name, describe what the name means and ignore them.

Return ONLY a JSON array, no prose before or after:
[{"name": "<exact genre name as given>", "description": "<the description>"}]

Return one object per genre given, using the exact name you were given. English only.`;

function buildUserPrompt(targets, catalogue) {
  const voice = VOICE_EXAMPLES
    .map(([n, d]) => `- ${n}: ${d}`).join('\n');

  const existing = catalogue
    .filter((g) => g.description)
    .map((g) => `- ${g.name}: ${g.description}`)
    .join('\n');

  const wanted = targets.map((g) => {
    const parts = [`- ${g.name}`];
    if (g.parentName) parts.push(`  Sits under: ${g.parentName}`);
    parts.push(`  Books filed here: ${g.usage_count ?? 0}`);
    if (g.samples?.length) parts.push(`  Sample titles: ${g.samples.join('; ')}`);
    return parts.join('\n');
  }).join('\n\n');

  return `THE VOICE, by example — match this register exactly:
${voice}

THE REST OF THE CATALOGUE — these already have descriptions. Use them to place the new genres and to avoid describing something the catalogue already covers:
${existing}

WRITE DESCRIPTIONS FOR THESE ${targets.length} GENRES:
${wanted}`;
}

// ── Data ──────────────────────────────────────────────────────────────────────
async function fetchCatalogue() {
  const { data, error } = await supabase
    .from('genres')
    .select('id, name, description, usage_count, parent_id')
    .order('usage_count', { ascending: false })
    .range(0, 4999);

  if (error) {
    console.error('Failed to read genres:', error.message);
    process.exit(1);
  }
  return data || [];
}

// Sample titles are the difference between describing the NAME and describing
// the SHELF. A genre called "Business" with six management titles under it and
// one called "Business" holding economic history want different sentences.
const SAMPLE_CHUNK = 20;

async function fetchSamples(genreIds) {
  const byGenre = new Map(genreIds.map((id) => [id, []]));
  if (genreIds.length === 0) return byGenre;

  for (let i = 0; i < genreIds.length; i += SAMPLE_CHUNK) {
    const chunk = genreIds.slice(i, i + SAMPLE_CHUNK);
    const { data, error } = await supabase
      .from('book_genres')
      .select('genre_id, books:book_id ( title, author )')
      .in('genre_id', chunk)
      .limit(SAMPLE_CHUNK * SAMPLE_BOOKS * 3);

    if (error) {
      // Not fatal: a description written without samples is still a good
      // description. Say so rather than failing the run.
      console.warn(`  sample lookup failed for a chunk: ${error.message}`);
      continue;
    }
    for (const row of data || []) {
      const list = byGenre.get(row.genre_id);
      if (!list || list.length >= SAMPLE_BOOKS || !row.books?.title) continue;
      list.push(row.books.author
        ? `${row.books.title} (${row.books.author})`
        : row.books.title);
    }
  }
  return byGenre;
}

async function callClaude(systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
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
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Book Oracle — Genre descriptions        ║');
  console.log('╚══════════════════════════════════════════╝\n');
  if (DRY_RUN) console.log('  DRY RUN — no API calls, no writes\n');

  const catalogue = await fetchCatalogue();
  const nameById = new Map(catalogue.map((g) => [g.id, g.name]));

  let targets = catalogue.filter((g) => !g.description || !g.description.trim());

  console.log(`  Catalogue: ${catalogue.length} genres, ${catalogue.length - targets.length} described.`);
  console.log(`  Missing a description: ${targets.length}\n`);

  if (targets.length === 0) {
    console.log('  Nothing to do — every genre has a description.\n');
    return;
  }

  // Rarest first. A genre with one book is the one the Oracle is most likely to
  // re-invent instead of reuse, so it is the one whose description buys most.
  targets.sort((a, b) => (a.usage_count ?? 0) - (b.usage_count ?? 0));
  if (LIMIT && targets.length > LIMIT) {
    targets = targets.slice(0, LIMIT);
    console.log(`  Limiting to ${LIMIT} (--limit flag)\n`);
  }

  const samples = await fetchSamples(targets.map((g) => g.id));
  for (const g of targets) {
    g.samples = samples.get(g.id) || [];
    g.parentName = g.parent_id ? nameById.get(g.parent_id) || null : null;
  }

  const batches = Math.ceil(targets.length / BATCH_SIZE);
  console.log(`  ${targets.length} genre(s) in ${batches} batch(es) of up to ${BATCH_SIZE}\n`);

  if (DRY_RUN) {
    console.log(buildUserPrompt(targets.slice(0, BATCH_SIZE), catalogue).slice(0, 1500));
    console.log('\n  ...prompt truncated. Remove --dry-run to write.\n');
    return;
  }

  let written = 0;
  let failed = 0;
  let unmatched = 0;
  let cost = 0;

  for (let b = 0; b < batches; b++) {
    const batch = targets.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    process.stdout.write(`  Batch ${b + 1}/${batches} (${batch.length} genres)... `);

    let parsed = null;
    try {
      const { text, usage } = await callClaude(SYSTEM_PROMPT, buildUserPrompt(batch, catalogue));
      if (usage) {
        cost += (usage.input_tokens / 1e6) * INPUT_COST_PER_M
              + (usage.output_tokens / 1e6) * OUTPUT_COST_PER_M;
      }
      parsed = parseJSON(text);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed += batch.length;
      continue;
    }

    if (!Array.isArray(parsed)) {
      console.log('FAILED: response was not a JSON array');
      failed += batch.length;
      continue;
    }

    const byName = new Map(parsed.map((r) => [String(r.name || '').trim(), r]));
    let batchWritten = 0;

    for (const genre of batch) {
      const item = byName.get(genre.name);
      const description = String(item?.description || '').trim();

      if (!description) {
        unmatched++;
        continue;
      }
      if (description.length > MAX_DESCRIPTION_CHARS) {
        console.log(`\n    over length, skipped: ${genre.name} (${description.length} chars)`);
        unmatched++;
        continue;
      }

      // Re-check null at write time. A description that exists is a curation
      // decision — possibly one made by hand while this run was in flight — and
      // must win over anything generated here.
      const { data, error } = await supabase
        .from('genres')
        .update({ description })
        .eq('id', genre.id)
        .is('description', null)
        .select('id');

      if (error) {
        console.log(`\n    write failed: ${genre.name} — ${error.message}`);
        failed++;
        continue;
      }
      if (!data || data.length === 0) continue;   // described by someone else meanwhile
      batchWritten++;
      written++;
    }

    console.log(`OK  (${batchWritten} written)`);
  }

  console.log('\n  ┌─ Results ─────────────────────────────────');
  console.log(`  │  Written:      ${written}`);
  console.log(`  │  Failed:       ${failed}`);
  console.log(`  │  No usable answer: ${unmatched}`);
  console.log(`  │  Actual cost:  ~$${cost.toFixed(4)}`);
  console.log('  └───────────────────────────────────────────\n');

  // Machine-readable, for the workflow summary step to grep. Same convention as
  // metadataBackfill's `[metadataBackfill] descriptions=N genres=N ...` line.
  console.log(`[genreDescriptions] written=${written} failed=${failed} unusable=${unmatched} cost=${cost.toFixed(4)}`);

  const { count: stillNull } = await supabase
    .from('genres')
    .select('id', { count: 'exact', head: true })
    .is('description', null);

  if ((stillNull ?? 0) > 0) {
    console.warn(
      `\n  ${stillNull} genre(s) still have no description. They will reach the Oracle ` +
      `as bare names on the next run and are likely to be re-invented rather than reused.`
    );
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
