// Hardcover client. All calls go through our Netlify Function proxy so the
// API token never reaches the browser.
//
// Hardcover's GraphQL schema (relevant subset):
//   search(query, query_type, per_page, page) → { results: [...] }
//   books(where, limit) → [{ id, title, pages, description, contributions { author { name } }, image { url }, book_series { series { name }, position } }]
//   editions(where: { isbn_13/isbn_10 }) → [{ book { ... } }]
//   series(where, limit) → [{ name, books_count, primary_books_count, book_series { book { ... }, position } }]

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
      console.warn('[hardcover] proxy returned', resp.status);
      return null;
    }
    const data = await resp.json();
    if (data.errors) {
      console.warn('[hardcover] GraphQL errors', data.errors);
      // Don't return null just because of partial errors; data may still be present
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
  // Hardcover sometimes has a normalized rating between 0-5
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

const BOOK_FIELDS = `
  id
  title
  pages
  description
  image { url }
  contributions { author { name } }
  book_series { position series { name books_count primary_books_count } }
  editions(limit: 3) { isbn_13 isbn_10 }
`;

// ---------- Public API ----------

// Look up by ISBN-13 or ISBN-10.
export async function hardcoverLookupByIsbn(isbn) {
  if (!isbn) return null;
  const data = await gql(
    `query ($isbn: String!) {
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

// Look up by ASIN (Amazon identifier). Hardcover's edition records sometimes
// contain ASIN; fall back to search if not found.
export async function hardcoverLookupByAsin(asin) {
  if (!asin) return null;
  // Try as ISBN-10 first (some ASINs ARE ISBN-10s for older print books)
  if (/^\d{9}[\dX]$/i.test(asin)) {
    const byIsbn = await hardcoverLookupByIsbn(asin);
    if (byIsbn) return byIsbn;
  }
  // Fall back to search
  return hardcoverSearch(asin);
}

// Search by free text (title, or "title author"). Returns the best match.
export async function hardcoverSearch(query, author) {
  if (!query) return null;
  const q = author ? `${cleanTitle(query)} ${cleanAuthor(author)}` : cleanTitle(query);
  const data = await gql(
    `query ($q: String!) {
       search(query: $q, query_type: "Book", per_page: 5, page: 1) {
         results
       }
     }`,
    { q }
  );
  const results = data?.search?.results;
  // search() returns a JSON blob with hits, not the same shape as books query
  const hits = results?.hits || results?.results || [];
  if (!hits.length) return null;
  // Pull the book ID from the first hit and fetch full record
  const firstHit = hits[0];
  const bookId =
    firstHit?.document?.id || firstHit?.id || firstHit?._id || firstHit?.book?.id;
  if (!bookId) {
    // Use the hit data directly as a fallback
    return normalizeSearchHit(firstHit);
  }
  return hardcoverGetBook(bookId);
}

function normalizeSearchHit(hit) {
  const doc = hit.document || hit;
  if (!doc) return null;
  const authors = doc.author_names || doc.contributions?.map((c) => c?.author?.name) || [];
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
    `query ($id: Int!) {
       books(where: { id: { _eq: $id } }, limit: 1) {
         ${BOOK_FIELDS}
       }
     }`,
    { id: typeof id === 'string' ? parseInt(id, 10) : id }
  );
  return normalize(data?.books?.[0]);
}

// Fetch all books in a series by series name. Used by Plan + BookModal.
export async function hardcoverFetchSeriesBooks(seriesName) {
  if (!seriesName) return [];
  const data = await gql(
    `query ($name: String!) {
       series(where: { name: { _ilike: $name } }, limit: 1) {
         name
         books_count
         primary_books_count
         book_series(order_by: { position: asc }) {
           position
           book { ${BOOK_FIELDS} }
         }
       }
     }`,
    { name: seriesName }
  );
  const series = data?.series?.[0];
  if (!series?.book_series) return [];
  return series.book_series
    .map((bs) => {
      const b = normalize(bs.book);
      if (!b) return null;
      // Ensure the series position is set even if the book record was inconsistent
      if (b.s) {
        b.s.name = series.name;
        b.s.n = bs.position || b.s.n;
        b.s.total = series.primary_books_count || series.books_count || b.s.total;
      } else {
        b.s = {
          name: series.name,
          n: bs.position || null,
          total: series.primary_books_count || series.books_count || null,
          fromHardcover: true,
        };
      }
      return b;
    })
    .filter(Boolean);
}
