// originalLanguageBackfill.mjs — fill books.original_language for the existing
// catalog, from free sources, without guessing.
//
// WHY THIS EXISTS
//
// books.original_language landed with books.language in migration
// 20260817140000. `language` now has an answer for every row in the catalog:
// upsert_book writes it for new rows, languageBackfill.mjs filled the old ones,
// and isbnBackfill/isbnFallback closed the ISBN gap that fed both — as of the
// v0.64 pass, `select count(*) from books where language is null` and the same
// query for `isbn` both return 0.
//
// original_language returns 3,4xx. It is the last null column of that work, and
// it is null for a structural reason rather than an accidental one: the
// migration named exactly one writer for it, the nightly Oracle categorisation
// pass, and that pass does not revisit books it has already categorised. Every
// row that existed before v0.64 is therefore permanently outside the reach of
// the only thing allowed to fill it. author_gender hit this exact wall in v0.62
// and the answer was authorGenderBackfill.mjs; this is the same shape of
// script for the same shape of gap.
//
// WHAT THE COLUMN IS FOR
//
// It is the field that lets the app tell an original from a translation when it
// holds both. src/lib/workGroups.js collapses rows that are provably the same
// work and then has to choose which one to show; `pickPreferred()` consults
// original_language and, today, almost always finds null and falls back to
// whichever row has a cover. Filling it is what makes that choice principled —
// and it is a precondition for the "More about the author" rule in
// docs/reader-editions-v1-spec.md, which is supposed to show an author's
// original-language work rather than an arbitrary translation of it.
//
// SOURCES — ALL FREE, IN DESCENDING ORDER OF AUTHORITY
//
//   1. Wikidata P364 ("original language of film, TV show, novel, musical work
//      or web series"), via the MediaWiki action API on www.wikidata.org.
//      No key, no account, CC0 data, so nothing that lands in the catalog from
//      here carries a deletion obligation. This is a stated fact about the
//      work, which is exactly what the column holds.
//
//      Reached by title search, NOT by ISBN. Wikidata does hold ISBNs (P212 on
//      edition items), but coverage is a rounding error — the items that exist
//      are works and the editions mostly do not — and P212 is stored hyphenated
//      in a hyphenation we cannot reconstruct from a bare 13-digit string. A
//      title search that is then verified against the author is both broader
//      and, because of the verification, no less strict.
//
//   2. OpenLibrary `translated_from` on the edition record. Present only on
//      editions somebody has marked as translations, so coverage is low, but
//      when it is there it is definitive in the most direct possible way: the
//      record is saying "this printing was translated out of X".
//
//   3. Propagation across the catalog's own work groups. If two rows are
//      provably the same work — shared hardcover_id, shared goodreads_id,
//      shared ISBN — and one of them now has an original_language, the other
//      one has the same original_language. This is not an inference about
//      books; it is the definition of "same work" applied twice. It costs no
//      requests and it is the source that scales, because every Wikidata hit
//      pulls its translations along with it.
//
// NOT USED: ISBNdb, and it is worth writing down why, because we now pay for it
// and the question will be asked again. Its Book model is
// title / title_long / isbn / isbn13 / isbn10 / binding / publisher / language /
// date_published / edition / pages / dimensions / overview / image / msrp /
// excerpt / synopsis / authors / subjects / reviews / prices / related /
// other_isbns. `language` is there — and `language` is the PRINTING's language,
// which is books.language, which is already at zero nulls. There is no
// original_language, no translated_from, no translator and no original_title
// field anywhere in the schema. This is not an oversight on ISBNdb's part:
// original language is a fact about a work and ISBNdb is an edition database.
// docs/isbndb-evaluation.md reached the same conclusion from the published
// docs; this script re-checked the v2 OpenAPI spec (api2.isbndb.com/doc.json)
// in August 2026 and it still holds.
//
// THE RULE THIS SCRIPT IS BUILT AROUND
//
// A TITLE MATCH IS NOT AN IDENTIFICATION.
//
// Searching Wikidata for "Dune" returns the novel, the films, the video games,
// the desert and a Scottish surname. Searching for "Crushed" returns a dozen
// unrelated works. The catalog-maintenance postmortem of 2026-08-17 records
// what happens when a search's top hit is trusted: 971 books declared missing
// from Hardcover because a broken connection looked like an empty result, and
// 31 books rejected because "Unknown author" was compared against a real name.
//
// So every candidate is verified against the author before it is allowed to
// answer, and the verification is done against the AUTHOR ITEM'S OWN LABELS AND
// ALIASES, not against a description string:
//
//   candidate has P364, and some P50 author's label/alias matches  →  accept
//   candidate has P364, no author match                            →  discard
//   two accepted candidates that disagree                          →  conflict,
//                                                                     write
//                                                                     nothing
//   row has no usable author (null, or a placeholder)              →  skip
//                                                                     entirely
//
// The placeholder rule is the postmortem's lesson taken literally: 31 rows
// store the literal string "Unknown author", and a row with no author cannot
// have a title match verified, so it is not searched at all rather than
// searched and hoped over.
//
// WHAT IT WILL NOT DO
//
// Write a guess. It will not infer the original language from the author's
// nationality, from books.language, or from the shape of the title. A Spanish
// title tells you about the printing in your hand, not about the language it
// was written in — *Los peligros de fumar en la cama* is Spanish-original and
// *Lágrimas en H Mart* is not, and nothing about either title says which.
//
// Write 'unknown'. oracleBatch.mjs stores 'unknown' deliberately, as a resolved
// answer that stops a book being re-billed. This script has no per-book cost,
// so it has nothing to protect by claiming an answer it does not have. A row it
// cannot resolve is left NULL and stays eligible for the next run — and for the
// Oracle, which may know things Wikidata does not.
//
// Overwrite. Write-once, matching oracleBatch's guard and for its reason: the
// language García Márquez wrote in does not change, so a second and different
// answer means one of the two is wrong, and the older one has at least had the
// chance to be corrected by hand. Disagreements are reported, and --force
// applies them — except over 'self_stated' and 'verified', which --force does
// not reach.
//
// USAGE
//
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --probe "Dune|Frank Herbert"
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --dry-run --limit 50 --verbose
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --dry-run          # audit
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs                    # fill
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --propagate-only   # free pass
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --all --dry-run    # re-check
//
// Start with --probe on a book you know the answer to, then --dry-run. Nothing
// is written without a real run.
//
// Requires migration 20260819120000_original_language_source.sql.
// Required in .env.local: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No API keys. Every source is anonymous.

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { cleanIsbn, isValidIsbn } from '../../src/lib/isbn.js';
// Every rule that can be got wrong without a network call lives in the library
// module, so batch-scripts/probes/originalLanguage.probe.mjs can exercise it
// offline. This file is the I/O.
import {
  normPerson, normTitleLoose, isPlaceholderAuthor, authorLikelySame,
  to6391, planPropagation, decideWrite,
} from '../../src/lib/originalLanguage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
// --all             re-examine rows that already have a value, instead of only
//                   filling gaps. Reports; does not change anything on its own.
// --force           with --all, apply the disagreements. Never touches a row
//                   whose original_language_source is in HUMAN_SOURCES.
// --propagate-only  run phase 3 alone: no network at all, just spread what the
//                   catalog already knows across its own work groups. Seconds,
//                   not minutes, and a sensible thing to run after any pass.
const ALL = args.includes('--all');
const FORCE = args.includes('--force');
const PROPAGATE_ONLY = args.includes('--propagate-only');

