// oracleBatch.mjs — v0.22: also backfills complexity + depth for older
// oracle_categorized books that predate those fields.
// Standalone Node.js script to run Oracle enrichment (genres + series +
// description + complexity + depth + author gender) over all eligible books in
// the Supabase DB.
//
// v0.62 — author_gender is written here for the first time.
//
// It was added to the schema in v0.55 and to the prompt in
// src/lib/oracleCategorizationService.js, which this script is supposed to
// mirror. It was never added HERE. When v0.61 moved the work off the reader's
// button and onto the nightly cron, that module stopped executing entirely and
// this script became the only thing writing the column — so the field shipped,
// was documented in nightly-curation.yml as something this job fills, and
// stayed null on every row for six versions.
//
// The lesson worth keeping: "mirrors buildPrompt() in oracleCategorizationService"
// is a claim no test checks. When you change one prompt, grep for the other.
//
// This change does NOT widen fetchEligibleBooks(). Books already
// oracle_categorized with complexity and depth filled remain unreachable, which
// means the existing catalog is not fixed by this script — that is
// authorGenderBackfill.mjs's job, run once, by hand. Widening the `.or()` here
// would make every categorized book eligible again on a nightly cron, which is
// a recurring charge nobody approved.
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

import { createServiceClient } from '../_shared/supabaseClient.mjs';
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

