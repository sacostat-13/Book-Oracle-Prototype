// isbnFallback.mjs — second-pass ISBN resolution via OpenLibrary and Google Books,
// for the rows isbnBackfill.mjs could not settle from Hardcover alone.
//
// TWO TARGET POPULATIONS
// ----------------------
//   --target unresolved   books with isbn IS NULL. Their purchase links currently
//                         degrade to a search. Functional, just not converting.
//
//   --target foreign      books whose stored ISBN is a non-English registration group
//                         (978-4 Japan, 978-84 Spain, 978-3 Germany…). These are WORSE
//                         than the unresolved set: the link looks valid and 404s on
//                         amazon.com and bookshop.org. Hardcover only had a foreign
//                         edition; an English one often exists elsewhere.
//
//   --target both         (default) unresolved first, then foreign.
//
// SOURCES, IN ORDER
//   1. OpenLibrary  — no API key, works out of the box. Searches for the work, then
//                     reads its editions to find an English one with an ISBN-13.
//   2. Google Books — better language metadata (langRestrict + a per-volume language
//                     tag) but REQUIRES a key: Google set anonymous quota to 0, so
//                     keyless requests return 429. Used only if GOOGLE_BOOKS_API_KEY
//                     is in .env.local. Free tier is ~1,000 queries/day.
//   3. ISBNdb       — PAID, and with a key present it now runs FIRST, short-circuiting
//                     the other two on a hit. Its value is searching by TITLE ALONE,
//                     which is what the residual needs — non-English titles and rows
//                     whose stored author is a placeholder, where the free sources rank
//                     badly without an author to corroborate. 5,000 lookups/day against a
//                     residual in the low hundreds makes it the ABUNDANT source; Google's
//                     ~1,000/day is the scarce one. Skipped entirely without
//                     ISBNDB_API_KEY, so the pipeline stays free by default.
//                     Pass --isbndb-last to restore the free-first ordering.
//
// LANGUAGE POLICY
// Every ISBN is checksum-verified before it is written. Language is a PREFERENCE, not a
// gate: English editions outrank foreign ones decisively, but when a book has no English
// edition — a Spanish novel, a Japanese manga — its foreign ISBN is the correct link and
// gets written. Both storefronts carry foreign-language titles, and no link at all serves
// the reader worse than a foreign one.
//
// The exception is --target foreign, whose whole purpose is to REPLACE a non-English
// ISBN. Swapping Spanish for German is churn, not repair, so that pass writes only when
// it finds an actual English edition and otherwise leaves the existing value alone.
//
// Audiobook and library-rebind editions are disqualified outright in both passes — those
// are never something a reader can buy as the book they asked for.
//
// Usage:
//   node batch-scripts/isbnFallback.mjs --dry-run --limit 20 --verbose
//   node batch-scripts/isbnFallback.mjs --target unresolved
//   node batch-scripts/isbnFallback.mjs --target foreign
//   node batch-scripts/isbnFallback.mjs                       # both
//
// Verify the upstream response shapes before trusting a clean run:
//   node batch-scripts/isbnFallback.mjs --probe "A Discovery of Witches" "Deborah Harkness"
//
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:               GOOGLE_BOOKS_API_KEY
//                         ISBNDB_API_KEY      enables ISBNdb (queried first by default)
//                         ISBNDB_MIN_GAP_MS   default 1100 (Basic tier is 1 req/sec)

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cleanIsbn, isValidIsbn, isEnglishRegistrant, isbn10to13 } from '../../src/lib/isbn.js';
import { titleMatches, authorMatches, titleVariants } from '../../src/lib/titleMatch.js';

// The most-stripped variant is what we send to a relevance-ranked search: series markers
// and subtitles are noise to the search engine even though they matter to the matcher.
// Matching itself uses ALL variants (see titleMatch.js) so nothing is lost by stripping.
const searchTitle = (t) => titleVariants(t).slice(-1)[0] || t || '';

// Same placeholder problem as isbnBackfill.mjs, and it bites harder here because the
// string is sent to the upstreams as a filter: OpenLibrary gets author=Unknown author,
// Google Books gets inauthor:"Unknown author". Both then return nothing at all, so the
// book fails before any matching logic runs. Treated as absent, the title alone is used.
const SENTINEL_AUTHOR_RX = /^(unknown(\s+author)?|no\s+author|n\/?a|none|anon(ymous)?|various(\s+authors)?|\?+|-+|null|undefined)$/i;
const realAuthor = (a) => {
  const t = (a || '').trim();
  return !t || SENTINEL_AUTHOR_RX.test(t) ? null : t;
};


const __dirname = dirname(fileURLToPath(import.meta.url));

// -- CLI ----------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function argVal(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  return (a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1]) ?? fallback;
}
const LIMIT = Number.isFinite(parseInt(argVal('--limit'), 10)) ? parseInt(argVal('--limit'), 10) : null;
const ISBNDB_LAST = args.includes('--isbndb-last');
// Manual override for when you already know a source is spent and would rather not pay
// even the one call it takes to find out:  --skip googlebooks,openlibrary
const SKIP_SOURCES = (argVal('--skip', '') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const TARGET = (argVal('--target', 'both') || 'both').toLowerCase();
if (!['unresolved', 'foreign', 'both'].includes(TARGET)) {
  console.error(`--target must be unresolved | foreign | both`); process.exit(1);
}

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
const GOOGLE_KEY = env['GOOGLE_BOOKS_API_KEY'] || '';
// Optional and PAID. Absent = the pipeline behaves exactly as before, free sources only.
const ISBNDB_KEY = env['ISBNDB_API_KEY'] || '';
const ISBNDB_FIRST = !!ISBNDB_KEY && !ISBNDB_LAST;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };
const UA = 'BooksOracle-isbnFallback/1.0 (https://thebooksoracle.com)';

