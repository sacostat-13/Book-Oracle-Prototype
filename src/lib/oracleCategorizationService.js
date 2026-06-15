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
// Statuses eligible for Oracle enrichment.
// 'discovered' is intentionally excluded: those books haven't been added
// to anyone's collection yet, so spending tokens on them isn't warranted.
const UNVERIFIED_STATUSES = ['unreviewed', 'incomplete'];

// ---------- helpers ----------

export function getBooksNeedingGenres(books, genresByBookId) {
  return books.filter((b) => {
    if (!b.bookId) return false;
    if (!UNVERIFIED_STATUSES.includes(b.status || 'unreviewed')) return false;
    const genres = genresByBookId[b.bookId];
    return !genres || genres.length === 0;
  });
}

async function fetchAllGenres() {
  const { data, error } = await supabase.rpc('search_genres', {
    _query: '',
    _limit: 200,
  });
  if (error || !data) {
    console.warn('fetchAllGenres failed', error);
    return [];
  }
  return data; // [{ id, name, normalized_name, description, source, usage_count, exact_match }]
}

function buildPrompt(books, existingGenres) {
  // Include description when available so the Oracle matches on meaning, not just name
  const catalogList = existingGenres
    .map((g) => g.description
      ? `- ${g.name}: ${g.description}`
      : `- ${g.name}`
    )
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

You will be given a list of books and a catalog of existing genre labels, each with a description of what that genre means in this app's curation system. Your task is to assign 1-3 genres to each book.

RULES:
1. STRONGLY prefer genres from the existing catalog. Use the descriptions to understand the precise intent of each genre — they define the curatorial lens, not just the label.
2. Only invent a new genre label when NO existing genre fits at all.
3. If you must invent a genre, match the established naming style exactly: evocative, specific, often using "&" to combine (e.g. "Classic & Older Gothic", "Sapphic & Feminist Gothic").
4. Assign 1-3 genres per book. Assign only 1 if the book clearly belongs to one category.
5. Return ONLY valid JSON. No preamble, no explanation, no markdown fences.

EXISTING GENRE CATALOG (name: description):
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

async function resolveGenreId(name) {
  const { data, error } = await supabase.rpc('upsert_genre', { _raw_name: name });
  if (error || !data || data.length === 0) {
    console.warn('upsert_genre failed for', name, error);
    return null;
  }
  return data[0].id;
}

async function assignGenresToBook(bookId, genreIds) {
  for (const genreId of genreIds) {
    const { error } = await supabase.rpc('link_book_genre', {
      _book_id: bookId,
      _genre_id: genreId,
      _source: 'oracle',
    });
    if (error) console.warn('link_book_genre failed', bookId, genreId, error);
  }
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
 * @param {Function} opts.onError        — (err, batchIndex) called when a batch fails (non-fatal)
 *
 * @returns {Promise<{ processed: number, failed: number }>}
 */
export async function runOracleCategorization({ books, onProgress, onBatchResult, onError }) {
  const total = books.length;
  let processed = 0;
  let failed = 0;

  const existingGenres = await fetchAllGenres();

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
        onError?.(`Batch ${batchIdx + 1} returned an unexpected response.`, batchIdx);
        onProgress?.(processed + batch.length, total);
        processed += batch.length;
        continue;
      }

      const batchAssignments = [];

      for (const item of parsed) {
        const bookIdx = (item.index || 0) - 1;
        if (bookIdx < 0 || bookIdx >= batch.length) continue;
        const book = batch[bookIdx];
        if (!book.bookId) continue;

        const genreNames = Array.isArray(item.genres)
          ? item.genres.slice(0, 3)
          : [];

        const resolvedGenres = (
          await Promise.all(
            genreNames.map(async (name) => {
              const id = await resolveGenreId(name);
              if (!id) return null;
              const existing = existingGenres.find((g) => g.id === id);
              if (!existing) {
                existingGenres.push({ id, name, normalized_name: name.toLowerCase().replace(/[^a-z0-9]/g, ''), source: 'oracle', usage_count: 0, description: null });
              }
              return {
                genreId: id,
                name: existing?.name || name,
                normalizedName: existing?.normalized_name || name.toLowerCase().replace(/[^a-z0-9]/g, ''),
                source: existing?.source || 'oracle',
                usageCount: existing?.usage_count || 0,
                description: existing?.description || null,
                assignedBySource: 'oracle',
              };
            })
          )
        ).filter(Boolean);

        if (resolvedGenres.length > 0) {
          await assignGenresToBook(book.bookId, resolvedGenres.map((g) => g.genreId));
          batchAssignments.push({ bookId: book.bookId, genres: resolvedGenres });
        }

        processed++;
        onProgress?.(processed, total);
      }

      onBatchResult?.({ assignments: batchAssignments, batchIndex: batchIdx });

    } catch (err) {
      console.error(`Batch ${batchIdx + 1} failed:`, err);
      failed += batch.length;
      processed += batch.length;
      onError?.(`Batch ${batchIdx + 1} failed: ${err.message}`, batchIdx);
    }

    onProgress?.(processed, total);
  }

  return { processed, failed };
}