function argVal(name, fallback = null) {
  const a = args.find((x) => x === name || x.startsWith(name + '='));
  if (!a) return fallback;
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  return args[args.indexOf(a) + 1] ?? fallback;
}
const LIMIT = Number.isFinite(parseInt(argVal('--limit'), 10)) ? parseInt(argVal('--limit'), 10) : null;
const PROBE = argVal('--probe');

// ── Env ──────────────────────────────────────────────────────────────────────
// Same reader as languageBackfill.mjs — deliberately duplicated rather than
// shared, because _shared/ is for things two scripts genuinely agree on and a
// six-line .env parser is not worth a coupling.
function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8')
        .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [
            l.slice(0, i).trim().replace(/^export\s+/, ''),
            l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ''),
          ];
        })
    );
  } catch {
    return {};
  }
}
const env = loadEnv();
const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };

// Wikidata asks for a descriptive User-Agent with contact information and
// throttles anonymous clients that do not send one. This is not optional
// politeness; requests without it get 403s.
const UA = 'BooksOracle-originalLanguageBackfill/1.0 (https://thebooksoracle.com; simont@mozillafoundation.org)';
const WD_API = 'https://www.wikidata.org/w/api.php';

// ── HTTP ─────────────────────────────────────────────────────────────────────
//
// One helper, and it distinguishes the three outcomes that matter. The
// postmortem's first root cause was a transport that reported "no data" and
// "the service is down" identically, so a 100% failure rate read as a 100%
// miss rate. Here a transport failure returns the FAILED sentinel, which the
// caller counts separately and which trips the circuit breaker; a 404 returns
// null, which is a real answer meaning "not held".
const FAILED = Symbol('request-failed');

