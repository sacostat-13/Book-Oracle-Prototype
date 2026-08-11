// curateManualBooks.mjs — identify and repair manually-added catalog rows using Claude.
//
// THE PROBLEM
// -----------
// When add-time lookup fails, the book goes in as whatever the user typed: "a darker act",
// "-when i sing, mountains dance", "A Corruption of Souls — Taylor   Hubbard". Those rows
// have no ISBN, no cover, no pages, no description, and a normalized_key derived from a
// title that isn't the book's real title — so they can never be matched or deduplicated,
// and they get the weakest Oracle recommendations in the catalog.
//
// Properly this is an admin review queue. This script trades tokens for that human time:
// Claude identifies the real book via web search, Hardcover corroborates it, and the
// findings are applied in two tiers of risk.
//
// TWO TIERS, DELIBERATELY
// -----------------------
//   AUTO   — fills NULL metadata only (isbn, hardcover_id, pages, description, cover_url).
//            Additive; nothing existing is overwritten, nothing changes identity.
//   GATED  — title/author corrections are written to proposed-titles.csv and applied only
//            on a second, explicit --apply-titles run. Changing a title recomputes
//            normalized_key, which is UNIQUE, so a wrong identification doesn't just
//            mislabel a book — it can collide with or merge into a different one.
//
// Usage:
//   node batch-scripts/curateManualBooks.mjs --dry-run --limit 10 --verbose
//   node batch-scripts/curateManualBooks.mjs --limit 50      # enrich + propose titles
//   node batch-scripts/curateManualBooks.mjs --all           # every manual row, not just
//                                                            # the ones lacking an ISBN
//   node batch-scripts/curateManualBooks.mjs --apply-titles  # apply the reviewed CSV
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HARDCOVER_API_TOKEN, ANTHROPIC_API_KEY
//
// --apply-titles requires schema_v39_migration.sql (merge_books) to have been run.
//
// COST: one Claude call with web search per book. Budget roughly 2-4 cents each — check
// --limit 10 against your Anthropic console before turning it loose on the full set.

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pickBestEdition, EDITION_FIELDS } from '../../src/lib/editionPicker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'output', 'proposed-titles.csv');

// -- CLI ----------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const APPLY_TITLES = args.includes('--apply-titles');

function numArg(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  const v = a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
const LIMIT = numArg('--limit', null);
// By default, only manual rows that STILL have no ISBN.
//
// "Manual" (source='user_manual' OR status='incomplete') is ~200 rows, but that is the
// wrong queue for this script. This pass exists to repair IDENTITY — a title that isn't
// the book's real title. A manual row that DID resolve to an ISBN has, by definition, a
// title good enough that titleMatches() accepted a real catalogue record for it; its
// identity is fine and the AUTO tier would find every field already filled. Paying for a
// Claude web-search call on those is spend with no possible outcome.
//
// No ISBN after Hardcover, OpenLibrary AND Google Books have all been tried is the
// sharpest available signal that the title itself is the problem. That is ~90 rows.
// --all widens back to every manual row if you want a full sweep.
const ALL_MANUAL = args.includes('--all');
// Below this, a proposal is logged but never written to the CSV as approvable.
const MIN_CONFIDENCE = numArg('--min-confidence', 80);

// -- Env ----------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || '';
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || '';

for (const [k, v] of [['VITE_SUPABASE_URL', SUPABASE_URL], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY]]) {
  if (!v) { console.error(`Missing ${k} in .env.local`); process.exit(1); }
}
if (!APPLY_TITLES && !ANTHROPIC_KEY) { console.error('Missing ANTHROPIC_API_KEY in .env.local'); process.exit(1); }

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