// -- Title / author matching (same rules as isbnBackfill.mjs) ------------------


// Validity is non-negotiable — a bad check digit guarantees a 404. Language is NOT a
// gate: a Spanish novel's Spanish ISBN is the CORRECT answer, and both storefronts carry
// Spanish-language titles. English is a strong preference expressed in scoring, applied
// only when an English edition actually exists.
function acceptable(raw) {
  const c = cleanIsbn(raw);
  if (!c) return null;
  if (!isValidIsbn(c)) { vlog(`reject ${c} — bad check digit`); return null; }
  const t = c.length === 10 ? isbn10to13(c) : c;
  return { isbn: t, englishRegistrant: isEnglishRegistrant(t) };
}

// -- Candidate scoring ---------------------------------------------------------
// Taking the first title+author match is the same mistake the Hardcover picker made.
// The probe run proved it: Google Books' top hit for A Discovery of Witches was
// 9780606267281 — a Turtleback library rebind. Valid, English, and not what either
// storefront sells to a consumer.
//
// School/library rebinders buy retail copies, rebind them and issue their own ISBN.
// Those ISBNs resolve on Amazon at library pricing or not at all, and Bookshop rarely
// carries them. Audio imprints are worse — a spoken-word ISBN isn't a book at all.
const REBINDER_RX = /\b(turtleback|perfection learning|bound to stay bound|paw prints|econo-?clad|demco|paperbackshelf|reprint|large print)\b/i;
const AUDIO_PUB_RX = /\b(audio|audible|recorded books|books on tape|blackstone|tantor|brilliance|listening library|spoken arts|dreamscape)\b/i;

// 0606 is Turtleback's registrant prefix — catches their editions even when the
// publisher string is missing, which it often is on OpenLibrary records.
const REBINDER_ISBN_RX = /^9780606/;

// Returns null for a candidate that must never be written, or a score where higher is
// better. Disqualification and preference are deliberately different mechanisms: an
// audiobook ISBN is never a book and no amount of other merit redeems it, whereas a
// foreign edition is merely worse than an English one and perfectly fine on its own.
function scoreCandidate(c) {
  const pub = c.publisher || '';

  // Hard disqualifiers. `binding` is ISBNdb's format field ("Audio CD", "Audible Audio")
  // and catches spoken-word editions issued under an ordinary trade imprint, where the
  // publisher string gives nothing away.
  const binding = c.binding || '';
  if (/\b(audio|audible|spoken|cd|cassette)\b/i.test(binding)) return null;
  if (AUDIO_PUB_RX.test(pub)) return null;
  if (REBINDER_RX.test(pub) || REBINDER_ISBN_RX.test(c.isbn)) return null;

  let score = 0;

  // English wins decisively when one is on the table — the +100 outweighs every other
  // signal combined, so a sparse English record still beats a well-described foreign
  // one. But a foreign edition scores positively and IS written when nothing English
  // exists: for "Alienígenas Americanos" or "A mí no me iba a pasar" the Spanish ISBN
  // is the right link, and no link at all serves the reader worse.
  if (c.englishRegistrant) score += 100;
  if (c.explicitEnglish) score += 20;

  // Signals of a real, catalogued trade edition rather than a stub record.
  if (pub) score += 10;
  if (c.pages) score += 10;

  // Google Books carries retail metadata, so its records skew toward editions actually
  // for sale; OpenLibrary indexes library holdings, including many ex-library copies.
  if (c.source === 'googlebooks') score += 5;
  // Bowker-derived retail data, so a well-populated ISBNdb record is a real trade
  // edition. Scored below Google Books because its records are frequently sparse —
  // only title/author/isbn are guaranteed — and a sparse record already loses the
  // publisher and pages points above.
  if (c.source === 'isbndb') score += 3;

  return score;
}

