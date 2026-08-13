// regenreCatalog.mjs — re-genre the whole catalogue against the current rules.
//
// WHY THIS EXISTS
//
// Two things happened at once. Nightly curation had been failing to write a
// single genre link for months (it named a column that does not exist — see
// manual/oracleBatch.mjs), so 116 Oracle-invented genres sat at usage_count 0.
// And the taxonomy went from 15 seeds to 136 entries, most of which no book has
// ever been filed under.
//
// Meanwhile 3,260 books carry at most one genre each, chosen when one was all a
// book could have. Multi-genre works now, so the catalogue is a long way behind
// what the taxonomy can express.
//
// THREE PHASES, RUN IN ORDER
//
//   --fetch    Ask Hardcover / Open Library / Google Books for each book's
//              subjects and STORE them on the row. Free, slow (three HTTP calls
//              and a politeness delay per book — hours for the full catalogue),
//              and only ever needs doing once per book.
//
//   --apply    Run the rule table against the STORED subjects and write
//              book_genres. Free, offline, no network at all, seconds rather
//              than hours. This is the phase you re-run every time you edit
//              _shared/genreRules.mjs.
//
//   --report   What the rules would do, and how many books they cannot place.
//              That residue is the input to a Claude pass; this tells you what
//              it would cost before you spend it.
//
// The split is the whole point. Fetching and inferring used to be one step, so
// improving a rule meant re-fetching everything — hours per iteration, which is
// long enough that nobody iterates and the rules never improve. Separated, the
// loop is: edit a rule, --apply, look, repeat.
//
// WHY manual/ AND NOT scheduled/
//
// It costs nothing, so the money rule in batch-scripts/README.md does not
// exclude it. The other half of that rule does: this rewrites genre assignments
// across every book in the catalogue, which is a change you want to look at
// before and after, not one that happens on a timer.
//
// Usage, in the order you actually want them:
//
//   --report                          where things stand; safe, reads only
//   --fetch --limit 100               a slice first, to see the shape (~1 min)
//   --report                          now the rules have something to read
//   --fetch                           the rest (~30 min at concurrency 3)
//   --apply --dry-run --verbose       what it would write
//   --apply                           write it
//   --apply --replace                 also clear previous machine-assigned links
//
// --fetch is RESUMABLE. Each book is stored as it completes and the query only
// selects books with no subjects yet, so an interrupted run costs nothing but
// the book in flight. Do not be afraid to Ctrl-C it.
//
//   --concurrency N   books in parallel, default 3, hard cap 6
//   --delay MS        pause between sources, default 400
//   --retry-empty     re-ask for every book the rules still cannot place, not
//   (--retry-unplaced) merely those that stored nothing. A book whose only
//                     stored subject is "Fiction" is just as unplaceable as one
//                     with none, and it already carries a timestamp — so a
//                     plain --fetch skips it forever. Use after any change to
//                     how lookup works.
//
// Required in .env.local:
//   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   HARDCOVER_API_TOKEN  (optional — the other two sources still work without)
//   GOOGLE_BOOKS_API_KEY (optional)

import { createServiceClient } from '../_shared/supabaseClient.mjs';
import {
  MAX_GENRES_PER_BOOK,
  inferGenre,
  inferAllGenres,
  explainGenre,
  findGenreDrift,
  withUmbrellas,
  ruleMatches,
} from '../_shared/genreRules.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FETCH = args.includes('--fetch');
const APPLY = args.includes('--apply');
const REPORT = args.includes('--report') || (!FETCH && !APPLY);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
// Off by default. Genres assigned by a human ('admin') or carried since the
// seed are judgements this script has no business overruling — it only ever
// ADDS links unless explicitly told otherwise, and even then it only clears
// what a previous machine pass wrote.
const REPLACE = args.includes('--replace');
// Re-ask for every book the rules still cannot place.
//
// "Empty" was the wrong test. A first pass stored ["Fiction"] for 339 books —
// Google Books answered with its coarsest possible category while Open Library
// and Hardcover found nothing — and that array is neither null nor empty, so a
// filter on emptiness skipped all of them forever. Human Acts, Child of God,
// Japanese Gothic: real books with rich records, permanently stuck behind a
// successful-looking fetch.
//
// The honest test is not "did we store something" but "can the rules do
// anything with what we stored". That cannot be expressed as a Postgres
// predicate, so the set is computed here by running the rules over the stored
// subjects — the same planFor() --apply uses, so the two can never disagree
// about what counts as placed.
const RETRY_EMPTY = args.includes('--retry-empty') || args.includes('--retry-unplaced');

