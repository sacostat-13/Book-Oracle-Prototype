// metadataBackfill.mjs — v1
//
// Fills books.description and books.genre from free APIs. Never calls Claude.
//
// WHY THIS EXISTS
//
// 682 books have a cover but no description, so The Stacks flips them over to
// "Description not available". The obvious fix — point curateManualBooks or
// oracleBatch at them — bills Anthropic for text that Hardcover, Open Library
// and Google Books all hand out for nothing. Worse, a model can invent a plot
// summary; those three cannot.
//
// The rule this script encodes: Claude is for judgment, not retrieval. A
// description is a fact somebody has already written down. Recommendations,
// reading plans and memory synthesis are not. Spend the budget there.
//
// Descriptions and genres are backfilled together on purpose. Both are read
// out of the SAME three API responses, so doing them in one pass costs one set
// of requests instead of two. The `--target` flag still lets you run either
// alone.
//
// GENRE INFERENCE
//
// The taxonomy is bespoke (136 genres as of v0.63), so no API returns it
// directly — which is what made this look like a job for a model. It isn't.
// All three sources return raw subject/tag lists, and a keyword table maps
// those onto the canonical names deterministically. See
// _shared/genreRules.mjs. Books matching no rule are left null and written to
// genre-unmatched.csv rather than guessed at.
//
// v0.63, three changes:
//   - MULTI-GENRE. Every genre clearing the threshold is linked into
//     book_genres, not just the winner. books.genre keeps the top pick because
//     it is a scalar column other code still reads.
//   - UMBRELLAS. The parent from public.genres.parent_id is attached alongside
//     the specific genre, so a folk horror novel is on both shelves.
//   - SUBJECTS ARE CACHED to books.source_subjects. The rule table will be
//     edited repeatedly now that it has 136 targets, and without a cache every
//     edit means re-fetching the whole catalogue over HTTP. With one,
//     manual/regenreCatalog.mjs re-applies the rules offline in seconds.
//
// Usage:
//   node batch-scripts/metadataBackfill.mjs
//   node batch-scripts/metadataBackfill.mjs --target description
//   node batch-scripts/metadataBackfill.mjs --target genre
//   node batch-scripts/metadataBackfill.mjs --dry-run --verbose --limit 20
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   HARDCOVER_API_TOKEN  (optional — the other two sources still work without)
//   GOOGLE_BOOKS_API_KEY (optional — Google Books allows anonymous use, rate-limited)

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import {
  GENRE_RULES,
  MAX_GENRES_PER_BOOK,
  inferGenre,
  inferAllGenres,
  explainGenre,
  findGenreDrift,
  withUmbrellas,
} from '../_shared/genreRules.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function argValue(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  return a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
}

const TARGET = (argValue('--target', 'both') || 'both').toLowerCase();
if (!['description', 'genre', 'both'].includes(TARGET)) {
  console.error(`Unknown --target "${TARGET}". Use description, genre or both.`);
  process.exit(1);
}
const WANT_DESC = TARGET === 'description' || TARGET === 'both';
const WANT_GENRE = TARGET === 'genre' || TARGET === 'both';

const LIMIT = Number.parseInt(argValue('--limit', ''), 10) || null;
const DELAY_MS = Number.parseInt(argValue('--delay', ''), 10) || 400;

// Below this, a "description" is a stub — a single line of catalog boilerplate
// rather than anything worth flipping a card to read.
const MIN_DESCRIPTION_CHARS = 40;

// ── Not asking the same question every night ─────────────────────────────────
//
// A book none of the three sources can answer used to be re-queried on every
// run, forever. The 2026-08-12 run reported nothingFound=186 — 186 books × 3
// HTTP calls × a 400ms delay, all of it guaranteed to produce nothing, and all
// of it eating the --limit budget that should go to books the sources CAN
// answer. The queue could never drain because its head was permanently
// occupied.
//
// Backoff rather than a tombstone. Open Library in particular gains records
// constantly, so a book with nothing today may have a description in three
// months; a permanent "dead" flag would need clearing by hand and never would
// be. Time heals this on its own.
//
// The interval widens with each consecutive empty result. A book that has come
// back empty once might just have had a bad title match; one that has come back
// empty six times is not in these sources under the title we hold.
const RETRY_DAYS = [1, 7, 30, 60, 90];      // by attempt count, then capped
const MAX_ATTEMPTS = 6;                      // at/above this, stop asking entirely

