// netlify/functions/book-teaser.js — the Oracle, once, for a visitor.
//
// POST { key: "<title key>|<author key>", lang: "en" | "es" }
//   → { status: 'ok', cached, picks: [{ title, author, coverUrl, shareKey, why }] }
//   → { status: 'empty' }   the Oracle had nothing it could stand behind
//   → { status: 'busy' }    rate limit or the daily generation cap
//
// A signed-out visitor on /book/:key can ask what might follow this book.
// The answer is about the BOOK, not the person asking, so it is generated once
// per book and language, stored in public.book_teasers, and every later visitor
// gets the stored one. Consequences, on purpose:
//   - No account, no JWT and no visitor data: the prompt holds the book's
//     title, author and description and nothing else.
//   - Cost is one model call per book ever asked about, capped per day
//     (BOOK_TEASER_DAILY_CAP, default 150 new books/day) and per IP.
//   - Picks are kept only if they resolve to a row in our own catalogue
//     (resolve_teaser_picks), so every pick links to a real page and nothing
//     the model invented is shown.
//
// Schema: supabase/migrations/20261110130000_book_teasers.sql
// Client: src/lib/api/bookTeaser.js, src/components/OracleTeaser.jsx
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      (optional) BOOK_TEASER_DAILY_CAP

import { corsHeaders } from './_shared/auth.js';

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 900;
const PICKS_SHOWN = 3;
const KEY_RE = /^[a-z0-9]{1,200}\|[a-z0-9]{0,40}$/;

const DAILY_CAP = Math.max(0, parseInt(process.env.BOOK_TEASER_DAILY_CAP, 10) || 150);

// Per-IP throttle. In the warm Lambda's memory, so best effort — the durable
// limit is the daily cap, which is counted in the database.
const WINDOW_MS = 10 * 60e3;
const MAX_GENERATIONS_PER_WINDOW = 4;
const MAX_REQUESTS_PER_WINDOW = 40;
const hits = new Map(); // ip -> { gen: number[], req: number[] }

/** @returns {boolean} true when this IP may do `kind` now */
export function allow(ip, kind, now = Date.now(), store = hits) {
  const rec = store.get(ip) || { gen: [], req: [] };
  rec.gen = rec.gen.filter((t) => now - t < WINDOW_MS);
  rec.req = rec.req.filter((t) => now - t < WINDOW_MS);
  const list = kind === 'gen' ? rec.gen : rec.req;
  const max = kind === 'gen' ? MAX_GENERATIONS_PER_WINDOW : MAX_REQUESTS_PER_WINDOW;
  if (list.length >= max) { store.set(ip, rec); return false; }
  list.push(now);
  store.set(ip, rec);
  if (store.size > 5000) store.clear();
  return true;
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function restHeaders(extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rpc(name, params) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: restHeaders(), body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`${name} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findBook(key) {
  const rows = await rpc('find_book_by_client_key', { _key: key });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function cachedPicks(bookId, lang) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/book_teasers?select=picks&book_id=eq.${bookId}&lang=eq.${lang}&limit=1`,
    { headers: restHeaders() }
  );
  if (!res.ok) throw new Error(`book_teasers read ${res.status}`);
  const rows = await res.json();
  return rows[0] ? rows[0].picks : null;
}

async function generatedToday() {
  const since = new Date(Date.now() - 86400e3).toISOString();
  const res = await fetch(
    `${supabaseUrl}/rest/v1/book_teasers?select=book_id&created_at=gte.${encodeURIComponent(since)}`,
    { headers: restHeaders({ Prefer: 'count=exact', Range: '0-0' }) }
  );
  const range = res.headers.get('content-range') || '';
  const total = parseInt(range.split('/')[1], 10);
  return Number.isFinite(total) ? total : Infinity; // unknown → treat as capped
}

async function storePicks(bookId, lang, picks) {
  const res = await fetch(`${supabaseUrl}/rest/v1/book_teasers?on_conflict=book_id,lang`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ book_id: bookId, lang, picks, model: MODEL }),
  });
  if (!res.ok) console.error('book_teasers write', res.status, await res.text());
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM = [
  'You are the Oracle of The Books Oracle, a reading companion.',
  'You offer guidance, never verdicts: suggest what a reader MIGHT enjoy and why, and leave the choice to them.',
  'You only name real, published books you are certain exist, with their real authors.',
  'You answer with JSON only.',
].join(' ');