let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 12;

async function getJson(url, attempt = 1) {
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (resp.status === 404) { consecutiveFailures = 0; return null; }
    if (resp.status === 429 || resp.status === 503) {
      if (attempt <= 3) {
        const wait = 15000 * attempt;
        vlog(`HTTP ${resp.status} — waiting ${wait / 1000}s`);
        await sleep(wait);
        return getJson(url, attempt + 1);
      }
      consecutiveFailures++;
      console.log(`  ! HTTP ${resp.status} after 3 attempts: ${url.slice(0, 120)}`);
      return FAILED;
    }
    if (resp.status === 403) {
      // Almost always the User-Agent. Say so rather than making it look like a
      // data gap — this is the failure mode that produced a 971-row worklist.
      consecutiveFailures++;
      console.log('  ! HTTP 403 — Wikidata rejects anonymous clients without a descriptive User-Agent.');
      return FAILED;
    }
    if (!resp.ok) { consecutiveFailures++; return FAILED; }
    consecutiveFailures = 0;
    return await resp.json();
  } catch (e) {
    if (attempt <= 3) { await sleep(2000 * attempt); return getJson(url, attempt + 1); }
    consecutiveFailures++;
    vlog(`request failed: ${String(e)}`);
    return FAILED;
  }
}

function abortIfSourceIsDown() {
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error(
      `\nAborting: ${consecutiveFailures} consecutive request failures. That is a broken ` +
      'connection, not a data gap, and continuing would write a report claiming the ' +
      'catalog has no answers. Nothing further has been written. Re-run when the source is back.'
    );
    process.exit(2);
  }
}

// ── Wikidata ─────────────────────────────────────────────────────────────────
//
// The action API, not the SPARQL endpoint. WDQS is the natural tool for
// "give me every work with P364" and the wrong tool here: this needs a
// case-insensitive, alias-aware, typo-tolerant title lookup, which is search,
// and WDQS has no search. It also has a 60-second query timeout and an
// aggressive anonymous throttle, while the action API batches 50 entities per
// request and is designed to be called in a loop.

const langCodeCache = new Map();   // language QID  → 639-1 code | null
const authorNameCache = new Map(); // author QID    → [labels + aliases]