// -- normalized_key, mirroring compute_book_key() exactly ----------------------
// SQL:  regexp_replace(lower(title),'[^a-z0-9]','','g') || '|' ||
//       substr(regexp_replace(lower(author),'[^a-z0-9]','','g'), 1, 10)
// If this drifts from the SQL, collision detection silently stops working and the
// merge path never fires — so keep the two in lockstep.
function computeBookKey(title, author) {
  const strip = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${strip(title)}|${strip(author).slice(0, 10)}`;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Minimal RFC4180-ish parser — the CSV round-trips through a spreadsheet, so it has to
// survive quoted commas and doubled quotes in titles.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
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
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// -- Hardcover ----------------------------------------------------------------
const RATE_LIMIT = 55, WINDOW_MS = 60_000, requestTimes = [];
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (requestTimes.length && now - requestTimes[0] > WINDOW_MS) requestTimes.shift();
    if (requestTimes.length < RATE_LIMIT) { requestTimes.push(now); return; }
    await sleep(WINDOW_MS - (now - requestTimes[0]) + 50);
  }
}

async function hcGql(query, variables = {}, attempt = 1) {
  if (!HARDCOVER_TOKEN) return null;
  await throttle();
  let resp;
  try {
    resp = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        Authorization: HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BooksOracle-curateManual/1.0',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    if (attempt <= 3) { await sleep(2000 * 3 ** (attempt - 1)); return hcGql(query, variables, attempt + 1); }
    return null;
  }
  if (resp.status === 429) { await sleep(60000); return hcGql(query, variables, attempt); }
  if (!resp.ok) return null;
  const json = await resp.json();
  return json.data || null;
}

// Corroborate Claude's identification against Hardcover and pull real edition data.
async function hardcoverConfirm(title, author) {
  const data = await hcGql(
    `query S($q: String!, $type: String!) { search(query: $q, query_type: $type, per_page: 5, page: 1) { results } }`,
    { q: [title, author].filter(Boolean).join(' '), type: 'Book' }
  );
  const hits = data?.search?.results?.hits || [];
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(title);
  for (const h of hits) {
    const doc = h.document || h;
    if (!doc?.id) continue;
    const got = norm(doc.title);
    if (!got.includes(want) && !want.includes(got)) continue;
    const full = await hcGql(
      `query B($id: Int!) { books(where: { id: { _eq: $id } }, limit: 1) {
         id title pages description image { url } ${EDITION_FIELDS} } }`,
      { id: Number(doc.id) }
    );
    const node = full?.books?.[0];
    if (node) return node;
  }
  return null;
}

// -- Claude -------------------------------------------------------------------
const SYSTEM = `You identify books from messy, user-typed catalog entries.

The input is a title (and sometimes an author) typed by hand by a reader whose automatic
lookup failed. It may be lowercase, truncated, misspelled, missing the author, in a
language other than English, or a partial/remembered title.

Use web_search to identify the actual published book. Then reply with ONLY a JSON object,
no prose, no markdown fence:

{"title":"","author":"","isbn13":"","confidence":0,"reasoning":""}

Rules:
- title: the canonical published title, correctly capitalised, WITHOUT series markers,
  subtitles after a colon, or edition wording.

- NEVER TRANSLATE. Return the title in the SAME LANGUAGE the user typed it in, and if the
  book was originally published in that language, return its ORIGINAL title.
  Fix spelling, accents, capitalisation and word order — do not change language.
    "Los peligros de fumar en la cama"  → "Los peligros de fumar en la cama"
        (Mariana Enriquez wrote this in Spanish; "The Dangers of Smoking in Bed" is a
         2021 translation and is NOT this book's title)
    "Escalofrios urbanos"               → "Escalofrios urbanos"   (accents only)
    "Lagrimas en H mart"                → "Crying in H Mart"
        (correct: the original IS English; the user recorded a Spanish rendering)
  The test is the language the work was FIRST published in, not the language of this
  catalog. A reader who added a Spanish edition wants the Spanish edition.

- NEVER RETURN A CONTAINER FOR A PART. If the entry names a single short story, novella,
  essay or comic issue that appears inside a larger collection, anthology or omnibus, do
  NOT return the collection's title. That silently converts one work into a different,
  larger one.
    "La patrona"  → NOT "Tales of the Unexpected" (that anthology CONTAINS "The Landlady")
    "La bruja"    → NOT "The Lottery and Other Stories"
  If the part has no standalone published edition, return confidence below 50 and say so.

- author: the primary author's name as normally credited.
- isbn13: ISBN-13 of a widely available print edition IN THE TITLE'S LANGUAGE (not
  audiobook, not ebook, not a boxed set). Empty string if you cannot establish one.
- confidence: 0-100, how certain you are this is the specific book the entry refers to.
  Be strict. If the entry is too vague to distinguish between several real books, or you
  cannot find any matching book, use a confidence below 50 and say why in reasoning.
- reasoning: one short sentence. If you kept a non-English title deliberately, or declined
  to map a part onto a collection, say so here.

Never guess a plausible-sounding book to fill the field. A low confidence score is a
correct and useful answer.`;

async function askClaude(title, author, attempt = 1) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{
          role: 'user',
          content: `Catalog entry:\n  title: ${JSON.stringify(title)}\n  author: ${JSON.stringify(author || null)}`,
        }],
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt <= 3) { await sleep(3000 * attempt); return askClaude(title, author, attempt + 1); }
      return null;
    }
    if (!res.ok) { vlog(`claude ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
    const data = await res.json();

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) { vlog(`no JSON in reply: ${text.slice(0, 160)}`); return null; }
    const out = JSON.parse(m[0]);
    return {
      title: (out.title || '').trim() || null,
      author: (out.author || '').trim() || null,
      isbn13: (out.isbn13 || '').replace(/[^0-9X]/gi, '') || null,
      confidence: Number(out.confidence) || 0,
      reasoning: (out.reasoning || '').trim(),
    };
  } catch (e) {
    if (attempt <= 3) { await sleep(3000 * attempt); return askClaude(title, author, attempt + 1); }
    vlog(`claude error: ${e.message}`);
    return null;
  }
}

