// languageBackfill.mjs — fill books.language for the existing catalog.
//
// WHY THIS EXISTS
//
// books.language landed in migration 20260817140000 and upsert_book has written
// it ever since, so every row created from that point knows its own language.
// Every row created BEFORE it does not, and nothing backfills — which is most
// of the catalog.
//
// That gap is not cosmetic. "More by this author" on *The Dragon Keeper* listed
// *Aprendiz del Asesino*, *La Nef Du Crépuscule* and *Die Tochter des Wolfs*
// among Robin Hobb's books, because the filter that should have removed them
// reads books.language and books.language was null. The stopgap is
// src/lib/titleLanguage.js, which guesses from function words in the title —
// deliberately weak, and documented as such. This script is what retires it:
// callers check the column first, so every row filled here is a row the
// heuristic never sees again.
//
// SOURCES — BOTH FREE
//
//   1. OpenLibrary  /isbn/{isbn}.json → languages: [{ key: '/languages/spa' }]
//      No API key, no quota, no account. This is the whole reason the script
//      can run over the entire catalog without costing anything. Throttled to
//      be a good citizen rather than because anyone made us.
//
//   2. Google Books  q=isbn:{isbn} → volumeInfo.language
//      Better coverage on recent and non-Anglophone printings, but needs
//      GOOGLE_BOOKS_API_KEY (Google set anonymous quota to 0) and the free tier
//      is ~1,000 queries/day. Used only for rows OpenLibrary could not answer,
//      and only if the key is present. Without a key the script still works —
//      it just resolves fewer rows.
//
//   3. ISBN registration group (offline, no request at all)
//      978-84 Spain, 978-3 Germany, 978-2 France. Free, instant, and available
//      for every valid ISBN — including the ones the APIs have never indexed.
//      9788419680877 (*Aprendiz de asesino*, Nocturna Ediciones) is answered by
//      neither OpenLibrary nor Google Books and resolves to `es` from the group
//      alone. Weaker than a stated language, since the group identifies the
//      issuing agency's country rather than the text's language, so it is tried
//      last and cross-examined like everything else.
//
//      Not used: isbnsearch.org. It is an HTML page rather than an API, and it
//      does not carry a language field at all — it shows publisher, binding and
//      prices. Its data comes from ISBNdb, which is a real API but paid.
//
// THE TRAP THIS SCRIPT IS BUILT AROUND
//
// books.isbn IS NOT NECESSARILY THIS ROW'S EDITION.
//
// It is chosen by editionPicker.js to make a PURCHASE LINK work, and
// isbnFallback.mjs --target foreign exists specifically to REPLACE a
// non-English ISBN with an English one so amazon.com stops 404ing. So a row
// titled *Aprendiz del Asesino* can legitimately carry the ISBN of the English
// *Assassin's Apprentice*, and asking that ISBN what language it is returns
// "en" — which would be written onto a Spanish row.
//
// That is worse than leaving the column null, because a populated column
// OUTRANKS the title heuristic everywhere it is consulted. A null row is
// handled correctly today by guesswork; a wrongly-populated row is handled
// confidently and wrongly forever.
//
// So every answer is cross-examined against the title before it is written:
//
//   ISBN says X, title suggests X or nothing  →  write X
//   ISBN says X, title suggests Y             →  WRITE NOTHING, count it
//
// The disagreements are reported at the end rather than resolved. They are the
// rows where books.isbn and books.title genuinely describe different editions,
// which is the reader-editions problem itself (docs/reader-editions-v1-spec.md)
// and not something a language backfill gets to decide.
//
// WHAT IT WILL NOT DO
//
// Write a guess. A row with no ISBN, or whose ISBN no source recognises, is
// left null — the same rule author_gender follows, for the same reason: an
// honest absence is recoverable and a confident error is not.
//
// The title heuristic (src/lib/titleLanguage.js) is used ONLY as a guard here,
// never as a source. It can veto a suspicious answer; it cannot supply one. The
// registrant fallback replaced the earlier --trust-title escape hatch, which is
// a better trade: a registration group is a fact about the ISBN rather than a
// guess about the prose.
//
// USAGE
//
//   node batch-scripts/scheduled/languageBackfill.mjs --dry-run --limit 50 --verbose
//   node batch-scripts/scheduled/languageBackfill.mjs --limit 500
//   node batch-scripts/scheduled/languageBackfill.mjs                  # fill the gaps
//   node batch-scripts/scheduled/languageBackfill.mjs --all --dry-run  # audit all 3.4k
//   node batch-scripts/scheduled/languageBackfill.mjs --all            # audit + fill
//   node batch-scripts/scheduled/languageBackfill.mjs --all --force    # and overwrite
//   node batch-scripts/scheduled/languageBackfill.mjs --probe 9788498382662
//
// Nothing is written without a real run: --dry-run reports exactly what it
// would do. Start there.
//
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:               GOOGLE_BOOKS_API_KEY

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cleanIsbn, isValidIsbn, registrantLanguage } from '../../src/lib/isbn.js';
import { guessIsEnglish } from '../../src/lib/titleLanguage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- CLI ----------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
// --all      examine every book, not just the ones with no language yet.
// --force    with --all, actually overwrite a stored value that disagrees.
const ALL = args.includes('--all');
const FORCE = args.includes('--force');
const VERBOSE = args.includes('--verbose');

