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
//   1. Wikidata, via the MediaWiki action API on www.wikidata.org. No key, no
//      account, CC0 data, so nothing that lands in the catalog from here
//      carries a deletion obligation.
//
//      The property that actually answers is P407 ("language of work or name"),
//      not P364 ("original language of film, TV show, novel…"). P364 reads like
//      the right one and is a film property in practice — it answered zero of
//      the first fifty catalog rows where P407 answered fourteen. P364 still
//      wins where both are present. P407 is taken only from an item that
//      declares itself a WRITTEN WORK; an EDITION item is followed through P629
//      to its work rather than believed, because an edition's language is the
//      printing's, which is `books.language`. See the Wikidata section for that
//      and for the three searches one title needs.
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
//   states a language, and a P50 author's label/alias matches      →  accept
//   states a language, no author match                             →  discard
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
// cannot resolve is left NULL — and still eligible for the Oracle, which knows
// things Wikidata does not.
//
// THE QUEUE, AND WHY IT IS NOT `original_language IS NULL`
//
// That filter looks right and does not terminate. Roughly 60% of what this
// examines is books Wikidata genuinely does not have; they stay NULL, so they
// stay eligible, so a weekly cron re-asks the same ~2,000 indie novellas,
// Warhammer tie-ins and single-issue comics every Monday forever. Slow, poor
// manners toward a free service, and a report that never shrinks — which is
// worse than either, because a queue that cannot drain gives no signal about
// whether anything is working.
//
// `books.original_language_checked_at` (migration 20260819180000) is the stamp
// that fixes it, and it is authorGenderBackfill.mjs's rule verbatim: stamp even
// when the answer is nothing, so an honest shrug is recorded as asked-and-
// answered rather than re-asked. The default pass selects rows never asked.
//
// ONE EXCEPTION, AND IT IS THE IMPORTANT ONE. A failed REQUEST never stamps.
// `search-failed` and `entities-unfetchable` mean the row was attempted, not
// asked, and writing a timestamp for them converts an outage into a permanent
// "we checked, there is nothing" — the postmortem's root cause with a date on
// it. 971 books were declared unfindable by a broken connection once, and the
// only thing that saved them was that nothing recorded the verdict.
// shouldStampChecked() in src/lib/originalLanguage.js owns that decision, and
// the probe asserts on it.
//
// Overwrite. Write-once, matching oracleBatch's guard and for its reason: the
// language García Márquez wrote in does not change, so a second and different
// answer means one of the two is wrong, and the older one has at least had the
// chance to be corrected by hand. Disagreements are reported, and --force
// applies them — except over 'self_stated' and 'verified', which --force does
// not reach.
//
// WHEN THE NUMBERS LOOK WRONG, RUN --diagnose FIRST
//
// The first dry run of this script resolved 0 of 48 rows and reported them all
// as "no answer", which is five different outcomes wearing one number. Two bugs
// were hiding under it: MediaWiki error payloads being read as empty results,
// and a single English prefix search against a catalog full of Spanish,
// accent-stripped and mistyped titles.
//
// --diagnose splits that number into the funnel — no search hits / no language
// property / author not corroborated / no ISO code / request failed — and never
// writes. The funnel is printed on every run now, not only under --diagnose,
// because the aggregate it replaces was the misleading one.
//
// USAGE
//
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --probe "Dune|Frank Herbert"
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --probe "Cien años de soledad|Gabriel García Márquez|es"
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --diagnose --limit 50
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --dry-run --limit 50 --verbose
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --dry-run          # audit
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs                    # fill
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --propagate-only   # free pass
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --recheck           # re-ask the empties
//   node batch-scripts/scheduled/originalLanguageBackfill.mjs --all --dry-run    # re-check
//
// Start with --probe on a book you know the answer to, then --dry-run. Nothing
// is written without a real run.
//
// Requires migrations 20260819120000_original_language_source.sql and
// 20260819180000_original_language_checked_at.sql.
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
  to6391, planPropagation, decideWrite, searchTitles, shouldStampChecked,
} from '../../src/lib/originalLanguage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || args.includes('--diagnose');
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
// --diagnose  never writes, and reports WHERE each row fell out of the funnel
//             rather than only that it did. "no answer" is five different
//             outcomes wearing one number; this splits them. Implies --dry-run.
const DIAGNOSE = args.includes('--diagnose');
// --recheck  re-examine rows that have already been asked and came back empty.
//            The default pass only looks at rows never asked, which is what
//            makes this script terminate. Use this when a source has improved
//            or the matching has — not on a schedule.
const RECHECK = args.includes('--recheck');

function argVal(name, fallback = null) {
  const a = args.find((x) => x === name || x.startsWith(name + '='));
  if (!a) return fallback;
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  return args[args.indexOf(a) + 1] ?? fallback;
}
const LIMIT = Number.isFinite(parseInt(argVal('--limit'), 10)) ? parseInt(argVal('--limit'), 10) : null;
const PROBE = argVal('--probe');