// P218 is the ISO 639-1 code on a language item. Not every language item has
// one (many small languages only have 639-3, P220), and a language with no
// 639-1 code cannot be stored in a column documented as holding the BCP-47
// primary subtag — so it resolves to null and the row is left alone rather
// than being given a code the rest of the app cannot read.
async function resolveLanguageCodes(qids) {
  const want = [...new Set(qids)].filter((q) => q && !langCodeCache.has(q));
  for (let i = 0; i < want.length; i += 50) {
    const batch = want.slice(i, i + 50);
    const url = `${WD_API}?action=wbgetentities&ids=${batch.join('|')}&props=claims&format=json&origin=*`;
    const data = await getJson(url);
    if (data === FAILED || !data?.entities) { batch.forEach((q) => langCodeCache.set(q, null)); continue; }
    for (const q of batch) {
      const claims = data.entities[q]?.claims?.P218 || [];
      const code = claims[0]?.mainsnak?.datavalue?.value;
      langCodeCache.set(q, typeof code === 'string' && /^[a-z]{2}$/i.test(code) ? code.toLowerCase() : null);
    }
    await sleep(200);
  }
}

// Labels AND aliases, across the languages the catalog's authors are actually
// spelled in. An author item's English label may be a transliteration while the
// catalog holds the native spelling, or the other way round; the alias list is
// where the other spellings live, and skipping it would reject correct matches.
const NAME_LANGS = 'en|es|pt|fr|de|it|ca|gl';

async function resolveAuthorNames(qids) {
  const want = [...new Set(qids)].filter((q) => q && !authorNameCache.has(q));
  for (let i = 0; i < want.length; i += 50) {
    const batch = want.slice(i, i + 50);
    const url =
      `${WD_API}?action=wbgetentities&ids=${batch.join('|')}` +
      `&props=labels|aliases&languages=${NAME_LANGS}&format=json&origin=*`;
    const data = await getJson(url);
    if (data === FAILED || !data?.entities) { batch.forEach((q) => authorNameCache.set(q, [])); continue; }
    for (const q of batch) {
      const ent = data.entities[q];
      const names = [];
      for (const l of Object.values(ent?.labels || {})) if (l?.value) names.push(l.value);
      for (const arr of Object.values(ent?.aliases || {})) {
        for (const a of arr || []) if (a?.value) names.push(a.value);
      }
      authorNameCache.set(q, names);
    }
    await sleep(200);
  }
}

// Search returns items, not works. The filtering happens after, in
// wikidataOriginalLanguage: an item is only ever consulted for P364, and P364
// is a property of creative works, so a desert and a surname simply have
// nothing to say and drop out without needing a P31 whitelist to exclude them.
// That is deliberate — a whitelist of "written work" classes is a list that is
// always slightly wrong, and the property itself is a better filter than any
// enumeration of types.
async function searchEntities(term, limit = 8) {
  const url =
    `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(term)}` +
    `&language=en&uselang=en&type=item&limit=${limit}&format=json&origin=*`;
  const data = await getJson(url);
  if (data === FAILED) return FAILED;
  return (data?.search || []).map((s) => s.id).filter(Boolean);
}

async function fetchClaims(qids) {
  const out = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const url = `${WD_API}?action=wbgetentities&ids=${batch.join('|')}&props=claims|labels&languages=${NAME_LANGS}&format=json&origin=*`;
    const data = await getJson(url);
    if (data === FAILED || !data?.entities) continue;
    for (const q of batch) if (data.entities[q]) out.set(q, data.entities[q]);
    await sleep(200);
  }
  return out;
}

const claimQids = (entity, prop) =>
  (entity?.claims?.[prop] || [])
    .map((c) => c?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);

const claimStrings = (entity, prop) =>
  (entity?.claims?.[prop] || [])
    .map((c) => c?.mainsnak?.datavalue?.value)
    .filter((v) => typeof v === 'string');

