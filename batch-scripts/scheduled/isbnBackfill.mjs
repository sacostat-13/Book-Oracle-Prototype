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

import { createServiceClient } from '../_shared/supabaseClient.mjs';
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

// v0.62.2 — "Unknown author" is a PLACEHOLDER, and treating it as a name is why
// Winnie-the-Pooh, Don Quixote, The Once and Future King, The Fellowship of the Ring and
// My Sister the Serial Killer were all reported as unfindable on Hardcover.
//
// authorMatches() requires the author to corroborate, so it compared the literal string
// "Unknown author" against ["A.A. Milne"], failed, and rejected every hit — for books
// Hardcover obviously has. Worse, the string was also concatenated into the search query
// ("Winnie-the-Pooh Unknown author"), poisoning the ranking before matching even began.
// 31 of the 186 remaining rows carry one of these sentinels.
//
// Treated as ABSENT instead: authorMatches(null, …) already returns true by design, so
// the title guard stands alone — and titleMatches requires exact equality for short
// titles precisely so it can be trusted without corroboration. Writes made this way are
// flagged, because losing the author check does genuinely lower confidence.
const SENTINEL_AUTHOR_RX = /^(unknown(\s+author)?|no\s+author|n\/?a|none|anon(ymous)?|various(\s+authors)?|\?+|-+|null|undefined)$/i;
const realAuthor = (a) => {
  const t = (a || '').trim();
  return !t || SENTINEL_AUTHOR_RX.test(t) ? null : t;
};



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

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
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
// 55 was chosen as "60 minus headroom", but the run still collects 429s, so the real
// ceiling is evidently below the documented 60/min — Hardcover appears to count bursts
// rather than a clean sliding minute. Overridable without a code edit so the number can
// be tuned against observed behaviour: HARDCOVER_RATE_LIMIT=40 in .env.local.
const RATE_LIMIT = Number(env['HARDCOVER_RATE_LIMIT']) > 0 ? Number(env['HARDCOVER_RATE_LIMIT']) : 45;
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
// v0.62 — EVERY Hardcover call failing used to look exactly like a catalog with no data.
//
// The 2026-08-17 run is the worked example: all 185 searches returned "no confident
// match" and all 786 batched edition fetches returned "no editions on any candidate
// record", so the script wrote a 971-row worklist stating, with total confidence, that
// Hardcover has nothing for Dune. A 100% miss rate across two unrelated query types is
// not a data gap, it is a broken connection — but nothing said so, because:
//
//   * a non-2xx response was reported through vlog(), which is silent without --verbose;
//   * GraphQL `errors` were likewise vlog()-only, and `json.data || null` turned an
//     errored response into an ordinary empty one;
//   * a null return from gql() is indistinguishable, at every call site, from a
//     legitimate "this book genuinely isn't on Hardcover".
//
// So the failure mode was: green step, full log, plausible CSV, wrong conclusion, and a
// recommendation to spend ~$39 of Claude curation on books that were never missing.
//
// Two changes. Transport-level failures are now reported unconditionally, and a run in
// which Hardcover answers nothing but failures aborts instead of finishing. Refusing to
// produce output is the correct behaviour when the output would be a confident lie.
const MAX_CONSECUTIVE_FAILURES = 10;
let consecutiveFailures = 0;
let hardcoverOk = 0;

class HardcoverUnavailable extends Error {
  constructor(detail) {
    super(
      `Hardcover returned ${MAX_CONSECUTIVE_FAILURES} consecutive failures and ` +
      `${hardcoverOk} successful call(s). Aborting rather than reporting every book ` +
      `as unresolved.\n  Last failure: ${detail}\n` +
      `  Diagnose with:  node batch-scripts/scheduled/isbnBackfill.mjs --probe`
    );
    this.name = 'HardcoverUnavailable';
  }
}