function retryDueAt(attempts) {
  const days = RETRY_DAYS[Math.min(attempts, RETRY_DAYS.length - 1)];
  return days * 24 * 60 * 60 * 1000;
}

// Is this book due for another look? Never-checked books always are.
function isDue(book, now) {
  const attempts = book.metadata_attempts ?? 0;
  if (attempts >= MAX_ATTEMPTS) return false;
  if (!book.metadata_checked_at) return true;
  const last = Date.parse(book.metadata_checked_at);
  if (Number.isNaN(last)) return true;
  return now - last >= retryDueAt(attempts);
}

// -- Env ----------------------------------------------------------------------
const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const SUPABASE_URL = env['VITE_SUPABASE_URL'] || '';
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || env['VITE_HARDCOVER_TOKEN'] || '';
const GOOGLE_KEY = env['GOOGLE_BOOKS_API_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

// -- Helpers ------------------------------------------------------------------
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\/.*$/, '')
    .trim();
}

function cleanAuthor(a) {
  return (a || '').split(/[,&]|\sand\s/i)[0].trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (msg) => { if (VERBOSE) process.stdout.write('    ' + msg + '\n'); };

// Descriptions arrive as HTML from some sources and as Open Library's
// {type, value} record from others. Normalise to plain text, and reject the
// boilerplate that is worse than showing nothing.
function normaliseDescription(raw) {
  let text = raw;
  if (!text) return null;
  if (typeof text === 'object') text = text.value || '';
  if (typeof text !== 'string') return null;

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Open Library descriptions often end with a source credit line.
    .replace(/\(\s*source:.*?\)\s*$/is, '')
    .replace(/^\s*\[?source:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < MIN_DESCRIPTION_CHARS) return null;
  // Publisher filler that says nothing about the book.
  if (/^(no description|description not available|n\/?a)\b/i.test(text)) return null;
  return text;
}

// ── Genre inference ──────────────────────────────────────────────────────────
//
// Moved to batch-scripts/_shared/genreRules.mjs in v0.63. The table outgrew
// this file when the taxonomy went from 49 usable targets to 136, and
// manual/regenreCatalog.mjs needs exactly the same rules — two scripts writing
// the same table from two drifting copies of one rule set is a bug that takes
// months to surface.
//
// Everything about the scoring, the weights and why it is not first-match-wins
// is documented there.
// ── Source 1: Hardcover ──────────────────────────────────────────────────────
// Best source by a distance: it is where the crawl already gets descriptions,
// so its coverage of this catalog is high and its text is already the house
// style. cached_tags carries the Genre list too.
const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';

const HC_QUERY = `
  query FindBook($title: String!) {
    books(
      where: { title: { _ilike: $title } }
      order_by: { users_read_count: desc }
      limit: 5
    ) {
      title
      description
      cached_tags
      contributions(limit: 1) { author { name } }
    }
  }
`;

async function tryHardcover(title, author) {
  if (!HARDCOVER_TOKEN) return { description: null, subjects: [] };
  try {
    const res = await fetch(HARDCOVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: HARDCOVER_TOKEN.startsWith('Bearer ')
          ? HARDCOVER_TOKEN
          : `Bearer ${HARDCOVER_TOKEN}`,
      },
      body: JSON.stringify({ query: HC_QUERY, variables: { title: cleanTitle(title) } }),
    });
    if (!res.ok) return { description: null, subjects: [] };
    const json = await res.json();
    const rows = json.data?.books || [];
    if (rows.length === 0) return { description: null, subjects: [] };

    // Match the author when we can. Hardcover title search is fuzzy enough that
    // taking row[0] blindly attaches the wrong book's blurb — the single worst
    // failure mode available to this script, because it looks like success.
    const wanted = cleanAuthor(author).toLowerCase();
    const hit = rows.find((r) => {
      const got = (r.contributions?.[0]?.author?.name || '').toLowerCase();
      return wanted && got && (got.includes(wanted) || wanted.includes(got));
    });
    if (!hit) {
      vlog(`hardcover: ${rows.length} title match(es), none by "${author}" — skipping`);
      return { description: null, subjects: [] };
    }

    const tags = hit.cached_tags?.Genre || [];
    const subjects = tags.map((t) => t?.tag).filter(Boolean);
    return { description: hit.description || null, subjects };
  } catch (e) {
    vlog(`hardcover error: ${e.message}`);
    return { description: null, subjects: [] };
  }
}

