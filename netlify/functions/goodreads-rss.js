// Goodreads shelf import via public RSS.
//
// There is no Goodreads API — key issuance stopped in December 2020. The
// remaining public surface is the per-user review feed:
//
//   https://www.goodreads.com/review/list_rss/{USER_ID}?shelf={SHELF}&per_page=100&page={N}
//
// No auth, no key. Requires the profile to be public. Rate-limited by IP,
// which is why the page loop below is throttled — a shared Netlify egress
// address means one tight loop degrades the feature for every user.
//
// The client POSTs { goodreadsId, shelf } and gets back normalized items in
// the SAME shape parseGoodreadsCSV() already produces, so the whole
// downstream ingestion path (importGoodreads → upsertBookOnServer) is reused
// unchanged. This function replaces the *parsing* layer only.
//
// v0.59

import { corsHeaders } from './_shared/auth.js';
import { splitGoodreadsSeriesTitle } from './_shared/goodreadsTitle.js';

const USER_AGENT =
  'BookOracle/0.56 (https://github.com/sacostat-13/Book-Oracle-Prototype; contact via repo)';

const VALID_SHELVES = new Set(['read', 'to-read', 'currently-reading']);
const PER_PAGE = 100;
const MAX_PAGES = 20;          // hard cap: 2,000 books
const PAGE_DELAY_MS = 1000;    // throttle between pages
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Warm-container cache. Not a durable cache — Netlify recycles containers
// freely — but it absorbs the common case of a reader retrying an import
// seconds after the first attempt, which is exactly when we'd otherwise
// hammer Goodreads with an identical request.
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Minimal XML field extraction.
//
// The list_rss feed is a fixed, machine-generated shape: a flat <channel> of
// <item> elements whose children are either plain text or CDATA. We slice on
// <item> boundaries first and only then read named children, so this never
// tries to be a general XML parser — it can't be fooled by nesting it will
// never see. Anything unexpected yields null and the item is skipped.
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')   // strip stray markup revealed inside CDATA
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemBlocks(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function field(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  return decodeEntities(m[1]);
}

// Goodreads emits RFC-822: "Mon, 06 Jan 2025 00:00:00 -0800".
// We want a plain YYYY-MM-DD in the feed's *own* offset, so a book finished
// on the 6th local time doesn't silently become the 5th or 7th for us.
function toISODate(rfc822) {
  if (!rfc822) return null;
  const d = new Date(rfc822);
  if (Number.isNaN(d.getTime())) return null;
  const offsetMatch = rfc822.match(/([+-]\d{4})\s*$/);
  let ms = d.getTime();
  if (offsetMatch) {
    const raw = offsetMatch[1];
    const sign = raw[0] === '-' ? -1 : 1;
    const mins = sign * (parseInt(raw.slice(1, 3), 10) * 60 + parseInt(raw.slice(3, 5), 10));
    ms += mins * 60 * 1000;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function parseShelfPage(xml) {
  return itemBlocks(xml)
    .map((block) => {
      const rawTitle = field(block, 'title');
      const author = field(block, 'author_name');
      if (!rawTitle || !author) return null;

      // Same series-suffix handling as the CSV path, so RSS and CSV imports
      // produce identical rows for the same book.
      const { title, series } = splitGoodreadsSeriesTitle(rawTitle);
      if (!title) return null;

      // user_rating 0 means "unrated", not zero stars. NULL it, matching the
      // documented contract on read_books.rating.
      const ratingRaw = parseInt(field(block, 'user_rating') || '0', 10);
      const rating = Number.isFinite(ratingRaw) && ratingRaw > 0 ? ratingRaw : null;

      // user_read_at is empty for most readers — Goodreads only records it
      // when the shelving was explicitly dated. We deliberately do NOT fall
      // back to user_date_added: a book added to to-read in 2019 and finished
      // in 2024 would land in the wrong year and corrupt the reading challenge
      // and streak. Undated is correct; wrong-dated is not.
      const dateRead = toISODate(field(block, 'user_read_at'));

      const pages = parseInt(field(block, 'num_pages') || '', 10);
      const year = parseInt(field(block, 'book_published') || '', 10);
      const goodreadsId = parseInt(field(block, 'book_id') || '', 10);
      const isbn = field(block, 'isbn');
      const cover = field(block, 'book_large_image_url');

      return {
        t: title,
        a: author,
        rating,
        dateRead,
        fromGoodreads: true,
        ...(series ? { s: series } : {}),
        // Enrichment hints. The lookup chain will improve on all of these,
        // but they make an imported book presentable immediately.
        ...(isbn ? { isbn } : {}),
        ...(cover ? { cover } : {}),
        ...(Number.isFinite(pages) && pages > 0 ? { pp: pages } : {}),
        ...(Number.isFinite(year) && year > 0 ? { year } : {}),
        ...(Number.isFinite(goodreadsId) && goodreadsId > 0 ? { goodreadsId } : {}),
      };
    })
    .filter(Boolean);
}

// In-feed dedupe. Re-shelved editions can appear more than once; the kept row
// absorbs a rating or date from its duplicates rather than losing them.
function dedupe(items) {
  const byKey = new Map();
  const out = [];
  for (const b of items) {
    const k = `${b.t.toLowerCase()}|${b.a.toLowerCase()}`;
    const kept = byKey.get(k);
    if (!kept) {
      byKey.set(k, b);
      out.push(b);
      continue;
    }
    if (kept.rating == null && b.rating != null) kept.rating = b.rating;
    if (!kept.dateRead && b.dateRead) kept.dateRead = b.dateRead;
    if (!kept.s && b.s) kept.s = b.s;
  }
  return out;
}

const ok = (CORS, payload) => ({
  statusCode: 200,
  headers: CORS,
  body: JSON.stringify(payload),
});

export async function handler(event) {
  const CORS = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_request' }) };
  }

  const goodreadsId = String(body.goodreadsId || '').trim();
  const shelf = String(body.shelf || 'read').trim();

  // Validate before making any network call. An ID is digits only.
  if (!/^\d{1,12}$/.test(goodreadsId)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_id' }) };
  }
  if (!VALID_SHELVES.has(shelf)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_shelf' }) };
  }

  const cacheKey = `${goodreadsId}:${shelf}`;
  const cached = cacheGet(cacheKey);
  if (cached) return ok(CORS, { ...cached, cached: true });

  const items = [];
  let truncated = false;
  let sawAnyResponse = false;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `https://www.goodreads.com/review/list_rss/${goodreadsId}` +
        `?shelf=${encodeURIComponent(shelf)}&per_page=${PER_PAGE}&page=${page}`;

      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml' },
      });

      // Goodreads returns 404 both for a missing user and for a private one.
      // We cannot distinguish them, so the client copy covers both cases.
      if (res.status === 404) {
        return ok(CORS, { shelf, count: 0, items: [], error: 'private_or_missing' });
      }
      if (res.status === 429) {
        return ok(CORS, { shelf, count: 0, items: [], error: 'rate_limited' });
      }
      if (!res.ok) {
        return ok(CORS, { shelf, count: 0, items: [], error: 'upstream' });
      }

      sawAnyResponse = true;
      const xml = await res.text();
      const pageItems = parseShelfPage(xml);
      items.push(...pageItems);

      // A short page means we've reached the end of the shelf.
      if (pageItems.length < PER_PAGE) break;

      if (page === MAX_PAGES) {
        truncated = true;
        break;
      }
      await sleep(PAGE_DELAY_MS);
    }
  } catch {
    return ok(CORS, { shelf, count: 0, items: [], error: 'upstream' });
  }

  if (!sawAnyResponse) {
    return ok(CORS, { shelf, count: 0, items: [], error: 'upstream' });
  }

  const deduped = dedupe(items);
  const payload = { shelf, count: deduped.length, truncated, items: deduped };
  cacheSet(cacheKey, payload);
  return ok(CORS, payload);
}
