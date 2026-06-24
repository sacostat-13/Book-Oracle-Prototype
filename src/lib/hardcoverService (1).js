// Hardcover client. All calls go through our Netlify Function proxy so the
// API token never reaches the browser.
//
// Important constraints from Hardcover docs:
//   - No text search operators (_like, _ilike, _regex). Use _eq, _in, _or.
//   - search() returns a JSON blob with hits in `results.hits[]`
//   - Rate-limited to 60 requests/minute
//   - query_type values are case-sensitive in practice; use "Book", "Series", etc.
//
// Schema relevant subset:
//   books(where, limit, order_by) → [{ id, title, pages, description,
//     contributions { author { name } }, image { url },
//     book_series { position, series { id, name, books_count, primary_books_count } },
//     editions(limit) { isbn_13, isbn_10 } }]
//   editions(where) → [{ book }]
//   series(where) → [{ id, name, books_count, book_series { position, book } }]
//   search(query, query_type, per_page, page) → { results: <json> }

import { cleanTitle, cleanAuthor } from './bookHelpers';

const ENDPOINT = '/.netlify/functions/hardcover';

async function gql(query, variables = {}) {
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      // Try to read the body for diagnostics — Hardcover usually includes a
      // helpful errors[] array even on 400 responses.
      let detail = '';
      try {
        const body = await resp.text();
        detail = body.slice(0, 300);
      } catch {}
      console.warn(`[hardcover] proxy ${resp.status}`, detail);
      return null;
    }
    const data = await resp.json();
    if (data.errors) {
      console.warn('[hardcover] GraphQL errors', data.errors);
      // Even with errors, data.data may have partial results
    }
    return data.data || null;
  } catch (e) {
    console.warn('[hardcover] request failed', e);
    return null;
  }
}

// Normalize a Hardcover book node into our internal shape.
function normalize(node) {
  if (!node) return null;
  const author = (node.contributions || [])
    .map((c) => c?.author?.name)
    .filter(Boolean)[0] || null;
  const bs = (node.book_series || [])[0];
  const series = bs?.series
    ? {
        name: bs.series.name,
        n: bs.position || null,
        total: bs.series.primary_books_count || bs.series.books_count || null,
        fromHardcover: true,
      }
    : null;
  return {
    t: node.title,
    a: author || 'Unknown author',
    d: node.description || null,
    pp: node.pages || null,
    coverUrl: node.image?.url || null,
    s: series,
    isbn: extractIsbnFromEditions(node.editions),
    hardcoverId: node.id || null,
    fromHardcover: true,
  };
}

function extractIsbnFromEditions(editions) {
  if (!editions || editions.length === 0) return null;
  for (const e of editions) {
    if (e.isbn_13) return e.isbn_13;
    if (e.isbn_10) return e.isbn_10;
  }
  return null;
}

// Reusable fragment of book fields. Keep depth shallow — Hardcover allows
// limited nesting and the proxy enforces a depth guard.
const BOOK_FIELDS = `
  id
  title
  pages
  description
  image { url }
  contributions { author { name } }
  book_series { position series { id name books_count primary_books_count } }
  editions(limit: 3) { isbn_13 isbn_10 }
`;

// ---------- Public API ----------

// Look up by ISBN-13 or ISBN-10. Uses `_or` which Hardcover's Hasura backend supports.
export async function hardcoverLookupByIsbn(isbn) {
  if (!isbn) return null;
  const data = await gql(
    `query LookupByIsbn($isbn: String!) {
       editions(
         where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }
         limit: 1
       ) {
         book { ${BOOK_FIELDS} }
       }
     }`,
    { isbn }
  );
  return normalize(data?.editions?.[0]?.book);
}

// Look up by ASIN — try as ISBN-10 first (many ASINs ARE ISBN-10s), then search.
export async function hardcoverLookupByAsin(asin) {
  if (!asin) return null;
  if (/^\d{9}[\dX]$/i.test(asin)) {
    const byIsbn = await hardcoverLookupByIsbn(asin);
    if (byIsbn) return byIsbn;
  }
  return hardcoverSearch(asin);
}