// ── Source 2: Open Library ───────────────────────────────────────────────────
// Two calls: search gives the work key and subjects, the work record gives the
// description. Subjects here are the richest of the three — Open Library tags
// heavily, which is exactly what the genre rules want.
async function tryOpenLibrary(title, author) {
  try {
    const q = 'title=' + encodeURIComponent(cleanTitle(title)) +
      '&author=' + encodeURIComponent(cleanAuthor(author)) +
      '&fields=key,subject&limit=1';
    const res = await fetch('https://openlibrary.org/search.json?' + q);
    if (!res.ok) return { description: null, subjects: [] };
    const data = await res.json();
    const doc = data.docs?.[0];
    if (!doc) return { description: null, subjects: [] };

    const subjects = doc.subject || [];
    let description = null;

    if (doc.key) {
      await sleep(250);
      const wres = await fetch(`https://openlibrary.org${doc.key}.json`);
      if (wres.ok) {
        const work = await wres.json();
        description = work.description || null;
      }
    }
    return { description, subjects };
  } catch (e) {
    vlog(`openlibrary error: ${e.message}`);
    return { description: null, subjects: [] };
  }
}

// ── Source 3: Google Books ───────────────────────────────────────────────────
// Last because its categories are coarse ("Fiction", "Juvenile Fiction") and
// rarely trip a rule, but its descriptions are good and it covers books the
// other two miss.
async function tryGoogleBooks(title, author) {
  try {
    const q = `intitle:${cleanTitle(title)}+inauthor:${cleanAuthor(author)}`;
    const url = 'https://www.googleapis.com/books/v1/volumes?q=' +
      encodeURIComponent(q) + '&maxResults=1' +
      (GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : '');
    const res = await fetch(url);
    if (!res.ok) return { description: null, subjects: [] };
    const data = await res.json();
    const info = data.items?.[0]?.volumeInfo;
    if (!info) return { description: null, subjects: [] };
    return { description: info.description || null, subjects: info.categories || [] };
  } catch (e) {
    vlog(`googlebooks error: ${e.message}`);
    return { description: null, subjects: [] };
  }
}

// ── The chain ────────────────────────────────────────────────────────────────
// Walks all three sources rather than stopping at the first description,
// because subjects accumulate: Hardcover may answer the description while Open
// Library is the one carrying "southern gothic". Stops early only when both
// wanted fields are settled, so a description-only run stays cheap.
async function fetchMetadata(book, needDesc, needGenre) {
  const sources = [
    ['hardcover', tryHardcover],
    ['openlibrary', tryOpenLibrary],
    ['googlebooks', tryGoogleBooks],
  ];

  let description = null;
  let descriptionFrom = null;
  const subjects = [];

  for (const [name, fn] of sources) {
    if ((!needDesc || description) && (!needGenre || subjects.length > 0)) break;

    const got = await fn(book.title, book.author);
    if (needDesc && !description) {
      const clean = normaliseDescription(got.description);
      if (clean) {
        description = clean;
        descriptionFrom = name;
        vlog(`description from ${name} (${clean.length} chars)`);
      }
    }
    if (needGenre && got.subjects.length) {
      subjects.push(...got.subjects);
      // Log ALL of them, with the count.
      //
      // This used to print `.slice(0, 6)` with no indication there was more,
      // which made the dry run actively misleading: Open Library routinely
      // returns 30+ subjects, so a genre would be assigned on evidence that
      // never appeared in the output. "Old Man and the Sea → East Asian
      // Literary Fiction" looked inexplicable until you could see subject 24.
      // A diagnostic that hides the deciding input is worse than none.
      vlog(`${name} subjects (${got.subjects.length}): ${got.subjects.join(', ')}`);
    }
    await sleep(DELAY_MS);
  }

  return { description, descriptionFrom, subjects };
}