function argVal(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  return (a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1]) ?? fallback;
}
const LIMIT = Number.isFinite(parseInt(argVal('--limit'), 10)) ? parseInt(argVal('--limit'), 10) : null;
const PROBE = argVal('--probe', null);

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
const UA = 'BooksOracle-languageBackfill/1.0 (https://thebooksoracle.com)';

// -- Language codes -----------------------------------------------------------
//
// OpenLibrary returns ISO 639-2, and for a couple of dozen languages 639-2 has
// TWO codes: a bibliographic one derived from the English name and a
// terminological one derived from the language's own name. German is "ger" or
// "deu", French "fre" or "fra". OpenLibrary records use both, having been
// imported from many sources over twenty years, so both map here.
//
// books.language stores the 639-1 two-letter subtag, matching what Google Books
// returns and what the browser reports — one representation in the column, so
// nothing downstream has to normalise.
const TO_639_1 = {
  eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de',
  ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', rus: 'ru', jpn: 'ja',
  chi: 'zh', zho: 'zh', kor: 'ko', ara: 'ar', heb: 'he', hin: 'hi',
  swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', isl: 'is', ice: 'is',
  pol: 'pl', cze: 'cs', ces: 'cs', slo: 'sk', slk: 'sk', hun: 'hu',
  rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', tur: 'tr', ukr: 'uk',
  cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl', lat: 'la', wel: 'cy',
  cym: 'cy', gle: 'ga', bul: 'bg', hrv: 'hr', srp: 'sr', slv: 'sl',
  est: 'et', lav: 'lv', lit: 'lt', tha: 'th', vie: 'vi', ind: 'id',
  msa: 'ms', may: 'ms', per: 'fa', fas: 'fa', afr: 'af', epo: 'eo',
};

// Accepts either form and returns a 639-1 subtag, or null. Google Books already
// speaks 639-1, so a two-letter input passes through — but only if it is
// plausibly a language code rather than, say, a truncated country string.
function to6391(raw) {
  const s = (raw || '').trim().toLowerCase().split('-')[0];
  if (!s) return null;
  if (s.length === 2) return /^[a-z]{2}$/.test(s) ? s : null;
  return TO_639_1[s] || null;
}

// -- HTTP ---------------------------------------------------------------------
async function getJson(url, attempt = 1) {
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (resp.status === 404) return null;          // a real answer: not held
    if (resp.status === 429) {
      if (attempt <= 3) { vlog(`429 — waiting ${20 * attempt}s`); await sleep(20000 * attempt); return getJson(url, attempt + 1); }
      return null;
    }
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    if (attempt <= 3) { await sleep(2000 * attempt); return getJson(url, attempt + 1); }
    vlog(`request failed: ${String(e)}`);
    return null;
  }
}

// -- Sources ------------------------------------------------------------------

// OpenLibrary's edition record. `languages` is an array because a record can be
// bilingual; the first entry is the primary one, and a genuinely bilingual
// edition is not something this column can express anyway.
async function olLanguage(isbn) {
  const data = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
  const key = data?.languages?.[0]?.key;             // '/languages/spa'
  if (!key) return null;
  return to6391(key.split('/').pop());
}

