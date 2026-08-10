// oracleCategorizationService.js
//
// v0.60.1 — DESCRIPTIONS REMOVED. The Oracle no longer writes books.description.
//
// It was generating text that Hardcover, Open Library and Google Books already
// hand out for free, which meant paying Anthropic for retrieval and accepting a
// model's summary of a book in place of the publisher's. A generated blurb can
// also be wrong in ways a fetched one cannot.
// batch-scripts/scheduled/metadataBackfill.mjs owns the field now, on the
// weekly cron, at no cost.
//
// What stays is what no API can supply: the curated book_genres taxonomy,
// series linkage, complexity, depth, and author gender. Judgment, not lookup —
// which is the whole test for whether an Oracle call is worth making.
//
// Descriptions still go INTO the prompt as context; they are the best available
// evidence for complexity and depth. They just don't come back out.
//
// v0.21 — Oracle now handles genres, series, AND descriptions in one batch call.
// v0.42-ish — also assigns complexity + depth (previously "curated only" fields,
// left null for every book added via Hardcover/OpenLibrary/Goodreads/manual entry —
// which is most of the catalog. Needed for accurate Match % scoring and, longer
// term, for Reading Plans if they ever expand beyond the curated Vault).
// v0.55 — also assigns author_gender, for the "books by women" accomplishment
// (shareMoments.js / accomplishments.js). Deliberately NOT part of the GENRE
// RULES below — author gender is an attribute of the author, not a thematic
// classification, so it never touches genres/book_genres. Same batch call,
// no extra API cost. See schema_v35_migration.sql for the column + the
// guardrail this enforces: never guess from a name, only from a real public
// signal, or return 'unknown'.
//
// v0.61 — NO LONGER RUNS IN THE BROWSER. runOracleCategorization() and the
// Wishlist/Library button that called it are both gone. See the note at the
// foot of this file for the reasoning and for where the work moved.
//
// WHAT THIS MODULE IS NOW
// Two things, and nothing that spends money:
//
//   1. Eligibility — getBooksNeedingGenres() / getBooksNeedingOracle() decide
//      which books still need the Oracle. CurationNotice.jsx counts with the
//      first one to tell a reader what tonight's job will pick up.
//   2. Reference — buildPrompt() and its GENRE RULES remain the canonical
//      statement of how a book gets classified. oracleBatch.mjs mirrors them.
//
// Eligibility is books with status in ['unreviewed', 'incomplete'] still
// missing at least one Oracle-only field: genres, complexity, depth, author
// gender. 'discovered' books are intentionally excluded — they haven't been
// added to anyone's collection, so spending tokens on them isn't warranted.

import {
  supabase
} from './supabase';
// v0.61: the claudeApi import is gone entirely along with
// runOracleCategorization. This module no longer reaches Anthropic from the
// browser at all — that is the guarantee, and a lingering import of callClaude
// would quietly undermine it.
import { hardcoverSearch } from './hardcoverService';

// v0.57: lowered 10 → 5. Each batch is ONE synchronous Anthropic call inside
// the claude.js Netlify function, which has a hard 30s ceiling. The call's
// latency scales with how many output tokens the model generates, and each
// book now needs six fields (genres, series, description, complexity, depth,
// author_gender — the last added in v0.55). At 10 books the generation time
// sat right on the 30s edge and adding the sixth field tipped verbose batches
// over into "Task timed out after 30.00 seconds". Halving the batch ~halves
// the output per call — a comfortable margin under 30s — at the cost of twice
// as many calls (fine: curators are unmetered as of v0.56, and this button is
// primarily a curator/catalog tool). If this ever needs to go back up, the
// real fix is moving the proxy to a Netlify background function (15-min limit)
// rather than raising the batch under the 30s sync cap.
// v0.60.1: 5 → 10, reversing the v0.57 halving.
//
// That halving was forced by output length: six fields per book, one of them a
// 2-4 sentence description, pushed generation time onto the 30s edge. Dropping
// description removes by far the largest output field — the remaining five are
// a short array, a small object and three scalars — so the per-book generation
// cost is a fraction of what it was and 10 sits comfortably under the cap
// again. Halves the number of calls, which is where the fixed cost lives.
//
// If timeouts reappear, lower this first; the real fix remains moving the proxy
// to a Netlify background function rather than tuning the batch under a 30s
// synchronous ceiling.
// Retained as reference alongside buildPrompt(): oracleBatch.mjs batches to the
// same size, and the reasoning below is why that number is what it is.
const BATCH_SIZE = 10;

const UNVERIFIED_STATUSES = ['unreviewed', 'incomplete'];

// ---------- eligibility ----------