// `quiet` is passed when this is used as a probe between sources rather than to make the
// final decision — otherwise every candidate gets logged two or three times over.
function pickCandidate(cands, requireEnglish, quiet = false) {
  let best = null, bestScore = -Infinity;
  for (const c of cands) {
    const s = scoreCandidate(c);
    if (!quiet) vlog(`  cand ${c.isbn} ${s === null ? ' DISQ' : String(s).padStart(5)}  ${c.englishRegistrant ? 'en' : '--'}  ${c.source}  ${(c.publisher || '—').slice(0, 30)}`);
    if (s === null) continue;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  // "every candidate disqualified" was printed even when there were no candidates at all,
  // which reads as "we found editions and rejected them" when nothing was ever found.
  if (!best) {
    if (!quiet) vlog(cands.length ? '  every candidate disqualified (audio / rebind)' : '  no candidates from any source');
    return null;
  }

  // --target foreign exists to REPLACE a non-English ISBN. Swapping a Spanish one for a
  // German one is churn, not repair, so that pass only accepts an English result.
  if (requireEnglish && !best.englishRegistrant) {
    vlog(`  best candidate ${best.isbn} is also non-English — leaving the existing value`);
    return null;
  }
  return best;
}

// v0.62.3 — a source that has run out of quota must be STOPPED, not retried per book.
//
// The 10-book trial spent roughly 40 minutes, and almost none of it on work: Google Books
// answered 429 to every call, and each book paid 20s+40s+60s twice over — once for the
// English-restricted query and once for the unrestricted retry — before moving on. Four
// minutes per book, to learn something already known after the first one.
//
// The daily free-tier allowance is ~1,000 queries and the earlier full pass consumed it.
// So: after this many consecutive 429s a source is switched off for the rest of the run
// and every later call returns instantly.
const SOURCE_DEAD_AFTER = 3;
const sourceHealth = { openlibrary: 0, googlebooks: 0, isbndb: 0 };
const sourceExhausted = new Set(SKIP_SOURCES);
const sourceDead = (k) => sourceExhausted.has(k) || sourceHealth[k] >= SOURCE_DEAD_AFTER;

// A 429 means two completely different things and they deserve opposite responses.
//
//   Burst throttling      transient. Wait and it clears. Killing the source over one of
//                         these would throw away a working upstream — OpenLibrary rate-
//                         limits for courtesy and has no daily cap at all.
//   Quota exhaustion      permanent until the window resets (midnight UTC for Google and
//                         ISBNdb). Every retry is guaranteed to fail, so retrying is pure
//                         latency: 120 seconds per book, per source, for nothing.
//
// Rather than guess with a strike count, ask. Google states the distinction in the error
// body — `dailyLimitExceeded` / `quotaExceeded` versus `rateLimitExceeded` /
// `userRateLimitExceeded` — and ISBNdb publishes it in headers, where `ratelimit` carries
// remaining requests (r) and seconds until reset (t). A reset measured in hours is a
// daily wall; one measured in seconds is a burst.
function classify429(body, headers) {
  try {
    const reasons = (JSON.parse(body)?.error?.errors || []).map((e) => e.reason || '');
    if (reasons.some((r) => /daily|quota/i.test(r))) return 'exhausted';
    if (reasons.length) return 'throttled';
  } catch { /* not Google-shaped JSON */ }

  const rl = headers.get?.('ratelimit') || '';
  const remaining = /(?:^|[;,\s])r=(\d+)/.exec(rl);
  const resetIn = /(?:^|[;,\s])t=(\d+)/.exec(rl);
  if (remaining && Number(remaining[1]) === 0 && resetIn && Number(resetIn[1]) > 300) return 'exhausted';

  return 'throttled';
}

function killSource(k, why) {
  if (!k || sourceExhausted.has(k)) return;
  sourceExhausted.add(k);
  console.log(`  !! ${k} disabled for the rest of this run — ${why}`);
  console.log(`     Every further call would fail identically, so they are skipped rather than retried.`);
}

function noteSourceResult(k, rateLimited) {
  if (!k) return;
  if (!rateLimited) { sourceHealth[k] = 0; return; }
  if (++sourceHealth[k] === SOURCE_DEAD_AFTER) {
    killSource(k, `${SOURCE_DEAD_AFTER} consecutive rate-limit errors with no quota signal in the response`);
  }
}

async function getJson(url, attempt = 1, extraHeaders = {}, sourceKey = null) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...extraHeaders } });
    if (r.status === 429) {
      const body = await r.text().catch(() => '');
      if (classify429(body, r.headers) === 'exhausted') {
        // No backoff at all. The allowance is gone until the window resets; waiting 20,
        // 40 and 60 seconds to be told so again helps nobody.
        killSource(sourceKey, 'the API reports its quota is exhausted (resets at 00:00 UTC)');
        return null;
      }
      if (attempt <= 3) { vlog(`429 (burst) — waiting ${20 * attempt}s`); await sleep(20000 * attempt); return getJson(url, attempt + 1, extraHeaders, sourceKey); }
      noteSourceResult(sourceKey, true);
      return null;
    }
    if (!r.ok) { vlog(`${r.status} ${url.slice(0, 90)}`); return null; }
    noteSourceResult(sourceKey, false);
    return await r.json();
  } catch (e) {
    if (attempt <= 3) { await sleep(2000 * attempt); return getJson(url, attempt + 1, extraHeaders, sourceKey); }
    vlog(`fetch failed: ${e.message}`);
    return null;
  }
}