// -- Row selection ------------------------------------------------------------
const PAGE = 1000;
async function fetchManualRows(limit) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    let q = supabase
      .from('books')
      .select('id, title, author, isbn, hardcover_id, pages, description, cover_url, source, status, metadata, normalized_key')
      // The two markers the app sets deliberately when a lookup FAILS.
      //
      // metadata->>manuallyAdded is deliberately excluded. It is set on every successful
      // lookup path in bookLookup.js and by goodreadsImport.js to drive the ✎ icon, so
      // it means "user-added", not "unidentified". Including it pulled 209 rows into
      // this queue where 89 belong — and the extra 120 are real books (Babel, The Eye of
      // the World, Flores para Algernon) whose titles are already correct. Sending those
      // to Claude for identity repair burns tokens on books that need nothing, and risks
      // "correcting" a title that was right. Their actual problem is a missing ISBN,
      // which is isbnFallback.mjs's job.
      .or('source.eq.user_manual,status.eq.incomplete')
      // Exclude rows whose lookup never completed. Those are retryable by the free
      // deterministic passes; sending them to Claude spends tokens asking it to identify
      // a book the normal chain was simply never given a chance to find.
      //
      // Must be an .or() with an explicit IS NULL branch, NOT .not(...,'eq','true').
      // metadata->>lookupIncomplete is NULL on every row added before v0.56, and in SQL
      // `NOT (NULL = 'true')` evaluates to NULL — which is not TRUE, so PostgREST filters
      // the row out. That silently excluded the entire existing catalog and the script
      // reported "0 manually-added row(s)" on a queue of 90.
      .or('metadata->>lookupIncomplete.is.null,metadata->>lookupIncomplete.neq.true')
      .order('title');
    // Identity repair only pays off where the title failed to resolve at all.
    if (!ALL_MANUAL) q = q.is('isbn', null);
    const { data, error } = await q.range(from, limit ? Math.min(to, limit - 1) : to);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
    if (limit && out.length >= limit) break;
  }
  return limit ? out.slice(0, limit) : out;
}