// v0.15 compat: still exported so OracleCategories view can use it.
export function getBooksNeedingGenres(books, genresByBookId) {
  return books.filter((b) => {
    if (!b.bookId) return false;
    if (!UNVERIFIED_STATUSES.includes(b.status || 'unreviewed')) return false;
    const genres = genresByBookId[b.bookId];
    return !genres || genres.length === 0;
  });
}

// Books the Oracle can still add something to.
//
// v0.60.1 — this used to return every unreviewed book unconditionally ("Option
// A: always re-run"), which was defensible when the Oracle also wrote
// descriptions: almost every book was missing one, so almost every book was
// genuinely work.
//
// It is not defensible now. Descriptions and books.genre are filled for free by
// metadataBackfill, so re-running the whole shelf bills Anthropic to regenerate
// fields that are already correct. The button should light up only for books
// missing something no free source can supply:
//
//   genres        the curated book_genres taxonomy — no API knows it
//   complexity    a reading of the prose
//   depth         a reading of the themes
//   author_gender only from a real biographical signal
//
// Series is excluded from the test on purpose: a standalone book legitimately
// has none, so "no series" can never mean "needs the Oracle" without making
// every standalone permanently eligible.
export function getBooksNeedingOracle(books, genresByBookId) {
  return books.filter((b) => {
    if (!b.bookId) return false;
    if (!UNVERIFIED_STATUSES.includes(b.status || 'unreviewed')) return false;

    // Client-side field names, not column names: bookRowToClient maps
    // complexity → c, depth → p, author_gender → ag. Using the column names
    // here reads as undefined on every book and quietly makes the whole shelf
    // eligible again, which is the exact bug this function exists to prevent.
    const genres = genresByBookId[b.bookId];
    if (!genres || genres.length === 0) return true;
    if (b.c == null) return true;
    if (b.p == null) return true;
    // `ag` is undefined for BOTH 'unknown' and never-checked, so it cannot
    // answer this on its own — 'unknown' is a final answer and re-asking bills
    // for the same shrug. agChecked reads author_gender_checked_at, which is
    // stamped either way.
    if (!b.agChecked) return true;

    return false;
  });
}

// ---------- helpers ----------

// Fill in a missing ISBN for a book the Oracle is already processing.
//
// Uses the same hardcoverSearch → pickBestEdition path as every other lookup, so an ISBN
// written here is chosen by identical rules to one written by the backfill script or the
// browser chain. Writes through upsert_book, whose coalesce(existing, incoming) merge
// means this can only fill a null — it can never overwrite a curated value.
async function topUpIsbn(book) {
  if (!book?.t || book.isbn) return;
  const hit = await hardcoverSearch(book.t, book.a).catch(() => null);
  if (!hit?.isbn) return;
  await supabase.rpc('upsert_book', {
    _title: book.t,
    _author: book.a || null,
    _isbn: hit.isbn,
    _hardcover_id: hit.hardcoverId || null,
  });
}


async function fetchAllGenres() {
  const {
    data,
    error
  } = await supabase.rpc('search_genres', {
    _query: '',
    _limit: 200,
  });
  if (error || !data) {
    console.warn('fetchAllGenres failed', error);
    return [];
  }
  return data;
}