// v0.63. Which of these books already have at least one row in book_genres?
//
// PostgREST cannot express "books with no related rows" as a filter on the
// parent table, so this asks the child table directly for the ids it knows
// about and the caller treats absence as "no links". Chunked because a URL
// carrying 2,500 UUIDs in an `in.()` will be rejected long before Postgres
// sees it — the same 50-id chunking DataContext uses for the same table, for
// the same reason.
//
// Cheap: one indexed lookup per 50 books, no network beyond Supabase, and it
// runs once per invocation rather than once per book.
const LINK_CHUNK = 50;

async function fetchBooksWithGenreLinks(bookIds) {
  const linked = new Set();
  if (!bookIds || bookIds.length === 0) return linked;

  for (let i = 0; i < bookIds.length; i += LINK_CHUNK) {
    const chunk = bookIds.slice(i, i + LINK_CHUNK);
    const { data, error } = await supabase
      .from('book_genres')
      .select('book_id')
      .in('book_id', chunk);

    if (error) {
      // Failing open would mark every book as "already linked" and quietly
      // restore exactly the bug this function exists to fix. Failing closed
      // would re-infer genres for the whole catalogue. Neither is a decision
      // this function should make silently, so say so and fail closed for this
      // chunk only — the worst case is some redundant (idempotent) upserts.
      console.warn(`[metadataBackfill] genre-link lookup failed for a chunk: ${error.message}`);
      continue;
    }
    for (const row of data || []) linked.add(row.book_id);
  }
  return linked;
}

// Every genre this script can assign must exist in public.genres.
//
// The taxonomy is not fixed: Oracle categorisation creates genres on demand, so
// public.genres drifts relative to the hardcoded names in GENRE_RULES. If a
// rule target is missing from that table, this script will happily stamp it
// onto books.genre and the result is invisible — the genre picker only offers
// names from public.genres, so no reader can ever select it and none of those
// books can be genre-seeded.
//
// Checked before any writes. Reported, not enforced: a stale rule should not
// stop descriptions being backfilled, which is the larger half of this job.
// One query, three uses: ids for linking, names for the drift check, and
// parent_id for the umbrella map.
async function loadGenreCatalog() {
  const { data, error } = await supabase.from('genres').select('id, name, parent_id');
  if (error) {
    console.warn('[metadataBackfill] could not read genres table:', error.message);
    return { idByName: new Map(), parentByName: new Map() };
  }
  const rows = data || [];
  const idByName = new Map(rows.map((r) => [r.name, r.id]));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  // childName -> parentName. Built from the database rather than a second copy
  // of the hierarchy here, which would disagree with it inside a month.
  const parentByName = new Map(
    rows.filter((r) => r.parent_id && nameById.has(r.parent_id))
        .map((r) => [r.name, nameById.get(r.parent_id)])
  );
  const known = new Set(rows.map((r) => r.name));
  const missing = findGenreDrift(known);
  if (missing.length) {
    console.warn(
      `\n[metadataBackfill] GENRE DRIFT — ${missing.length} rule target(s) absent from ` +
      `public.genres:\n  ${missing.join('\n  ')}\n` +
      `Books assigned these are unreachable by genre seeding. Fix GENRE_RULES, or add ` +
      `the rows to public.genres.\n`
    );
  }
  return { idByName, parentByName };
}