// -- Source 1: OpenLibrary -----------------------------------------------------
// Search gives a work key; the work's editions carry per-edition ISBNs and languages.
// The search result's own `isbn` array pools every edition together with no language
// attribution, so it cannot be used to pick an English one — hence the second call.
async function tryOpenLibrary(title, rawAuthor, out) {
  if (sourceDead('openlibrary')) return;
  const author = realAuthor(rawAuthor);
  const q = new URLSearchParams({
    title: searchTitle(title),
    limit: '5',
    fields: 'key,title,author_name',
  });
  if (author) q.set('author', author);
  const search = await getJson(`https://openlibrary.org/search.json?${q}`, 1, {}, 'openlibrary');
  const docs = search?.docs || [];

  // OpenLibrary routinely holds several work records for the same book (the probe found
  // three for A Discovery of Witches), and editions come back unordered — the first
  // record's first edition was Spanish. So gather from every matching work rather than
  // returning on the first hit, and pull enough editions that English ones aren't
  // truncated away on a heavily-reprinted title.
  for (const d of docs.slice(0, 3)) {
    if (!d.key) continue;
    if (!titleMatches(title, d.title)) { vlog(`OL reject (title) "${d.title}"`); continue; }
    if (!authorMatches(author, d.author_name)) { vlog(`OL reject (author) "${d.title}"`); continue; }

    await sleep(300); // be polite to OpenLibrary
    const eds = await getJson(`https://openlibrary.org${d.key}/editions.json?limit=100`, 1, {}, 'openlibrary');
    const entries = eds?.entries || [];
    vlog(`OL ${d.key} "${d.title}" — ${entries.length} editions`);

    for (const e of entries) {
      // Every language is collected now; scoring decides. Skipping non-English editions
      // here would leave Spanish-only books with no candidates at all.
      const langs = e.languages || [];
      const acc = acceptable((e.isbn_13 || [])[0] || (e.isbn_10 || [])[0]);
      if (!acc) continue;
      out.push({
        isbn: acc.isbn,
        englishRegistrant: acc.englishRegistrant,
        source: 'openlibrary',
        publisher: (e.publishers || [])[0] || null,
        pages: e.number_of_pages || null,
        explicitEnglish: langs.some((l) => /\/eng$/.test(l.key || '')),
        matched: d.title,
      });
    }
  }
}