function buildPrompt(books, existingGenres) {
  // Full catalog WITH descriptions. Names alone were not enough context —
  // the Oracle kept creating near-duplicates ("Epic Fantasy" / "Dark
  // Fantasy" / "Epic & Dark Fantasy" all existing side by side, "Gothic"
  // next to "Classic & Older Gothic") because a bare name reads as
  // ambiguous without the curatorial description clarifying what each
  // genre actually covers. Every genre in the table has a description now
  // specifically so this list can carry real disambiguating signal.
  const catalogList = existingGenres
    .map((g) => `- ${g.name}${g.description ? `: ${g.description}` : ''}`)
    .join('\n');

  const bookList = books
    .map((b, i) => {
      const title = b.t || b.title;
      const author = b.a || b.author;
      const description = b.d || b.description;
      const genreHint = b.g;
      const seriesHint = b.s ?.name;

      const parts = [`${i + 1}. Title: "${title || 'Unknown'}"`];
      if (author) parts.push(`   Author: ${author}`);
      if (genreHint) parts.push(`   Auto-genre hint: ${genreHint}`);
      if (seriesHint) parts.push(`   Series hint: ${seriesHint}`);
      // v0.60.1: description is now INPUT-only, and included whenever we have
      // one rather than only when the genre hint is missing.
      //
      // It used to be withheld to save tokens, back when the Oracle was also
      // generating descriptions and every token counted against the 30s cap.
      // Now that it only generates judgment fields, a real description is the
      // single most useful signal available for complexity and depth — those
      // are readings of the prose, and title plus author is thin evidence for
      // either. Input tokens are also far cheaper than output tokens, and
      // dropping description from the response freed plenty of both.
      if (description) {
        const desc = description.length > 400 ?
          description.slice(0, 400) + '…' :
          description;
        parts.push(`   Description: ${desc}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  const systemPrompt = `You are the The Books Oracle, a literary curator with deep expertise in Gothic fiction, horror, literary fiction, and speculative literature. You enrich book records for a curated reading app.

For each book you will return:
1. GENRES — 1-3 canonical genre labels from or inspired by the existing catalog
2. SERIES — series name, position, and total books (null if standalone)
3. COMPLEXITY — prose complexity, 1-5
4. DEPTH — thematic/genre depth, 1-5
5. AUTHOR GENDER — the author's gender, ONLY when you're confident from a real public signal

GENRE RULES:
- The existing catalog above is the source of truth. Read every description before deciding — a genre that looks unrelated by name alone (e.g. "International Fiction") may be exactly the right fit once you read what it actually covers.
- Reuse an existing genre whenever it reasonably fits, even if the wording isn't a perfect match. Do NOT create a new genre that is a synonym, word-reordering, or narrower/broader variant of one that already exists. For example: if "Dark & Epic Fantasy" exists, do not also create "Epic Fantasy" or "Epic & Dark Fantasy" for a similar book. If "Folk Horror" exists, do not create "British Folk Horror" or "Regional Folk Horror" — a regional or stylistic flavor of an existing genre is not a new genre.
- Before proposing a new genre, check: is this genre distinguishable from every existing genre by more than region, word order, or a synonym substitution? If not, use the existing one instead.
- When reusing an existing genre, copy its name EXACTLY as listed above — do not paraphrase, reorder words, or change punctuation.
- Only create a new genre when the catalog has a genuine gap: a book that doesn't fit any existing genre even loosely.
- When you do create a new genre, keep it specific and non-overlapping with anything already in the catalog, and match established naming style: evocative, specific, often using "&" (e.g. "Classic & Older Gothic").
- Assign 1-3 genres. Assign only 1 if the book clearly belongs to one category.

SERIES RULES:
- Return null for standalone books not part of any series.
- "total" may be null if the series is ongoing or total is unknown.

COMPLEXITY RULES (prose-level difficulty, 1 = approachable, 5 = challenging):
1 = casual/page-turners
2 = mid-difficulty
3 = literary
4 = challenging (e.g. Faulkner, Han Kang)
5 = experimental (e.g. Donoso, Lispector)
Judge sentence structure, vocabulary, and narrative technique — not length or genre.

DEPTH RULES (thematic/genre depth, 1 = approachable, 5 = challenging):
Judge how demanding the book's themes and ideas are within its own genre —
not prose difficulty. A simply-written book can still explore heavy, complex
themes (high depth, lower complexity) and vice versa.

Always return an integer 1-5 for both COMPLEXITY and DEPTH — never null and
never omit them, even when unsure; give your best-informed estimate.

AUTHOR GENDER RULES (strict — read carefully, this is not like COMPLEXITY/DEPTH):
- Return one of: "female", "male", "nonbinary", "mixed", "unknown".
- Only return "female", "male", or "nonbinary" when you have a real, reliable
  public signal: the author's own stated pronouns/identity, an official bio,
  publisher copy, or a well-known interview. Being confident the name "sounds"
  female or male is NOT a reliable signal — names are not a reliable indicator
  of gender, and guessing from one risks misgendering a real person. If you
  are not certain from an actual biographical fact, return "unknown".
- Use "mixed" for books with multiple credited authors/editors whose genders
  are not all the same (anthologies, co-authored nonfiction).
- Unlike COMPLEXITY/DEPTH, "unknown" is a normal, expected, frequent answer
  here — do not strain to produce a definite value. A wrong guess is worse
  than an honest "unknown".

EXISTING GENRE CATALOG (name: description):
${catalogList || '(empty — you are seeding the catalog)'}

RESPONSE FORMAT (JSON array, one object per book, in input order):
[
  {
    "index": 1,
    "genres": ["Exact Genre Name"],
    "series": { "name": "Series Name", "n": 1, "total": 3 },
    "complexity": 1-5,
    "depth": 1-5,
    "authorGender": "female" | "male" | "nonbinary" | "mixed" | "unknown"
  }
]
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.`;

  const userPrompt = `Enrich these ${books.length} books:\n\n${bookList}`;
  return {
    systemPrompt,
    userPrompt
  };
}

async function resolveGenreId(name) {
  const {
    data,
    error
  } = await supabase.rpc('upsert_genre', {
    _raw_name: name
  });
  if (error || !data || data.length === 0) {
    console.warn('upsert_genre failed for', name, error);
    return null;
  }
  return data[0].id;
}

// Clamp to an integer 1-5, or null if the Oracle didn't return something usable.
// Never write a bad value — a missing complexity/depth (null) is fine and just
// falls back to graceful degradation downstream (Match %, etc); a WRONG value
// baked into the DB is worse than no value.
function sanitizeLevel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1 || v > 5) return null;
  return v;
}

const VALID_AUTHOR_GENDERS = new Set(['female', 'male', 'nonbinary', 'mixed', 'unknown']);

// Anything the Oracle didn't return, or returned outside the allowed set, is
// treated as null (never checked) rather than 'unknown' (checked, no signal) —
// a malformed/missing response shouldn't be indistinguishable from a
// deliberate "no reliable signal" answer.
function sanitizeAuthorGender(v) {
  return VALID_AUTHOR_GENDERS.has(v) ? v : null;
}

// v0.60.1: `description` parameter removed. It used to sit between seriesData
// and complexity — if you are merging an older branch, check the call site
// rather than trusting positional arguments to line up.
async function writeBookEnrichment(bookId, genreIds, seriesData, complexity, depth, authorGender) {
  // 1. Genres
  for (const genreId of genreIds) {
    const {
      error
    } = await supabase.rpc('link_book_genre', {
      _book_id: bookId,
      _genre_id: genreId,
      _source: 'oracle',
    });
    if (error) console.warn('link_book_genre failed', bookId, genreId, error);
  }

  // 2. Complexity, depth, author gender — only write fields the Oracle actually
  // produced. author_gender_checked_at is stamped whenever authorGender is
  // present (including 'unknown') so "checked, inconclusive" stays
  // distinguishable from "never checked" (NULL) going forward.
  //
  // `description` is deliberately absent. It is filled by
  // batch-scripts/scheduled/metadataBackfill.mjs from Hardcover / Open Library
  // / Google Books, for free, and this write would clobber a real publisher
  // blurb with a generated one.
  const enrichPatch = {
    ...(complexity != null ? {
      complexity
    } : {}),
    ...(depth != null ? {
      depth
    } : {}),
    ...(authorGender ? {
      author_gender: authorGender,
      author_gender_source: 'oracle_inferred',
      author_gender_checked_at: new Date().toISOString(),
    } : {}),
  };

  // 3. Series — write via upsert_series RPC if we have a name
  if (seriesData ?.name) {
    await supabase.rpc('upsert_series', {
      _name: seriesData.name,
      _author: null,
      _description: null,
      _hardcover_id: null,
      _metadata: {},
      _publication_status: null,
      _total_books: seriesData.total || null,
      _status: 'oracle_categorized',
      _source: 'oracle',
      _verified_source: null,
    }).then(async ({
      data: seriesRow
    }) => {
      if (seriesRow ?.[0]?.id) {
        await supabase.from('books').update({
          series_id: seriesRow[0].id,
          position_in_series: seriesData.n || null,
          status: 'oracle_categorized',
          ...enrichPatch,
        }).eq('id', bookId);
      }
    });
  } else {
    // No series — just update status, description, complexity, depth
    await supabase.from('books').update({
      status: 'oracle_categorized',
      ...enrichPatch,
    }).eq('id', bookId);
  }
}

// ---------- main export ----------

// ── REMOVED in v0.61: runOracleCategorization() ───────────────────────────────
//
// This was the in-app execution path — the one the Wishlist/Library button
// called. It billed a reader's own Oracle quota to enrich the SHARED `books`
// catalog, which is the wrong party to charge: the genres and series it wrote
// benefit everyone who ever sees that book, not the person who pressed the
// button. A reader's five calls a month now go entirely to suggestions, plans
// and asking.
//
// The work moved to .github/workflows/nightly-curation.yml, which runs
// batch-scripts/manual/oracleBatch.mjs against the service role key on a
// capped nightly batch.
//
// WHAT STAYS, AND WHY
// buildPrompt() and its GENRE RULES remain above and are deliberately NOT
// deleted: they are the canonical statement of how the Oracle classifies a
// book, and oracleBatch.mjs mirrors them. Deleting the original because its
// only in-app caller went away would leave the copy as the sole source of
// truth for rules that took a long time to get right. They are reference now,
// not a live code path — nothing in src/ calls Claude for categorization.
//
// getBooksNeedingGenres() is still live: CurationNotice.jsx uses it to count
// what the nightly job has yet to reach.