// A wall-clock budget OF ITS OWN, so the run ends rather than being killed.
//
// The 2026-08-24 run hit the workflow's hard `timeout-minutes: 60`. A hard kill
// means no summary, no `[originalLanguageBackfill] ...` counters line -- so the job
// summary rendered `--  (did not finish)` -- and, worse, propagate() never ran at
// all. Propagation is free, offline and the highest yield per second in the script.
// Per-row writes and stamps survived, as designed; the report and the propagation
// were the whole loss.
//
// Default 50 minutes, comfortably inside the step's 60.
const MAX_MINUTES = Number.isFinite(parseFloat(argVal('--max-minutes')))
  ? parseFloat(argVal('--max-minutes'))
  : (Number.isFinite(parseFloat(process.env.ORIGLANG_MAX_MINUTES))
    ? parseFloat(process.env.ORIGLANG_MAX_MINUTES)
    : 50);
const STARTED_AT = Date.now();
const DEADLINE_AT = STARTED_AT + MAX_MINUTES * 60_000;
const msLeft = () => DEADLINE_AT - Date.now();
const outOfTime = () => msLeft() <= 0;
const elapsedMin = () => ((Date.now() - STARTED_AT) / 60000).toFixed(1);
let stoppedEarly = false;

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

// One line per distinct API error code, not one per request.
const seenApiErrors = new Set();

