// Penguin Random House client. Calls go through /.netlify/functions/prh.
//
// PRH covers their own imprints — for English that's Penguin, Random House,
// Knopf, etc.; for Spanish that's Alfaguara, Lumen, Plaza & Janés, Random
// House Mondadori, and others published via PRH.MX or PRH.ESP domains.
//
// Particularly useful for Spanish/Latin American titles that Hardcover and
// OpenLibrary handle poorly. Coverage is incomplete (only PRH-published books)
// but quality is high where it exists.

import { cleanTitle, cleanAuthor } from './bookHelpers';

const ENDPOINT = '/.netlify/functions/prh';

// Configurable per-deploy via env. For Costa Rica/LatAm users, PRH.MX is best.
const DOMAIN = import.meta.env.VITE_PRH_DOMAIN || 'PRH.US';

async function prhRequest(path, params = {}) {
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, params }),
    });
    if (!resp.ok) {
      console.warn(`[prh] proxy ${resp.status}`);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('[prh] request failed', e);
    return null;
  }
}

// Normalize a PRH title record into our internal shape.
function normalize(t) {
  if (!t) return null;
  // PRH title resources have various shapes depending on endpoint. Try to
  // pull the canonical fields defensively.
  const isbn = t.isbn || t.isbnHyphenated?.replace(/-/g, '') || null;
  return {
    t: t.title || null,
    a: t.author || null,
    d: t.flapcopy
      ? // PRH flap copy can contain HTML; strip tags for plain text
        t.flapcopy.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : null,
    pp: t.pages || null,
    coverUrl: t.coverurl || t.imageUrl || (isbn ? `https://images.randomhouse.com/cover/${isbn}` : null),
    s: null, // series detection handled separately if needed
    isbn,
    prhTitleId: t.titleid || t.workid || null,
    fromPrh: true,
  };
}

// ---------- Public API ----------

// Look up a book by ISBN through PRH. Faster + cleaner than searching by text
// when an ISBN is available.
export async function prhLookupByIsbn(isbn) {
  if (!isbn) return null;
  const cleanIsbn = isbn.replace(/[-\s]/g, '');
  const data = await prhRequest(
    `/resources/v2/title/domains/${DOMAIN}/titles/${cleanIsbn}`,
    {}
  );
  // PRH returns a {data: {titles: [...]}} envelope or sometimes a single title
  const t = data?.data?.titles?.[0] || data?.data || null;
  if (!t || !t.title) return null;
  return normalize(t);
}

// Search by title (+ optional author). Used as a fallback when we don't have
// an ISBN.
export async function prhSearch(title, author) {
  if (!title) return null;
  const q = author ? `${cleanTitle(title)} ${cleanAuthor(author)}` : cleanTitle(title);
  // Search endpoint
  const data = await prhRequest(
    `/resources/v2/title/domains/${DOMAIN}/search/searchterm/${encodeURIComponent(q)}`,
    { rows: 5 }
  );
  const titles = data?.data?.titles || data?.data?.results || [];
  if (!titles.length) return null;

  // Pick the title whose name most closely matches; otherwise first result
  const target = cleanTitle(title).toLowerCase();
  let best = titles[0];
  for (const t of titles) {
    if (t.title && t.title.toLowerCase().includes(target)) {
      best = t;
      break;
    }
  }
  return normalize(best);
}