/**
 * Resolve one (title, author) pair to a 639-1 code via Wikidata, or null.
 *
 * Returns { code, qid } on success, null on "no verified answer", FAILED if the
 * source itself is unreachable, and { conflict: [...] } when two candidates
 * both verified against the author and disagreed — which happens for an author
 * who wrote a novel and its screenplay in different languages, and is not
 * something this script gets to adjudicate.
 */
async function wikidataOriginalLanguage(title, author) {
  const qids = await searchEntities(title);
  if (qids === FAILED) return FAILED;
  if (!qids.length) return null;

  const entities = await fetchClaims(qids);
  if (!entities.size) return null;

  // Only candidates that actually state an original language are worth the
  // author lookups that verification costs.
  const withLang = [...entities.entries()].filter(([, e]) => claimQids(e, 'P364').length > 0);
  if (!withLang.length) return null;

  const authorQids = withLang.flatMap(([, e]) => claimQids(e, 'P50'));
  await resolveAuthorNames(authorQids);

  const accepted = [];
  for (const [qid, ent] of withLang) {
    // P50 is the author item; P2093 is the "author name string" used when no
    // item exists for the person. Both are legitimate evidence, and a work by a
    // minor author often has only the second.
    const names = [
      ...claimQids(ent, 'P50').flatMap((aq) => authorNameCache.get(aq) || []),
      ...claimStrings(ent, 'P2093'),
    ];
    if (!names.length) continue;
    if (!names.some((n) => authorLikelySame(author, n))) continue;
    accepted.push({ qid, langQids: claimQids(ent, 'P364') });
  }
  if (!accepted.length) return null;

  await resolveLanguageCodes(accepted.flatMap((a) => a.langQids));

  const codes = new Set();
  for (const a of accepted) for (const lq of a.langQids) {
    const c = langCodeCache.get(lq);
    if (c) codes.add(c);
  }
  if (!codes.size) return null;
  if (codes.size > 1) return { conflict: [...codes], qid: accepted[0].qid };
  return { code: [...codes][0], qid: accepted[0].qid };
}

// ── OpenLibrary ──────────────────────────────────────────────────────────────
//
// `translated_from` is an array of language keys on the EDITION record — the
// record saying "this printing came out of that language". It is the one field
// in any free bibliographic API that answers this question directly, and it is
// only present when a librarian filled it in, so treat it as a bonus rather
// than a tier.
//
// The 639-2 → 639-1 map is the same one languageBackfill.mjs carries, and for
// the same reason: OpenLibrary uses both the bibliographic and terminological
// 639-2 codes ("ger" and "deu" are both German) because its records were
// imported from many sources over twenty years.
async function openLibraryTranslatedFrom(isbn) {
  const data = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
  if (data === FAILED) return FAILED;
  const key = data?.translated_from?.[0]?.key;
  return key ? to6391(key) : null;
}