// -- Pass 1: identify + enrich ------------------------------------------------
async function runCurate() {
  const rows = await fetchManualRows(LIMIT);
  console.log(`${rows.length} manually-added row(s)${ALL_MANUAL ? '' : ' with no ISBN'}${DRY_RUN ? '  [DRY RUN]' : ''}`);
  if (!ALL_MANUAL) {
    console.log(`  (manual rows that already resolved to an ISBN are skipped — their titles`);
    console.log(`   matched a real catalogue record, so there is no identity to repair.`);
    console.log(`   Use --all to sweep every manual row.)`);
  }
  if (!rows.length) {
    // Zero is a legitimate result once the queue is drained, but it is also what a
    // mis-built filter looks like — so say what was actually asked for.
    console.log(`\n  Selected: source='user_manual' OR status='incomplete'`);
    console.log(`            ${ALL_MANUAL ? '' : "AND isbn IS NULL "}`);
    console.log(`            excluding metadata.lookupIncomplete = 'true'.`);
    console.log(`  If you expected rows, check that predicate against the catalog:`);
    console.log(`    select count(*) from public.books`);
    console.log(`    where source = 'user_manual' or status = 'incomplete';`);
    return;
  }
  console.log(`One Claude web-search call each — check spend after a small --limit run.\n`);

  const stats = { enriched: 0, proposed: 0, lowConfidence: 0, unidentified: 0, failed: 0 };
  const proposals = [];

  for (const [i, b] of rows.entries()) {
    const label = `[${i + 1}/${rows.length}] ${b.title}${b.author ? ' — ' + b.author : ''}`;
    console.log(label);

    const id = await askClaude(b.title, b.author);
    if (!id) { console.log('  could not reach a verdict\n'); stats.failed++; continue; }

    vlog(`claude: ${JSON.stringify(id)}`);

    if (id.confidence < 50 || !id.title) {
      console.log(`  unidentified (confidence ${id.confidence}) — ${id.reasoning}\n`);
      stats.unidentified++;
      continue;
    }

    // Corroborate. Claude having found a book is not the same as the book existing in the
    // catalog we actually link against, and Hardcover gives real edition data rather than
    // a remembered ISBN.
    const node = await hardcoverConfirm(id.title, id.author);
    const picked = node ? pickBestEdition(node.editions || []) : { isbn: null, asin: null, warnings: [] };
    const isbn = picked.isbn || id.isbn13 || null;
    const isbnSource = picked.isbn ? 'hardcover' : (id.isbn13 ? 'claude' : 'none');
    console.log(`  → ${id.title} — ${id.author || '?'}  (confidence ${id.confidence}, isbn ${isbn || '—'} via ${isbnSource})`);

    // Is this row's stored identity wrong? If so, anything previously derived FROM that
    // identity is suspect — specifically the ISBN and hardcover_id that isbnBackfill.mjs
    // may have resolved by searching the mistyped title. Fill-nulls-only would preserve
    // those wrong values forever, since the field is no longer null.
    //
    // Note the ISBN we're about to write is not subject to the same doubt: it came from
    // hardcoverConfirm(id.title, id.author), i.e. the CORRECTED identity.
    const identitySuspect =
      id.title.toLowerCase() !== (b.title || '').toLowerCase() ||
      (id.author || '').toLowerCase() !== (b.author || '').toLowerCase();

    // AUTO tier: fill nulls, plus overwrite identity-derived fields when the identity
    // itself turned out to be wrong. Descriptive fields are still never clobbered.
    const patch = {};
    if (isbn && (!b.isbn || (identitySuspect && picked.isbn && b.isbn !== isbn))) {
      if (b.isbn && b.isbn !== isbn) console.log(`  isbn ${b.isbn} → ${isbn} (was derived from the mistyped title)`);
      patch.isbn = isbn;
    }
    if (node?.id && (!b.hardcover_id || (identitySuspect && b.hardcover_id !== node.id))) patch.hardcover_id = node.id;
    if (!b.pages && node?.pages) patch.pages = node.pages;
    if (!b.description && node?.description) patch.description = node.description;
    if (!b.cover_url && node?.image?.url) patch.cover_url = node.image.url;

    if (Object.keys(patch).length) {
      console.log(`  fill: ${Object.keys(patch).join(', ')}`);
      if (!DRY_RUN) {
        const { error } = await supabase.from('books').update(patch).eq('id', b.id);
        if (error) { console.log(`  WRITE FAILED: ${error.message}`); stats.failed++; }
        else stats.enriched++;
      } else stats.enriched++;
    }

    // GATED tier: identity changes go to the CSV, never applied here.
    if (identitySuspect) {
      if (id.confidence < MIN_CONFIDENCE) {
        console.log(`  title change withheld — confidence ${id.confidence} < ${MIN_CONFIDENCE}`);
        stats.lowConfidence++;
      } else {
        const newKey = computeBookKey(id.title, id.author);
        const { data: clash } = await supabase
          .from('books').select('id, title, author').eq('normalized_key', newKey).neq('id', b.id).maybeSingle();
        if (clash) console.log(`  would MERGE into existing "${clash.title}" (${clash.id})`);
        proposals.push({
          approve: '', book_id: b.id,
          old_title: b.title, old_author: b.author,
          new_title: id.title, new_author: id.author,
          confidence: id.confidence,
          merge_into: clash?.id || '',
          merge_into_title: clash?.title || '',
          reasoning: id.reasoning,
        });
        stats.proposed++;
      }
    }
    console.log('');
  }

  if (proposals.length) {
    const header = ['approve', 'book_id', 'old_title', 'old_author', 'new_title', 'new_author',
                    'confidence', 'merge_into', 'merge_into_title', 'reasoning'];
    writeFileSync(CSV_PATH,
      [header.join(','), ...proposals.map((p) => header.map((h) => csvCell(p[h])).join(','))].join('\n') + '\n',
      'utf8');
  }

  console.log('--- done ---');
  console.log(`  metadata enriched:      ${stats.enriched}`);
  console.log(`  title changes proposed: ${stats.proposed}`);
  console.log(`  withheld (low conf):    ${stats.lowConfidence}`);
  console.log(`  unidentified:           ${stats.unidentified}`);
  console.log(`  failed:                 ${stats.failed}`);
  if (proposals.length) {
    console.log(`\n  proposals → batch-scripts/proposed-titles.csv`);
    console.log(`  Put 'y' in the approve column on the rows you accept, then run:`);
    console.log(`     node batch-scripts/curateManualBooks.mjs --apply-titles`);
    console.log(`  Rows with merge_into set will FOLD the manual row into that book and`);
    console.log(`  delete it, repointing any wishlist/library entries. Check those first.`);
  }
  if (DRY_RUN) console.log('\n(dry run — nothing was written to the database)');
}

