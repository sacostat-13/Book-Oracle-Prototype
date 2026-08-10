// oracleBatch.mjs — v0.22: also backfills complexity + depth for older
// oracle_categorized books that predate those fields.
// Standalone Node.js script to run Oracle enrichment (genres + series +
// description + complexity + depth) over all eligible books in the Supabase DB.
//
// complexity/depth were previously "curated only" — every book added via
// Hardcover/OpenLibrary/Goodreads import or manual entry has them null. This
// script (and the in-app "Let the Oracle categorize my books" button, which
// mirrors this same prompt) is how that gets backfilled at scale.
//
// Runs outside the browser — calls Anthropic API directly (no Netlify proxy).
// Uses the service role key to bypass RLS and reach all users' books.
//
// Usage (from project root):
//   node scripts/oracleBatch.mjs            # run enrichment
//   node scripts/oracleBatch.mjs --dry-run  # estimate cost, no API calls
//   node scripts/oracleBatch.mjs --limit 50 # process at most N books
//
// Required env vars in .env.local:
//   VITE_SUPABASE_URL          Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY  Service role key (bypasses RLS) — NEVER commit
//   ANTHROPIC_API_KEY           (console.anthropic.com)
//
// Cost model (approximate, Sonnet):
//   ~800 input tokens + ~300 output tokens per book
//   Input:  $3.00 / 1M tokens  → ~$0.0024 per book
//   Output: $15.00 / 1M tokens → ~$0.0045 per book
//   Total:  ~$0.007 per book (~$7 per 1000 books)

import {
  createClient
} from '@supabase/supabase-js';
import {
  readFileSync
} from 'fs';
import {
  dirname,
  join
} from 'path';
import {
  fileURLToPath
} from 'url';

const __dirname = dirname(fileURLToPath(
  import.meta.url));
const BATCH_SIZE = 20;
const MODEL = 'claude-sonnet-4-5';

// Approximate token costs (USD per million)
const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;
const EST_INPUT_TOKENS_PER_BOOK = 800;
const EST_OUTPUT_TOKENS_PER_BOOK = 300;

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : null;

// ── Env ───────────────────────────────────────────────────────────────────────
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const idx = l.indexOf('=');
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')];
  })
);

const SUPABASE_URL = "https://wwkqgnbnacajeqpdedbp.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3a3FnbmJuYWNhamVxcGRlZGJwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDA2NDQxNiwiZXhwIjoyMDk1NjQwNDE2fQ.Jak1Xj8Ox4tAEITDgzcR9EERE-6pjncu5C46RvwUJy4";
const ANTHROPIC_KEY = "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";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!DRY_RUN && !ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local (required for non-dry-run)');
  process.exit(1);
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Fetch eligible books ──────────────────────────────────────────────────────
async function fetchEligibleBooks() {
  // Two eligible groups:
  //   1. Never processed — status is unreviewed/incomplete. Gets full
  //      enrichment (genres + series + description + complexity + depth).
  //   2. Already oracle_categorized under an older version of this script,
  //      from before complexity/depth existed — those two columns are still
  //      null. These get complexity/depth backfilled ONLY; writeEnrichment
  //      is told (via `backfillOnly` in main()) to leave their existing
  //      genres/series/description untouched.
  // Excludes 'discovered' books — no one has added them yet
  const {
    data,
    error
  } = await supabase
    .from('books')
    .select(`
      id,
      title,
      author,
      description,
      pages,
      status,
      complexity,
      depth,
      series_id,
      position_in_series,
      series:series_id ( name )
    `)
    .or('status.in.(unreviewed,incomplete),and(status.eq.oracle_categorized,or(complexity.is.null,depth.is.null))')
    .order('created_at', {
      ascending: true
    });

  if (error) {
    console.error('Failed to fetch books:', error.message);
    process.exit(1);
  }
  return data || [];
}

async function fetchExistingGenres() {
  const {
    data,
    error
  } = await supabase.rpc('search_genres', {
    _query: '',
    _limit: 200
  });
  if (error) {
    console.warn('fetchAllGenres failed:', error.message);
    return [];
  }
  return data || [];
}