// -- Source 2: Google Books ----------------------------------------------------
// v0.62.1 — this function contradicted the language policy stated at the top of the file.
//
// That policy says language is a PREFERENCE, not a gate: "when a book has no English
// edition — a Spanish novel, a Japanese manga — its foreign ISBN is the correct link and
// gets written". scoreCandidate() implements it faithfully, and even names the cases in
// its comments. But this query sent langRestrict=en AND skipped any volume whose language
// was not 'en', so a Spanish-only novel could never produce a Google Books candidate at
// all. The scoring branch for "no English edition exists" was unreachable through this
// source; only OpenLibrary, which does collect every language, could ever get there.
//
// That is why Paradais, Alma oscura del alba and Aquelarre came back "no edition found"
// while being trivially findable elsewhere: the pipeline was not looking for them.
//
// Fixed by making the restriction a parameter rather than a constant. The English-first
// call is still made first — it produces better-ranked English trade editions when one
// exists, which is the common case — and the caller retries unrestricted only for rows
// that found nothing, the same widen-recall-on-failure idiom searchForBookIds() uses.
async function tryGoogleBooks(title, rawAuthor, out, { englishOnly = true } = {}) {
  if (!GOOGLE_KEY || sourceDead('googlebooks')) return;
  const author = realAuthor(rawAuthor);
  const terms = [`intitle:${JSON.stringify(searchTitle(title))}`];
  if (author) terms.push(`inauthor:${JSON.stringify(author)}`);
  const u = new URLSearchParams({
    // Join with a SPACE, not '+'. URLSearchParams percent-encodes a literal '+' as %2B,
    // so joining with '+' produced q=intitle:"X"%2Binauthor:"Y" — Google saw a literal
    // plus character inside the query rather than a term separator, and answered 503 to
    // essentially every request in the first dry run. A space encodes to '+', which is
    // what the API actually wants.
    q: terms.join(' '),
    maxResults: '10',
    ...(englishOnly ? { langRestrict: 'en' } : {}),
    printType: 'books',
    key: GOOGLE_KEY,
  });
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?${u}`, 1, {}, 'googlebooks');
  for (const item of data?.items || []) {
    const vi = item.volumeInfo || {};
    if (!vi.title) continue;
    if (englishOnly && vi.language && vi.language !== 'en') continue;
    const full = vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title;
    if (!titleMatches(title, full)) { vlog(`GB reject (title) "${full}"`); continue; }
    if (!authorMatches(author, vi.authors)) { vlog(`GB reject (author) "${full}"`); continue; }
    const ids = vi.industryIdentifiers || [];
    const acc = acceptable(
      ids.find((x) => x.type === 'ISBN_13')?.identifier ||
      ids.find((x) => x.type === 'ISBN_10')?.identifier
    );
    if (!acc) continue;
    out.push({
      isbn: acc.isbn,
      englishRegistrant: acc.englishRegistrant,
      source: 'googlebooks',
      publisher: vi.publisher || null,
      pages: vi.pageCount || null,
      explicitEnglish: vi.language === 'en',
      matched: full,
    });
  }
}

// -- Source 3: ISBNdb ----------------------------------------------------------
// PAID, and the only paid dependency in this pipeline — so it runs LAST, and only for
// rows the three free lookups could not settle. Two reasons beyond cost: the free sources
// answer the easy majority, and keeping ISBNdb on the tail means the daily allowance is
// spent on exactly the books that need it.
//
// Why it earns a place at all: /books/{query}?column=title searches TITLES ALONE, with no
// author term required. That is precisely the shape of the residual — Spanish and Japanese
// titles, and the 31 rows whose stored author is a placeholder. OpenLibrary and Google
// both rank far better when an author corroborates; ISBNdb does not need one.
//
// Coverage caveat from their own FAQ: only title, author, isbn and isbn13 are guaranteed
// per record. publisher, language and binding "vary in coverage", and scoreCandidate()
// leans on publisher for the rebinder/audio disqualifiers. So a sparse ISBNdb record
// scores low and will lose to a well-described Google Books hit — which is the correct
// outcome. It is a recall net, not a better answer.
//
// Docs: https://isbndb.com/isbndb-api-documentation-v2   Spec: https://api2.isbndb.com/doc.json
const ISBNDB_BASE = 'https://api2.isbndb.com';

// Basic is 1 request/second. Exceeding it earns a 429 and, on a tier with a daily cap,
// wastes allowance on retries — so pace deliberately rather than relying on backoff.
const ISBNDB_MIN_GAP_MS = Number(env['ISBNDB_MIN_GAP_MS']) > 0 ? Number(env['ISBNDB_MIN_GAP_MS']) : 1100;
let isbndbLastCall = 0;
let isbndbCalls = 0;

async function tryIsbnDb(title, rawAuthor, out) {
  if (!ISBNDB_KEY || sourceDead('isbndb')) return;
  const author = realAuthor(rawAuthor);

  const gap = Date.now() - isbndbLastCall;
  if (gap < ISBNDB_MIN_GAP_MS) await sleep(ISBNDB_MIN_GAP_MS - gap);
  isbndbLastCall = Date.now();
  isbndbCalls++;

  // column=title scopes the query to titles; without it the query is a general keyword
  // search and a title like "The Box" drags in everything with "box" in the synopsis.
  const q = new URLSearchParams({ column: 'title', pageSize: '20', page: '1' });
  const url = `${ISBNDB_BASE}/books/${encodeURIComponent(searchTitle(title).slice(0, 150))}?${q}`;

  // Authorization takes the raw key — NOT "Bearer <key>". The docs are explicit that a
  // query-parameter key is rejected, and a Bearer prefix is not what this API expects.
  const data = await getJson(url, 1, { Authorization: ISBNDB_KEY }, 'isbndb');
  const books = data?.books || [];
  vlog(`ISBNdb returned ${books.length} for "${searchTitle(title)}"`);

  for (const bk of books) {
    const full = bk.title || '';
    if (!full) continue;
    if (!titleMatches(title, full)) { vlog(`ISBNdb reject (title) "${full}"`); continue; }
    // Print the AUTHORS on an author reject. Printing the title told you which book was
    // rejected but not why — and the two are decided by different fields. For the
    // Aquelarre anthology this is the whole question: is ISBNdb's record crediting a
    // different contributor, or carrying no author at all?
    if (!authorMatches(author, bk.authors)) {
      vlog(`ISBNdb reject (author) want "${author}" got ${JSON.stringify(bk.authors ?? null)} — "${full}"`);
      continue;
    }
    const acc = acceptable(bk.isbn13 || bk.isbn10 || bk.isbn);
    if (!acc) continue;

    // `language` comes back as either a code ("eng", "en") or a full name ("English").
    const lang = String(bk.language || '').toLowerCase();
    out.push({
      isbn: acc.isbn,
      englishRegistrant: acc.englishRegistrant,
      source: 'isbndb',
      publisher: bk.publisher || null,
      pages: bk.pages || null,
      // Binding is ISBNdb's format field and the only place an audiobook announces itself
      // when the publisher string is a normal trade imprint. scoreCandidate() checks it.
      binding: bk.binding || null,
      explicitEnglish: lang === 'eng' || lang === 'en' || lang === 'english',
      matched: full,
    });
  }
}

// -- Row selection -------------------------------------------------------------
const PAGE = 1000;
async function fetchRows(kind, limit) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('books').select('id, title, author, isbn').order('title');
    if (kind === 'unresolved') {
      q = q.is('isbn', null);
    } else {
      // Non-English registrants. Selected in SQL by prefix as a cheap filter; the
      // authoritative check is isEnglishRegistrant() on whatever replacement we find.
      q = q.not('isbn', 'is', null)
           .not('isbn', 'like', '9780%')
           .not('isbn', 'like', '9781%')
           .not('isbn', 'like', '9798%');
    }
    const { data, error } = await q.range(from, limit ? Math.min(from + PAGE - 1, limit - 1) : from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
    if (limit && out.length >= limit) break;
  }
  return limit ? out.slice(0, limit) : out;
}

// -- Probe ---------------------------------------------------------------------
// The OpenLibrary and Google Books response shapes below were written from their docs,
// not observed against the live APIs. If either has drifted — entries[] renamed, ISBNs
// nested differently, languages no longer "/languages/eng" — the script would quietly
// find nothing rather than crash, which is the worst failure mode: a clean run and an
// empty result. Run this first to see the actual JSON:
//
//   node batch-scripts/isbnFallback.mjs --probe "A Discovery of Witches" "Deborah Harkness"
async function runProbe(title, author) {
  console.log(`PROBE  title=${JSON.stringify(title)} author=${JSON.stringify(author || null)}\n`);

  const q = new URLSearchParams({ title: searchTitle(title), limit: '3', fields: 'key,title,author_name' });
  if (author) q.set('author', author);
  const url = `https://openlibrary.org/search.json?${q}`;
  console.log(`1. ${url}`);
  const search = await getJson(url);
  console.log(JSON.stringify(search, null, 2)?.slice(0, 900) || '(no response)');

  const key = search?.docs?.[0]?.key;
  if (key) {
    const u2 = `https://openlibrary.org${key}/editions.json?limit=3`;
    console.log(`\n2. ${u2}`);
    const eds = await getJson(u2);
    const e = eds?.entries?.[0];
    console.log(`entries: ${eds?.entries?.length ?? '(field missing!)'}`);
    console.log(`first entry keys: ${e ? Object.keys(e).join(', ') : '(none)'}`);
    console.log(`  isbn_13:   ${JSON.stringify(e?.isbn_13)}`);
    console.log(`  isbn_10:   ${JSON.stringify(e?.isbn_10)}`);
    console.log(`  languages: ${JSON.stringify(e?.languages)}`);
    console.log(`\nExpected by this script: entries[].isbn_13[], entries[].languages[].key === '/languages/eng'`);
  } else {
    console.log('\n!! no docs[].key — the search shape has changed; tryOpenLibrary cannot work');
  }

  if (GOOGLE_KEY) {
    const terms = [`intitle:${JSON.stringify(searchTitle(title))}`];
    if (author) terms.push(`inauthor:${JSON.stringify(author)}`);
    // join(' '), not join('+') — see the note in tryGoogleBooks. URLSearchParams encodes a
    // literal '+' as %2B, which Google reads as part of the search term rather than as a
    // separator, and answers 503. The probe kept the original bug, so the diagnostic tool
    // failed in a way the code it was meant to diagnose no longer did.
    const u3 = new URLSearchParams({ q: terms.join(' '), maxResults: '3', langRestrict: 'en', printType: 'books', key: GOOGLE_KEY });
    console.log(`\n3. Google Books`);
    const gb = await getJson(`https://www.googleapis.com/books/v1/volumes?${u3}`);
    const vi = gb?.items?.[0]?.volumeInfo;
    console.log(`items: ${gb?.items?.length ?? '(none)'}`);
    console.log(`  title:    ${vi?.title}`);
    console.log(`  language: ${vi?.language}`);
    console.log(`  ids:      ${JSON.stringify(vi?.industryIdentifiers)}`);
  } else {
    console.log('\n3. Google Books — skipped (no GOOGLE_BOOKS_API_KEY)');
  }
}

