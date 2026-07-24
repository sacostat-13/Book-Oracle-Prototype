// Google Books proxy.
//
// The client POSTs { q, langRestrict?, maxResults? } to
// /.netlify/functions/googlebooks; we inject the API key from env and forward
// to the Books API, returning the raw JSON. The key never touches the browser.
//
// WHY a key is now required: Google removed anonymous quota from the Books API.
// Keyless requests to www.googleapis.com/books/v1 return HTTP 429 with a
// per-day limit of 0 (reason RATE_LIMIT_EXCEEDED, quota_limit_value "0"). A key
// from a Cloud project that has the Books API enabled restores the free tier
// (~1,000 queries/day; request more via the Cloud console if needed).
//
// Required env var (Netlify → Site → Environment variables):
//   GOOGLE_BOOKS_API_KEY
//
// One-time setup to obtain it:
//   1. https://console.cloud.google.com/ → create or select a project
//   2. APIs & Services → Library → search "Books API" → Enable
//   3. APIs & Services → Credentials → Create credentials → API key
//   4. (recommended) Edit the key → API restrictions → restrict to "Books API"
//   5. Put the value in GOOGLE_BOOKS_API_KEY (Netlify env + your local .env)

import { corsHeaders as buildCors } from './_shared/auth.js';

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

export async function handler(event) {
  const CORS = buildCors(event);

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

  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'GOOGLE_BOOKS_API_KEY env var is not set' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const q = (body.q || '').trim();
  if (!q) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing q' }),
    };
  }

  const params = new URLSearchParams({ q, key, printType: 'books', country: 'US' });
  const max = Math.min(parseInt(body.maxResults, 10) || 5, 20);
  params.set('maxResults', String(max));
  if (body.langRestrict) {
    params.set('langRestrict', String(body.langRestrict).slice(0, 5));
  }

  try {
    const upstream = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'BookOracle/1.0' },
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (e) {
    console.error('googlebooks.js upstream error:', String(e));
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'Upstream fetch failed' }),
    };
  }
}