function argValue(name, fallback) {
  const a = args.find((x) => x.startsWith(name));
  if (!a) return fallback;
  return a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1];
}
const LIMIT = Number.parseInt(argValue('--limit', ''), 10) || null;
const DELAY_MS = Number.parseInt(argValue('--delay', ''), 10) || 400;

// Books fetched in parallel. Serial, the full catalogue is about 90 minutes;
// at 3 it is about 30. Capped at 6 because the delay between sources is a
// politeness budget shared across workers — raising this multiplies the request
// rate against Open Library and Hardcover, and being rate-limited mid-run is
// slower than never having parallelised. 3 is a deliberate default, not a
// timid one.
const CONCURRENCY = Math.min(6, Math.max(1,
  Number.parseInt(argValue('--concurrency', ''), 10) || 3));

// ── Env ──────────────────────────────────────────────────────────────────────
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
const SERVICE_KEY = env['SUPABASE_SECRET_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'] || '';
const HARDCOVER_TOKEN = env['HARDCOVER_API_TOKEN'] || env['VITE_HARDCOVER_TOKEN'] || '';
const GOOGLE_KEY = env['GOOGLE_BOOKS_API_KEY'] || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[regenre] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (m) => { if (VERBOSE) process.stdout.write('    ' + m + '\n'); };
const cleanTitle = (t) => (t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\/.*$/, '').trim();
const cleanAuthor = (a) => (a || '').split(/[,&]|\sand\s/i)[0].trim();

// Page past PostgREST's 1000-row default. oracleBatch shipped for months
// reporting "1000 eligible" when that was the cap and not a count; the same
// mistake here would silently re-genre a third of the catalogue and call it
// all of it.
async function fetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) { console.error('[regenre] query failed:', error.message); process.exit(1); }
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
    if (LIMIT && out.length >= LIMIT) break;
  }
  return LIMIT ? out.slice(0, LIMIT) : out;
}

// ── Sources ──────────────────────────────────────────────────────────────────
// Same three the metadata backfill uses, same order, subjects only — this pass
// does not touch descriptions.
const HC_QUERY = `
  query FindBook($title: String!) {
    books(where: { title: { _ilike: $title } }, order_by: { users_read_count: desc }, limit: 5) {
      title cached_tags contributions(limit: 1) { author { name } }
    }
  }`;

// By id when we have one, by fuzzy title otherwise.
//
// The id path matters more than it looks. A full-catalogue run found 1,020 of
// 3,260 books came back with NO subjects from any source — a third of the
// library, which is not plausible for real books. The cause is the lookup, not
// the sources: title+author search fails on anything with a null author, a
// translated title, or a subtitle the cleaner did not strip. Every one of those
// books still has an exact identifier sitting on its row, unused.
const HC_BY_ID = `
  query BookById($id: Int!) {
    books(where: { id: { _eq: $id } }, limit: 1) { cached_tags }
  }`;

async function hardcoverSubjects(book) {
  if (!HARDCOVER_TOKEN) return [];
  const auth = HARDCOVER_TOKEN.startsWith('Bearer ') ? HARDCOVER_TOKEN : `Bearer ${HARDCOVER_TOKEN}`;
  const post = async (query, variables) => {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ query, variables }),
    });
    return res.ok ? (await res.json())?.data?.books || [] : [];
  };
  const tags = (row) => (row?.cached_tags?.Genre || []).map((t) => t?.tag).filter(Boolean);

  try {
    if (book.hardcover_id) {
      const rows = await post(HC_BY_ID, { id: Number(book.hardcover_id) });
      const got = tags(rows[0]);
      if (got.length) return got;
    }
    const rows = await post(HC_QUERY, { title: cleanTitle(book.title) });
    // Author-match before trusting a fuzzy row. Taking rows[0] blindly attaches
    // another book's tags — the worst failure available here, because it looks
    // like success.
    const wanted = cleanAuthor(book.author).toLowerCase();
    const hit = rows.find((r) => {
      const got = (r.contributions?.[0]?.author?.name || '').toLowerCase();
      return wanted && got && (got.includes(wanted) || wanted.includes(got));
    });
    return tags(hit);
  } catch (e) { vlog(`hardcover: ${e.message}`); return []; }
}