// Called on every transport- or GraphQL-level failure. A book that is simply absent from
// Hardcover does NOT come through here — that is a successful call with no hits, which
// resets the counter like any other success.
function noteFailure(detail) {
  console.warn(`  hardcover: ${detail}`);
  if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new HardcoverUnavailable(detail);
}

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
  // v0.62.2 — this used to be `await sleep(60000); return gql(query, variables)`, which
  // RESET `attempt` to 1 on every retry. Against a per-minute limit that is merely slow;
  // against an exhausted DAILY quota it never terminates — the run sleeps 60s, retries,
  // 429s, forever, producing no output and no error. A job killed while in that state is
  // indistinguishable from one killed while working, which is a plausible reading of what
  // happened to the curation run.
  //
  // Now bounded, and it honours Retry-After when the server sends one instead of always
  // guessing 60s. After the cap it is reported as a failure like any other, so a run that
  // has genuinely run out of quota trips the circuit breaker and says so.
  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 300_000) : 60_000;
    if (attempt <= 3) {
      console.warn(`  rate limited (429) — attempt ${attempt}/3, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      return gql(query, variables, attempt + 1);
    }
    noteFailure(
      `429 after 3 backoffs. This is a quota wall, not congestion — most likely the daily ` +
      `allowance is spent. Lower RATE_LIMIT (currently ${RATE_LIMIT}/min) or rerun later; ` +
      `the script resumes from where it stopped.`
    );
    return null;
  }
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300);
    // 401/403 will not fix themselves on the next book. Fail on the first one rather
    // than spending 971 books' worth of wall-clock discovering the same thing 971 times.
    if (resp.status === 401 || resp.status === 403) {
      throw new HardcoverUnavailable(
        `HTTP ${resp.status} — the token was rejected. Check HARDCOVER_API_TOKEN ` +
        `(Hardcover tokens expire after a year and reset on January 1st), and that the ` +
        `Authorization header format still matches https://docs.hardcover.app/api/getting-started/. ${body}`
      );
    }
    noteFailure(`HTTP ${resp.status} ${body}`);
    return null;
  }

  const json = await resp.json();
  // A GraphQL error is a FAILED call that arrives with HTTP 200. `json.data || null`
  // laundered it into a normal empty result — the single most misleading line in the
  // original script, because a schema drift (a renamed field, a changed argument type)
  // reads downstream as "this book does not exist".
  if (json.errors?.length) {
    noteFailure(`graphql: ${JSON.stringify(json.errors).slice(0, 300)}`);
    return null;
  }

  consecutiveFailures = 0;
  hardcoverOk++;
  return json.data || null;
}

// Hardcover's `books` query takes `id: { _in: [...] }`, so editions for many books come
// back in ONE request. Fetching them one at a time would cost 953 requests for the
// known-ID rows alone; batched at 50 it costs 20. Keep the batch modest — each book
// carries up to 10 editions, so 50 books is ~500 edition rows per response.
const BATCH = 50;

