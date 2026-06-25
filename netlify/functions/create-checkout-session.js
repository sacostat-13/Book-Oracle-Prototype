// netlify/functions/create-checkout-session.js
// Lemon Squeezy checkout — redirects to the hosted checkout URL.
//
// Lemon Squeezy's hosted checkout page is a fixed URL per variant.
// We append the customer's email as a prefill param so they don't
// have to type it. The checkout URL itself comes from the dashboard.
//
// Required env vars:
//   LEMON_SQUEEZY_REDIRECT_URL  — full checkout URL from LS dashboard
//                                 e.g. https://thereadingoracle.lemonsqueezy.com/checkout/buy/...
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (optional — used to look up email if not in JWT)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return {
    statusCode: 204,
    headers: CORS,
    body: ''
  };
  if (event.httpMethod !== 'POST') return json(405, {
    error: 'Method not allowed'
  });

  const checkoutBase = process.env.LEMON_SQUEEZY_REDIRECT_URL;
  if (!checkoutBase) {
    return json(500, {
      error: 'LEMON_SQUEEZY_REDIRECT_URL not set.'
    });
  }

  // Decode user info from JWT
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return json(401, {
    error: 'unauthenticated'
  });

  let userId, userEmail;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    userId = payload.sub;
    userEmail = payload.email;
  } catch {
    return json(401, {
      error: 'invalid_token'
    });
  }

  // Build checkout URL with prefill params and user_id as custom data.
  // We build the query string manually — bracket notation in URLSearchParams
  // keys (checkout[email]) confuses older esbuild versions used by Netlify CLI.
  const params = [];
  if (userEmail) params.push('checkout%5Bemail%5D=' + encodeURIComponent(userEmail));
  if (userId) params.push('checkout%5Bcustom%5D%5Buser_id%5D=' + encodeURIComponent(userId));
  params.push('embed=1');

  const separator = checkoutBase.includes('?') ? '&' : '?';
  const finalUrl = checkoutBase + separator + params.join('&');

  return json(200, {
    url: finalUrl
  });
}