// -- Pass 2: apply reviewed titles --------------------------------------------
async function runApplyTitles() {
  if (!existsSync(CSV_PATH)) { console.error('No proposed-titles.csv — run the curate pass first.'); process.exit(1); }
  const all = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const approved = all.filter((r) => /^(y|yes|true|1)$/i.test((r.approve || '').trim()));

  console.log(`${all.length} proposal(s), ${approved.length} approved${DRY_RUN ? '  [DRY RUN]' : ''}\n`);
  if (!approved.length) { console.log("Nothing approved — put 'y' in the approve column."); return; }

  const stats = { renamed: 0, merged: 0, alreadyApplied: 0, failed: 0 };

  // The CSV carries no record of whether it has been applied, and re-running
  // --apply-titles on a stale one is an easy mistake: 50 renames silently rewrite
  // identical values and every merge fails with "source book not found", which reads
  // like 9 real errors. Check the current state of each row first and skip the no-ops.
  const ids = approved.map((r) => r.book_id).filter(Boolean);
  const current = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('books').select('id, title').in('id', ids.slice(i, i + 200));
    for (const row of data || []) current.set(row.id, row.title);
  }

  for (const r of approved) {
    const label = `${r.old_title} → ${r.new_title}`;

    const now = current.get(r.book_id);
    if (now === undefined) {
      // Row is gone — already merged away by an earlier run of this same CSV.
      console.log(`${label}\n  already merged in a previous run — skipping\n`);
      stats.alreadyApplied++;
      continue;
    }
    if (!r.merge_into && now === r.new_title) {
      console.log(`${label}\n  already renamed — skipping\n`);
      stats.alreadyApplied++;
      continue;
    }

    try {
      if (r.merge_into) {
        console.log(`${label}\n  MERGE ${r.book_id} → ${r.merge_into} (${r.merge_into_title})`);
        if (!DRY_RUN) {
          const { data, error } = await supabase.rpc('merge_books', { _from: r.book_id, _to: r.merge_into });
          if (error) throw new Error(error.message);
          console.log(`  ${JSON.stringify(data)}`);
        }
        stats.merged++;
      } else {
        // normalized_key is a stored column, not generated — updating title/author without
        // it would leave the key pointing at the old identity, breaking dedup forever.
        const patch = {
          title: r.new_title,
          author: r.new_author || null,
          normalized_key: computeBookKey(r.new_title, r.new_author),
        };
        console.log(`${label}\n  rename ${r.book_id}  key=${patch.normalized_key}`);
        if (!DRY_RUN) {
          const { error } = await supabase.from('books').update(patch).eq('id', r.book_id);
          // A late collision means something else claimed the key since the CSV was
          // written. Safer to report than to silently merge without review.
          if (error) throw new Error(`${error.message}${error.code === '23505' ? ' (key now taken — rerun curate to re-detect the merge)' : ''}`);
        }
        stats.renamed++;
      }
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
      stats.failed++;
    }
    console.log('');
  }

  console.log('--- done ---');
  console.log(`  renamed:         ${stats.renamed}`);
  console.log(`  merged:          ${stats.merged}`);
  console.log(`  already applied: ${stats.alreadyApplied}`);
  console.log(`  failed:          ${stats.failed}`);
  if (stats.alreadyApplied && !stats.renamed && !stats.merged) {
    console.log(`\n  Every row in this CSV was already applied. To generate NEW proposals`);
    console.log(`  under the current prompt, delete it and run the curate pass:`);
    console.log(`     rm batch-scripts/proposed-titles.csv`);
    console.log(`     node batch-scripts/curateManualBooks.mjs --limit 10 --verbose`);
  }
  if (DRY_RUN) console.log('\n(dry run — nothing was written to the database)');
}

(APPLY_TITLES ? runApplyTitles() : runCurate()).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