async function getJson(url, attempt = 1) {
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (resp.status === 404) { consecutiveFailures = 0; return null; }
    if (resp.status === 429 || resp.status === 503) {
      if (attempt <= 3) {
        const wait = 15000 * attempt;
        // Never sleep past the run's own deadline. The ladder is 15+30+45s, so a
        // source that is broadly 503ing costs 90s of pure waiting PER URL -- which
        // is how a 60-minute budget went to roughly forty rows.
        if (wait >= msLeft()) {
          consecutiveFailures++;
          console.log(`  ! HTTP ${resp.status} — no time left in this run to retry: ${url.slice(0, 120)}`);
          return FAILED;
        }
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

    const body = await resp.json();

    // THE POSTMORTEM'S ROOT CAUSE #1, WHICH THIS SCRIPT REPRODUCED.
    //
    // MediaWiki answers HTTP 200 with `{"error": {...}}` for a rejected or
    // malformed parameter. Returning that body as data made a systematically
    // broken request indistinguishable, at every call site, from a book
    // Wikidata has never heard of — which is exactly how `gql()` turned a
    // Hardcover outage into a 971-row worklist. The first dry run of this
    // script reported 48 of 48 rows as "no answer" for this reason.
    //
    // Printed once per error code, so a systematic fault is loud and a
    // one-off is not noise.
    if (body?.error) {
      consecutiveFailures++;
      const code = body.error.code || 'unknown';
      if (!seenApiErrors.has(code)) {
        seenApiErrors.add(code);
        console.log(`  ! Wikidata API error "${code}": ${body.error.info || '(no detail)'}`);
        console.log(`    request: ${url.slice(0, 160)}`);
      }
      return FAILED;
    }

    consecutiveFailures = 0;
    return body;
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
//
// THREE SEARCHES, NOT ONE — and why the first version found almost nothing
//
// v0.64's first dry run resolved 0 of 48 rows with usable authors. Two causes,
// both in this section, both now fixed:
//
//   1. `getJson` returned MediaWiki's error payload as if it were data. The API
//      answers HTTP 200 with `{"error": {...}}` for a rejected parameter, so a
//      systematically broken request was indistinguishable from a book Wikidata
//      has never heard of — the postmortem's root cause #1, reproduced exactly.
//      Errors are now detected, printed once per code, and counted as failures.
//
//   2. One `wbsearchentities` call in English was the whole search. That
//      endpoint matches labels and aliases by PREFIX, in ONE language. Against
//      a catalog whose titles are Spanish (*Los peligros de fumar en la cama*),
//      accent-stripped (*Hadriana en todos mis suenos*), truncated (*Emily
//      wilde's encyclopedia*) or simply mistyped (*En la tierra somos
//      fuzgazmente grandiosos*), a prefix match on an English label finds
//      nothing, and "nothing" was being reported as "no answer" rather than as
//      "never searched properly".
//
// So the candidate set is now the union of three lookups, deduplicated:
//
//   a. wbsearchentities in English — precise, cheap, and right for the
//      Anglophone majority of the catalog.
//   b. wbsearchentities in the row's OWN language, when `books.language` says
//      it is not English. This column is at zero nulls as of this release,
//      which is what makes the second lookup possible at all — the Spanish
//      label of a Spanish novel is the one a Spanish title will match.
//   c. CirrusSearch full text (`action=query&list=search`) on title + author.
//      Not prefix-bound, not label-bound, and tolerant of the accent and typo
//      damage above. It is the loosest of the three, which is fine, because
//      loosening the SEARCH does not loosen the ANSWER: every candidate still
//      has to be corroborated by the author before it may write anything.
//
// TWO PROPERTIES, AND P407 IS THE ONE THAT ANSWERS
//
// P364 is "original language of film, TV show, novel, musical work or web
// series" and reads like the exactly-right property. In practice it is a
// film-and-television property: across the first 50 catalog rows it answered
// **zero** times and P407 ("language of work or name") answered fourteen. The
// original framing in this file had it the other way round and was wrong.
//
// P364 still wins where both are present — it is the more specific claim — but
// the working assumption is now that a novel carries P407 and nothing else.
//
// THE DISTINCTION THAT MATTERS, AND THE MISTAKE IT ALREADY CAUSED
//
// On a WORK item, P407 is the language of the work, which is the original
// language. On an EDITION item (P31 = Q3331189, "version, edition or
// translation") it is the language of THAT PRINTING — which is
// `books.language`, the one thing this column exists to be different from.
//
// Q3331189 was in the written-work whitelist in the first version of this file,
// and the diagnose run caught it: *Cress* came back "en vs sv" and *Carpe
// Jugulum* "en vs cs", because a Swedish and a Czech edition item each stated
// its own language and both were corroborated by the right author. They were
// reported as conflicts rather than written, so nothing was corrupted — but the
// same pair on a row where only the translation item was found would have
// written `sv` for an English novel, silently and permanently.
//
// Editions are no longer treated as works. They are FOLLOWED: P629 ("edition or
// translation of") points at the work, and the work's own language claim is the
// answer. That turns those two conflicts into agreements and, more usefully,
// turns a translation item from a hazard into a route to the right answer.

const WD_API = 'https://www.wikidata.org/w/api.php';

// P31 classes that make an item a written work rather than a film, album or
// video game. Only consulted for the P407 fallback — P364 needs no such
// whitelist, because a desert does not have an original language.
const WRITTEN_WORK_CLASSES = new Set([
  'Q7725634',   // literary work
  'Q47461344',  // written work
  'Q571',       // book
  'Q8261',      // novel
  'Q149537',    // novella
  'Q49084',     // short story
  'Q1279564',   // short story collection
  'Q1667921',   // novel series
  'Q25379',     // play
  'Q5185279',   // poem
  'Q37484',     // epic poem
  'Q1004',      // comics
  'Q1760610',   // comic book
  'Q725377',    // graphic novel
  'Q8274',      // manga
  'Q234460',    // text
  'Q690851',    // essay collection
  'Q35760',     // essay
  'Q17518461',  // autobiography-ish
  'Q6473911',   // memoir
]);

const langCodeCache = new Map();   // language QID  → 639-1 code | null
const authorNameCache = new Map(); // author QID    → [labels + aliases]

// P218 is the ISO 639-1 code on a language item. Not every language item has
// one (many smaller languages only have 639-3, P220), and a language with no
// 639-1 code cannot be stored in a column documented as holding the BCP-47
// primary subtag — so it resolves to null and the row is left alone rather
// than being given a code the rest of the app cannot read.
async function resolveLanguageCodes(qids) {
  const want = [...new Set(qids)].filter((q) => q && !langCodeCache.has(q));
  for (let i = 0; i < want.length; i += 50) {
    const batch = want.slice(i, i + 50);
    const url = `${WD_API}?action=wbgetentities&ids=${batch.join('|')}&props=claims&format=json&formatversion=2`;
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
// where the other spellings live, and skipping it rejects correct matches.
const NAME_LANGS = 'en|es|pt|fr|de|it|ca|gl';

async function resolveAuthorNames(qids) {
  const want = [...new Set(qids)].filter((q) => q && !authorNameCache.has(q));
  for (let i = 0; i < want.length; i += 50) {
    const batch = want.slice(i, i + 50);
    const url =
      `${WD_API}?action=wbgetentities&ids=${batch.join('|')}` +
      `&props=labels|aliases&languages=${NAME_LANGS}&format=json&formatversion=2`;
    const data = await getJson(url);
    if (data === FAILED || !data?.entities) { batch.forEach((q) => authorNameCache.set(q, [])); continue; }
    for (const q of batch) {
      const ent = data.entities[q];
      const names = [];
      for (const l of Object.values(ent?.labels || {})) {
        if (typeof l === 'string') names.push(l);
        else if (l?.value) names.push(l.value);
      }
      for (const arr of Object.values(ent?.aliases || {})) {
        for (const a of arr || []) {
          if (typeof a === 'string') names.push(a);
          else if (a?.value) names.push(a.value);
        }
      }
      authorNameCache.set(q, names);
    }
    await sleep(200);
  }
}

// (a) and (b): label/alias prefix search, in one language.
async function wbSearch(term, lang) {
  const url =
    `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(term)}` +
    `&language=${encodeURIComponent(lang)}&uselang=${encodeURIComponent(lang)}` +
    `&type=item&limit=8&format=json&formatversion=2`;
  const data = await getJson(url);
  if (data === FAILED) return FAILED;
  return (data?.search || []).map((s) => s.id).filter(Boolean);
}

// (c): CirrusSearch full text. Tolerant of the accent damage, truncation and
// typos that (a) and (b) cannot see past. Deliberately includes the author in
// the query string — not as a filter, which would be a gate, but as ranking
// evidence, so the right item is inside the eight we look at.
async function cirrusSearch(title, author) {
  const q = `${title} ${author || ''}`.trim();
  const url =
    `${WD_API}?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
    `&srnamespace=0&srlimit=8&format=json&formatversion=2`;
  const data = await getJson(url);
  if (data === FAILED) return FAILED;
  return (data?.query?.search || []).map((s) => s.title).filter((t) => /^Q\d+$/.test(t || ''));
}

/**
 * The union of all three searches, deduplicated and capped.
 *
 * A FAILED from any one strategy is not fatal — the others may still answer —
 * but if EVERY strategy failed there is nothing to distinguish that from a book
 * nobody has heard of, so the caller is told.
 */
async function searchCandidates(title, author, rowLanguage) {
  const seen = new Set();
  let anyOk = false;

  const add = (r) => {
    if (r === FAILED) return;
    anyOk = true;
    for (const q of r) seen.add(q);
  };

  add(await wbSearch(title, 'en'));
  await sleep(150);

  const own = (rowLanguage || '').slice(0, 2).toLowerCase();
  if (own && own !== 'en') {
    add(await wbSearch(title, own));
    await sleep(150);
  }

  add(await cirrusSearch(title, author));
  await sleep(150);

  if (!anyOk) return FAILED;
  return [...seen].slice(0, 14);
}

async function fetchClaims(qids) {
  const out = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const url =
      `${WD_API}?action=wbgetentities&ids=${batch.join('|')}` +
      `&props=claims|labels&languages=${NAME_LANGS}&format=json&formatversion=2`;
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

const entityLabel = (ent) => {
  const l = ent?.labels?.en;
  if (typeof l === 'string') return l;
  if (l?.value) return l.value;
  const any = Object.values(ent?.labels || {})[0];
  return (typeof any === 'string' ? any : any?.value) || '(no label)';
};

const EDITION_CLASS = 'Q3331189';   // version, edition or translation

const isEdition = (ent) => claimQids(ent, 'P31').includes(EDITION_CLASS);

// The language claims an item offers, best property first.
//
// P364 always wins. P407 is accepted only from an item that declares itself a
// written work — on a film it is the film's language, and on an edition it is
// the printing's, which is the one thing this column must never be.
function languageClaims(ent) {
  const p364 = claimQids(ent, 'P364');
  if (p364.length) return { qids: p364, prop: 'P364' };
  const p407 = claimQids(ent, 'P407');
  if (!p407.length) return null;
  const types = claimQids(ent, 'P31');
  if (!types.some((t) => WRITTEN_WORK_CLASSES.has(t))) return null;
  return { qids: p407, prop: 'P407' };
}

/**
 * Replace every edition item in the candidate map with the WORK it is an
 * edition of, via P629.
 *
 * One extra batched fetch, and it is the fetch that makes translation items
 * useful instead of dangerous: a Swedish edition of an English novel now
 * contributes "en" — the work's language — rather than "sv".
 *
 * The edition's own author claims go with it. The work carries them, and
 * corroborating against the work is the stricter of the two anyway.
 */
async function resolveEditionsToWorks(entities) {
  const workQids = [];
  for (const ent of entities.values()) {
    if (isEdition(ent)) workQids.push(...claimQids(ent, 'P629'));
  }
  if (!workQids.length) return entities;

  const fresh = [...new Set(workQids)].filter((q) => !entities.has(q));
  const works = fresh.length ? await fetchClaims(fresh) : new Map();

  const out = new Map();
  for (const [qid, ent] of entities) {
    if (!isEdition(ent)) { out.set(qid, ent); continue; }
    for (const wq of claimQids(ent, 'P629')) {
      const w = entities.get(wq) || works.get(wq);
      if (w) out.set(wq, w);
    }
  }
  return out;
}

/**
 * Resolve one row to a 639-1 code via Wikidata.
 *
 * Returns one of:
 *   { code, source, qid }        a verified answer
 *   { conflict: [codes], qid }   two corroborated candidates disagreed
 *   { stage: '…' }               no answer, and where in the funnel it stopped
 *   FAILED                       every search strategy failed
 *
 * The `stage` is the point of this shape. "no answer" is five different
 * outcomes wearing one number, and the first dry run of this script reported 48
 * of them without saying which — the same shape of report the 2026-08-17
 * postmortem is about. --diagnose aggregates these.
 */
async function wikidataOriginalLanguage(title, author, rowLanguage) {
  // Most specific title form first; a reduction is only reached when the
  // precise one found nothing. searchTitles() explains why reducing is safe for
  // a SEARCH where titleMatch.js forbids it for a MATCH.
  const forms = searchTitles(title);
  let best = { stage: 'no-search-hits' };

  for (let i = 0; i < forms.length; i++) {
    const attempt = await resolveOneTitle(forms[i], author, rowLanguage);
    if (attempt === FAILED) return FAILED;
    if (attempt?.code || attempt?.conflict) {
      if (i > 0) attempt.viaTitle = forms[i];
      return attempt;
    }
    // Keep the most INFORMATIVE failure rather than the last one. "No hits at
    // all" is a less useful report than "found the book, nobody says who wrote
    // it", and the funnel is only worth reading if it says the second.
    if (STAGE_RANK[attempt.stage] > STAGE_RANK[best.stage]) best = attempt;
  }
  return best;
}

// How far down the funnel a failure got. A later stage means the search worked
// and something else stopped it, which is the more actionable thing to report.
const STAGE_RANK = {
  'no-search-hits': 0,
  'entities-unfetchable': 1,
  'no-language-property': 2,
  'author-not-corroborated': 3,
  'no-iso-639-1-code': 4,
};

async function resolveOneTitle(title, author, rowLanguage) {
  const qids = await searchCandidates(title, author, rowLanguage);
  if (qids === FAILED) return FAILED;
  if (!qids.length) return { stage: 'no-search-hits' };

  let entities = await fetchClaims(qids);
  if (!entities.size) return { stage: 'entities-unfetchable' };
  entities = await resolveEditionsToWorks(entities);

  // Only candidates that state a language are worth the author lookups that
  // verification costs.
  const withLang = [];
  for (const [qid, ent] of entities) {
    const lc = languageClaims(ent);
    if (lc) withLang.push({ qid, ent, ...lc });
  }
  if (!withLang.length) return { stage: 'no-language-property' };

  const authorQids = withLang.flatMap((c) => [...claimQids(c.ent, 'P50'), ...claimQids(c.ent, 'P170')]);
  await resolveAuthorNames(authorQids);

  const accepted = [];
  for (const c of withLang) {
    // P50 is the author item; P2093 is the "author name string" used where no
    // item exists for the person; P170 is "creator", which is what comics and
    // anthologies carry where a novel would carry P50 — *Batman: The Long
    // Halloween* and *X-Men: Days of Future Past* both failed corroboration on
    // P50 alone. All three are the same kind of evidence: a name the item
    // itself asserts, which either matches this row's author or does not.
    const names = [
      ...claimQids(c.ent, 'P50').flatMap((aq) => authorNameCache.get(aq) || []),
      ...claimQids(c.ent, 'P170').flatMap((aq) => authorNameCache.get(aq) || []),
      ...claimStrings(c.ent, 'P2093'),
    ];
    if (!names.length) continue;
    if (!names.some((n) => authorLikelySame(author, n))) continue;
    accepted.push(c);
  }
  if (!accepted.length) return { stage: 'author-not-corroborated' };

  await resolveLanguageCodes(accepted.flatMap((a) => a.qids));

  // P364 outranks P407 outright: if any corroborated candidate states P364, the
  // P407 answers are not even consulted. Mixing them is how a work item and an
  // edition item of the same book turn into a "conflict" that is really just
  // two properties meaning two different things.
  const best = accepted.some((a) => a.prop === 'P364')
    ? accepted.filter((a) => a.prop === 'P364')
    : accepted;

  const codes = new Set();
  for (const a of best) for (const lq of a.qids) {
    const c = langCodeCache.get(lq);
    if (c) codes.add(c);
  }
  if (!codes.size) return { stage: 'no-iso-639-1-code' };
  if (codes.size > 1) return { conflict: [...codes], qid: best[0].qid };
  return {
    code: [...codes][0],
    source: best[0].prop === 'P407' ? 'wikidata_p407' : 'wikidata',
    qid: best[0].qid,
  };
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
// Per-source breaker, the pattern isbnFallback.mjs already uses. OpenLibrary is
// the lowest-yield of the three sources and by far the most expensive to fail:
// up to 90s of backoff for a row Wikidata has usually already answered. Five
// consecutive failures is an outage, and an outage is not worth the budget.
let olFailures = 0;
let olDead = false;

async function openLibraryTranslatedFrom(isbn) {
  if (olDead) return FAILED;
  const data = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
  if (data === FAILED) {
    if (++olFailures >= 5) {
      olDead = true;
      console.log('  ! OpenLibrary disabled for the rest of this run: 5 consecutive request failures.');
      console.log('    Wikidata and the offline propagation pass are unaffected. Rows that only');
      console.log('    OpenLibrary could have answered are NOT stamped, so they stay in the queue.');
    }
    return FAILED;
  }
  olFailures = 0;
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
  // "Title|Author" or "Title|Author|es" — the third field is the row's own
  // language, which the real run reads from books.language and which decides
  // whether a second, native-language label search happens.
  const [pTitle, pAuthor, pLang] = String(PROBE).split('|').map((s) => (s || '').trim());
  if (!pTitle) {
    console.error('Usage: --probe "Title|Author"');
    process.exit(1);
  }
  console.log(`probe: title="${pTitle}" author="${pAuthor || '(none)'}"`);
  console.log(`  normalised title : ${normTitleLoose(pTitle)}`);
  console.log(`  normalised author: ${normPerson(pAuthor)}${isPlaceholderAuthor(pAuthor) ? '   [PLACEHOLDER — a real row here would be skipped]' : ''}`);

  const qids = await searchCandidates(pTitle, pAuthor, pLang);
  console.log(`  wikidata search  : ${qids === FAILED ? 'ALL STRATEGIES FAILED' : (qids.join(', ') || '(no hits)')}`);

  if (qids !== FAILED && qids.length) {
    const ents = await fetchClaims(qids);
    for (const [qid, ent] of ents) {
      const label = ent?.labels?.en?.value || '(no en label)';
      const lc = languageClaims(ent);
      if (!lc) {
        const types = claimQids(ent, 'P31').join(',') || 'no P31';
        console.log(`    ${qid}  ${label}  — no usable language property (${types}), discarded`);
        continue;
      }
      const aQids = claimQids(ent, 'P50');
      await resolveAuthorNames(aQids);
      await resolveLanguageCodes(lc.qids);
      const names = [...aQids.flatMap((a) => authorNameCache.get(a) || []), ...claimStrings(ent, 'P2093')];
      const ok = pAuthor && names.some((n) => authorLikelySame(pAuthor, n));
      const codes = lc.qids.map((l) => langCodeCache.get(l) || '?').join('/');
      console.log(`    ${qid}  ${label}  ${lc.prop}=${codes}  authors=[${names.slice(0, 4).join(', ')}]  → ${ok ? 'ACCEPTED' : 'discarded (author not corroborated)'}`);
    }
  }

  const verdict = pAuthor ? await wikidataOriginalLanguage(pTitle, pAuthor, pLang) : null;
  console.log(`  verdict          : ${
    verdict === FAILED ? 'ALL SEARCH STRATEGIES FAILED'
      : verdict?.conflict ? `CONFLICT ${verdict.conflict.join(' vs ')} — would write nothing`
      : verdict?.code ? `${verdict.code}  (${verdict.source})`
      : verdict?.stage ? `no answer — stopped at: ${verdict.stage}`
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
  stamped: 0, notStamped: 0,
};

// The funnel. Every row that produces no answer lands in exactly one of these,
// and the distribution is the difference between "Wikidata does not have these
// books" and "we are not asking Wikidata properly".
const funnel = {
  'resolved': 0,
  'resolved-via-openlibrary': 0,
  'placeholder-author': 0,
  'search-failed': 0,
  'no-search-hits': 0,
  'entities-unfetchable': 0,
  'no-language-property': 0,
  'author-not-corroborated': 0,
  'no-iso-639-1-code': 0,
  'conflict': 0,
};
const bump = (k) => { funnel[k] = (funnel[k] || 0) + 1; };
const conflicts = [];
const disagreements = [];
const bySource = { wikidata: 0, wikidata_p407: 0, openlibrary: 0, catalog_sibling: 0 };

// How many answers needed a title form other than the one the catalog stores.
// If this is high, the catalog's titles are carrying Goodreads series
// annotation that belongs in `series` and `position_in_series`, and the real
// fix is upstream in the importer rather than here.
let reducedTitleHits = 0;

// KEYSET pagination by id, not offset — for the reason languageBackfill.mjs
// documents at length: a live run changes which rows match the filter, while
// the rows this script deliberately skips keep matching forever, so an offset
// window re-serves the unresolvable rows and the loop never ends.
const PAGE = 200;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const SELECT_COLS = 'id, title, author, isbn, language, original_language, original_language_source, original_language_checked_at, hardcover_id, goodreads_id';
// Without the stamp column. Kept so a database that predates 20260819180000
// still runs, degraded and loudly, rather than crashing mid-pagination.
const SELECT_COLS_LEGACY = 'id, title, author, isbn, language, original_language, original_language_source, hardcover_id, goodreads_id';

// Set when the database predates 20260819180000. See detectStampColumn().
let stampColumnMissing = false;

/**
 * Is books.original_language_checked_at there?
 *
 * Checked once, up front, rather than discovered as a PostgREST error on the
 * first page — because the error a missing column produces is
 * `column books.original_language_checked_at does not exist`, thrown from
 * inside the pagination loop, after the operator has already walked away from a
 * run they expected to take four hours.
 *
 * The fallback is the old behaviour: filter on the value, stamp nothing. That
 * is strictly worse — the queue stops draining — but it is a working script
 * rather than a crash, and it says so in words. A tool that refuses to run
 * because of an unapplied migration is correct exactly once and infuriating
 * every other time; a tool that runs degraded and tells you why is neither.
 */
async function detectStampColumn() {
  const { error } = await supabase
    .from('books')
    .select('id, original_language_checked_at')
    .limit(1);
  if (!error) return;
  if (!/original_language_checked_at/.test(error.message || '')) throw new Error(`select failed: ${error.message}`);

  stampColumnMissing = true;
  console.log('  ! books.original_language_checked_at does not exist.');
  console.log('    Migration 20260819180000_original_language_checked_at.sql has not been applied.');
  console.log('    Running in v0.64 mode: the queue is "original_language IS NULL", nothing is');
  console.log('    stamped, and rows that no free source can answer will be re-examined on every');
  console.log('    future run. Apply the migration before this goes on the weekly cron.\n');
}

async function fetchAfter(lastId, gapsOnly) {
  let q = supabase
    .from('books')
    .select(stampColumnMissing ? SELECT_COLS_LEGACY : SELECT_COLS)
    .gt('id', lastId)
    .order('id')
    .limit(PAGE);
  // THE QUEUE, and why it is keyed on the STAMP rather than on the value.
  //
  // `original_language IS NULL` looks like the right filter and does not
  // terminate: about 60% of what this script examines is books Wikidata
  // genuinely does not have, they stay NULL, and they stay eligible forever.
  // On a weekly cron that is the same ~2,000 rows re-asked every Monday, and a
  // report that never shrinks.
  //
  // `original_language_checked_at IS NULL` is "never asked", which drains.
  // --recheck falls back to the value filter for the rare deliberate sweep.
  if (gapsOnly) {
    q = (RECHECK || stampColumnMissing)
      ? q.is('original_language', null)
      : q.is('original_language_checked_at', null);
  }
  const { data, error } = await q;
  if (error) throw new Error(`select failed: ${error.message}`);
  return data || [];
}

async function writeAnswer(row, code, source) {
  if (DRY_RUN) return true;
  const { error } = await supabase
    .from('books')
    .update({
      original_language: code,
      original_language_source: source,
      ...(stampColumnMissing ? {} : { original_language_checked_at: new Date().toISOString() }),
    })
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

/**
 * Record that this row was asked, whatever the answer was.
 *
 * Written PER ROW rather than batched at the end, deliberately. The 2026-08-17
 * postmortem's second root cause was a run cancelled at [187/971] whose
 * per-book writes survived and whose end-of-run outputs did not; the 98 books
 * that kept their answers kept them because the write was immediate. A batched
 * stamp flushed on completion would lose the whole run's queue progress to one
 * timeout, and this script's whole budget problem is that it is slow.
 *
 * shouldStampChecked() is what decides. It refuses `search-failed` and
 * `entities-unfetchable`, because those mean the row was attempted rather than
 * asked, and stamping an outage records it as a verdict.
 */
async function stampChecked(row, stage) {
  if (DRY_RUN || stampColumnMissing || !shouldStampChecked(stage)) return;
  const { error } = await supabase
    .from('books')
    .update({ original_language_checked_at: new Date().toISOString() })
    .eq('id', row.id);
  if (error) {
    stats.failed++;
    console.log(`  STAMP FAILED "${row.title}": ${error.message}`);
    return;
  }
  stats.stamped++;
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

await detectStampColumn();

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
      if (outOfTime()) {
        stoppedEarly = true;
        done = true;
        console.log(`\n  ! Budget of ${MAX_MINUTES} min reached after ${stats.examined} row(s). Stopping cleanly.`);
        console.log('    Every answer and every stamp is written per-row, so a re-run resumes from');
        console.log('    here: the query selects only rows that were never asked. Propagation and the');
        console.log('    summary still run below, which is the point of stopping instead of being killed.');
        break;
      }
      lastId = row.id;
      stats.examined++;
      abortIfSourceIsDown();

      const label = `"${row.title}"${row.author ? ' — ' + row.author : ''}`;

      if (isPlaceholderAuthor(row.author)) {
        stats.noAuthor++;
        bump('placeholder-author');
        // Stamped. Not searching this row is a DECISION, and it will be the
        // same decision next week unless the author is fixed in-app — at which
        // point the row is edited and can be re-queued deliberately.
        await stampChecked(row, 'placeholder-author');
        vlog(`no usable author ${label} — not searched`);
        continue;
      }

      let code = null;
      let source = null;

      // books.language is at zero nulls as of this release, which is what lets
      // the search look for a Spanish title under its Spanish label.
      const wd = await wikidataOriginalLanguage(row.title, row.author, row.language);
      await sleep(250);
      if (wd === FAILED) {
        bump('search-failed');
        stats.notStamped++;
        vlog(`wikidata unreachable for ${label} — NOT stamped, will be re-asked`);
      } else if (wd?.stage) {
        bump(wd.stage);
        if (DIAGNOSE) console.log(`  ${wd.stage.padEnd(26)} ${label}`);
      } else if (wd?.conflict) {
        stats.conflict++;
        bump('conflict');
        conflicts.push({ id: row.id, title: row.title, author: row.author, codes: wd.conflict, qid: wd.qid });
        // Stamped: a conflict is an answer of a kind — the free sources have
        // spoken and they disagree. Re-asking produces the same disagreement.
        // It stays in the conflicts report, which is where a human sees it.
        await stampChecked(row, 'conflict');
        vlog(`CONFLICT ${label}: ${wd.conflict.join(' vs ')} — skipped`);
        continue;
      } else if (wd?.code) {
        code = wd.code;
        source = wd.source || 'wikidata';
        bump('resolved');
        if (wd.viaTitle) {
          reducedTitleHits++;
          vlog(`found via reduced title "${wd.viaTitle}" (row title: "${row.title}")`);
        }
        if (DIAGNOSE) console.log(`  ${('resolved ' + code + ' (' + source + ')').padEnd(26)} ${label}   ${wd.qid}`);
      }

      if (!code) {
        const isbn = cleanIsbn(row.isbn);
        if (isbn && isValidIsbn(isbn)) {
          const ol = await openLibraryTranslatedFrom(isbn);
          await sleep(300);
          if (ol && ol !== FAILED) {
            code = ol;
            source = 'openlibrary';
            bump('resolved-via-openlibrary');
            if (DIAGNOSE) console.log(`  ${('resolved ' + code + ' (openlibrary)').padEnd(26)} ${label}`);
          }
        }
      }

      if (!code) {
        stats.noAnswer++;
        // The stage carries whether this was an answer ("Wikidata has no such
        // item") or a fault ("the request failed"). Only the first stamps.
        await stampChecked(row, wd === FAILED ? 'search-failed' : (wd?.stage || 'no-search-hits'));
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
console.log(`  via wikidata P364 ${bySource.wikidata}`);
console.log(`  via wikidata P407 ${bySource.wikidata_p407}`);
console.log(`  via openlibrary   ${bySource.openlibrary}`);
if (reducedTitleHits) {
  console.log(`  (${reducedTitleHits} of those needed a reduced title — series annotation or a subtitle`);
  console.log('   in books.title that Wikidata does not carry. High counts here are an importer');
  console.log('   problem, not a lookup problem.)');
}
console.log(`propagated      ${stats.propagated}   — copied from a sibling row of the same work`);
console.log(`no usable author ${stats.noAuthor}   — null or placeholder; a title match could not be verified`);
console.log(`no answer       ${stats.noAnswer}   — searched, nothing corroborated; left NULL for the Oracle`);
console.log(`conflicts       ${stats.conflict}   — two verified candidates disagreed; left NULL on purpose`);
if (ALL) {
  console.log(`confirmed       ${stats.confirmed}   — already set, and re-checking agreed`);
  console.log(`disagreed       ${stats.disagreed}   — already set, and re-checking did not${FORCE ? ' (applied, except where protected)' : ' (left alone)'}`);
  if (stats.protected) console.log(`protected       ${stats.protected}   — human-sourced; --force does not reach these`);
}
console.log(`stamped         ${stats.stamped}   — recorded as asked; these leave the queue for good`);
if (stats.notStamped) {
  console.log(`NOT stamped     ${stats.notStamped}   — the request failed, so the row was attempted, not asked.`);
  console.log('                     Deliberately left in the queue. An outage is not a verdict.');
}
if (stats.failed) console.log(`write failures  ${stats.failed}`);

// THE FUNNEL. A single "no answer" count is five different outcomes wearing
// one number, and telling them apart is the difference between "Wikidata does
// not have these books" (nothing to do) and "we are not asking properly" (a
// bug). Always printed, not just under --diagnose: the number it replaces was
// the misleading one.
if (!PROPAGATE_ONLY) {
  const EXPLAIN = {
    'resolved': 'answered by Wikidata',
    'resolved-via-openlibrary': 'answered by OpenLibrary translated_from',
    'placeholder-author': 'author is null or a placeholder — never searched',
    'search-failed': 'every search strategy errored — a fault, not a gap',
    'no-search-hits': 'searched three ways, Wikidata has no such item',
    'entities-unfetchable': 'search found ids the entity fetch could not load',
    'no-language-property': 'items found, none state P364 or a usable P407',
    'author-not-corroborated': 'items state a language, none are by this author',
    'no-iso-639-1-code': 'language item has no ISO 639-1 code to store',
    'conflict': 'two corroborated candidates disagreed',
  };
  console.log('\n── funnel ────────────────────────────────');
  for (const [k, v] of Object.entries(funnel)) {
    if (!v) continue;
    console.log(`  ${String(v).padStart(5)}  ${k.padEnd(26)} ${EXPLAIN[k] || ''}`);
  }
  const bad = funnel['search-failed'] + funnel['entities-unfetchable'];
  if (bad > stats.examined / 4) {
    console.log('\n  ! More than a quarter of rows failed at the REQUEST level.');
    console.log('    That is a broken connection, not a data gap. Do not read the');
    console.log('    numbers above as coverage. Check the API error lines further up.');
  }
}

// A machine-readable line, in the format .github/workflows/catalog-maintenance.yml
// reads for its summary. The workflow was changed in v0.64 to count these rather
// than to count rows in a CSV, because a CSV that was never written counted as
// zero and rendered as "nothing to do".
console.log(
  `\n[originalLanguageBackfill] examined=${stats.examined} written=${stats.written} ` +
  `propagated=${stats.propagated} wikidata=${bySource.wikidata} openlibrary=${bySource.openlibrary} ` +
  `p407=${bySource.wikidata_p407} sibling=${bySource.catalog_sibling} ` +
  `noauthor=${stats.noAuthor} noanswer=${stats.noAnswer} ` +
  `reducedtitle=${reducedTitleHits} stamped=${stats.stamped} notstamped=${stats.notStamped} ` +
  `nohits=${funnel['no-search-hits']} nolangprop=${funnel['no-language-property']} ` +
  `noauthormatch=${funnel['author-not-corroborated']} searchfailed=${funnel['search-failed']} ` +
  `conflict=${stats.conflict} failed=${stats.failed} dryrun=${DRY_RUN ? 1 : 0} ` +
  `elapsedmin=${elapsedMin()} oldead=${olDead ? 1 : 0} complete=${stoppedEarly ? 0 : 1}`
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
  : RECHECK
    ? '\nRe-checked rows that were asked before and came back empty (--recheck).'
    : '\nRe-run safely at any time: only rows never asked are touched, so the queue shrinks.');
console.log('Rows left NULL are still eligible for the nightly Oracle pass, which is the point —');
console.log('this script fills what a free source can state, and does not pretend to the rest.');