// ── Probe ────────────────────────────────────────────────────────────────────
//
// --probe "Title|Author" runs the real resolver against real inputs, with the
// same verification. The postmortem's second wrong turn was a diagnostic that
// hardcoded its inputs and therefore came back clean while the job failed; this
// one takes the inputs from the command line and runs the same function the
// main loop runs.
if (PROBE) {
  const [pTitle, pAuthor] = String(PROBE).split('|').map((s) => (s || '').trim());
  if (!pTitle) {
    console.error('Usage: --probe "Title|Author"');
    process.exit(1);
  }
  console.log(`probe: title="${pTitle}" author="${pAuthor || '(none)'}"`);
  console.log(`  normalised title : ${normTitleLoose(pTitle)}`);
  console.log(`  normalised author: ${normPerson(pAuthor)}${isPlaceholderAuthor(pAuthor) ? '   [PLACEHOLDER — a real row here would be skipped]' : ''}`);

  const qids = await searchEntities(pTitle);
  console.log(`  wikidata search  : ${qids === FAILED ? 'REQUEST FAILED' : (qids.join(', ') || '(no hits)')}`);

  if (qids !== FAILED && qids.length) {
    const ents = await fetchClaims(qids);
    for (const [qid, ent] of ents) {
      const label = ent?.labels?.en?.value || '(no en label)';
      const langQids = claimQids(ent, 'P364');
      if (!langQids.length) { console.log(`    ${qid}  ${label}  — no P364, discarded`); continue; }
      const aQids = claimQids(ent, 'P50');
      await resolveAuthorNames(aQids);
      await resolveLanguageCodes(langQids);
      const names = [...aQids.flatMap((a) => authorNameCache.get(a) || []), ...claimStrings(ent, 'P2093')];
      const ok = pAuthor && names.some((n) => authorLikelySame(pAuthor, n));
      const codes = langQids.map((l) => langCodeCache.get(l) || '?').join('/');
      console.log(`    ${qid}  ${label}  P364=${codes}  authors=[${names.slice(0, 4).join(', ')}]  → ${ok ? 'ACCEPTED' : 'discarded (author not corroborated)'}`);
    }
  }

  const verdict = pAuthor ? await wikidataOriginalLanguage(pTitle, pAuthor) : null;
  console.log(`  verdict          : ${
    verdict === FAILED ? 'REQUEST FAILED'
      : verdict?.conflict ? `CONFLICT ${verdict.conflict.join(' vs ')} — would write nothing`
      : verdict?.code ? verdict.code
      : '(no verified answer — would be left NULL)'
  }`);
  process.exit(0);
}

// ── Supabase ─────────────────────────────────────────────────────────────────
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

const stats = {
  examined: 0, written: 0, propagated: 0,
  noAuthor: 0, noAnswer: 0, conflict: 0, failed: 0, confirmed: 0, disagreed: 0, protected: 0,
};
const conflicts = [];
const disagreements = [];
const bySource = { wikidata: 0, openlibrary: 0, catalog_sibling: 0 };

// KEYSET pagination by id, not offset — for the reason languageBackfill.mjs
// documents at length: a live run changes which rows match the filter, while
// the rows this script deliberately skips keep matching forever, so an offset
// window re-serves the unresolvable rows and the loop never ends.
const PAGE = 200;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const SELECT_COLS = 'id, title, author, isbn, language, original_language, original_language_source, hardcover_id, goodreads_id';

async function fetchAfter(lastId, gapsOnly) {
  let q = supabase
    .from('books')
    .select(SELECT_COLS)
    .gt('id', lastId)
    .order('id')
    .limit(PAGE);
  if (gapsOnly) q = q.is('original_language', null);
  const { data, error } = await q;
  if (error) throw new Error(`select failed: ${error.message}`);
  return data || [];
}

async function writeAnswer(row, code, source) {
  if (DRY_RUN) return true;
  const { error } = await supabase
    .from('books')
    .update({ original_language: code, original_language_source: source })
    .eq('id', row.id);
  if (error) {
    stats.failed++;
    console.log(`  WRITE FAILED "${row.title}": ${error.message}`);
    return false;
  }
  return true;
}

// Decide what to do with an answer for a row that may already have one.
// Returns 'write' | 'skip'.
// Wraps decideWrite (src/lib/originalLanguage.js) with this run's bookkeeping.
// The decision itself is in the library so the probe can assert on it; the
// counters and the disagreement log are reporting, and belong here.
function precedence(row, code, source) {
  const verdict = decideWrite(row, code, { force: FORCE });

  if (verdict === 'confirm') { stats.confirmed++; return 'skip'; }

  if (row.original_language != null && row.original_language !== code) {
    stats.disagreed++;
    disagreements.push({
      id: row.id, title: row.title,
      stored: row.original_language, storedSource: row.original_language_source || '(none)',
      found: code, foundSource: source,
    });
  }

  if (verdict === 'protected') {
    stats.protected++;
    vlog(`PROTECTED "${row.title}": stored ${row.original_language} (${row.original_language_source}) — --force does not overwrite a human answer`);
    return 'skip';
  }
  return verdict === 'write' ? 'write' : 'skip';
}

