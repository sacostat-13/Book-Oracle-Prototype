// Penguin Random House public API proxy.
// PRH uses an API key as a query parameter. While the key is generally low-risk
// (read-only, public catalog data), we still keep it server-side for consistency
// and to avoid baking it into the bundle.
//
// Required env var (Netlify → Site → Environment variables):
//   PRH_API_KEY
//
// Optional env var:
//   PRH_DOMAIN — default 'PRH.US'. Override to 'PRH.MX' for Mexican Spanish
//   editions, 'PRH.ESP' for Spain. Costa Rica → 'PRH.MX' is the closest match.
//
// Client posts { path, params }:
//   path:   the resource path (e.g. '/resources/v2/title/domains/PRH.US/search/searchterm/<query>')
//   params: additional query params
//
// Docs: https://developer.penguinrandomhouse.com/

import { corsHeaders as buildCors } from './_shared/auth.js';

export async function handler(event) {
  const corsHeaders = buildCors(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey = process.env.PRH_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'PRH_API_KEY env var is not set' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { path, params = {} } = body;
  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing or invalid path' }),
    };
  }

  // Build the upstream URL. PRH wants format=json or returns XML by default.
  const url = new URL(`https://api.penguinrandomhouse.com${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('api_key', apiKey);
  // Force JSON
  if (!url.searchParams.has('format')) url.searchParams.set('format', 'json');
  if (!url.searchParams.has('rows')) url.searchParams.set('rows', '5');

  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WishlistOracle/1.0',
      },
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (e) {
    console.error('prh.js upstream error:', String(e));
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Upstream request failed' }),
    };
  }
}