// OpenLibrary's OTHER index. /isbn/{isbn}.json only resolves ISBNs that have an
// edition record; the bibkeys API also answers for ISBNs known through imported
// bibliographic data. Different coverage, same source, one extra request only
// when the first came back empty.
async function olBibkeysLanguage(isbn) {
  const data = await getJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  );
  const rec = data?.[`ISBN:${isbn}`];
  const raw = rec?.language || rec?.languages?.[0]?.key || rec?.languages?.[0]?.name;
  if (!raw) return null;
  return to6391(String(raw).split('/').pop());
}

// NO country=US.
//
// The Books API's `country` parameter scopes results to what is AVAILABLE in
// that market, not to what exists. A Spanish-only printing from a Spanish
// publisher is frequently not sellable in the US, so country=US hides it and
// the lookup returns nothing — which is exactly what happened to
// 9788419680877 (Nocturna Ediciones, Madrid). googlebooks.js sets country=US
// because it is buying-oriented; this script is asking a bibliographic
// question and must not inherit that.
// Google's free tier is ~1,000 queries/day and this script can have thousands
// of rows to resolve, so exhausting it mid-run is the expected case, not an
// edge one. It must therefore fail FAST: getJson's generic 429 handling backs
// off 20s, 40s, then 60s, which is right for a transient rate limit and
// catastrophic for a daily cap — every remaining row would stall two minutes
// for an answer that is not coming today.
//
// So Google gets its own request here, with no retry, and the first 429 turns
// it off for the rest of the run. OpenLibrary and the registration group carry
// on unaffected, which is the whole reason the ladder does not depend on
// Google. Re-run tomorrow and the skipped rows are picked up — only rows with
// language IS NULL are ever examined.
let googleOff = false;