// ── Claude API (direct, not via Netlify proxy) ────────────────────────────────
async function callClaudeDirect(systemPrompt, userPrompt) {
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
      messages: [{
        role: 'user',
        content: userPrompt
      }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${t}`);
  }
  const d = await res.json();
  return d.content ?.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || null;
}

function parseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}

// ── Prompt builder (mirrors oracleCategorizationService.js) ──────────────────
function buildPrompt(books, existingGenres) {
  const catalogList = existingGenres
    .map((g) => g.description ? `- ${g.name}: ${g.description}` : `- ${g.name}`)
    .join('\n');

  const bookList = books.map((b, i) => {
    const parts = [`${i + 1}. Title: "${b.title || 'Unknown'}"`];
    if (b.author) parts.push(`   Author: ${b.author}`);
    if (b.series ?.name) parts.push(`   Series hint: ${b.series.name}`);
    if (b.description) {
      const d = b.description.length > 300 ? b.description.slice(0, 300) + '...' : b.description;
      parts.push(`   Description: ${d}`);
    }
    return parts.join('\n');
  }).join('\n\n');

  const systemPrompt = `You are the Book Oracle, a literary curator. For each book return genres, series info, a description, complexity, and depth.

GENRE RULES: Prefer existing catalog genres. 1-3 per book. Only invent when nothing fits.
SERIES RULES: null for standalone books. "total" may be null for ongoing series.
DESCRIPTION RULES: 2-4 sentences. Evocative, literary, informative. English only.
COMPLEXITY RULES (prose difficulty, 1-5): 1=casual/page-turners, 2=mid-difficulty, 3=literary, 4=challenging (Faulkner, Han Kang), 5=experimental (Donoso, Lispector). Judge sentence structure/vocabulary/technique, not length or genre.
DEPTH RULES (thematic/genre depth, 1-5): how demanding the themes are within the book's own genre, not prose difficulty — a simply-written book can still be high-depth. Always return an integer 1-5 for both, never null, even if unsure.

EXISTING GENRE CATALOG:
${catalogList || '(empty — you are seeding the catalog)'}

RESPONSE FORMAT (JSON array, input order):
[{"index":1,"genres":["Genre"],"series":{"name":"Name","n":1,"total":3},"description":"Text.","complexity":1-5,"depth":1-5}]
Return ONLY valid JSON.`;

  const userPrompt = `Enrich these ${books.length} books:\n\n${bookList}`;
  return {
    systemPrompt,
    userPrompt
  };
}

// ── Write-back ────────────────────────────────────────────────────────────────
// Genre name normaliser matching the DB's normalize_genre_name() function.
function normalizeGenreName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// upsert_genre RPC requires auth.uid() which is null with the service role key.
// Instead we do a direct INSERT ... ON CONFLICT DO NOTHING and then SELECT.
// The service role bypasses RLS so both operations work fine.
async function resolveGenreId(name, genreCache) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return null;
  const normalized = normalizeGenreName(trimmed);
  if (!normalized) return null;

  // Check local cache first (avoids redundant DB round-trips per batch)
  if (genreCache.has(normalized)) return genreCache.get(normalized);

  // Try to insert; on conflict (normalized_name already exists) do nothing
  await supabase.from('genres').upsert({
    name: trimmed,
    normalized_name: normalized,
    source: 'oracle',
  }, {
    onConflict: 'normalized_name',
    ignoreDuplicates: true
  });

  // Now fetch the id (whether we just inserted or it already existed)
  const {
    data,
    error
  } = await supabase
    .from('genres')
    .select('id')
    .eq('normalized_name', normalized)
    .single();

  if (error || !data) {
    console.warn('resolveGenreId failed for:', trimmed, error ?.message);
    return null;
  }
  genreCache.set(normalized, data.id);
  return data.id;
}

// Series name normaliser matching normalize_series_name() in the DB.
function normalizeSeriesName(name) {
  return name.toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

// Clamp to an integer 1-5, or null if unusable — never write a bad value.
function sanitizeLevel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1 || v > 5) return null;
  return v;
}

async function writeEnrichment(book, genreIds, seriesData, description, complexity, depth) {
  // Genres: direct upsert into book_genres (link_book_genre RPC requires auth.uid)
  if (genreIds.length > 0) {
    await supabase.from('book_genres').upsert(
      genreIds.map((genreId) => ({
        book_id: book.id,
        genre_id: genreId,
        source: 'oracle',
      })), {
        onConflict: 'book_id,genre_id',
        ignoreDuplicates: true
      }
    );
  }

  // Description + complexity + depth + status
  const patch = {
    status: 'oracle_categorized'
  };
  if (description) patch.description = description;
  if (complexity != null) patch.complexity = complexity;
  if (depth != null) patch.depth = depth;

  // Series: direct upsert into series table (upsert_series RPC also requires auth.uid)
  if (seriesData ?.name) {
    const normalized = normalizeSeriesName(seriesData.name);
    await supabase.from('series').upsert({
      name: seriesData.name,
      normalized_name: normalized,
      total_books: seriesData.total || null,
      status: 'oracle_categorized',
      source: 'oracle',
    }, {
      onConflict: 'normalized_name',
      ignoreDuplicates: false
    });

    const {
      data: seriesRow
    } = await supabase
      .from('series')
      .select('id')
      .eq('normalized_name', normalized)
      .single();

    if (seriesRow ?.id) {
      patch.series_id = seriesRow.id;
      patch.position_in_series = seriesData.n || null;
    }
  }

  await supabase.from('books').update(patch).eq('id', book.id);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Book Oracle — Batch Enrichment v0.22   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (DRY_RUN) console.log('  DRY RUN — no API calls will be made\n');

  // Fetch
  process.stdout.write('  Fetching eligible books... ');
  let books = await fetchEligibleBooks();
  console.log(`${books.length} found`);

  const backfillCount = books.filter((b) => b.status === 'oracle_categorized').length;
  if (backfillCount > 0) {
    console.log(`  (${backfillCount} of those are already oracle_categorized — complexity/depth backfill only, genres/series/description untouched)\n`);
  }

  if (LIMIT && books.length > LIMIT) {
    books = books.slice(0, LIMIT);
    console.log(`  Limiting to ${LIMIT} books (--limit flag)\n`);
  }

  if (books.length === 0) {
    console.log('  Nothing to do — all books are already oracle_categorized.\n');
    return;
  }

  // Cost estimate
  const totalInputTokens = books.length * EST_INPUT_TOKENS_PER_BOOK;
  const totalOutputTokens = books.length * EST_OUTPUT_TOKENS_PER_BOOK;
  const estimatedCost = (
    (totalInputTokens / 1_000_000) * INPUT_COST_PER_M +
    (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_M
  );
  const batches = Math.ceil(books.length / BATCH_SIZE);

  console.log('  ┌─ Estimate ────────────────────────────────');
  console.log(`  │  Books:           ${books.length}`);
  console.log(`  │  Batches:         ${batches} × ${BATCH_SIZE}`);
  console.log(`  │  Input tokens:    ~${totalInputTokens.toLocaleString()}`);
  console.log(`  │  Output tokens:   ~${totalOutputTokens.toLocaleString()}`);
  console.log(`  │  Estimated cost:  ~$${estimatedCost.toFixed(3)}`);
  console.log('  └───────────────────────────────────────────\n');

  if (DRY_RUN) {
    console.log('  Dry run complete. Remove --dry-run to proceed.\n');
    return;
  }

  const existingGenres = await fetchExistingGenres();
  let processed = 0;
  let failed = 0;
  let totalCost = 0;
  const genreCache = new Map(); // normalized_name -> id

  for (let batchIdx = 0; batchIdx < batches; batchIdx++) {
    const batch = books.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
    const batchNum = batchIdx + 1;
    process.stdout.write(`  Batch ${batchNum}/${batches} (${batch.length} books)... `);

    try {
      const {
        systemPrompt,
        userPrompt
      } = buildPrompt(batch, existingGenres);
      const raw = await callClaudeDirect(systemPrompt, userPrompt);
      const parsed = parseJSON(raw);

      if (!Array.isArray(parsed)) {
        console.log('FAILED (non-array response)');
        failed += batch.length;
        continue;
      }

      // Estimate actual cost from this batch
      const inputEst = systemPrompt.length / 4 + userPrompt.length / 4;
      const outputEst = (raw ?.length || 0) / 4;
      const batchCost = (inputEst / 1_000_000) * INPUT_COST_PER_M +
        (outputEst / 1_000_000) * OUTPUT_COST_PER_M;
      totalCost += batchCost;

      for (const item of parsed) {
        const bookIdx = (item.index || 0) - 1;
        if (bookIdx < 0 || bookIdx >= batch.length) continue;
        const book = batch[bookIdx];

        // Books that were already oracle_categorized only qualified because
        // complexity/depth were null — don't touch their existing genres,
        // series, or description, even though the model still returned them
        // as part of the same prompt.
        const backfillOnly = book.status === 'oracle_categorized';

        const genreNames = backfillOnly ? [] : (Array.isArray(item.genres) ? item.genres.slice(0, 3) : []);
        const genreIds = genreNames.length ?
          (await Promise.all(genreNames.map((n) => resolveGenreId(n, genreCache)))).filter(Boolean) :
          [];
        const seriesData = backfillOnly ? null : (item.series || null);
        const description = backfillOnly ? null : (item.description || null);
        const complexity = sanitizeLevel(item.complexity);
        const depth = sanitizeLevel(item.depth);

        await writeEnrichment(book, genreIds, seriesData, description, complexity, depth);

        // Keep genre catalog fresh for subsequent batches
        for (const name of genreNames) {
          if (!existingGenres.find((g) => g.name === name)) {
            existingGenres.push({
              name,
              description: null
            });
          }
        }
        processed++;
      }

      console.log(`OK  (+$${batchCost.toFixed(4)})`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed += batch.length;
    }
  }

  console.log('\n  ┌─ Results ─────────────────────────────────');
  console.log(`  │  Processed:  ${processed}`);
  console.log(`  │  Failed:     ${failed}`);
  console.log(`  │  Actual cost: ~$${totalCost.toFixed(4)}`);
  console.log('  └───────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});