// Genres per book. Raised 3 -> 5 in v0.63.
//
// Two things changed at once. The taxonomy grew from 15 seeds to 136 after the
// compound splits, so the useful entries are far more specific. And umbrellas
// are now applied ALONGSIDE the specific genre rather than instead of it — a
// folk horror novel is "Folk Horror" AND "Horror" — because a reader browsing
// the wide shelf and a reader browsing the narrow one should both find it.
// That costs a slot, so the budget is roughly two umbrellas plus three
// specifics.
//
// Still capped. With no limit the model pads, and a book tagged with eight
// genres is as useless for discovery as one tagged with none. Change here and
// in the GENRE RULES line of the system prompt together.
const MAX_GENRES_PER_BOOK = 5;
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

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
// v0.62: SUPABASE_SECRET_KEY accepted first, for the sb_secret_… keys replacing
// the legacy service_role JWT (docs/KEY_ROTATION.md). The old name still works —
// that runbook deliberately keeps it, since the value changes but the name does
// not. Same chain as netlify/functions/_shared/auth.js.
const SERVICE_KEY = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
// v0.61: was `env['ANTHROPIC_KEY']` only — which matched neither this script's
// own usage docs above, nor its error message below, nor any sibling script
// (curateManualBooks and coverBackfill both read ANTHROPIC_API_KEY). It worked
// locally because a hand-written .env.local happened to carry the short name;
// it would have failed on the first nightly CI run, where the file is composed
// from the ANTHROPIC_API_KEY secret. Both are accepted so neither breaks.
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!DRY_RUN && !ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local (required for non-dry-run)');
  process.exit(1);
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

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
  //
  // v0.62: PAGED. This select previously had no .range(), so PostgREST capped
  // it at its default 1000 rows. A manual run reported "1000 found" and that
  // number was the cap, not a count — the true backlog was invisible above it
  // and no log line said so. Draining oldest-first meant the script still made
  // progress, so this looked like a plausible figure for months.
  //
  // See supabase/legacy/oracle_eligibility_audit.sql for the SQL that reports
  // the real number.
  const ELIGIBLE = 'status.in.(unreviewed,incomplete),and(status.eq.oracle_categorized,or(complexity.is.null,depth.is.null))';

  // Exact count first, separately from the rows. Reporting "N found" from the
  // length of a capped page is what made the old number a lie; with --limit set
  // we deliberately stop fetching early, so row count can never be the honest
  // answer to "how big is the backlog". Ask the database.
  const {
    count: eligibleCount,
    error: countError
  } = await supabase
    .from('books')
    .select('id', {
      count: 'exact',
      head: true
    })
    .or(ELIGIBLE);

  if (countError) {
    console.error('Failed to count eligible books:', countError.message);
    process.exit(1);
  }

  // Never page past what --limit will keep.
  const wanted = LIMIT ? Math.min(LIMIT, eligibleCount ?? LIMIT) : (eligibleCount ?? 0);
  const PAGE_SIZE = Math.min(1000, Math.max(wanted, 1));
  const rows = [];
  let from = 0;

  for (;;) {
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
        author_gender_source,
        original_language,
        series_id,
        position_in_series,
        series:series_id ( name )
      `)
      .or(ELIGIBLE)
      // Ordering by created_at ALONE is not safe to paginate: the column is not
      // unique, and rows tying on the page boundary can be returned twice or
      // skipped entirely depending on how Postgres breaks the tie between
      // queries. id is the unique tiebreaker. created_at stays the primary key
      // of the sort because oldest-first is the intended drain order.
      .order('created_at', {
        ascending: true
      })
      .order('id', {
        ascending: true
      })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to fetch books:', error.message);
      process.exit(1);
    }

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    if (rows.length >= wanted) break;

    from += PAGE_SIZE;
  }

  // The caller prints the count, so hand back both. `eligible` is the real
  // backlog; `rows` is only what this run intends to look at.
  return { rows, eligible: eligibleCount ?? rows.length };
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

  const systemPrompt = `You are the Book Oracle, a literary curator. For each book return genres, series info, a description, complexity, depth, author gender, and the language the book was originally written in.

GENRE RULES: Prefer existing catalog genres. Assign 2-5 per book: every specific genre that genuinely applies, PLUS the broad umbrella above it where one exists. A folk horror novel is \"Folk Horror\" AND \"Horror\"; a Faulkner is \"Southern Gothic\" AND \"Gothic\" AND \"Literary Fiction\". One reader browses the wide shelf and another the narrow one, and the book should be found by both. Do not pad — a genre that only loosely fits is worse than a missing one, because it puts the book in front of a reader who did not ask for it. Prefer a single clear concept over a compound name joined with \"&\": a book can carry several genres, so two ideas belong in two genres. Only invent when nothing in the catalog fits.
SERIES RULES: null for standalone books. "total" may be null for ongoing series.
DESCRIPTION RULES: 2-4 sentences. Evocative, literary, informative. English only.
COMPLEXITY RULES (prose difficulty, 1-5): 1=casual/page-turners, 2=mid-difficulty, 3=literary, 4=challenging (Faulkner, Han Kang), 5=experimental (Donoso, Lispector). Judge sentence structure/vocabulary/technique, not length or genre.
DEPTH RULES (thematic/genre depth, 1-5): how demanding the themes are within the book's own genre, not prose difficulty — a simply-written book can still be high-depth. Always return an integer 1-5 for both, never null, even if unsure.

AUTHOR GENDER RULES (strict — read carefully, this is not like COMPLEXITY/DEPTH):
- Return one of: "female", "male", "nonbinary", "mixed", "unknown".
- Only return "female", "male", or "nonbinary" when you have a real, reliable
  public signal: the author's own stated pronouns/identity, an official bio,
  publisher copy, or a well-known interview. Being confident the name "sounds"
  female or male is NOT a reliable signal — names are not a reliable indicator
  of gender, and guessing from one risks misgendering a real person. If you
  are not certain from an actual biographical fact, return "unknown".
- Use "mixed" for books with multiple credited authors/editors whose genders
  are not all the same (anthologies, co-authored nonfiction).
- Unlike COMPLEXITY/DEPTH, "unknown" is a normal, expected, frequent answer
  here — do not strain to produce a definite value. A wrong guess is worse
  than an honest "unknown".
- The book's subject matter is not evidence. A book about women does not imply
  a female author.

ORIGINAL LANGUAGE RULES (same standard of evidence as AUTHOR GENDER):
- Return "originalLanguage": the ISO 639-1 two-letter code for the language the
  work was FIRST WRITTEN in — not the language of the edition described above,
  and not the language of its title as given. Gabriel García Márquez wrote in
  Spanish, so "es", whether the row you were shown says "One Hundred Years of
  Solitude" or "Cien años de soledad".
- Return "unknown" unless you actually know. Do NOT infer it from the author's
  name, nationality, or where they live: Nabokov wrote in both Russian and
  English, Beckett in French and English, Conrad in English. If you are not
  certain for THIS book, "unknown" is the correct answer and a frequent one.
- For a work with no single original language (an anthology of translations, a
  multilingual text), return "unknown".
- This is used to decide which of several rows for the same novel a reader is
  shown. A wrong answer promotes a translation over the original, which is
  visible and wrong; an "unknown" simply leaves the current behaviour in place.

EXISTING GENRE CATALOG:
${catalogList || '(empty — you are seeding the catalog)'}

RESPONSE FORMAT (JSON array, input order):
[{"index":1,"genres":["Genre"],"series":{"name":"Name","n":1,"total":3},"description":"Text.","complexity":1-5,"depth":1-5,"authorGender":"female"|"male"|"nonbinary"|"mixed"|"unknown","originalLanguage":"en"|"es"|...|"unknown"}]
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

// v0.62: mirrors VALID_AUTHOR_GENDERS / sanitizeAuthorGender in
// src/lib/oracleCategorizationService.js. Anything outside the enum → null →
// the field is not written and the book stays eligible for a later run.
const VALID_AUTHOR_GENDERS = new Set(['female', 'male', 'nonbinary', 'mixed', 'unknown']);

function sanitizeAuthorGender(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return VALID_AUTHOR_GENDERS.has(s) ? s : null;
}

// v0.64. Deliberately NOT an allow-list of language codes: there are ~184
// living two-letter codes, the set changes, and rejecting a real one would
// silently drop a correct answer. Shape is all that is checked — exactly two
// ASCII letters — plus the explicit 'unknown', which is a real answer here and
// is stored so the book is not re-asked forever.
function sanitizeLanguage(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'unknown') return 'unknown';
  return /^[a-z]{2}$/.test(s) ? s : null;
}