async function editionsByBookIds(ids) {
  if (!ids.length) return new Map();

  // v0.62.1 — the probe proved this query works perfectly when handed a real integer id
  // (427363 → 10 editions), yet the 2026-08-17 run got "no editions" for all 786 rows
  // that already had a hardcover_id. The query is not the problem; what we feed it is.
  //
  // `ids.map(Number)` turns anything non-numeric — a slug, a UUID, a numeric string with
  // whitespace, a null — into NaN, and JSON.stringify serialises NaN as `null`. So the
  // request goes out as { id: { _in: [null] } }, which is valid GraphQL, returns an empty
  // array, and reads downstream as "this book has no editions". Silent, total, and
  // indistinguishable from missing data.
  const coerced = ids.map((id) => ({ raw: id, num: Number(id) }));
  const bad = coerced.filter((c) => !Number.isFinite(c.num));
  if (bad.length) {
    console.warn(
      `  !! ${bad.length}/${ids.length} hardcover_id value(s) are not numeric and would be ` +
      `sent as null — e.g. ${JSON.stringify(bad.slice(0, 3).map((b) => b.raw))} ` +
      `(type ${typeof bad[0].raw}). These cannot match books.id.`
    );
  }
  const usable = coerced.filter((c) => Number.isFinite(c.num)).map((c) => c.num);
  if (!usable.length) return new Map();
  ids = usable;

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

// per_page was 10. The probe showed why that is too few: searching "Dune Frank Herbert"
// reports found: 70, but the first ten hits are God Emperor of Dune, two omnibus
// collections and two CliffsNotes-style study guides — every one correctly rejected by
// titleMatches, and the actual novel nowhere in the window. Hardcover's relevance ranking
// favours records with high activity counts, and study guides of famous books are busy
// records.
//
// A wider window costs exactly the same single request. The guards are unchanged, so
// precision is unaffected — this only stops the right answer being truncated away.
const PER_PAGE = 25;

async function runSearch(q) {
  const data = await gql(
    `query SearchBooks($q: String!, $type: String!, $per: Int!) {
       search(query: $q, query_type: $type, per_page: $per, page: 1) { results }
     }`,
    { q, type: 'Book', per: PER_PAGE }
  );
  return data?.search?.results?.hits || [];
}

async function searchForBookIds(title, rawAuthor) {
  // Normalise once, here, so both the query text and every guard below see the same
  // thing. A placeholder must not reach either.
  const author = realAuthor(rawAuthor);
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

// -- Probe ---------------------------------------------------------------------
// isbnFallback.mjs has had one of these since its first version; isbnBackfill never did,
// which is why an entire Hardcover outage had to be inferred from a CSV. Two requests,
// no throttling, no database, raw status and body printed — enough to tell apart an
// expired token, a moved endpoint and a changed schema in about five seconds.
//
//   node batch-scripts/scheduled/isbnBackfill.mjs --probe
//   node batch-scripts/scheduled/isbnBackfill.mjs --probe 10534   (a known hardcover_id)
async function runProbe(bookId) {
  const auth = HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`;
  console.log(`endpoint: https://api.hardcover.app/v1/graphql`);
  console.log(`token:    ${HARDCOVER_TOKEN.length} chars, sent as "${auth.slice(0, 7)}…"`);

  // A JWT carries its own expiry. Reading it locally beats guessing from a 401, and
  // Hardcover additionally resets tokens every January 1st regardless of the exp claim.
  try {
    const claims = JSON.parse(Buffer.from(auth.split(' ')[1].split('.')[1], 'base64url').toString());
    if (claims.exp) {
      const when = new Date(claims.exp * 1000);
      console.log(`          exp ${when.toISOString()} — ${when < new Date() ? '*** EXPIRED ***' : 'valid'}`);
    }
  } catch { console.log(`          (token is not a decodable JWT)`); }

  // v0.62.1 — the first version dumped 800 characters of pretty-printed JSON, which on a
  // Typesense document is spent entirely on `alternative_titles` before reaching anything
  // the script actually reads. It confirmed the transport was healthy and hid every field
  // that decides whether a book matches. Print the DECISION INPUTS instead of the payload.
  const call = async (label, body) => {
    console.log(`\n--- ${label} ---`);
    const r = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'BooksOracle-isbnBackfill/1.0' },
      body: JSON.stringify(body),
    });
    console.log(`HTTP ${r.status} ${r.statusText}`);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!json) { console.log(text.slice(0, 600)); return null; }
    if (json.errors) console.log(`GraphQL errors: ${JSON.stringify(json.errors, null, 2).slice(0, 1200)}`);
    return json;
  };

  // 1. Search. Reproduces searchForBookIds() exactly, then reports which of the three
  //    guards each hit passes — the search returning 70 results tells us nothing if
  //    titleMatches() then rejects all of them.
  const TITLE = 'Dune', AUTHOR = 'Frank Herbert';
  const s = await call('1. search — the path for rows with no hardcover_id', {
    query: `query SearchBooks($q: String!, $type: String!) {
       search(query: $q, query_type: $type, per_page: 10, page: 1) { results }
     }`,
    variables: { q: [searchTitle(TITLE), AUTHOR].filter(Boolean).join(' '), type: 'Book' },
  });

  const hits = s?.data?.search?.results?.hits || [];
  console.log(`hits: ${hits.length}   (found: ${s?.data?.search?.results?.found ?? '?'})`);
  if (!hits.length) {
    console.log(`!! results.hits is empty or missing — runSearch() would return [] for every book.`);
  } else {
    console.log(`document fields: ${Object.keys(hits[0].document || hits[0]).join(', ')}\n`);
    console.log(`  ${'id'.padEnd(9)} ${'title'.padEnd(38)} ${'ok?'.padEnd(5)} why`);
    for (const h of hits.slice(0, 6)) {
      const doc = h.document || h;
      const okId = !!doc?.id;
      const okT = okId && titleMatches(TITLE, doc.title);
      const okA = okT && authorMatches(AUTHOR, docAuthors(doc));
      const why = !okId ? 'NO id field — every hit is skipped'
        : !okT ? `title rejected (got ${JSON.stringify(doc.title)})`
        : !okA ? `author rejected (got ${JSON.stringify(docAuthors(doc)).slice(0, 60)})`
        : 'accepted';
      console.log(`  ${String(doc?.id ?? '—').padEnd(9)} ${String(doc?.title ?? '—').slice(0, 38).padEnd(38)} ${(okA ? 'YES' : 'no').padEnd(5)} ${why}`);
    }
  }

  // 2. Editions. This is the 786-book path — the one that returned "no editions on any
  //    candidate record" for every single row — and it was never exercised above.
  //    Default to an id the search just returned, so no database lookup is needed.
  const firstId = hits.map((h) => (h.document || h)?.id).find(Boolean);
  const probeId = bookId || firstId;
  if (!probeId) {
    console.log(`\n2. editions — SKIPPED: no id available. Pass one:  --probe <hardcover_id>`);
    return;
  }

  const e = await call(`2. editions for book id ${probeId} — the path for rows that HAVE a hardcover_id`, {
    query: `query EditionsByBooks($ids: [Int!]) {
       books(where: { id: { _in: $ids } }) { id title ${EDITION_FIELDS} }
     }`,
    variables: { ids: [Number(probeId)] },
  });

  const books = e?.data?.books;
  if (!Array.isArray(books)) {
    console.log(`!! data.books is ${books === undefined ? 'missing' : JSON.stringify(books)} — the query shape has changed.`);
  } else if (!books.length) {
    console.log(`!! books[] is EMPTY for id ${probeId}. The row exists (search just returned it),`);
    console.log(`   so { id: { _in: [Int!] } } is not selecting it — most likely an id TYPE`);
    console.log(`   mismatch: Hardcover's books.id may now be bigint, and ids.map(Number) sends`);
    console.log(`   Int. That alone would produce "no editions" for all 786 known-id rows.`);
  } else {
    for (const b of books) {
      const eds = b.editions || [];
      console.log(`books[0]: id=${b.id} title=${JSON.stringify(b.title)}`);
      console.log(`editions: ${b.editions === undefined ? '*** FIELD MISSING ***' : eds.length}`);
      if (eds.length) {
        console.log(`fields:   ${Object.keys(eds[0]).join(', ')}`);
        for (const ed of eds.slice(0, 5)) {
          console.log(`  ${(ed.isbn_13 || ed.isbn_10 || '—').padEnd(15)} fmt=${ed.reading_format_id} lang=${ed.language_id} users=${ed.users_count} ${ed.edition_format || ''}`);
        }
      } else {
        console.log(`!! zero editions on a book the search ranked first. Either the sub-query's`);
        console.log(`   filters exclude everything (compilation _eq false / limit / order_by) or`);
        console.log(`   the relationship was renamed. See EDITION_FIELDS in src/lib/editionPicker.js.`);
      }
    }
  }
}