// Search by free text. Hardcover's search() returns Typesense-style hits in
// `results.hits[]` where each hit has a `document` containing the actual fields.
export async function hardcoverSearch(query, author) {
  if (!query) return null;
  const q = author ? `${cleanTitle(query)} ${cleanAuthor(author)}` : cleanTitle(query);
  const data = await gql(
    `query SearchBooks($q: String!, $type: String!) {
       search(query: $q, query_type: $type, per_page: 5, page: 1) {
         results
       }
     }`,
    { q, type: 'Book' }
  );
  const results = data?.search?.results;
  if (!results) return null;
  // Hardcover returns Typesense hits — try several shapes defensively
  const hits = results?.hits || results?.results || [];
  if (!hits.length) return null;

  // Pick the best hit.
  // Hardcover sets document.compilation=true on box sets/collected editions.
  // Heuristics catch edge cases. Popularity breaks ties between equal scores.
  const targetTitle = cleanTitle(query).toLowerCase();
  const COMPILATION_KW_RX = /\b(omnibus|box\s*set|complete\s+collect|books?\s+\d+[-\u2013\u2014]\d+|volumes?\s+\d+[-\u2013\u2014]\d+|complet[ea]|anthology)\b/i;
  function isCompilation(doc) {
    if (doc?.compilation === true) return true;
    const title = doc?.title || '';
    if (COMPILATION_KW_RX.test(title)) return true;
    if ((title.match(/,/g) || []).length >= 3) return true;
    if (/^[^:]+\'s\s*:/i.test(title)) return true;
    return false;
  }
  function scoreHit(h) {
    const doc = h.document || h;
    const title = doc?.title || '';
    const titleMatch = title.toLowerCase().includes(targetTitle);
    const compilation = isCompilation(doc);
    const popularity = doc?.users_count || doc?.ratings_count || 0;
    return (compilation ? -10 : 0) + (titleMatch ? 2 : 0) + Math.min(popularity / 1000, 1);
  }
  let bestHit = hits[0];
  let bestScore = scoreHit(hits[0]);
  for (const h of hits.slice(1)) {
    const s = scoreHit(h);
    if (s > bestScore) { bestScore = s; bestHit = h; }
  }

  // Pull the book ID and fetch full record for clean data
  const doc = bestHit.document || bestHit;
  const bookId = doc?.id || doc?._id || bestHit?.id;
  if (bookId) {
    const full = await hardcoverGetBook(bookId);
    if (full) return full;
  }
  // Last resort: use the search hit data directly
  return normalizeSearchHit(bestHit);
}

function normalizeSearchHit(hit) {
  const doc = hit.document || hit;
  if (!doc) return null;
  const authors =
    doc.author_names ||
    (doc.contributions || []).map((c) => c?.author?.name).filter(Boolean) ||
    [];
  return {
    t: doc.title,
    a: authors[0] || 'Unknown author',
    d: doc.description || null,
    pp: doc.pages || null,
    coverUrl: doc.image?.url || null,
    s: null,
    isbn: doc.isbn_13 || doc.isbn_10 || null,
    hardcoverId: doc.id || null,
    fromHardcover: true,
  };
}

// Fetch a full book record by Hardcover book ID.
// Search returning multiple results for the nav search dropdown.
// Returns up to `limit` hits scored/sorted by relevance, non-compilation first.
// Each result is a normalized book object (same shape as hardcoverSearch return).
export async function hardcoverSearchMulti(query, limit = 6) {
  if (!query || query.trim().length < 2) return [];
  const q = cleanTitle(query.trim());
  const data = await gql(
    `query SearchBooks($q: String!, $type: String!) {
       search(query: $q, query_type: $type, per_page: 10, page: 1) {
         results
       }
     }`,
    { q, type: 'Book' }
  );
  const results = data?.search?.results;
  if (!results) return [];
  const hits = results?.hits || results?.results || [];
  if (!hits.length) return [];

  const targetTitle = q.toLowerCase();
  const COMPILATION_KW_RX = /\b(omnibus|box\s*set|complete\s+collect|books?\s+\d+[-\u2013\u2014]\d+|volumes?\s+\d+[-\u2013\u2014]\d+|complet[ea]|anthology)\b/i;
  function isCompilation(doc) {
    if (doc?.compilation === true) return true;
    const title = doc?.title || '';
    if (COMPILATION_KW_RX.test(title)) return true;
    if ((title.match(/,/g) || []).length >= 3) return true;
    if (/^[^:]+\'s\s*:/i.test(title)) return true;
    return false;
  }
  function scoreHit(h) {
    const doc = h.document || h;
    const title = doc?.title || '';
    const titleMatch = title.toLowerCase().includes(targetTitle);
    const compilation = isCompilation(doc);
    const popularity = doc?.users_count || doc?.ratings_count || 0;
    return (compilation ? -10 : 0) + (titleMatch ? 2 : 0) + Math.min(popularity / 1000, 1);
  }

  const scored = hits
    .map((h) => ({ h, score: scoreHit(h) }))
    .filter(({ score }) => score > -10) // drop pure compilations with no title match
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Normalize each hit directly from document fields (no full getBook fetch
  // to keep search fast). normalizeSearchHit fills in what we need for display.
  return scored.map(({ h }) => normalizeSearchHit(h)).filter(Boolean);
}

export async function hardcoverGetBook(id) {
  if (!id) return null;
  const data = await gql(
    `query GetBook($id: Int!) {
       books(where: { id: { _eq: $id } }, limit: 1) {
         ${BOOK_FIELDS}
       }
     }`,
    { id: typeof id === 'string' ? parseInt(id, 10) : id }
  );
  return normalize(data?.books?.[0]);
}

// Fetch all books in a series. Strategy: use search() to find the series ID
// (since `_ilike` isn't allowed for name matching), then query the series with
// _eq on the resolved name.
export async function hardcoverFetchSeriesBooks(seriesName) {
  if (!seriesName) return [];

  // Step 1: find the series via search
  const searchData = await gql(
    `query SearchSeries($q: String!, $type: String!) {
       search(query: $q, query_type: $type, per_page: 3, page: 1) {
         results
       }
     }`,
    { q: seriesName, type: 'Series' }
  );
  const hits = searchData?.search?.results?.hits || searchData?.search?.results?.results || [];
  if (!hits.length) return [];

  // Pick the series hit: exact name match beats substring match.
  const target = seriesName.toLowerCase().trim();
  let bestHit = hits[0];
  let bestSeriesScore = 0;
  for (const h of hits) {
    const doc = h.document || h;
    const name = (doc?.name || '').toLowerCase().trim();
    const score = name === target ? 2 : name.includes(target) ? 1 : 0;
    if (score > bestSeriesScore) { bestSeriesScore = score; bestHit = h; }
  }
  const bestDoc = bestHit.document || bestHit;
  const seriesId = bestDoc?.id;
  const resolvedName = bestDoc?.name;
  if (!seriesId) return [];

  // Step 2: fetch the series books in order.
  // primary_book: true excludes novellas, companion books, and special editions
  // that inflate books_count. primary_books_count is the authoritative total.
  const data = await gql(
    `query GetSeries($id: Int!) {
       series(where: { id: { _eq: $id } }, limit: 1) {
         id
         name
         books_count
         primary_books_count
         book_series(order_by: { position: asc }) {
           position
           book { ${BOOK_FIELDS} }
         }
       }
     }`,
    { id: typeof seriesId === 'string' ? parseInt(seriesId, 10) : seriesId }
  );
  const series = data?.series?.[0];
  if (!series?.book_series) return [];
  // primary_books_count is the authoritative main-sequence length.
  // Filter to entries with a position <= primary_books_count to exclude
  // novellas and short stories that Hardcover numbers but don't count as
  // primary books (e.g. Earthseed has 14 numbered entries, primary=2).
  // Fall back to all non-null-position entries if primary_books_count missing.
  const primaryTotal = series.primary_books_count || null;
  let primaryEntries = series.book_series.filter((bs) =>
    bs.position != null && (primaryTotal == null || bs.position <= primaryTotal)
  );
  // If we have fewer entries than primaryTotal, some books have null positions
  // (a Hardcover data gap). Include them to avoid showing a blank slot in the series.
  if (primaryTotal && primaryEntries.length < primaryTotal) {
    const nullPositionEntries = series.book_series.filter((bs) => bs.position == null);
    const needed = primaryTotal - primaryEntries.length;
    primaryEntries = [...primaryEntries, ...nullPositionEntries.slice(0, needed)];
  }
  return primaryEntries
    .map((bs) => {
      const b = normalize(bs.book);
      if (!b) return null;
      if (b.s) {
        b.s.name = series.name || resolvedName;
        b.s.n = bs.position || b.s.n;
        b.s.total = primaryTotal || b.s.total;
      } else {
        b.s = {
          name: series.name || resolvedName,
          n: bs.position || null,
          total: primaryTotal || null,
          fromHardcover: true,
        };
      }
      return b;
    })
    .filter(Boolean);
}
