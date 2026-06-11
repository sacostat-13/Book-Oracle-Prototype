// oracleCategorizationService.js
// v0.15 phase 2.4 — Oracle genre categorization.
//
// WHAT IT DOES
// Filters books that are (a) status in ['unreviewed', 'incomplete'] AND
// (b) have no genres assigned, then batches them 20 at a time, sends each
// batch to Claude via the existing Netlify proxy, and writes the results
// back to Supabase using the upsert_genre / link_book_genre / update RPCs.
//
// FAILURE MODEL
// One bad batch is logged and skipped; the rest continue. The caller receives
// progress callbacks so the UI can show a progress bar.

import { supabase } from './supabase';
import { callClaude, parseJSONResponse } from './claudeApi';

const BATCH_SIZE = 20;
const UNVERIFIED_STATUSES = ['unreviewed', 'incomplete'];

// ---------- helpers ----------

// Resolve which books in the given list need genres.
// A book "needs genres" if:
//   - its status is unreviewed or incomplete, AND
//   - it has no entries in genresByBookId for its bookId.
export function getBooksNeedingGenres(books, genresByBookId) {
  return books.filter((b) => {
    if (!b.bookId) return false; // no DB id → can't write genres
    if (!UNVERIFIED_STATUSES.includes(b.status || 'unreviewed')) return false;
    const genres = genresByBookId[b.bookId];
    return !genres || genres.length === 0;
  });
}

// Fetch the full global genre catalog from the DB (for the prompt).
async function fetchAllGenres() {
  const { data, error } = await supabase.rpc('search_genres', {
    _query: '',
    _limit: 200,
  });
  if (error || !data) {
    console.warn('fetchAllGenres failed', error);
    return [];
  }
  return data; // [{ id, name, normalized_name, source, usage_count, exact_match }]
}

