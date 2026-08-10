// isbnBackfill.mjs — repopulate public.books.isbn after the v38 reset.
//
// WHY THIS IS NEEDED
// ------------------
// schema_v38_migration.sql nulled every stored ISBN so the corrected edition picker
// could replace the bad ones (boxed sets, audiobooks, foreign printings). That migration
// assumed viewing a book would trigger a fresh lookup and repopulate it. That assumption
// was wrong. The view-time enrichment path is enrichBookFromOpenLibrary(), which returns
// only { series, pages } — it has never carried an ISBN. ISBNs are written by
// upsert_book, which only runs when a book is ADDED to a list, not when it's viewed.
//
// So after v38 the catalog sits with null ISBNs indefinitely and every purchase link
// degrades to a search. This script closes that gap.
//
// It uses the same pickBestEdition() as the browser path (src/lib/editionPicker.js) so
// the backfilled ISBNs are chosen by identical rules to newly-looked-up ones.
//
// Writes go direct to the table with the service role key rather than through
// upsert_book, because upsert_book merges with coalesce(_existing.isbn, _isbn) — fine
// while the column is null, but it would silently no-op on any row that has since been
// repopulated, making reruns unreliable. Service role bypasses RLS; public.books has
// no update policy, so an anon/authenticated key would update 0 rows and report success.
//
// Usage:
//   node batch-scripts/isbnBackfill.mjs --dry-run          # show what it would write
//   node batch-scripts/isbnBackfill.mjs --limit 25         # try a small batch first
//   node batch-scripts/isbnBackfill.mjs                    # full run (resumable)
//   node batch-scripts/isbnBackfill.mjs --verbose          # show every edition considered
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HARDCOVER_API_TOKEN
//
// Pacing is handled by a sliding-window limiter (see throttle) — no --delay flag needed.
// Interrupting is safe: the script only selects rows where isbn is null, so a rerun resumes.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pickBestEdition, EDITION_FIELDS } from '../../src/lib/editionPicker.js';
import { titleMatches, authorMatches, titleVariants } from '../../src/lib/titleMatch.js';

// The most-stripped variant is what we send to a relevance-ranked search: series markers
// and subtitles are noise to the search engine even though they matter to the matcher.
// Matching itself uses ALL variants (see titleMatch.js) so nothing is lost by stripping.
const searchTitle = (t) => titleVariants(t).slice(-1)[0] || t || '';

// Hardcover search hits expose authors either as a flat author_names[] (Typesense
// documents) or nested under contributions[].author.name (GraphQL nodes).
const docAuthors = (doc) =>
  doc?.author_names || (doc?.contributions || []).map((c) => c?.author?.name).filter(Boolean) || [];



const __dirname = dirname(fileURLToPath(import.meta.url));

// -- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function numArg(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  const v = a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
const LIMIT = numArg('--limit', null);

