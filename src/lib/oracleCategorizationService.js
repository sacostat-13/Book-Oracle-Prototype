// oracleCategorizationService.js
// v0.21 — Oracle now handles genres, series, AND descriptions in one batch call.
//
// WHAT IT DOES
// Runs on books with status in ['unreviewed', 'incomplete'] — one Claude call
// per batch of 20 returns genres, series info, and a description for each book.
// All three are written back to Supabase in the same pass.
//
// 'discovered' books are intentionally excluded: they haven't been added to
// anyone's collection, so spending tokens on them isn't warranted.
//
// FAILURE MODEL
// One bad batch is logged and skipped; the rest continue. The caller receives
// progress callbacks so the UI can show a progress bar.

import { supabase } from './supabase';
import { callClaude, parseJSONResponse, QuotaExceededError } from './claudeApi';

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

// v0.21: broader eligibility — any book needing genres, series, OR description.
// Option A (always re-run): pass all unreviewed/incomplete books.
// The Oracle overwrites all three fields unconditionally.
export function getBooksNeedingOracle(books, genresByBookId) {
  return books.filter((b) => {
    if (!b.bookId) return false;
    if (!UNVERIFIED_STATUSES.includes(b.status || 'unreviewed')) return false;
    return true; // Option A: run on all eligible books every time
  });
}

// ---------- helpers ----------

async function fetchAllGenres() {
  const { data, error } = await supabase.rpc('search_genres', {
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
  // Short catalog: just names, no descriptions, to keep the prompt lean.
  const catalogList = existingGenres
    .map((g) => `- ${g.name}`)
    .join('\n');

  const bookList = books
    .map((b, i) => {
      const title = b.t || b.title;
      const author = b.a || b.author;
      const description = b.d || b.description;
      const genreHint = b.g;
      const seriesHint = b.s?.name;

      const parts = [`${i + 1}. Title: "${title || 'Unknown'}"`];
      if (author) parts.push(`   Author: ${author}`);
      if (genreHint) parts.push(`   Auto-genre hint: ${genreHint}`);
      if (seriesHint) parts.push(`   Series hint: ${seriesHint}`);
      // Only include description when it adds signal beyond title/author/genre.
      // Keep it short to stay within the Netlify 30s timeout.
      if (description && !genreHint) {
        const desc = description.length > 150
          ? description.slice(0, 150) + '…'
          : description;
        parts.push(`   Description: ${desc}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  const systemPrompt = `You are the Book Oracle, a literary curator with deep expertise in Gothic fiction, horror, literary fiction, and speculative literature. You enrich book records for a curated reading app.

For each book you will return:
1. GENRES — 1-3 canonical genre labels from or inspired by the existing catalog
2. SERIES — series name, position, and total books (null if standalone)
3. DESCRIPTION — a rich 2-4 sentence description in the style of a literary review

GENRE RULES:
- STRONGLY prefer genres from the existing catalog. Use descriptions to understand precise curatorial intent.
- Only invent a new genre when NO existing genre fits at all.
- Match established naming style: evocative, specific, often using "&" (e.g. "Classic & Older Gothic").
- Assign 1-3 genres. Assign only 1 if the book clearly belongs to one category.

SERIES RULES:
- Return null for standalone books not part of any series.
- "total" may be null if the series is ongoing or total is unknown.

DESCRIPTION RULES:
- 2-4 sentences. Evocative, literary, informative — not a blurb or marketing copy.
- Focus on themes, tone, and what makes the book distinctive.
- Write in English regardless of the book's original language.
- If you already see a good description in the input, you may improve it or keep it.

EXISTING GENRE CATALOG (name: description):
${catalogList || '(empty — you are seeding the catalog)'}

RESPONSE FORMAT (JSON array, one object per book, in input order):
[
  {
    "index": 1,
    "genres": ["Exact Genre Name"],
    "series": { "name": "Series Name", "n": 1, "total": 3 },
    "description": "Rich literary description here."
  }
]
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.`;

  const userPrompt = `Enrich these ${books.length} books:\n\n${bookList}`;
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

async function writeBookEnrichment(bookId, genreIds, seriesData, description) {
  // 1. Genres
  for (const genreId of genreIds) {
    const { error } = await supabase.rpc('link_book_genre', {
      _book_id: bookId,
      _genre_id: genreId,
      _source: 'oracle',
    });
    if (error) console.warn('link_book_genre failed', bookId, genreId, error);
  }

  // 2. Description — only write if Oracle produced one
  const descPatch = description ? { description } : {};

  // 3. Series — write via upsert_series RPC if we have a name
  if (seriesData?.name) {
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
    }).then(async ({ data: seriesRow }) => {
      if (seriesRow?.[0]?.id) {
        await supabase.from('books').update({
          series_id: seriesRow[0].id,
          position_in_series: seriesData.n || null,
          status: 'oracle_categorized',
          ...descPatch,
        }).eq('id', bookId);
      }
    });
  } else {
    // No series — just update status and description
    await supabase.from('books').update({
      status: 'oracle_categorized',
      ...descPatch,
    }).eq('id', bookId);
  }
}

// ---------- main export ----------

/**
 * Run Oracle enrichment (genres + series + descriptions) on a list of books.
 *
 * @param {Object}   opts
 * @param {Array}    opts.books         — pre-filtered eligible books
 * @param {Function} opts.onProgress    — (done, total) callback
 * @param {Function} opts.onBatchResult — ({ assignments, batchIndex }) callback
 * @param {Function} opts.onError       — (err, batchIndex) non-fatal
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
      let raw;
      try {
        raw = await callClaude(userPrompt, systemPrompt);
      } catch (err) {
        if (err instanceof QuotaExceededError) throw err; // propagate to button
        throw err;
      }
      const parsed = parseJSONResponse(raw);

      if (!Array.isArray(parsed)) {
        console.warn(`Batch ${batchIdx + 1}: non-array response`, raw);
        failed += batch.length;
        onError?.(`Batch ${batchIdx + 1} returned an unexpected response.`, batchIdx);
        processed += batch.length;
        onProgress?.(processed, total);
        continue;
      }

      const batchAssignments = [];

      for (const item of parsed) {
        const bookIdx = (item.index || 0) - 1;
        if (bookIdx < 0 || bookIdx >= batch.length) continue;
        const book = batch[bookIdx];
        if (!book.bookId) continue;

        // Genres
        const genreNames = Array.isArray(item.genres) ? item.genres.slice(0, 3) : [];
        const resolvedGenres = (
          await Promise.all(
            genreNames.map(async (name) => {
              const id = await resolveGenreId(name);
              if (!id) return null;
              const existing = existingGenres.find((g) => g.id === id);
              if (!existing) {
                existingGenres.push({
                  id, name,
                  normalized_name: name.toLowerCase().replace(/[^a-z0-9]/g, ''),
                  source: 'oracle', usage_count: 0, description: null,
                });
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

        // Series and description
        const seriesData = item.series || null;
        const description = item.description || null;

        await writeBookEnrichment(
          book.bookId,
          resolvedGenres.map((g) => g.genreId),
          seriesData,
          description
        );

        batchAssignments.push({
          bookId: book.bookId,
          genres: resolvedGenres,
          series: seriesData,
          description,
        });

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