// ── Phase 3: propagation ─────────────────────────────────────────────────────
//
// Runs last, and runs over the WHOLE catalog rather than over the page that was
// just processed, because a group's answer may have been written on a page
// walked twenty minutes ago. It is one full read and no network, so the cost of
// being thorough here is seconds.
async function propagate() {
  console.log('\n── phase 3: propagation across work groups ───────────────');
  const rows = [];
  let lastId = ZERO_UUID;
  for (;;) {
    const page = await fetchAfter(lastId, false);
    if (!page.length) break;
    rows.push(...page);
    lastId = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }

  // planPropagation lives in src/lib/originalLanguage.js so the probe can run
  // this exact grouping over hand-built rows with no database. A group whose
  // members disagree is poisoned and answers nobody.
  const { assignments, poisoned } = planPropagation(rows, (isbn) => isValidIsbn(isbn));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const a of assignments) {
    const r = byId.get(a.id);
    if (!r) continue;
    if (DRY_RUN) {
      stats.propagated++;
      console.log(`  would propagate ${a.code}  "${r.title}"   (via ${a.viaKey})`);
      continue;
    }
    if (await writeAnswer(r, a.code, 'catalog_sibling')) {
      stats.propagated++;
      bySource.catalog_sibling++;
      vlog(`propagated ${a.code}  "${r.title}"   (via ${a.viaKey})`);
    }
  }

  console.log(`  ${stats.propagated} row(s) ${DRY_RUN ? 'would be ' : ''}filled from a sibling row of the same work.`);
  if (poisoned.length) {
    console.log(`  ${poisoned.length} work group(s) skipped: members disagree about the original language.`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`originalLanguageBackfill — ${DRY_RUN ? 'DRY RUN, nothing will be written' : 'LIVE'}`);
console.log('sources: Wikidata P364 (free, no key) → OpenLibrary translated_from (free) → catalog work groups (offline)');
console.log('ISBNdb is not consulted: its Book model has `language` (the printing) and no original-language field.');
console.log('');

if (PROPAGATE_ONLY) {
  await propagate();
} else {
  let lastId = ZERO_UUID;
  let done = false;

  while (!done) {
    const rows = await fetchAfter(lastId, !ALL);
    if (!rows.length) break;

    for (const row of rows) {
      if (LIMIT && stats.examined >= LIMIT) { done = true; break; }
      lastId = row.id;
      stats.examined++;
      abortIfSourceIsDown();

      const label = `"${row.title}"${row.author ? ' — ' + row.author : ''}`;

      if (isPlaceholderAuthor(row.author)) {
        stats.noAuthor++;
        vlog(`no usable author ${label} — not searched`);
        continue;
      }

      let code = null;
      let source = null;

      const wd = await wikidataOriginalLanguage(row.title, row.author);
      await sleep(250);
      if (wd === FAILED) {
        vlog(`wikidata unreachable for ${label}`);
      } else if (wd?.conflict) {
        stats.conflict++;
        conflicts.push({ id: row.id, title: row.title, author: row.author, codes: wd.conflict, qid: wd.qid });
        vlog(`CONFLICT ${label}: ${wd.conflict.join(' vs ')} — skipped`);
        continue;
      } else if (wd?.code) {
        code = wd.code;
        source = 'wikidata';
      }

      if (!code) {
        const isbn = cleanIsbn(row.isbn);
        if (isbn && isValidIsbn(isbn)) {
          const ol = await openLibraryTranslatedFrom(isbn);
          await sleep(300);
          if (ol && ol !== FAILED) { code = ol; source = 'openlibrary'; }
        }
      }

      if (!code) {
        stats.noAnswer++;
        vlog(`no answer ${label}`);
        continue;
      }

      if (precedence(row, code, source) === 'skip') continue;

      if (DRY_RUN) {
        stats.written++;
        bySource[source]++;
        console.log(`  would set ${code}  (${source})  ${label}${row.original_language ? `   [overwriting ${row.original_language}]` : ''}`);
        continue;
      }

      if (await writeAnswer(row, code, source)) {
        stats.written++;
        bySource[source]++;
        if (VERBOSE) console.log(`  set ${code}  (${source})  ${label}`);
      }
    }

    if (rows.length < PAGE) done = true;
  }

  await propagate();
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n── summary ───────────────────────────────');
console.log(`examined        ${stats.examined}`);
console.log(`written         ${stats.written}${DRY_RUN ? ' (dry run — nothing persisted)' : ''}`);
console.log(`  via wikidata      ${bySource.wikidata}`);
console.log(`  via openlibrary   ${bySource.openlibrary}`);
console.log(`propagated      ${stats.propagated}   — copied from a sibling row of the same work`);
console.log(`no usable author ${stats.noAuthor}   — null or placeholder; a title match could not be verified`);
console.log(`no answer       ${stats.noAnswer}   — searched, nothing corroborated; left NULL for the Oracle`);
console.log(`conflicts       ${stats.conflict}   — two verified candidates disagreed; left NULL on purpose`);
if (ALL) {
  console.log(`confirmed       ${stats.confirmed}   — already set, and re-checking agreed`);
  console.log(`disagreed       ${stats.disagreed}   — already set, and re-checking did not${FORCE ? ' (applied, except where protected)' : ' (left alone)'}`);
  if (stats.protected) console.log(`protected       ${stats.protected}   — human-sourced; --force does not reach these`);
}
if (stats.failed) console.log(`write failures  ${stats.failed}`);

// A machine-readable line, in the format .github/workflows/catalog-maintenance.yml
// reads for its summary. The workflow was changed in v0.64 to count these rather
// than to count rows in a CSV, because a CSV that was never written counted as
// zero and rendered as "nothing to do".
console.log(
  `\n[originalLanguageBackfill] examined=${stats.examined} written=${stats.written} ` +
  `propagated=${stats.propagated} wikidata=${bySource.wikidata} openlibrary=${bySource.openlibrary} ` +
  `sibling=${bySource.catalog_sibling} noauthor=${stats.noAuthor} noanswer=${stats.noAnswer} ` +
  `conflict=${stats.conflict} failed=${stats.failed} dryrun=${DRY_RUN ? 1 : 0} complete=1`
);

if (conflicts.length) {
  console.log('\nConflicts (two candidates both matched the author and disagreed):');
  for (const c of conflicts.slice(0, 25)) {
    console.log(`  ${c.codes.join(' vs ')}  "${c.title}" — ${c.author}   (e.g. ${c.qid})`);
  }
  if (conflicts.length > 25) console.log(`  … and ${conflicts.length - 25} more`);
  console.log('\nUsually a novel and its screenplay, or a work and a same-titled work by');
  console.log('the same author. Resolve by hand or leave to the Oracle. Do not guess.');
}

if (disagreements.length) {
  console.log(`\nDisagreements${FORCE ? ' (applied where not human-sourced)' : ' (left alone — re-run with --all --force to apply)'}:`);
  for (const d of disagreements.slice(0, 25)) {
    console.log(`  stored ${d.stored} (${d.storedSource}) → ${d.found} (${d.foundSource})   "${d.title}"`);
  }
  if (disagreements.length > 25) console.log(`  … and ${disagreements.length - 25} more`);
}

console.log(ALL
  ? '\nRan over the whole catalog (--all). Without --force, existing values were only checked.'
  : '\nRe-run safely at any time: only rows with original_language IS NULL are touched.');
console.log('Rows left NULL are still eligible for the nightly Oracle pass, which is the point —');
console.log('this script fills what a free source can state, and does not pretend to the rest.');