// -- Env ----------------------------------------------------------------------
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!HARDCOVER_TOKEN) {
  console.error('Missing HARDCOVER_API_TOKEN in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

// -- Rate limiting ------------------------------------------------------------
// Hardcover allows 60 requests/minute. Pacing with a fixed sleep PER BOOK is wrong,
// because a book is not one request: rows without a hardcover_id go through the search
// fallback, which costs two (search, then editions-by-id). A 1.1s per-book delay on a
// catalog full of those would peak near 109 req/min and spend the whole run getting
// 429'd and backing off 60s at a time.
//
// So throttle at the REQUEST level instead. This is a sliding-window limiter: before
// each call, if 55 requests have already gone out in the trailing 60s, wait until the
// oldest one ages out. 55 rather than 60 leaves headroom for clock skew and for the
// retry after a 429.
const RATE_LIMIT = 55;
const WINDOW_MS = 60_000;
const requestTimes = [];

async function throttle() {
  for (;;) {
    const now = Date.now();
    while (requestTimes.length && now - requestTimes[0] > WINDOW_MS) requestTimes.shift();
    if (requestTimes.length < RATE_LIMIT) {
      requestTimes.push(now);
      return;
    }
    await sleep(WINDOW_MS - (now - requestTimes[0]) + 50);
  }
}

// -- Hardcover ----------------------------------------------------------------
async function gql(query, variables = {}, attempt = 1) {
  await throttle();
  let resp;
  try {
    resp = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        Authorization: HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BooksOracle-isbnBackfill/1.0',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    // Transient network failures are expected over a 35-minute run — one killed the
    // first book of the last dry run outright ("error: fetch failed"). Losing a book
    // to a blip is pointless when a retry is nearly free. Backoff: 2s, 6s, 18s.
    if (attempt <= 3) {
      const wait = 2000 * 3 ** (attempt - 1);
      vlog(`network error (${e.message}) — retry ${attempt}/3 in ${wait / 1000}s`);
      await sleep(wait);
      return gql(query, variables, attempt + 1);
    }
    throw e;
  }
  if (resp.status === 429) {
    console.warn('  rate limited — backing off 60s');
    await sleep(60000);
    return gql(query, variables);
  }
  if (!resp.ok) {
    vlog(`hardcover ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return null;
  }
  const json = await resp.json();
  if (json.errors) vlog(`graphql errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data || null;
}

// Hardcover's `books` query takes `id: { _in: [...] }`, so editions for many books come
// back in ONE request. Fetching them one at a time would cost 953 requests for the
// known-ID rows alone; batched at 50 it costs 20. Keep the batch modest — each book
// carries up to 10 editions, so 50 books is ~500 edition rows per response.
const BATCH = 50;

async function editionsByBookIds(ids) {
  if (!ids.length) return new Map();
  const data = await gql(
    `query EditionsByBooks($ids: [Int!]) {
       books(where: { id: { _in: $ids } }) {
         id
         title
         ${EDITION_FIELDS}
       }
     }`,
    { ids: ids.map(Number) }
  );
  const map = new Map();
  for (const node of data?.books || []) map.set(String(node.id), node);
  return map;
}

// -- Search matching ----------------------------------------------------------
// Stored titles carry series markers imported from Goodreads — "A Caribbean Mystery
// (Miss Marple, #9)", "A Discovery of Witches (All Souls Trilogy, #1)" — while Hardcover
// returns "A Discovery of Witches: A Novel". Comparing those raw rejects the correct
// book. Strip series parentheticals, bracketed alternate titles and subtitles from BOTH
// sides before comparing; what's left is the work itself.


// A wrong ISBN is worse than no ISBN: it yields a confident-looking purchase link to a
// book the reader never asked for, and it's sticky once written. So the search path is
// deliberately strict, and "no match" is an acceptable outcome.
//
// Substring matching alone is not enough. Normalising strips punctuation, so a short
// title like "It" becomes "it" — which is a substring of "Bitter", "Itinerary" and a
// few thousand other books. Short titles therefore require exact equality, and the
// author must corroborate in every case.


// Returns UP TO `MAX_CANDIDATES` matching Hardcover book IDs, best-first.
//
// Returning only the first match was wrong. Hardcover carries duplicate book records for
// popular titles, and the first hit is often a stub: "A Discovery of Witches: A Novel"
// resolved to a record holding a single Kindle edition with no ISBN-13, and "A Game of
// Thrones (…) Audiobook – Unabridged" to one holding a single audiobook. Both were
// reported as "no usable edition" when a well-populated record for the same work existed
// a hit or two further down.
//
// Since editions are batch-fetched anyway, collecting several candidates and pooling
// their editions costs no extra requests in the common case.
const MAX_CANDIDATES = 3;

async function runSearch(q) {
  const data = await gql(
    `query SearchBooks($q: String!, $type: String!) {
       search(query: $q, query_type: $type, per_page: 10, page: 1) { results }
     }`,
    { q, type: 'Book' }
  );
  return data?.search?.results?.hits || [];
}

async function searchForBookIds(title, author) {
  // Search on the CORE title, not the stored one. Stored titles carry Goodreads series
  // markers, and feeding them to a relevance-ranked search actively hurts: querying
  // "A Discovery of Witches (All Souls Trilogy, #1) Deborah Harkness" returned only three
  // hits — two omnibus editions and one stub — while the main record, which has dozens of
  // editions, never surfaced. The parenthetical is noise to the search engine even though
  // it's meaningful to us.
  let hits = await runSearch([searchTitle(title), author].filter(Boolean).join(' '));

  // Retry title-only when the first pass finds nothing usable. Author names are a common
  // source of mismatch — "V.E. Schwab" vs "V. E. Schwab" vs a missing contributor record —
  // and dropping the author widens recall. Only costs a request on rows that already
  // failed, and titleMatches/authorMatches still gate whatever comes back.
  if (!hits.length) {
    vlog('no hits with author — retrying title only');
    hits = await runSearch(searchTitle(title));
  }

  const ids = [];
  for (const h of hits) {
    const doc = h.document || h;
    if (!doc?.id) continue;
    if (!titleMatches(title, doc.title)) {
      vlog(`reject (title) "${doc.title}"`);
      continue;
    }
    if (!authorMatches(author, docAuthors(doc))) {
      vlog(`reject (author) "${doc.title}" by ${(doc.author_names || []).join(', ') || '?'}`);
      continue;
    }
    vlog(`candidate "${doc.title}" (hardcover id ${doc.id})`);
    if (!ids.includes(doc.id)) ids.push(doc.id);
    if (ids.length >= MAX_CANDIDATES) break;
  }

  // Hits came back but every one failed the guards — usually the author didn't
  // corroborate. Try once more without the author in the query before giving up;
  // the guards still apply to the results, so this widens recall without loosening
  // precision. Skipped if we already ran the title-only pass above.
  if (!ids.length && author) {
    vlog('all hits rejected — retrying title only');
    for (const h of await runSearch(searchTitle(title))) {
      const doc = h.document || h;
      if (!doc?.id) continue;
      if (!titleMatches(title, doc.title)) continue;
      if (!authorMatches(author, docAuthors(doc))) continue;
      vlog(`candidate (retry) "${doc.title}" (hardcover id ${doc.id})`);
      if (!ids.includes(doc.id)) ids.push(doc.id);
      if (ids.length >= MAX_CANDIDATES) break;
    }
  }
  return ids;
}

// -- Main ---------------------------------------------------------------------
// A row typed by hand when lookup failed ("a darker act", "-when i sing, mountains
// dance") is a different kind of failure from a real book Hardcover simply lacks. The
// first is a data-entry artifact fixable in the app; the second is a genuine gap. They
// were being reported identically as "no confident match", which made the residual look
// like a script problem when much of it is a catalog-hygiene problem.
// A row whose lookup never completed — the throttle was saturated, a source threw, or
// quota was spent. Retryable: it is NOT evidence the book cannot be found, so it should
// never be counted as a dead end or sent to the Claude curate pass.
function isRetryable(b) {
  return b.metadata?.lookupIncomplete === true;
}

function isManual(b) {
  // Do NOT test metadata.manuallyAdded here. That flag is set on EVERY successful
  // lookup path in bookLookup.js (and by goodreadsImport.js, whose comment says
  // "surface the ✎ icon in the wishlist row"). It means "the user added this rather
  // than it coming from the curated seed" — a UI concern — NOT "lookup failed".
  //
  // Trusting it over-counted this bucket 209 vs 89, sweeping in real, well-known books
  // — Babel, The Eye of the World, My Sister The Serial Killer, Flores para Algernon —
  // and labelling them as possibly-nonexistent hand-typed titles. Worse, it is the same
  // predicate curateManualBooks.mjs selects on, so those books would have been sent to
  // Claude for IDENTITY repair when their titles were already correct and all they
  // needed was an ISBN from a different source.
  //
  // The honest signals are the two the app sets deliberately when a lookup fails:
  // source='user_manual' and status='incomplete' (see DataContext's resolvedStatus).
  return b.source === 'user_manual' || b.status === 'incomplete';
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// PostgREST caps a single response at 1000 rows regardless of what you ask for, and
// returns no error when it truncates. A plain .select() against a 2.5k-row catalog
// would quietly process the first 1000 and report "done", which looks like success.
// Page explicitly with .range() instead.
const PAGE = 1000;

async function fetchAllNullIsbn(limit) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await supabase
      .from('books')
      .select('id, title, author, isbn, hardcover_id, source, status, metadata')
      .is('isbn', null)
      .order('title')
      .range(from, limit ? Math.min(to, limit - 1) : to);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
    if (limit && out.length >= limit) break;
  }
  return limit ? out.slice(0, limit) : out;
}

async function main() {
  let books;
  try {
    books = await fetchAllNullIsbn(LIMIT);
  } catch (e) {
    console.error('Failed to read books:', e.message);
    process.exit(1);
  }

  const withId = books.filter((b) => b.hardcover_id).length;
  const needSearch = books.length - withId;
  // Known IDs are batched, so they cost ceil(n/BATCH) requests, not n. Search can't be
  // batched (one query per title), but the editions fetch that follows it can be.
  const estRequests = Math.ceil(withId / BATCH) + needSearch + Math.ceil(needSearch / BATCH);
  const estMinutes = Math.ceil(estRequests / RATE_LIMIT);

  console.log(`${books.length} book(s) with a null ISBN${DRY_RUN ? '  [DRY RUN — nothing will be written]' : ''}`);
  console.log(`  ${withId} have a hardcover_id → ~${Math.ceil(withId / BATCH)} batched requests`);
  console.log(`  ${needSearch} need search     → ~${needSearch + Math.ceil(needSearch / BATCH)} requests`);
  console.log(`  ~${estRequests} requests total, roughly ${estMinutes} min at ${RATE_LIMIT}/min`);
  console.log(`\nSafe to interrupt and rerun — it only selects rows where isbn is null,`);
  console.log(`so a rerun picks up exactly where it stopped.\n`);

  const stats = { filled: 0, noEdition: 0, notFound: 0, failed: 0, idsLearned: 0, flagged: 0 };
  const unresolved = [];   // { book, reason }
  let processed = 0;

  // Resolve a Hardcover ID for every book first, so the expensive edition fetch can be
  // batched across both populations.
  const resolved = [];   // { book, hardcoverIds[], learned }
  for (const b of books) {
    if (b.hardcover_id) { resolved.push({ book: b, hardcoverIds: [b.hardcover_id], learned: false }); continue; }
    processed++;
    try {
      const ids = await searchForBookIds(b.title, b.author);
      if (ids.length) {
        resolved.push({ book: b, hardcoverIds: ids, learned: true });
      } else {
        console.log(`[search ${processed}/${needSearch}] ${b.title} — ${b.author || '?'}\n  no confident match on Hardcover${isManual(b) ? '  (manually added row)' : ''}`);
        unresolved.push({ book: b, reason: 'no confident match' });
        stats.notFound++;
      }
    } catch (e) {
      console.log(`[search ${processed}/${needSearch}] ${b.title}\n  error: ${e.message}`);
      stats.failed++;
    }
  }

  console.log(`\nresolved ${resolved.length} Hardcover IDs; fetching editions in batches of ${BATCH}\n`);

  for (let i = 0; i < resolved.length; i += BATCH) {
    const chunk = resolved.slice(i, i + BATCH);
    let map;
    try {
      map = await editionsByBookIds(chunk.flatMap((r) => r.hardcoverIds));
    } catch (e) {
      console.log(`  batch ${i / BATCH + 1} failed: ${e.message}`);
      stats.failed += chunk.length;
      continue;
    }

    for (const { book: b, hardcoverIds, learned } of chunk) {
      const label = `${b.title}${b.author ? ' — ' + b.author : ''}`;

      // Pool editions across every candidate record for this work, tagging each with the
      // record it came from so a newly-learned hardcover_id points at the record that
      // actually supplied the winning edition — not just the first search hit.
      const pooled = [];
      for (const hid of hardcoverIds) {
        const node = map.get(String(hid));
        if (!node) continue;
        for (const e of node.editions || []) pooled.push({ ...e, _bookId: hid });
      }

      if (!pooled.length) {
        console.log(`${VERBOSE ? '' : label + '\n'}  no editions on any of ${hardcoverIds.length} candidate record(s)\n`);
        unresolved.push({ book: b, reason: 'candidate records had no editions' });
        stats.notFound++;
        continue;
      }

      // Print the heading BEFORE the edition dump. Printing editions first meant every
      // book's "→ picked" line was immediately followed by the NEXT book's candidate
      // list, which reads exactly like a wrong pick. Heading, then candidates, then
      // result — so a block always describes one book.
      if (VERBOSE) {
        console.log(label);
        for (const e of pooled) {
          const chosen = '';
          vlog(`${(e.isbn_13 || e.isbn_10 || '—').padEnd(15)} fmt=${e.reading_format_id} lang=${e.language_id} users=${e.users_count} ${e.edition_format || ''}${chosen}`);
        }
      }

      const { isbn, asin, warnings, bookId } = pickBestEdition(pooled);
      const hardcoverId = bookId || hardcoverIds[0];
      if (!isbn) {
        console.log(`${VERBOSE ? '' : label + '\n'}  no usable edition (${pooled.length} candidates)\n`);
        unresolved.push({ book: b, reason: `no usable edition (${pooled.length} candidates)` });
        stats.noEdition++;
        continue;
      }

      const flag = warnings?.length ? `\n  !! ${warnings.join('; ')}` : '';
      if (warnings?.length) stats.flagged++;
      const head = VERBOSE ? '' : `${label}\n`;
      console.log(`${head}  → ${isbn}${asin ? '  asin=' + asin : ''}${learned ? '  (+hardcover_id ' + hardcoverId + ')' : ''}${flag}\n`);

      if (!DRY_RUN) {
        // Persist a newly-discovered hardcover_id alongside the ISBN. It costs nothing
        // here and moves the book into the cheap, unambiguous path for every future
        // backfill or lookup — the search leg is both the slow part and the only part
        // that can match the wrong book.
        const patch = learned ? { isbn, hardcover_id: hardcoverId } : { isbn };
        const { error: upErr } = await supabase.from('books').update(patch).eq('id', b.id);
        if (upErr) {
          console.log(`  WRITE FAILED: ${upErr.message}`);
          stats.failed++;
          continue;
        }
      }
      stats.filled++;
      if (learned) stats.idsLearned++;
    }
  }

  const retryable = unresolved.filter((u) => isRetryable(u.book));
  const manual = unresolved.filter((u) => !isRetryable(u.book) && isManual(u.book));
  const real = unresolved.filter((u) => !isRetryable(u.book) && !isManual(u.book));

  console.log(`\n--- done ---`);
  console.log(`  filled:               ${stats.filled}`);
  console.log(`  hardcover_ids learnt: ${stats.idsLearned}`);
  console.log(`  flagged for review:   ${stats.flagged}   (grep the log for '!!')`);
  console.log(`  failed:               ${stats.failed}`);
  console.log(`\n  unresolved:           ${unresolved.length}`);
  console.log(`    ${manual.length} manually-added rows — titles typed by a user when lookup`);
  console.log(`       failed, so there may be nothing on Hardcover to match. Fixable in-app`);
  console.log(`       by correcting the title/author; not a backfill problem.`);
  console.log(`    ${real.length} looked-up rows — a real gap in Hardcover's data, or a title`);
  console.log(`       whose only editions are audio/foreign/ISBN-less.`);
  console.log(`    ${retryable.length} incomplete lookups — a stage never ran when the book was added`);
  console.log(`       (throttle saturated / source error). Retry, don't curate: these are`);
  console.log(`       not evidence the book is unfindable.`);

  // Write a worklist rather than making Simon scrape 2.5k lines of scrollback. Sorted
  // so the actionable population (properly looked-up rows that still failed) is on top.
  if (unresolved.length) {
    const out = join(__dirname, '..', 'output', 'isbn-unresolved.csv');
    const rows = [...real, ...retryable, ...manual].map(({ book: b, reason }) =>
      [b.id, b.title, b.author, b.source, b.status,
       isRetryable(b) ? 'retryable' : isManual(b) ? 'manual' : 'looked-up', reason]
        .map(csvCell).join(',')
    );
    writeFileSync(out, ['id,title,author,source,status,kind,reason', ...rows].join('\n') + '\n', 'utf8');
    console.log(`\n  worklist written to batch-scripts/isbn-unresolved.csv`);
  }

  if (DRY_RUN) console.log('\n(dry run — nothing was written to the database)');
}

main();