// -- Probe against REAL rows ---------------------------------------------------
// --probe uses hardcoded inputs, which is why it came back clean while the job it is
// meant to diagnose failed on all 786 known-id rows: the two were never given the same
// data. This variant takes the actual column values out of Supabase and pushes them
// through the actual code path.
//
//   node batch-scripts/scheduled/isbnBackfill.mjs --probe-db
async function runDbProbe() {
  const { data, error } = await supabase
    .from('books')
    .select('id, title, author, hardcover_id')
    .is('isbn', null)
    .not('hardcover_id', 'is', null)
    .order('title')
    .range(0, 4);
  if (error) { console.error(`supabase: ${error.message}`); process.exit(1); }
  if (!data.length) { console.log('No rows with a null ISBN and a hardcover_id. Nothing to probe.'); return; }

  console.log(`${data.length} row(s) with isbn IS NULL and hardcover_id IS NOT NULL:\n`);
  console.log(`  ${'hardcover_id'.padEnd(24)} ${'typeof'.padEnd(8)} ${'Number()'.padEnd(12)} title`);
  for (const b of data) {
    const n = Number(b.hardcover_id);
    console.log(
      `  ${JSON.stringify(b.hardcover_id).padEnd(24)} ${(typeof b.hardcover_id).padEnd(8)} ` +
      `${(Number.isFinite(n) ? String(n) : '*** NaN ***').padEnd(12)} ${String(b.title).slice(0, 40)}`
    );
  }

  const ids = data.map((b) => b.hardcover_id);
  console.log(`\nSent to Hardcover as: ${JSON.stringify({ ids: ids.map(Number) })}`);
  console.log(`(NaN serialises to null — a null in that array can never match books.id)\n`);

  const map = await editionsByBookIds(ids);
  console.log(`--- result ---`);
  console.log(`records returned: ${map.size} of ${ids.length} requested`);
  for (const b of data) {
    const node = map.get(String(b.hardcover_id));
    const eds = node?.editions || [];
    console.log(`  ${String(b.hardcover_id).padEnd(12)} ${node ? `matched "${String(node.title).slice(0, 34)}"` : '*** NO RECORD RETURNED ***'}  editions=${eds.length}`);
    if (eds.length) console.log(`      first: ${eds[0].isbn_13 || eds[0].isbn_10 || '—'}  ${eds[0].edition_format || ''}`);
  }
  if (map.size === ids.length && [...map.values()].every((n) => (n.editions || []).length)) {
    console.log(`\nThis path is healthy on real data. If the scheduled run still reports "no`);
    console.log(`editions", the difference is upstream — check that the batch is not mixing ids`);
    console.log(`from rows whose hardcover_id is null or of a different shape.`);
  }
}

