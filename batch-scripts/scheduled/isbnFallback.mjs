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

  // Hard disqualifiers.
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

  return score;
}

function pickCandidate(cands, requireEnglish) {
  let best = null, bestScore = -Infinity;
  for (const c of cands) {
    const s = scoreCandidate(c);
    vlog(`  cand ${c.isbn} ${s === null ? ' DISQ' : String(s).padStart(5)}  ${c.englishRegistrant ? 'en' : '--'}  ${c.source}  ${(c.publisher || '—').slice(0, 30)}`);
    if (s === null) continue;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (!best) { vlog('  every candidate disqualified (audio / rebind)'); return null; }

  // --target foreign exists to REPLACE a non-English ISBN. Swapping a Spanish one for a
  // German one is churn, not repair, so that pass only accepts an English result.
  if (requireEnglish && !best.englishRegistrant) {
    vlog(`  best candidate ${best.isbn} is also non-English — leaving the existing value`);
    return null;
  }
  return best;
}

async function getJson(url, attempt = 1) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 429) {
      if (attempt <= 3) { vlog(`429 — waiting ${20 * attempt}s`); await sleep(20000 * attempt); return getJson(url, attempt + 1); }
      return null;
    }
    if (!r.ok) { vlog(`${r.status} ${url.slice(0, 90)}`); return null; }
    return await r.json();
  } catch (e) {
    if (attempt <= 3) { await sleep(2000 * attempt); return getJson(url, attempt + 1); }
    vlog(`fetch failed: ${e.message}`);
    return null;
  }
}

// -- Source 1: OpenLibrary -----------------------------------------------------
// Search gives a work key; the work's editions carry per-edition ISBNs and languages.
// The search result's own `isbn` array pools every edition together with no language
// attribution, so it cannot be used to pick an English one — hence the second call.
async function tryOpenLibrary(title, author, out) {
  const q = new URLSearchParams({
    title: searchTitle(title),
    limit: '5',
    fields: 'key,title,author_name',
  });
  if (author) q.set('author', author);
  const search = await getJson(`https://openlibrary.org/search.json?${q}`);
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
    const eds = await getJson(`https://openlibrary.org${d.key}/editions.json?limit=100`);
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
async function tryGoogleBooks(title, author, out) {
  if (!GOOGLE_KEY) return;
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
    langRestrict: 'en',
    printType: 'books',
    key: GOOGLE_KEY,
  });
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?${u}`);
  for (const item of data?.items || []) {
    const vi = item.volumeInfo || {};
    if (!vi.title) continue;
    if (vi.language && vi.language !== 'en') continue;
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
    const u3 = new URLSearchParams({ q: terms.join('+'), maxResults: '3', langRestrict: 'en', printType: 'books', key: GOOGLE_KEY });
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

// -- Main ----------------------------------------------------------------------
async function runPass(kind, stats, stillStuck) {
  const rows = await fetchRows(kind, LIMIT);
  console.log(`\n=== ${kind}: ${rows.length} row(s) ===\n`);

  for (const [i, b] of rows.entries()) {
    const label = `[${i + 1}/${rows.length}] ${b.title}${b.author ? ' — ' + b.author : ''}`;
    console.log(label);
    if (kind === 'foreign') console.log(`  current: ${b.isbn} (non-English registrant)`);

    let hit = null;
    try {
      // Query BOTH sources and score the pooled candidates. Falling through to the
      // second source only on total failure would take OpenLibrary's first acceptable
      // ISBN even when Google Books had a better trade edition, and vice versa.
      const cands = [];
      await tryOpenLibrary(b.title, b.author, cands);
      await tryGoogleBooks(b.title, b.author, cands);
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
  console.log(`sources: OpenLibrary${GOOGLE_KEY ? ' → Google Books' : '  (Google Books disabled — no GOOGLE_BOOKS_API_KEY in .env.local)'}`);

  const stats = { filled: 0, replaced: 0, stuck: 0, foreignKept: 0, failed: 0 };
  const stillStuck = [];

  if (TARGET === 'unresolved' || TARGET === 'both') await runPass('unresolved', stats, stillStuck);
  if (TARGET === 'foreign' || TARGET === 'both') await runPass('foreign', stats, stillStuck);

  console.log(`\n--- done ---`);
  console.log(`  newly filled (was null):        ${stats.filled}`);
  console.log(`  foreign ISBNs replaced:         ${stats.replaced}`);
  console.log(`  foreign kept (no English edn):  ${stats.foreignKept}   ← fine, links work`);
  console.log(`  still NO ISBN at all:           ${stats.stuck}   ← the real remaining work`);
  console.log(`  failed:                         ${stats.failed}`);

  if (stillStuck.length) {
    const out = join(__dirname, '..', 'output', 'isbn-still-unresolved.csv');
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    writeFileSync(out,
      ['kind,id,title,author,current_isbn',
       ...stillStuck.map((b) => [b.kind, b.id, b.title, b.author, b.isbn].map(cell).join(','))].join('\n') + '\n',
      'utf8');
    console.log(`\n  remaining → batch-scripts/isbn-still-unresolved.csv`);
    console.log(`  Rows with NO ISBN only. Books keeping a valid foreign ISBN are excluded:`);
    console.log(`  they are already linkable and need no further work.`);
  }
  if (DRY_RUN) console.log('\n(dry run — nothing was written to the database)');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