// -- Output, flushable at any moment -------------------------------------------
// v0.62 — this pass is the longest-running step in the workflow and the likeliest to be
// cut short, and until now everything it had to say was said at the very end.
//
// On 2026-08-17 the runner cancelled the job 187 books into 971 ("Error: The operation
// was canceled."). The 98 ISBNs it had already resolved were safely in the database —
// those writes are per-book — but the summary and the worklist CSV were not, because both
// were built after the final loop. The workflow's summary step then counted rows in a
// file that did not exist and reported "Still unresolved after OL/Google: 0", which is
// the most optimistic possible reading of a run that never finished.
//
// So: counters live at module scope, and the CSV is written by a flush that runs on
// normal completion AND on the signals a cancellation actually sends. GitHub sends
// SIGINT, waits, then SIGTERM; both are handled, and neither needs the loop's cooperation.
const stats = { filled: 0, replaced: 0, stuck: 0, foreignKept: 0, failed: 0 };
const stillStuck = [];

// Every write the pass decides on, recorded for review. The foreign pass is the only
// operation in this pipeline that OVERWRITES an existing value, and a dry run that
// announces "302 replacements" gives you a number with no way to check it — the detail
// exists only as prose scattered through thousands of log lines.
//
// Written on every run, dry or not. On a dry run it is a proposal to review; on a real
// run it is the rollback record, because it carries the previous ISBN alongside the new
// one and can be replayed as an UPDATE if a batch turns out wrong.
const decisions = [];
const progress = { kind: null, done: 0, total: 0, passDone: 0, passTotal: 0 };
let flushed = false;