// -- Main ---------------------------------------------------------------------
async function main() {
  console.log(
    `[metadataBackfill] target=${TARGET} dryRun=${DRY_RUN} ` +
    `limit=${LIMIT ?? 'none'} hardcover=${HARDCOVER_TOKEN ? 'yes' : 'NO'}`
  );

  const { idByName: genreIdByName, parentByName } =
    WANT_GENRE ? await loadGenreCatalog() : { idByName: new Map(), parentByName: new Map() };

  // The cover gate. A book with no cover never reaches The Stacks, so its
  // DESCRIPTION is not what is stopping anyone — covers are coverBackfill's job
  // and should run first.
  //
  // v0.63: that reasoning is sound for descriptions and wrong for genres, and
  // applying it to both is one of the reasons the genre-less backlog would not
  // drain. Genre links feed shelf filters, the taste profile and Oracle
  // matching — none of which need a cover, all of which work perfectly well on
  // a book The Stacks will not show. With ~32% of the catalogue coverless, the
  // gate was withholding genres from a third of the books indefinitely, and
  // only coverBackfill (weekly, and itself gated) could ever release them.
  //
  // So the gate now applies only when descriptions are the point. On
  // `--target genre` it is dropped entirely; on `--target both` it is dropped
  // too, because a coverless book still legitimately wants its genres and the
  // description half simply finds nothing to do.
  let query = supabase
    .from('books')
    .select('id, title, author, description, genre, cover_url, metadata_checked_at, metadata_attempts, subjects_fetched_at')
    .neq('status', 'flagged')
    // Exhausted books are excluded server-side so they never occupy a row of
    // the overshoot window. Without this the filter below would still skip
    // them, but only after they had already crowded out the books we want:
    // `.limit(LIMIT * 4)` would come back full of the same 186 dead entries and
    // the run would process almost nothing.
    .lt('metadata_attempts', MAX_ATTEMPTS)
    // Oldest check first, nulls (never checked) ahead of everything.
    .order('metadata_checked_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });

  // Description-only runs keep the original behaviour exactly.
  if (!WANT_GENRE) query = query.not('cover_url', 'is', null);

  if (LIMIT) query = query.limit(LIMIT * 4); // overshoot: many rows won't need work

  const { data: rows, error } = await query;
  if (error) {
    console.error('[metadataBackfill] query failed:', error.message);
    process.exit(1);
  }

  const now = Date.now();
  let skippedExhausted = 0;

  // v0.63 — THE OTHER HALF OF THE GENRE-BACKLOG FIX, and the subtler one.
  //
  // "Missing a genre" was decided from the scalar `books.genre` column. The app
  // does not read that column: every surface reads `book_genres` (rolled up as
  // genresByBookId), and CurationNotice counts a book as needing genres when it
  // has ZERO ROWS THERE. So the script and the UI were measuring different
  // things, and the gap between them was not hypothetical — until v0.63,
  // nightly curation wrote its genre links to a column that does not exist
  // (see manual/regenreCatalog.mjs), which failed silently while the scalar was
  // written successfully. That produced a large cohort of books with
  // `books.genre = 'Fantasy'` and no links at all: invisible in the UI, and
  // skipped by this script on every single run, forever, because the scalar
  // was populated.
  //
  // One query, before the filter, so a book is "missing genres" when the app
  // would say so.
  const linkedBookIds = await fetchBooksWithGenreLinks(
    WANT_GENRE ? (rows || []).map((b) => b.id) : []
  );
  const missingGenreFor = (b) =>
    !b.genre || b.genre === 'Imported' || b.genre === 'Uncategorized' || !linkedBookIds.has(b.id);

  const needsWork = (rows || []).filter((b) => {
    const missingDesc = !b.description || b.description.trim().length < MIN_DESCRIPTION_CHARS;
    const missingGenre = missingGenreFor(b);
    if (!((WANT_DESC && missingDesc) || (WANT_GENRE && missingGenre))) return false;
    // Wants work, but we asked recently and got nothing. Asking again today
    // would produce the same nothing.
    if (!isDue(b, now)) {
      skippedExhausted++;
      return false;
    }
    return true;
  }).slice(0, LIMIT || undefined);

  console.log(
    `[metadataBackfill] ${needsWork.length} book(s) to process` +
    `${skippedExhausted ? ` (${skippedExhausted} skipped — checked recently, nothing found)` : ''}\n`
  );

  let descFilled = 0;
  let genreFilled = 0;
  let genreLinks = 0;
  let untouched = 0;
  const unmatched = [];

  for (let i = 0; i < needsWork.length; i++) {
    const book = needsWork[i];
    const needDesc = WANT_DESC &&
      (!book.description || book.description.trim().length < MIN_DESCRIPTION_CHARS);
    const needGenre = WANT_GENRE && missingGenreFor(book);

    process.stdout.write(
      `[${i + 1}/${needsWork.length}] ${book.title} — ${book.author || 'unknown'}\n`
    );

    const { description, descriptionFrom, subjects } =
      await fetchMetadata(book, needDesc, needGenre);

    const patch = {};
    if (needDesc && description) patch.description = description;

    let genre = null;
    let extraGenres = [];
    if (needGenre) {
      genre = inferGenre(subjects);
      if (subjects.length) vlog(`genre scores: ${explainGenre(subjects).join(' | ') || '(no rule matched)'}`);
      if (genre) {
        // v0.63: only (re)write the scalar when it is genuinely absent. A book
        // selected purely because it had no LINKS may already carry a perfectly
        // good scalar genre, possibly one the Oracle chose; silently replacing
        // it with a rule-table inference would be a change nobody asked for and
        // nobody would see happen. The links are what we came for.
        const scalarMissing =
          !book.genre || book.genre === 'Imported' || book.genre === 'Uncategorized';
        if (scalarMissing) patch.genre = genre;
        // books.genre holds the single top pick because it is a scalar column
        // other code still reads; book_genres gets the full set.
        // Specifics first, then their umbrellas — withUmbrellas appends, so if
        // the cap bites it drops an umbrella rather than the precise genre that
        // earned the book its place.
        extraGenres = withUmbrellas(inferAllGenres(subjects), parentByName, MAX_GENRES_PER_BOOK);
        if (extraGenres.length > 1) vlog(`also linking: ${extraGenres.slice(1).join(', ')}`);
      } else if (subjects.length) {
        unmatched.push({ id: book.id, title: book.title, author: book.author, subjects });
      }
    }

    // v0.63: `patch` no longer tells the whole story. A book selected because
    // it had no genre LINKS but did have a scalar genre produces an empty patch
    // and yet has real work to do — writing the links. Treating that as
    // "nothing found" would stamp a retry counter on it and skip the very thing
    // we selected it for.
    const hasLinkWork = extraGenres.length > 0;

    if (Object.keys(patch).length === 0 && !hasLinkWork) {
      untouched++;
      const attempts = (book.metadata_attempts ?? 0) + 1;
      // Stamp the dead end so tonight's three wasted requests are the last ones
      // for a while. This is the whole point of the change: without the write,
      // the next run re-selects this book on identical criteria.
      if (!DRY_RUN) {
        // "Asked, and they had nothing" is a fact worth keeping — a timestamp
        // stops the re-genre pass fetching this book again for no reason.
        //
        // v0.63.2b — BUT NOT AT THE COST OF WHAT IS ALREADY THERE. This used to
        // write `source_subjects: subjects || []` unconditionally, so a lookup
        // that found nothing today ERASED subjects a successful lookup had
        // stored earlier. The sources are flaky and rate-limited; an empty
        // result is very often "not today" rather than "does not exist".
        //
        // The damage is silent and compounding. Subjects are the only evidence
        // the rule table ever gets, and regenreCatalog --apply reads nothing
        // else — so a wiped book keeps whatever genre it was given back when
        // the evidence existed, and can never be re-derived or corrected.
        // "Cleat Cute" is the worked example: books.genre said 'Feminist &
        // Sapphic Gothic', a name only a rule matching "sapphic" can produce,
        // while source_subjects was []. The verdict outlived its evidence.
        //
        // Only ever widen what is stored. Nothing found means nothing written.
        const mark = {
          metadata_checked_at: new Date().toISOString(),
          metadata_attempts: attempts,
          subjects_fetched_at: new Date().toISOString(),
        };
        if (subjects && subjects.length) mark.source_subjects = subjects;

        const { error: markErr } = await supabase
          .from('books')
          .update(mark)
          .eq('id', book.id);
        if (markErr) vlog(`could not record lookup attempt: ${markErr.message}`);
      }
      const next = attempts >= MAX_ATTEMPTS
        ? 'no further attempts'
        : `retry in ${RETRY_DAYS[Math.min(attempts, RETRY_DAYS.length - 1)]}d`;
      process.stdout.write(`    nothing found (attempt ${attempts}, ${next})\n`);
      continue;
    }

    // Progress was made, so this book is not a dead end. Clear the counter
    // rather than leaving it: a book that got a description today but still
    // wants a genre should be tried again on the next pass at full frequency.
    if (book.metadata_attempts || book.metadata_checked_at) {
      patch.metadata_attempts = 0;
      patch.metadata_checked_at = null;
    }

    // Cache what the sources said. This is the row that lets a future rule
    // change be re-applied offline instead of re-fetching the catalogue, and it
    // is the audit trail when a book lands somewhere surprising.
    if (subjects && subjects.length) {
      patch.source_subjects = subjects;
      patch.subjects_fetched_at = new Date().toISOString();
    }

    // The retry bookkeeping is not content; showing it in the per-book line
    // would make every row read as if two extra fields had been filled in.
    const BOOKKEEPING = new Set([
      'metadata_attempts', 'metadata_checked_at', 'source_subjects', 'subjects_fetched_at',
    ]);
    const shown = Object.keys(patch).filter((k) => !BOOKKEEPING.has(k)).join(', ');

    if (DRY_RUN) {
      process.stdout.write(
        `    WOULD SET ${shown}` +
        `${patch.genre ? ` (genre=${patch.genre})` : ''}` +
        `${extraGenres.length > 1 ? ` (+${extraGenres.length - 1} more genre link(s))` : ''}` +
        `${descriptionFrom ? ` (desc from ${descriptionFrom})` : ''}\n`
      );
    } else {
      // Skip the round-trip entirely when the only work is link work.
      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from('books').update(patch).eq('id', book.id);
        if (upErr) {
          process.stdout.write(`    update failed: ${upErr.message}\n`);
          continue;
        }
      }

      // Link the full genre set into book_genres — the many-to-many the app
      // actually reads (genresByBookId). books.genre above is the legacy scalar
      // and holds only the top pick.
      //
      // `assigned_by_source` is the column name, NOT `source`. oracleBatch got
      // this wrong and every one of its genre links failed silently for
      // months, because the result was never checked. Both are checked now.
      if (extraGenres.length > 0) {
        const links = extraGenres
          .map((name) => genreIdByName.get(name))
          .filter(Boolean)
          .map((genre_id) => ({ book_id: book.id, genre_id, assigned_by_source: 'oracle' }));
        if (links.length) {
          const { error: linkErr } = await supabase
            .from('book_genres')
            .upsert(links, { onConflict: 'book_id,genre_id', ignoreDuplicates: true });
          if (linkErr) {
            process.stdout.write(`    genre link failed: ${linkErr.message}\n`);
          } else {
            genreLinks += links.length;
          }
        }
      }
      process.stdout.write(
        `    set ${shown}` +
        `${patch.genre ? ` (genre=${patch.genre})` : ''}\n`
      );
    }

    if (patch.description) descFilled++;
    if (patch.genre) genreFilled++;
  }

  // Books with subjects that matched no rule. This is the file to read before
  // deciding whether any Claude spend is warranted: if a theme recurs here
  // often enough to matter, the cheaper fix is a new line in GENRE_RULES.
  if (unmatched.length) {
    const csv = [
      'id,title,author,subjects',
      ...unmatched.map((u) =>
        [u.id, u.title, u.author || '', u.subjects.slice(0, 12).join('; ')]
          .map((f) => `"${String(f).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    writeFileSync(join(__dirname, '..', 'output', 'genre-unmatched.csv'), csv);
  }

  // nothingFound is now "asked today and got nothing", not "cannot be filled".
  // skippedExhausted is the standing dead set — it should climb for a few nights
  // and then stop, and nothingFound should fall towards zero. If nothingFound
  // stays flat while skippedExhausted stays at zero, the retry stamp is not
  // being written and the loop below is worth a look.
  console.log(
    `\n[metadataBackfill] descriptions=${descFilled} genres=${genreFilled} ` +
    `unmatchedGenre=${unmatched.length} nothingFound=${untouched} ` +
    `genreLinks=${genreLinks} skippedExhausted=${skippedExhausted}` +
    `${DRY_RUN ? ' (DRY RUN — nothing written)' : ''}`
  );
}

main().catch((e) => {
  console.error('[metadataBackfill] fatal:', e);
  process.exit(1);
});