async function gbLanguage(isbn) {
  if (!GOOGLE_KEY || googleOff) return null;
  const params = new URLSearchParams({ q: `isbn:${isbn}`, key: GOOGLE_KEY });
  try {
    const resp = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (resp.status === 429 || resp.status === 403) {
      googleOff = true;
      console.log(`\n  ! Google Books quota reached (HTTP ${resp.status}) — disabled for the rest of this run.`);
      console.log('    OpenLibrary and the ISBN registration group continue. Re-run tomorrow to pick up the rest.\n');
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    return to6391(data?.items?.[0]?.volumeInfo?.language);
  } catch {
    return null;
  }
}

// -- Probe --------------------------------------------------------------------
if (PROBE) {
  const isbn = cleanIsbn(PROBE);
  console.log(`ISBN ${PROBE} → cleaned ${isbn} (valid: ${isValidIsbn(isbn)})`);
  console.log(`  OpenLibrary /isbn : ${await olLanguage(isbn) ?? '(no answer)'}`);
  console.log(`  OpenLibrary bibkeys: ${await olBibkeysLanguage(isbn) ?? '(no answer)'}`);
  console.log(`  Google Books      : ${GOOGLE_KEY ? (await gbLanguage(isbn) ?? '(no answer)') : '(no key — skipped)'}`);
  console.log(`  ISBN registrant   : ${registrantLanguage(isbn) ?? '(unmapped group)'}   [offline, always available]`);
  process.exit(0);
}

// -- Main ---------------------------------------------------------------------
const stats = {
  examined: 0, written: 0,
  noIsbn: 0, noAnswer: 0, conflict: 0, failed: 0, confirmed: 0, disagreed: 0,
};
const conflicts = [];
const disagreements = [];

// KEYSET pagination, not offset.
//
// Offset paging is wrong here and wrong in a way that hangs rather than fails.
// A live run writes `language`, so those rows stop matching `language IS NULL`
// and the result window shifts underneath the offset — but rows this script
// deliberately SKIPS (no ISBN, no answer, ISBN/title conflict) keep matching
// forever. Re-requesting range(0, 499) therefore returns the same unresolvable
// rows on every iteration, and the loop never terminates.
//
// Walking by id has neither problem: it advances on rows seen rather than rows
// changed, so it behaves identically whether or not the run is writing.
async function fetchAfter(lastId) {
  let q = supabase
    .from('books')
    .select('id, title, author, isbn, language')
    .gt('id', lastId)
    .order('id')
    .limit(PAGE);
  // Default is gap-filling: only rows that have no answer yet. --all re-examines
  // rows that already have one, which is how you get an assurance pass over the
  // whole catalog rather than a promise that the gaps were filled.
  if (!ALL) q = q.is('language', null);
  const { data, error } = await q;
  if (error) throw new Error(`select failed: ${error.message}`);
  return data || [];
}

console.log(`languageBackfill — ${DRY_RUN ? 'DRY RUN, nothing will be written' : 'LIVE'}`);
console.log(`sources: OpenLibrary (free)${GOOGLE_KEY ? ' + Google Books (key present)' : ' — no GOOGLE_BOOKS_API_KEY, OpenLibrary only'}`);
console.log('');

const PAGE = 500;
// The zero uuid sorts before every generated one, so this starts at the top.
let lastId = '00000000-0000-0000-0000-000000000000';
let done = false;

while (!done) {
  const rows = await fetchAfter(lastId);
  if (rows.length === 0) break;

  for (const row of rows) {
    if (LIMIT && stats.examined >= LIMIT) { done = true; break; }
    lastId = row.id;
    stats.examined++;

    const label = `"${row.title}"${row.author ? ' — ' + row.author : ''}`;
    const titleEnglish = guessIsEnglish(row.title);   // true | false | null
    const isbn = cleanIsbn(row.isbn);

    let found = null;
    let source = null;

    if (isbn && isValidIsbn(isbn)) {
      found = await olLanguage(isbn);
      if (found) source = 'openlibrary';
      await sleep(300);                       // be polite to OpenLibrary

      if (!found) {
        found = await olBibkeysLanguage(isbn);
        if (found) source = 'openlibrary-bibkeys';
        await sleep(300);
      }
      if (!found && GOOGLE_KEY) {
        found = await gbLanguage(isbn);
        if (found) source = 'googlebooks';
        await sleep(200);
      }
      // Offline, free, and the only source that answers for the printings the
      // APIs have never heard of — which is disproportionately the recent
      // non-English editions this whole exercise is about. Weaker than a stated
      // language (it identifies the issuing agency's country, not the text), so
      // it goes last and is still cross-examined below.
      if (!found) {
        found = registrantLanguage(isbn);
        if (found) source = 'isbn-registrant';
      }
    } else {
      stats.noIsbn++;
    }

    // THE CROSS-EXAMINATION, at English-vs-not granularity.
    //
    // Comparing exact language codes was too strict and rejected good rows: the
    // title heuristic can tell English from not-English reliably, but telling
    // German from French needs more than one function word — *Die Tochter des
    // Wolfs* guesses French, because "des" is both. Demanding an exact match
    // there would discard a correct "de" from OpenLibrary over a disagreement
    // that is the heuristic's fault.
    //
    // English-vs-not is the granularity the guess is trustworthy at, and it is
    // also exactly the trap worth guarding: a Spanish row carrying an English
    // ISBN (see the header) shows up as title=not-English, ISBN=English.
    if (found && titleEnglish !== null && (found === 'en') !== titleEnglish) {
      stats.conflict++;
      conflicts.push({
        id: row.id, title: row.title, isbn,
        isbnSays: found, titleSays: titleEnglish ? 'English' : 'not English', source,
      });
      vlog(`CONFLICT ${label}: isbn(${isbn})→${found} via ${source}, title looks ${titleEnglish ? 'English' : 'non-English'} — skipped`);
      continue;
    }

    if (!found) {
      if (isbn) stats.noAnswer++;
      vlog(`no answer ${label}`);
      continue;
    }

    // A row that already has a value is being RE-CHECKED, not filled, and the
    // two deserve different treatment. Agreement is the boring case and is just
    // counted. Disagreement is not automatically an improvement: the stored
    // value may have come from a stronger source than the one answering now
    // (upsert_book writes what an edition lookup actually stated; this run may
    // be looking at a registration group), and it may have been corrected by
    // hand. So it is reported and left alone unless --force says otherwise.
    if (row.language) {
      if (row.language === found) { stats.confirmed++; vlog(`confirmed ${found}  ${label}`); continue; }
      stats.disagreed++;
      disagreements.push({ id: row.id, title: row.title, stored: row.language, found, source, isbn });
      if (!FORCE) {
        vlog(`DISAGREE ${label}: stored ${row.language}, ${source} says ${found} — left as ${row.language}`);
        continue;
      }
    }

    if (DRY_RUN) {
      stats.written++;
      console.log(`  would set ${found}  (${source})  ${label}${row.language ? `   [overwriting ${row.language}]` : ''}`);
      continue;
    }

    const { error } = await supabase.from('books').update({ language: found }).eq('id', row.id);
    if (error) {
      stats.failed++;
      console.log(`  WRITE FAILED ${label}: ${error.message}`);
      continue;
    }
    stats.written++;
    if (VERBOSE) console.log(`  set ${found}  (${source})  ${label}`);
  }

  if (rows.length < PAGE) done = true;
}

console.log('\n── summary ───────────────────────────────');
console.log(`examined        ${stats.examined}`);
console.log(`written         ${stats.written}${DRY_RUN ? ' (dry run — nothing persisted)' : ''}`);
console.log(`no ISBN         ${stats.noIsbn}   — left null; nothing to ask`);
console.log(`no answer       ${stats.noAnswer}   — ISBN not recognised by any source`);
console.log(`conflicts       ${stats.conflict}   — ISBN and title disagree; left null on purpose`);
if (ALL) {
  console.log(`confirmed       ${stats.confirmed}   — already set, and re-checking agreed`);
  console.log(`disagreed       ${stats.disagreed}   — already set, and re-checking did not${FORCE ? ' (OVERWRITTEN: --force)' : ' (left alone)'}`);
}
if (stats.failed) console.log(`write failures  ${stats.failed}`);
if (googleOff) {
  console.log('\n! Google Books was disabled partway through (daily quota).');
  console.log('  Rows after that point saw OpenLibrary + registration group only.');
  console.log('  Re-running tomorrow will retry them — nothing was written wrongly.');
}

if (conflicts.length) {
  console.log('\nConflicts (books.isbn describes a different edition than books.title):');
  for (const c of conflicts.slice(0, 25)) {
    console.log(`  ${c.isbnSays} vs ${c.titleSays}  ${c.isbn}  "${c.title}"`);
  }
  if (conflicts.length > 25) console.log(`  … and ${conflicts.length - 25} more`);
  console.log('\nThese are the rows where the catalog is holding one work and one');
  console.log('foreign edition in the same row — the reader-editions problem itself.');
  console.log('See docs/reader-editions-v1-spec.md. Do not resolve them by guessing.');
}

if (disagreements.length) {
  console.log(`\n${FORCE ? 'Overwritten' : 'Disagreements (left alone — re-run with --force to apply)'}:`);
  for (const d of disagreements.slice(0, 25)) {
    console.log(`  stored ${d.stored} → ${d.found} via ${d.source}   ${d.isbn || '(no isbn)'}  "${d.title}"`);
  }
  if (disagreements.length > 25) console.log(`  … and ${disagreements.length - 25} more`);
}

// A counters line, present only if the script reached the end. The workflow
// summary reads THIS rather than counting rows in a CSV: a CSV that was never
// written counts as zero, and zero renders as "nothing to do" when what it
// means is "did not finish". That mistake produced a report of six false zeros
// in the 2026-08-17 run.
console.log(
  `\n[languageBackfill] examined=${stats.examined} written=${stats.written} ` +
  `noIsbn=${stats.noIsbn} noAnswer=${stats.noAnswer} conflict=${stats.conflict} ` +
  `confirmed=${stats.confirmed} disagreed=${stats.disagreed} failed=${stats.failed} ` +
  `googleOff=${googleOff ? 1 : 0} dryrun=${DRY_RUN ? 1 : 0} complete=1`
);

console.log(ALL
  ? '\nRan over the whole catalog (--all). Without --force, existing values were only checked, never changed.'
  : '\nRe-run safely at any time: only rows with language IS NULL are touched. Use --all to re-check every book.');