function flushOutputs(reason) {
  if (flushed) return;
  flushed = true;

  const complete = reason === 'complete';
  console.log(`\n--- ${complete ? 'done' : 'INTERRUPTED (' + reason + ')'} ---`);
  if (!complete) {
    console.log(`  stopped at ${progress.passDone}/${progress.passTotal} of the "${progress.kind}" pass (${progress.done} book(s) processed overall).`);
    console.log(`  ISBNs already resolved are written per-book, so they are saved. Rerunning`);
    console.log(`  picks up from here: the query selects only rows that still have no ISBN.`);
  }
  console.log(`  newly filled (was null):        ${stats.filled}`);
  console.log(`  foreign ISBNs replaced:         ${stats.replaced}`);
  console.log(`  foreign kept (no English edn):  ${stats.foreignKept}   ← fine, links work`);
  console.log(`  still NO ISBN at all:           ${stats.stuck}${complete ? '   ← the real remaining work' : '   ← SO FAR — the pass did not finish'}`);
  console.log(`  failed:                         ${stats.failed}`);
  if (ISBNDB_KEY) console.log(`  ISBNdb calls billed:            ${isbndbCalls}`);
  if (sourceExhausted.size) {
    console.log(`  sources disabled mid-run:       ${[...sourceExhausted].join(', ')}`);
    console.log(`     Books processed after that point never saw them. Rerun once the quota`);
    console.log(`     resets — the pass only selects rows that still have no ISBN.`);
  }

  if (decisions.length) {
    try {
      const out = join(__dirname, '..', 'output', 'isbn-decisions.csv');
      const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const cols = ['kind', 'id', 'title', 'author', 'old_isbn', 'new_isbn', 'source', 'publisher', 'matched_title', 'english', 'sources_consulted'];
      writeFileSync(out, [cols.join(','), ...decisions.map((d) => cols.map((c) => cell(d[c])).join(','))].join('\n') + '\n', 'utf8');
      const repl = decisions.filter((d) => d.kind === 'foreign').length;
      console.log(`\n  ${decisions.length} decision(s) → batch-scripts/output/isbn-decisions.csv`);
      if (repl) {
        console.log(`  ${repl} of them REPLACE an existing ISBN — old_isbn holds the previous value.`);
        console.log(`  Review sources_consulted: a replacement decided by one source alone is`);
        console.log(`  weaker evidence than one the others also saw.`);
      }
    } catch (e) {
      console.log(`\n  could not write the decisions CSV: ${e.message}`);
    }
  }

  if (stillStuck.length) {
    try {
      const out = join(__dirname, '..', 'output', 'isbn-still-unresolved.csv');
      const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      writeFileSync(out,
        ['kind,id,title,author,current_isbn',
         ...stillStuck.map((b) => [b.kind, b.id, b.title, b.author, b.isbn].map(cell).join(','))].join('\n') + '\n',
        'utf8');
      console.log(`\n  remaining → batch-scripts/output/isbn-still-unresolved.csv`);
      console.log(`  Rows with NO ISBN only. Books keeping a valid foreign ISBN are excluded:`);
      console.log(`  they are already linkable and need no further work.`);
      if (!complete) console.log(`  PARTIAL — covers only the ${progress.done} book(s) reached before the interruption.`);
    } catch (e) {
      console.log(`\n  could not write the worklist: ${e.message}`);
    }
  }
  if (DRY_RUN) console.log('\n(dry run — nothing was written to the database)');

  // Machine-readable, like metadataBackfill.mjs. `complete` is the field that lets the
  // workflow tell "nothing left to do" apart from "never got there" — the distinction
  // the summary table was missing.
  console.log(
    `[isbnFallback] filled=${stats.filled} replaced=${stats.replaced} stuck=${stats.stuck} ` +
    `foreignKept=${stats.foreignKept} failed=${stats.failed} ` +
    `processed=${progress.done} total=${progress.total} isbndbCalls=${isbndbCalls} disabled=${[...sourceExhausted].join('|') || 'none'} complete=${complete ? 1 : 0}`
  );
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flushOutputs(sig);
    // 128+n is the conventional "killed by signal n" status, and it keeps the step
    // red — a cancelled run should not be mistaken for a clean one.
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

// -- Main ----------------------------------------------------------------------
async function runPass(kind) {
  const rows = await fetchRows(kind, LIMIT);
  console.log(`\n=== ${kind}: ${rows.length} row(s) ===\n`);
  // Was reset per pass, so a --target both run reported only the SECOND pass: "50 of 50"
  // after processing 100 books. Accumulate instead, and keep the per-pass position for
  // the interruption message.
  progress.kind = kind;
  progress.passDone = 0;
  progress.passTotal = rows.length;
  progress.total += rows.length;

  for (const [i, b] of rows.entries()) {
    progress.passDone = i + 1;
    progress.done++;
    const label = `[${i + 1}/${rows.length}] ${b.title}${b.author ? ' — ' + b.author : ''}`;
    console.log(label);
    if (kind === 'foreign') console.log(`  current: ${b.isbn} (non-English registrant)`);

    let hit = null;
    try {
      // Query BOTH sources and score the pooled candidates. Falling through to the
      // second source only on total failure would take OpenLibrary's first acceptable
      // ISBN even when Google Books had a better trade edition, and vice versa.
      const cands = [];
      const consulted = new Set();

      // ORDER. With a key present ISBNdb goes FIRST, and a hit short-circuits the rest.
      //
      // The original last-resort placement assumed the paid call was the scarce resource.
      // It is not: Basic allows 5,000 lookups a day against a residual in the low
      // hundreds, and the cost is a flat subscription rather than per-call. What is
      // actually scarce is Google Books' ~1,000/day free tier — which is why putting the
      // abundant source last meant paying for the scarce one first, and waiting through
      // its backoff to do it.
      //
      // The real trade-off is not money, it is edition quality: skipping the free sources
      // forfeits the pooled scoring that lets a well-described Google Books record beat a
      // sparse ISBNdb one. That matters less here than it sounds, because these rows are
      // the tail the free sources have already failed on. Pass --isbndb-last to restore
      // the previous behaviour and pool every source.
      if (ISBNDB_FIRST) { await tryIsbnDb(b.title, b.author, cands); if (!sourceDead('isbndb')) consulted.add('isbndb'); }

      // Short-circuit on a USABLE candidate, not merely on a non-empty array.
      //
      // `!cands.length` was wrong, and wrong in a way that only shows up in the foreign
      // pass. That pass exists to replace a non-English ISBN, so pickCandidate refuses
      // anything that is not English. If ISBNdb answered with two Spanish editions, the
      // array was non-empty, the free sources were skipped, pickCandidate then rejected
      // both — and the book was filed as "no English edition exists" without OpenLibrary
      // or Google ever being asked whether one does. The pass would have quietly reported
      // success at leaving things alone.
      //
      // Asking pickCandidate is exactly the right test, because it applies the same rule
      // the write will: audio and rebind editions are disqualified here too, so a book
      // whose only ISBNdb hits are audiobooks correctly falls through to the free sources.
      if (!pickCandidate(cands, kind === 'foreign', true)) {
        await tryOpenLibrary(b.title, b.author, cands);
        if (!sourceDead('openlibrary')) consulted.add('openlibrary');
        await tryGoogleBooks(b.title, b.author, cands, { englishOnly: true });
        if (GOOGLE_KEY && !sourceDead('googlebooks')) consulted.add('googlebooks');
      }

      // Nothing at all, and this pass is allowed to write a foreign ISBN. Ask Google
      // again without the language restriction before declaring the book unfindable.
      // Costs one extra request only on rows that have already failed everything else,
      // and for a Spanish or Japanese novel it is the only call that can succeed.
      //
      // NOT done for --target foreign: that pass exists to REPLACE a non-English ISBN,
      // so an unrestricted retry could only ever return more of what it is trying to
      // get rid of. pickCandidate(requireEnglish) would reject it anyway; skipping the
      // request keeps the quota for rows that can use it.
      if (!pickCandidate(cands, kind === 'foreign', true) && kind !== 'foreign') {
        vlog('nothing usable yet — retrying Google Books without langRestrict');
        await tryGoogleBooks(b.title, b.author, cands, { englishOnly: false });
      }

      // Last resort, and the only one that costs money. Reached only when three free
      // lookups have all come back empty, which is exactly the population it is good at:
      // title-only search, no author needed.
      if (!ISBNDB_FIRST && !pickCandidate(cands, kind === 'foreign', true)) await tryIsbnDb(b.title, b.author, cands);

      vlog(`${cands.length} candidate(s)`);
      hit = pickCandidate(cands, kind === 'foreign');
    } catch (e) {
      console.log(`  error: ${e.message}\n`); stats.failed++; continue;
    }

    if (!hit) {
      if (kind === 'foreign') {
        // NOT a failure. This book has a valid ISBN already — it simply has no English
        // edition, which for a Spanish novel or a Japanese manga is the correct and
        // expected answer. Its purchase links work. Lumping these in with genuinely
        // ISBN-less rows overstated the remaining work (239 of a reported 538) and
        // pointed them at the Claude curate pass, which would have spent tokens
        // re-identifying books that were never broken.
        console.log(`  no English edition exists — keeping ${b.isbn}\n`);
        stats.foreignKept++;
      } else {
        console.log(`  no edition found${GOOGLE_KEY ? '' : '  (Google Books skipped — no GOOGLE_BOOKS_API_KEY)'}\n`);
        stillStuck.push({ ...b, kind });
        stats.stuck++;
      }
      await sleep(400);
      continue;
    }

    console.log(`  → ${hit.isbn}${hit.englishRegistrant ? '' : '  [non-English — no English edition exists]'}  via ${hit.source}  ${hit.publisher ? '[' + hit.publisher + ']' : ''}  ("${hit.matched}")`);
    decisions.push({
      kind, id: b.id, title: b.title, author: b.author,
      old_isbn: kind === 'foreign' ? b.isbn : '',
      new_isbn: hit.isbn, source: hit.source,
      publisher: hit.publisher || '', matched_title: hit.matched,
      english: hit.englishRegistrant ? 'yes' : 'no',
      // The single most useful review column: a replacement decided by one source, with
      // the others skipped or dead, deserves more scrutiny than one they agreed on.
      sources_consulted: [...consulted].join('|'),
    });
    if (!DRY_RUN) {
      const { error } = await supabase.from('books').update({ isbn: hit.isbn }).eq('id', b.id);
      if (error) { console.log(`  WRITE FAILED: ${error.message}`); stats.failed++; await sleep(400); continue; }
    }
    stats[kind === 'foreign' ? 'replaced' : 'filled']++;
    console.log('');
    await sleep(400);
  }
}

async function main() {
  if (args.includes('--probe')) {
    const i = args.indexOf('--probe');
    const t = args[i + 1];
    if (!t) { console.error('--probe needs a title:  --probe "Some Title" "Some Author"'); process.exit(1); }
    return runProbe(t, args[i + 2] && !args[i + 2].startsWith('--') ? args[i + 2] : null);
  }

  console.log(`target: ${TARGET}${DRY_RUN ? '  [DRY RUN]' : ''}`);
  console.log(`sources: OpenLibrary${GOOGLE_KEY ? ' → Google Books' : '  (Google Books disabled — no GOOGLE_BOOKS_API_KEY in .env.local)'}` + `${ISBNDB_KEY ? (ISBNDB_FIRST ? ' | ISBNdb FIRST (paid, short-circuits on a hit)' : ' → ISBNdb (paid, last resort)') : '  (ISBNdb disabled — no ISBNDB_API_KEY in .env.local)'}`);

  if (TARGET === 'unresolved' || TARGET === 'both') await runPass('unresolved');
  if (TARGET === 'foreign' || TARGET === 'both') await runPass('foreign');

  flushOutputs('complete');
}

main().catch((e) => {
  console.error(e.message);
  // Even a crash should leave behind whatever was learnt before it.
  flushOutputs(`error: ${e.message}`);
  process.exit(1);
});