async function writeEnrichment(book, genreIds, seriesData, description, complexity, depth, authorGender, originalLanguage) {
  // Genres: direct upsert into book_genres (link_book_genre RPC requires auth.uid)
  //
  // THE COLUMN IS `assigned_by_source`, NOT `source`.
  //
  // This wrote `source: 'oracle'` — a column that does not exist on
  // book_genres. PostgREST rejects the whole request with PGRST204, so NOT ONE
  // genre link was ever written by this script. The result was never checked,
  // so it failed in total silence, and the update below still stamped the book
  // `oracle_categorized` — which made every affected book look done while
  // carrying zero genres. Books linked before this code path (via the
  // link_book_genre RPC, which names the column correctly) kept theirs, which
  // is why older books had genres and newly curated ones did not.
  //
  // The error is checked now. A genre write that fails must not be reported as
  // a successful enrichment — that is the whole reason this went unnoticed.
  if (genreIds.length > 0) {
    const { error: linkErr } = await supabase.from('book_genres').upsert(
      genreIds.map((genreId) => ({
        book_id: book.id,
        genre_id: genreId,
        assigned_by_source: 'oracle',
      })), {
        onConflict: 'book_id,genre_id',
        ignoreDuplicates: true
      }
    );
    if (linkErr) {
      throw new Error(`book_genres upsert failed for "${book.title}": ${linkErr.message}`);
    }
  }

  // Description + complexity + depth + author gender + status
  const patch = {
    status: 'oracle_categorized'
  };
  if (description) patch.description = description;
  if (complexity != null) patch.complexity = complexity;
  if (depth != null) patch.depth = depth;

  // v0.62. Stamp author_gender_checked_at for EVERY resolved answer, including
  // 'unknown'. That timestamp is the only signal distinguishing "we asked and
  // there was no reliable public signal" from "nobody has asked yet" — the
  // client's `ag` field collapses both into undefined (see bookRowToClient in
  // DataContext.jsx). getBooksNeedingOracle() reads it via `agChecked`, so
  // without the stamp every honest 'unknown' looks unprocessed forever and gets
  // re-billed on every subsequent run.
  //
  // author_gender_source records HOW we know. The column is constrained to
  // 'oracle_inferred' | 'verified' | 'self_identified'; this path is always the
  // first. Without it every value looks equally authoritative, so a gender you
  // later confirm or correct by hand is indistinguishable from a model guess —
  // and the next bulk pass has no way to know it must not overwrite it.
  //
  // A gender confirmed by hand or stated by the author outranks anything the
  // model infers, and must survive every subsequent bulk run. This guard is the
  // only thing enforcing that — the DB constraint validates the value, not the
  // precedence.
  const HUMAN_SOURCES = ['verified', 'self_identified'];
  if (authorGender != null && !HUMAN_SOURCES.includes(book.author_gender_source)) {
    patch.author_gender = authorGender;
    patch.author_gender_source = 'oracle_inferred';
    patch.author_gender_checked_at = new Date().toISOString();
  }

  // v0.64. Write-once: never overwrite an original_language already on the row.
  // Unlike complexity or a description, this is not a judgement that improves
  // on re-reading — the language García Márquez wrote in does not change, so a
  // second, different answer means one of the two runs is wrong, and the older
  // one has at least had the chance to be corrected by hand.
  //
  // 'unknown' IS stored. It is a resolved answer meaning "asked, no reliable
  // signal", exactly as it is for author_gender, and storing it is what stops
  // the same book being re-billed on every subsequent run.
  if (originalLanguage != null && book.original_language == null) {
    patch.original_language = originalLanguage;
    // v0.64.1. The column has two writers now — this pass and
    // batch-scripts/scheduled/originalLanguageBackfill.mjs — so the row has to
    // record which one spoke. Same reason author_gender_source exists, and the
    // backfill reads this column to know what it is allowed to overwrite.
    patch.original_language_source = 'oracle_inferred';
  }

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
  const {
    rows,
    eligible
  } = await fetchEligibleBooks();
  let books = rows;
  // `eligible` is an exact COUNT from the database, not the length of a page.
  // The old message printed rows.length, which PostgREST capped at 1000 — so a
  // backlog of any size reported as exactly "1000 found".
  console.log(`${eligible} eligible`);
  if (books.length < eligible) {
    console.log(`  Fetched ${books.length} of them this run.`);
  }

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

        // Cap raised 3 -> 4 (v0.63). The taxonomy is 142 genres now, not the
        // original 15, so the useful ones are far more specific and a book
        // legitimately sits under more of them. Still capped: without a limit
        // the model pads, and a book tagged with eight genres is as useless for
        // discovery as one tagged with none.
        const genreNames = backfillOnly ? [] : (Array.isArray(item.genres) ? item.genres.slice(0, MAX_GENRES_PER_BOOK) : []);
        const genreIds = genreNames.length ?
          (await Promise.all(genreNames.map((n) => resolveGenreId(n, genreCache)))).filter(Boolean) :
          [];
        const seriesData = backfillOnly ? null : (item.series || null);
        const description = backfillOnly ? null : (item.description || null);
        const complexity = sanitizeLevel(item.complexity);
        const depth = sanitizeLevel(item.depth);
        // NOT gated on backfillOnly. Those rows qualified because complexity or
        // depth was null, but author_gender is null on effectively all of them
        // too — gating it here would mean the only books that ever get a gender
        // are ones the Oracle has never seen, which reproduces the v0.55 bug in
        // a subtler form.
        const authorGender = sanitizeAuthorGender(item.authorGender);
        // Same reasoning as authorGender above: not gated on backfillOnly,
        // because original_language is null on every row that predates v0.64,
        // which is all of them.
        const originalLanguage = sanitizeLanguage(item.originalLanguage);

        await writeEnrichment(book, genreIds, seriesData, description, complexity, depth, authorGender, originalLanguage);

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