// Build the system + user prompt for one batch of books.
function buildPrompt(books, existingGenres) {
  const catalogList = existingGenres
    .map((g) => `- ${g.name}`)
    .join('\n');

  const bookList = books
    .map((b, i) => {
      // Client book shape uses t/a/d/g (short keys from bookRowToClient)
      const title = b.t || b.title;
      const author = b.a || b.author;
      const description = b.d || b.description;
      const genreHint = b.g;

      const parts = [`${i + 1}. Title: "${title || 'Unknown'}"`];
      if (author) parts.push(`   Author: ${author}`);
      if (genreHint) parts.push(`   Auto-genre hint: ${genreHint}`);
      if (description) {
        const desc = description.length > 300
          ? description.slice(0, 300) + '…'
          : description;
        parts.push(`   Description: ${desc}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  const systemPrompt = `You are the Book Oracle, a literary genre curator with deep expertise in Gothic fiction, horror, literary fiction, and speculative literature. You assign canonical genre labels to books for a curated reading app.

You will be given a list of books and a catalog of existing genre labels. Your task is to assign 1-3 genres to each book.

RULES:
1. STRONGLY prefer genres from the existing catalog. Only invent a new genre label when NO existing genre fits at all.
2. If you must invent a genre, match the established naming style exactly: evocative, specific, often using "&" to combine (e.g. "Classic & Older Gothic", "Sapphic & Feminist Gothic").
3. Assign 1-3 genres per book. Assign only 1 if the book clearly belongs to one category.
4. Return ONLY valid JSON. No preamble, no explanation, no markdown fences.

EXISTING GENRE CATALOG:
${catalogList || '(empty — you are seeding the catalog)'}

RESPONSE FORMAT (JSON array, one object per book, in the same order as input):
[
  {
    "index": 1,
    "genres": ["Exact Genre Name", "Another Genre Name"]
  },
  ...
]`;

  const userPrompt = `Assign genres to these ${books.length} books:\n\n${bookList}`;

  return { systemPrompt, userPrompt };
}

// Upsert a genre by name and return its id. Uses the DB's upsert_genre RPC.
async function resolveGenreId(name) {
  const { data, error } = await supabase.rpc('upsert_genre', { _raw_name: name });
  if (error || !data || data.length === 0) {
    console.warn('upsert_genre failed for', name, error);
    return null;
  }
  return data[0].id;
}

// Link a book to a genre and flip its status to oracle_categorized.
async function assignGenresToBook(bookId, genreIds) {
  // Link each genre
  for (const genreId of genreIds) {
    const { error } = await supabase.rpc('link_book_genre', {
      _book_id: bookId,
      _genre_id: genreId,
      _source: 'oracle',
    });
    if (error) console.warn('link_book_genre failed', bookId, genreId, error);
  }
  // Flip status to oracle_categorized
  const { error: statusErr } = await supabase
    .from('books')
    .update({ status: 'oracle_categorized' })
    .eq('id', bookId);
  if (statusErr) console.warn('status update failed', bookId, statusErr);
}

// ---------- main export ----------

/**
 * Run Oracle categorization on a list of books.
 *
 * @param {Object}   opts
 * @param {Array}    opts.books          — books needing genres (pre-filtered by getBooksNeedingGenres)
 * @param {Function} opts.onProgress     — (done, total) callback
 * @param {Function} opts.onBatchResult  — ({ assignments: [{ bookId, genres }], batchIndex }) callback
 *                                         called after each batch so UI can update immediately
 * @param {Function} opts.onError        — (err, batchIndex) called when a batch fails (non-fatal)
 *
 * @returns {Promise<{ processed: number, failed: number }>}
 */
export async function runOracleCategorization({ books, onProgress, onBatchResult, onError }) {
  const total = books.length;
  let processed = 0;
  let failed = 0;

  // Fetch the current genre catalog once for all batches
  const existingGenres = await fetchAllGenres();

  // Chunk into batches of BATCH_SIZE
  const batches = [];
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    batches.push(books.slice(i, i + BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    try {
      const { systemPrompt, userPrompt } = buildPrompt(batch, existingGenres);
      const raw = await callClaude(userPrompt, systemPrompt);
      const parsed = parseJSONResponse(raw);

      if (!Array.isArray(parsed)) {
        console.warn(`Batch ${batchIdx + 1}: Claude returned non-array`, raw);
        failed += batch.length;
        onError?.(`Batch ${batchIdx + 1} returned an unexpected response. Stopping.`, batchIdx);
        onProgress?.(processed + batch.length, total);
        break; // fail-fast: stop all remaining batches
      }

      const batchAssignments = [];

      for (const item of parsed) {
        const bookIdx = (item.index || 0) - 1; // 1-indexed in prompt
        if (bookIdx < 0 || bookIdx >= batch.length) continue;
        const book = batch[bookIdx];
        if (!book.bookId) continue;

        const genreNames = Array.isArray(item.genres) ? item.genres.slice(0, 3) : [];
        if (genreNames.length === 0) continue;

        // Resolve (or create) each genre in the DB
        const resolvedGenres = [];
        for (const name of genreNames) {
          const id = await resolveGenreId(name);
          if (!id) continue;
          // Find or synthesize the genre object for state update
          const existing = existingGenres.find((g) => g.id === id);
          resolvedGenres.push({
            genreId: id,
            name: existing?.name || name,
            normalizedName: existing?.normalized_name || name.toLowerCase().replace(/[^a-z0-9]/g, ''),
            source: existing?.source || 'oracle',
            usageCount: existing?.usage_count || 0,
            assignedBySource: 'oracle',
          });
          // Add to our local catalog so later batches in this run can reuse it
          if (!existingGenres.find((g) => g.id === id)) {
            existingGenres.push({ id, name, normalized_name: resolvedGenres.at(-1).normalizedName, source: 'oracle', usage_count: 0 });
          }
        }

        if (resolvedGenres.length === 0) continue;

        // Write to DB
        await assignGenresToBook(book.bookId, resolvedGenres.map((g) => g.genreId));

        batchAssignments.push({ bookId: book.bookId, genres: resolvedGenres });
        processed++;
      }

      // Notify caller so it can update DataContext immediately
      if (batchAssignments.length > 0) {
        onBatchResult?.({ assignments: batchAssignments, batchIndex: batchIdx });
      }

      // Count books in batch not matched in the response as processed (skipped gracefully)
      const unmatched = batch.length - parsed.filter((item) => {
        const i = (item.index || 0) - 1;
        return i >= 0 && i < batch.length;
      }).length;
      processed += unmatched;

    } catch (err) {
      console.error(`Batch ${batchIdx + 1} threw`, err);
      failed += batch.length;
      processed += batch.length;
      onError?.(`Batch ${batchIdx + 1} failed: ${err.message}. Stopping.`, batchIdx);
      onProgress?.(processed, total);
      break; // fail-fast: stop all remaining batches
    }

    onProgress?.(processed, total);
  }

  return { processed, failed };
}
