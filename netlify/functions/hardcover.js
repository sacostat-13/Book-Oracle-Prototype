// Hardcover GraphQL proxy.
// The client POSTs a GraphQL query+variables to /.netlify/functions/hardcover;
// we add the Bearer token from env and forward to Hardcover. The token never
// touches the browser.
//
// Required env var (set in Netlify → Site → Environment variables):
//   HARDCOVER_API_TOKEN   (Bearer token from hardcover.app/settings)

export async function handler(event) {
  // Basic CORS for local dev (Netlify Functions are same-origin in prod, but
  // `netlify dev` proxies on a different port).
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

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

  const token = process.env.HARDCOVER_API_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'HARDCOVER_API_TOKEN env var is not set' }),
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
  if (!body.query) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing GraphQL query' }),
    };
  }

  // Cap query depth as a basic abuse guard. Real queries top out around 9-10
  // braces (variables + nested where + book → series → fields).
  const depth = (body.query.match(/\{/g) || []).length;
  if (depth > 15) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Query too deeply nested' }),
    };
  }

  try {
    const upstream = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'WishlistOracle/1.0',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Upstream request failed', detail: String(e) }),
    };
  }
}