async function main() {
  if (args.includes('--probe-db')) return runDbProbe();
  if (args.includes('--probe')) {
    const i = args.indexOf('--probe');
    const next = args[i + 1];
    return runProbe(next && !next.startsWith('--') ? next : null);
  }

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
      // A dead upstream is not a per-book problem and must not be absorbed into a
      // per-book failure count — that is how 971 individual "errors" added up to a
      // confident worklist. Let it terminate the run.
      if (e instanceof HardcoverUnavailable) throw e;
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
      if (e instanceof HardcoverUnavailable) throw e;
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

      const { isbn, asin, warnings = [], bookId } = pickBestEdition(pooled);
      const hardcoverId = bookId || hardcoverIds[0];

      // Matched on title alone because the stored author is a placeholder. Usually right,
      // but it is the one path with no second signal — surface it for review rather than
      // letting it pass as an ordinary confident match.
      if (!realAuthor(b.author)) {
        warnings.push(`matched on title alone — stored author is "${b.author || '(blank)'}"`);
      }
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

  // Last line of defence, for the case the circuit breaker cannot see: calls that all
  // SUCCEED but return nothing usable. If not one book in the whole catalog produced an
  // ISBN, the explanation is a broken query — a renamed field, a changed argument type,
  // an ID type mismatch — not 971 simultaneously uncatalogued books. Writing the worklist
  // anyway is what turned a schema problem into a curation budget.
  if (books.length >= 25 && stats.filled === 0) {
    console.error(`\n!! ABORTING — ${books.length} books processed and not one ISBN was resolved.`);
    console.error(`   ${hardcoverOk} Hardcover call(s) succeeded at the transport level, so this is`);
    console.error(`   most likely a query/schema mismatch rather than missing data. The worklist has`);
    console.error(`   NOT been written; the previous one is still accurate.`);
    console.error(`\n   Diagnose:  node batch-scripts/scheduled/isbnBackfill.mjs --probe`);
    console.error(`   Override:  --allow-empty  (if you have confirmed the catalog really is this bare)`);
    if (!args.includes('--allow-empty')) process.exit(1);
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

  // Machine-readable last line, matching metadataBackfill.mjs's convention. The workflow
  // summary counted CSV rows, so "the file is absent because the step never ran" and
  // "the file is absent because there was nothing to write" rendered identically as 0.
  // A counters line is present only when the script actually reached the end.
  console.log(
    `[isbnBackfill] filled=${stats.filled} idsLearned=${stats.idsLearned} ` +
    `unresolved=${unresolved.length} manual=${manual.length} lookedUp=${real.length} ` +
    `retryable=${retryable.length} failed=${stats.failed} hardcoverOk=${hardcoverOk}`
  );

  if (DRY_RUN) console.log('\n(dry run — nothing was written to the database)');
}

// A bare main() left rejections to Node's default handler: a stack trace and a non-zero
// exit, but nothing that reads as an explanation in a CI log. Handle it so the step
// output ends with the reason rather than with a trace through fetch().
main().catch((e) => {
  console.error(`\n${e.name === 'HardcoverUnavailable' ? '!! ' : ''}${e.message}`);
  process.exit(1);
});
