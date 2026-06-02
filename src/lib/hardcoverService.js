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

  // Pick the first hit, prefer ones whose document.title roughly matches
  const targetTitle = cleanTitle(query).toLowerCase();
  let bestHit = hits[0];
  for (const h of hits) {
    const doc = h.document || h;
    if (doc?.title && doc.title.toLowerCase().includes(targetTitle)) {
      bestHit = h;
      break;
    }
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

  // Pick the hit whose name most closely matches (case-insensitive substring)
  const target = seriesName.toLowerCase();
  let bestHit = hits[0];
  for (const h of hits) {
    const doc = h.document || h;
    if (doc?.name && doc.name.toLowerCase().includes(target)) {
      bestHit = h;
      break;
    }
  }
  const bestDoc = bestHit.document || bestHit;
  const seriesId = bestDoc?.id;
  const resolvedName = bestDoc?.name;
  if (!seriesId) return [];

  // Step 2: fetch the series's books in order
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
  return series.book_series
    .map((bs) => {
      const b = normalize(bs.book);
      if (!b) return null;
      if (b.s) {
        b.s.name = series.name || resolvedName;
        b.s.n = bs.position || b.s.n;
        b.s.total = series.primary_books_count || series.books_count || b.s.total;
      } else {
        b.s = {
          name: series.name || resolvedName,
          n: bs.position || null,
          total: series.primary_books_count || series.books_count || null,
          fromHardcover: true,
        };
      }
      return b;
    })
    .filter(Boolean);
}
