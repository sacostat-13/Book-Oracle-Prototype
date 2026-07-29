// Hardcover GraphQL proxy.
// The client POSTs a GraphQL query+variables to /.netlify/functions/hardcover;
// we add the Bearer token from env and forward to Hardcover. The token never
// touches the browser.
//
// Required env var (set in Netlify → Site → Environment variables):
//   HARDCOVER_API_TOKEN   (Bearer token from hardcover.app/settings)

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

  // Cap query depth as a basic abuse guard.
  //
  // NB this counts total braces, not nesting depth, so filter arguments inflate it
  // as much as real nesting does. v0.56 added where/order_by to the nested editions
  // selection (see BOOK_FIELDS in hardcoverService.js) to stop picking boxed-set
  // ISBNs, which pushed the ISBN lookup query from 14 braces to 17 — it would have
  // been rejected here with a 400 and the whole Hardcover leg of the lookup chain
  // would have gone silently dead. Raised to 30, still far below anything abusive.
  const depth = (body.query.match(/\{/g) || []).length;
  if (depth > 30) {
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
    console.error('hardcover.js upstream error:', String(e));
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Upstream request failed' }),
    };
  }
}