async function openLibrarySubjects(book) {
  const ask = async (q) => {
    const res = await fetch('https://openlibrary.org/search.json?' + q);
    if (!res.ok) return [];
    return (await res.json())?.docs?.[0]?.subject || [];
  };
  try {
    // ISBN is exact and returns the same work-level subjects as a title match,
    // in one request. Only fall back to fuzzy search when there is no ISBN or
    // the ISBN is not in Open Library.
    if (book.isbn) {
      const clean = String(book.isbn).replace(/[^0-9Xx]/g, '');
      if (clean.length >= 10) {
        const got = await ask('q=isbn:' + encodeURIComponent(clean) + '&fields=subject&limit=1');
        if (got.length) return got;
      }
    }
    return await ask('title=' + encodeURIComponent(cleanTitle(book.title)) +
      '&author=' + encodeURIComponent(cleanAuthor(book.author)) + '&fields=subject&limit=1');
  } catch (e) { vlog(`openlibrary: ${e.message}`); return []; }
}

async function googleSubjects(book) {
  const ask = async (q) => {
    const url = 'https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) +
      '&maxResults=1' + (GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : '');
    const res = await fetch(url);
    if (!res.ok) return [];
    return (await res.json())?.items?.[0]?.volumeInfo?.categories || [];
  };
  try {
    if (book.isbn) {
      const clean = String(book.isbn).replace(/[^0-9Xx]/g, '');
      if (clean.length >= 10) {
        const got = await ask(`isbn:${clean}`);
        if (got.length) return got;
      }
    }
    return await ask(`intitle:${cleanTitle(book.title)}+inauthor:${cleanAuthor(book.author)}`);
  } catch (e) { vlog(`googlebooks: ${e.message}`); return []; }
}