export function buildPrompt(book, lang) {
  const desc = String(book.description || '').replace(/\s+/g, ' ').slice(0, 700);
  const language = lang === 'es'
    ? 'Spanish as spoken in Argentina and Uruguay (rioplatense, use "vos", e.g. "te puede gustar", "si te atrapó")'
    : 'English';
  return [
    `A reader is looking at this book:`,
    `Title: ${book.title}`,
    `Author: ${book.author}`,
    desc ? `Description: ${desc}` : null,
    '',
    'Suggest 6 books someone who liked it might read next.',
    '- Real, published books only, each by a different author, none by this book\'s author.',
    '- Not other volumes of the same series.',
    '- Give each title exactly as it is most commonly published, and the author\'s usual byline.',
    `- For each, one sentence (max 22 words) in ${language} saying what it shares with this book. Speak to the reader as a suggestion ("If the… held you, …"), never a promise that they will love it. Do not repeat the title.`,
    '',
    'Answer with only a JSON array: [{"title": "...", "author": "...", "why": "..."}]',
  ].filter((l) => l !== null).join('\n');
}

/** First JSON array in the model's reply, as [{ title, author, why }]. */
export function parsePicks(text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p) => p && typeof p.title === 'string' && p.title.trim())
      .slice(0, 10)
      .map((p) => ({
        title: p.title.trim().slice(0, 200),
        author: String(p.author || '').trim().slice(0, 120),
        why: String(p.why || '').trim().slice(0, 240),
      }));
  } catch { return []; }
}

/**
 * Join the model's reasons onto the catalogue rows that resolved, drop the
 * book itself, keep the first PICKS_SHOWN.
 */
export function mergePicks(resolved, raw, selfId) {
  const out = [];
  for (const r of resolved || []) {
    if (!r || r.book_id === selfId) continue;
    const src = raw[(r.ord || 0) - 1];
    if (!src?.why) continue;
    out.push({
      title: r.title,
      author: r.author,
      coverUrl: r.cover_url || null,
      shareKey: r.share_key,
      why: src.why,
    });
    if (out.length >= PICKS_SHOWN) break;
  }
  return out;
}

async function askOracle(book, lang) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(book, lang) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || '').join('');
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handler(event) {
  const CORS = corsHeaders(event);
  const json = (statusCode, data) => ({
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!supabaseUrl || !serviceKey || !process.env.ANTHROPIC_API_KEY) {
    return json(503, { status: 'busy' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const key = typeof body.key === 'string' ? body.key.toLowerCase() : '';
  const lang = body.lang === 'es' ? 'es' : 'en';
  if (!KEY_RE.test(key)) return json(400, { error: 'Bad key' });

  const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'unknown';
  if (!allow(ip, 'req')) return json(429, { status: 'busy' });

  try {
    const book = await findBook(key);
    if (!book?.id || !book.author) return json(404, { status: 'empty' });

    const cached = await cachedPicks(book.id, lang);
    if (cached) {
      return json(200, cached.length ? { status: 'ok', cached: true, picks: cached } : { status: 'empty' });
    }

    if (!allow(ip, 'gen')) return json(429, { status: 'busy' });
    if ((await generatedToday()) >= DAILY_CAP) return json(429, { status: 'busy' });

    const raw = parsePicks(await askOracle(book, lang));
    const resolved = raw.length
      ? await rpc('resolve_teaser_picks', { p_picks: raw.map(({ title, author }) => ({ title, author })) })
      : [];
    const picks = mergePicks(resolved, raw, book.id);

    // Stored even when empty, so a book the Oracle cannot answer for is not
    // asked about again on every visit.
    await storePicks(book.id, lang, picks);

    return json(200, picks.length ? { status: 'ok', cached: false, picks } : { status: 'empty' });
  } catch (err) {
    console.error('book-teaser:', String(err?.message || err));
    return json(502, { status: 'busy' });
  }
}