// Order matters: Open Library's subjects are the richest and its ordering is
// roughly by prominence, which the position weighting in the rules depends on.
// Hardcover's are curated and short, so they lead.
async function collectSubjects(book) {
  const out = [];
  out.push(...await hardcoverSubjects(book));
  await sleep(DELAY_MS);
  out.push(...await openLibrarySubjects(book));
  await sleep(DELAY_MS);
  out.push(...await googleSubjects(book));
  // Dedupe case-insensitively but keep the first spelling and the order.
  const seen = new Set();
  return out.filter((s) => {
    const k = String(s).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Genre catalogue ──────────────────────────────────────────────────────────
async function loadGenreCatalog() {
  const { data, error } = await supabase.from('genres').select('id, name, parent_id');
  if (error) { console.error('[regenre] could not read genres:', error.message); process.exit(1); }
  const rows = data || [];
  const idByName = new Map(rows.map((r) => [r.name, r.id]));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  const parentByName = new Map(
    rows.filter((r) => r.parent_id && nameById.has(r.parent_id))
        .map((r) => [r.name, nameById.get(r.parent_id)])
  );
  const drift = findGenreDrift(new Set(rows.map((r) => r.name)));
  if (drift.length) {
    console.warn(
      `\n[regenre] GENRE DRIFT — ${drift.length} rule target(s) absent from public.genres:\n  ` +
      drift.join('\n  ') +
      `\nBooks assigned these are unreachable: the picker only offers names from that table.\n`
    );
  }
  return { idByName, parentByName, total: rows.length };
}

// ── Phase 1: fetch ───────────────────────────────────────────────────────────
async function phaseFetch() {
  console.log('[regenre] --fetch: collecting subjects' +
    (RETRY_EMPTY ? ' (including books that previously came back empty)' : ' for books that have none stored'));

  // isbn and hardcover_id are selected because the lookup prefers them — see
  // the note on hardcoverSubjects. Fetching without them is what left a third
  // of the catalogue with no subjects at all.
  const cols = 'id, title, author, isbn, hardcover_id';
  let books;

  if (RETRY_EMPTY) {
    // Everything fetched so far, plus everything never fetched, then filtered
    // down to what the rules cannot place. Pulling source_subjects costs a
    // wider select, but it is one pass and it means the retry set is exactly
    // the set worth retrying.
    const { parentByName } = await loadGenreCatalog();
    const fetched = await fetchAll(() => supabase.from('books')
      .select(cols + ', source_subjects')
      .not('subjects_fetched_at', 'is', null)
      .neq('status', 'flagged')
      .order('created_at', { ascending: true }));
    const never = await fetchAll(() => supabase.from('books').select(cols)
      .is('subjects_fetched_at', null)
      .neq('status', 'flagged')
      .order('created_at', { ascending: true }));

    const unplaceable = fetched.filter((bk) => planFor(bk, parentByName).full.length === 0);
    books = [...never, ...unplaceable];
    console.log(`[regenre] retry set: ${never.length} never fetched + ${unplaceable.length} the rules cannot place`);
  } else {
    books = await fetchAll(() => supabase.from('books').select(cols)
      .is('subjects_fetched_at', null)
      .neq('status', 'flagged')
      .order('created_at', { ascending: true }));
  }

  const perBookMs = DELAY_MS * 2 + 900;
  console.log(`[regenre] ${books.length} book(s) to fetch, concurrency ${CONCURRENCY}` +
    (books.length ? ` — roughly ${Math.max(1, Math.round(books.length * perBookMs / 60000 / CONCURRENCY))} minutes` : ''));
  console.log('[regenre] safe to interrupt: each book is stored as it completes, and a');
  console.log('[regenre] re-run only picks up books with no subjects yet.\n');

  let withSubjects = 0, empty = 0, failed = 0, done = 0;

  // Workers pull from a shared cursor rather than being handed a slice each.
  // Slicing would leave one worker grinding through a tail of slow lookups
  // while the others sat idle.
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= books.length) return;
      const bk = books[i];
      try {
        const subjects = await collectSubjects(bk);
        if (!DRY_RUN) {
          const { error } = await supabase.from('books').update({
            source_subjects: subjects,
            subjects_fetched_at: new Date().toISOString(),
          }).eq('id', bk.id);
          if (error) {
            failed++;
            process.stdout.write(`  store failed: ${bk.title}: ${error.message}\n`);
            continue;
          }
        }
        if (subjects.length) withSubjects++; else empty++;
        vlog(`${bk.title}: ${subjects.length} subject(s) — ${subjects.slice(0, 10).join(', ')}`);
      } catch (e) {
        failed++;
        process.stdout.write(`  fetch failed: ${bk.title}: ${e.message}\n`);
      } finally {
        done++;
        // One line per 25 books rather than per book. At three workers the
        // per-book lines interleave into noise, and a 30-minute job needs a
        // pulse more than it needs a transcript.
        if (done % 25 === 0 || done === books.length) {
          const pct = Math.round((done / books.length) * 100);
          process.stdout.write(`[${done}/${books.length}] ${pct}%  withSubjects=${withSubjects} empty=${empty} failed=${failed}\n`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n[regenre] fetched=${books.length} withSubjects=${withSubjects} empty=${empty} failed=${failed}` +
    (DRY_RUN ? ' (DRY RUN — nothing stored)' : ''));
  if (!DRY_RUN) console.log('[regenre] next: --apply --dry-run --verbose, then --apply');
}

// ── Phase 2/3: infer from stored subjects ────────────────────────────────────
async function loadBooksWithSubjects() {
  return fetchAll(() => supabase
    .from('books')
    .select('id, title, author, genre, source_subjects')
    .not('subjects_fetched_at', 'is', null)
    .neq('status', 'flagged')
    .order('created_at', { ascending: true }));
}

function planFor(book, parentByName) {
  const subjects = book.source_subjects || [];
  const specifics = inferAllGenres(subjects, MAX_GENRES_PER_BOOK);
  const full = withUmbrellas(specifics, parentByName, MAX_GENRES_PER_BOOK);
  return { subjects, specifics, full, top: inferGenre(subjects) };
}

async function phaseApply() {
  const { idByName, parentByName, total } = await loadGenreCatalog();
  console.log(`[regenre] --apply: ${total} genres in the taxonomy, offline (no network)`);

  const books = await loadBooksWithSubjects();
  console.log(`[regenre] ${books.length} book(s) with stored subjects\n`);

  let linked = 0, placed = 0, unplaced = 0, cleared = 0;
  const unmatched = [];

  for (const book of books) {
    const { subjects, full, top } = planFor(book, parentByName);
    if (full.length === 0) {
      unplaced++;
      if (subjects.length) unmatched.push({ id: book.id, title: book.title, author: book.author, subjects });
      continue;
    }
    placed++;
    if (VERBOSE) {
      process.stdout.write(`${book.title}\n`);
      vlog(full.join(', '));
      vlog(explainGenre(subjects).join(' | '));
    }
    if (DRY_RUN) continue;

    // --replace clears only what a machine wrote. 'admin' and 'seed' links are
    // human judgements and survive untouched.
    if (REPLACE) {
      const { error: delErr, count } = await supabase
        .from('book_genres')
        .delete({ count: 'exact' })
        .eq('book_id', book.id)
        .eq('assigned_by_source', 'oracle');
      if (delErr) { process.stdout.write(`  clear failed: ${delErr.message}\n`); continue; }
      cleared += count || 0;
    }

    const links = full.map((n) => idByName.get(n)).filter(Boolean)
      .map((genre_id) => ({ book_id: book.id, genre_id, assigned_by_source: 'oracle' }));
    if (links.length) {
      // assigned_by_source, NOT source. Naming it wrong is how every genre link
      // from the nightly job failed silently for months.
      const { error } = await supabase.from('book_genres')
        .upsert(links, { onConflict: 'book_id,genre_id', ignoreDuplicates: true });
      if (error) { process.stdout.write(`  link failed: ${error.message}\n`); continue; }
      linked += links.length;
    }
    // books.genre keeps the single top pick — a scalar column other code reads.
    if (top && top !== book.genre) {
      await supabase.from('books').update({ genre: top }).eq('id', book.id);
    }
  }

  if (unmatched.length) {
    const csv = ['id,title,author,subjects',
      ...unmatched.map((u) => [u.id, u.title, u.author || '', u.subjects.slice(0, 15).join('; ')]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`).join(','))].join('\n');
    writeFileSync(join(__dirname, '..', 'output', 'regenre-unmatched.csv'), csv);
  }

  console.log(`\n[regenre] placed=${placed} unplaced=${unplaced} links=${linked}` +
    (REPLACE ? ` cleared=${cleared}` : '') +
    (DRY_RUN ? ' (DRY RUN — nothing written)' : '') +
    (unmatched.length ? `\n[regenre] ${unmatched.length} book(s) -> output/regenre-unmatched.csv` : ''));
}

// What is linked in book_genres today, by genre name.
//
// The report used to ignore this entirely, which made it quietly wrong in the
// way that matters most: it reported "Folk Horror would still have no book"
// while Folk Horror had 119 books linked. The rules were never going to assign
// it — no source tags these books "folk horror" — but the shelf was full, and
// the report said the opposite.
//
// --apply only ADDS links, so the end state is what exists now UNION what the
// rules would add. Anything that reports on the end state has to read both.
async function loadExistingCounts(nameById) {
  const counts = new Map();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('book_genres').select('genre_id').range(from, from + pageSize - 1);
    if (error) { console.warn('[regenre] could not read book_genres:', error.message); break; }
    for (const r of data || []) {
      const n = nameById.get(r.genre_id);
      if (n) counts.set(n, (counts.get(n) || 0) + 1);
    }
    if (!data || data.length < pageSize) break;
  }
  return counts;
}

async function phaseReport() {
  const { idByName, parentByName, total } = await loadGenreCatalog();
  const idsToNames = new Set(idByName.keys());
  const nameById = new Map([...idByName.entries()].map(([n, i]) => [i, n]));
  const existing = await loadExistingCounts(nameById);
  const books = await loadBooksWithSubjects();

  const { count: allBooks } = await supabase
    .from('books').select('id', { count: 'exact', head: true }).neq('status', 'flagged');

  const perGenre = new Map();
  const perCount = new Map();
  let placed = 0, unplaced = 0, noSubjects = 0;

  // The diagnostic that actually drives rule-writing.
  //
  // "60 placed, 40 not" says the rules need work but not what work. These two
  // counters say which subject strings are going unread, ranked by how many
  // books each one would rescue — so the next rule can be chosen by leverage
  // instead of by guessing at what a catalogue probably contains.
  //
  // missedOnUnplaced: subjects on books NOTHING matched. Highest value — each
  //   of these is a book with no shelf at all.
  // missedAnywhere:   subjects no rule matched, across every book. Lower value
  //   per hit, but this is where the missing SECOND and THIRD genres hide.
  const missedOnUnplaced = new Map();
  const missedAnywhere = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  const unmatchedBooks = [];

  for (const book of books) {
    const { subjects, full } = planFor(book, parentByName);
    if (!subjects.length) noSubjects++;

    // A subject is "missed" when no rule pattern matches it at all.
    const missed = subjects.filter((s) => !ruleMatches(s));
    for (const s of missed) bump(missedAnywhere, String(s).toLowerCase());

    if (full.length === 0) {
      unplaced++;
      for (const s of missed) bump(missedOnUnplaced, String(s).toLowerCase());
      if (subjects.length) {
        unmatchedBooks.push({ id: book.id, title: book.title, author: book.author, subjects });
      }
      continue;
    }
    placed++;
    perCount.set(full.length, (perCount.get(full.length) || 0) + 1);
    for (const g of full) perGenre.set(g, (perGenre.get(g) || 0) + 1);
  }

  // Same CSV --apply writes. Produced here too so the file exists before
  // anything has been written to the database.
  if (unmatchedBooks.length) {
    const csv = ['id,title,author,subjects',
      ...unmatchedBooks.map((u) => [u.id, u.title, u.author || '', u.subjects.slice(0, 15).join('; ')]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`).join(','))].join('\n');
    writeFileSync(join(__dirname, '..', 'output', 'regenre-unmatched.csv'), csv);
  }

  const CLAUDE_PER_BOOK = 0.007;
  const toFetch = (allBooks ?? 0) - books.length;

  // Empty AFTER means: no link today, and none the rules would add. That is
  // the only version of "empty" worth acting on.
  const willHave = new Set([...existing.keys(), ...perGenre.keys()]);
  const emptyAfter = [...idsToNames].filter((n) => !willHave.has(n)).sort();

  console.log(`
[regenre] REPORT
  taxonomy                 ${total} genres
  catalogue                ${allBooks ?? '?'} books
  subjects stored          ${books.length}
  still to --fetch         ${toFetch}`);

  // Nothing fetched yet is the normal starting state, not a failure — but a
  // page of zeros reads like one. Say what is actually true and stop, rather
  // than reporting "the rules can place 0" as though the rules had been tried.
  if (books.length === 0) {
    const perBookMs = DELAY_MS * 2 + 900;
    const mins = Math.max(1, Math.round(toFetch * perBookMs / 60000 / CONCURRENCY));
    console.log(`
  No subjects have been fetched yet, so there is nothing for the rules to read.
  Every number below this point would be zero for that reason alone, and none
  of them would tell you anything, so they are not printed.

  NEXT STEP — fetch the subjects (free, resumable, roughly ${mins} min at
  concurrency ${CONCURRENCY}):

      node batch-scripts/manual/regenreCatalog.mjs --fetch

  Try a slice first if you would rather see the shape before committing an hour:

      node batch-scripts/manual/regenreCatalog.mjs --fetch --limit 100
      node batch-scripts/manual/regenreCatalog.mjs --report
`);
    return;
  }

  console.log(`
  the rules can place      ${placed}
  the rules cannot         ${unplaced}   <- the Claude residue
  stored but no subjects   ${noSubjects}  <- try --fetch --retry-empty first

  genres with books TODAY         ${existing.size} / ${total}
  genres the rules would add to   ${perGenre.size} / ${total}
  genres empty AFTER this pass    ${emptyAfter.length}

  estimated Claude cost for the residue: ~$${(unplaced * CLAUDE_PER_BOOK).toFixed(2)}
`);

  // A large "no subjects" count is a lookup failure, not a fact about the
  // books. Say so, because the number sits next to a dollar figure and the
  // tempting read is "pay Claude" when the free fix has not been exhausted.
  if (noSubjects > books.length * 0.1) {
    const pctNo = Math.round((noSubjects / books.length) * 100);
    console.log(`  ${pctNo}% of fetched books came back with NO subjects from any source.
  That is a lookup problem, not a fact about the catalogue — real books have
  subjects somewhere. Before paying for any of them:

      node batch-scripts/manual/regenreCatalog.mjs --fetch --retry-empty

  which re-asks using ISBN and Hardcover id rather than fuzzy title search.
`);
  }

  console.log('  genres per book:');
  for (const n of [...perCount.keys()].sort((a, b) => a - b)) {
    console.log(`    ${n} genre(s): ${perCount.get(n)} books`);
  }

  const top = [...perGenre.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('\n  biggest shelves after the pass:');
  for (const [g, n] of top) console.log(`    ${String(n).padStart(5)}  ${g}`);

  if (emptyAfter.length > 0) {
    console.log(`\n  ${emptyAfter.length} genre(s) would have NO book at all — none linked today`);
    console.log('  and none the rules would add. If a name here is something your');
    console.log('  catalogue definitely contains, it wants a rule in');
    console.log('  batch-scripts/_shared/genreRules.mjs — then re-run --apply, no re-fetch:');
    console.log('    ' + emptyAfter.slice(0, 40).join(', ') + (emptyAfter.length > 40 ? ', …' : ''));
  }

  // Shelves that exist only because something linked them before this pass.
  // Worth seeing: a big number here means the rules cannot reproduce a shelf
  // the catalogue already has, so re-running with --replace would destroy it.
  const rulesMiss = [...existing.entries()]
    .filter(([n]) => !perGenre.has(n))
    .sort((a, b) => b[1] - a[1]);
  if (rulesMiss.length) {
    console.log(`\n  ${rulesMiss.length} shelf(s) exist today that the rules would NOT reproduce.`);
    console.log('  These survive a plain --apply (it only adds) but would be LOST by');
    console.log('  --replace, which clears previous machine-assigned links first:');
    for (const [g, n] of rulesMiss.slice(0, 15)) console.log(`    ${String(n).padStart(5)}  ${g}`);
    if (rulesMiss.length > 15) console.log(`    … and ${rulesMiss.length - 15} more`);
  }

  const rank = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  if (missedOnUnplaced.size) {
    console.log('\n  UNREAD SUBJECTS ON BOOKS WITH NO SHELF — highest-leverage rules to add.');
    console.log('  Each line is a subject string no rule matches, and how many shelf-less');
    console.log('  books carry it. One rule per line here rescues that many books:');
    for (const [s, n] of rank(missedOnUnplaced, 30)) {
      console.log(`    ${String(n).padStart(4)}  ${s}`);
    }
  }

  if (missedAnywhere.size) {
    console.log('\n  UNREAD SUBJECTS ACROSS ALL BOOKS — where missing 2nd/3rd genres hide:');
    for (const [s, n] of rank(missedAnywhere, 20)) {
      console.log(`    ${String(n).padStart(4)}  ${s}`);
    }
  }

  if (unmatchedBooks.length) {
    console.log(`\n  ${unmatchedBooks.length} shelf-less book(s) with their subjects -> output/regenre-unmatched.csv`);
  }

  if (toFetch > 0) {
    console.log(`\n  ${toFetch} book(s) still need --fetch before this report is complete.`);
    console.log('  Placement rates on a slice are indicative, not final — a bigger sample');
    console.log('  will surface subject strings this one never saw.');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (FETCH) await phaseFetch();
  if (APPLY) await phaseApply();
  if (REPORT && !FETCH && !APPLY) await phaseReport();
}

main().catch((e) => { console.error('[regenre] fatal:', e); process.exit(1); });
