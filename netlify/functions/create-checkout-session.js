// netlify/functions/create-checkout-session.js
// Lemon Squeezy checkout — redirects to the hosted checkout URL.
//
// v0.39 hardening: the JWT is verified against Supabase Auth (was: decoded
// without verification). The email/user_id embedded in the checkout URL now
// come from the VERIFIED session, so an attacker can't attach someone else's
// user_id to their own subscription.
//
// Required env vars:
//   LEMON_SQUEEZY_REDIRECT_URL  — full checkout URL from LS dashboard
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { corsHeaders, bearerToken, verifySupabaseJwt } from './_shared/auth.js';

export async function handler(event) {
  const CORS = corsHeaders(event);
  const json = (statusCode, data) => ({
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const checkoutBase = process.env.LEMON_SQUEEZY_REDIRECT_URL;
  if (!checkoutBase) return json(500, { error: 'Server misconfigured' });

  const jwt = bearerToken(event);
  if (!jwt) return json(401, { error: 'unauthenticated' });

  const user = await verifySupabaseJwt(jwt);
  if (!user) return json(401, { error: 'invalid_token' });

  const userId    = user.userId;
  const userEmail = user.email;

  // Build checkout URL with prefill params and user_id as custom data.
  // We build the query string manually — bracket notation in URLSearchParams
  // keys (checkout[email]) confuses older esbuild versions used by Netlify CLI.
  const params = [];
  if (userEmail) params.push('checkout%5Bemail%5D=' + encodeURIComponent(userEmail));
  if (userId) params.push('checkout%5Bcustom%5D%5Buser_id%5D=' + encodeURIComponent(userId));
  params.push('embed=1');

  const separator = checkoutBase.includes('?') ? '&' : '?';
  const finalUrl = checkoutBase + separator + params.join('&');

  // v0.43.1: probe the checkout URL before handing it to the client. A stale
  // LEMON_SQUEEZY_REDIRECT_URL (deleted/renamed product, wrong store) makes
  // LS serve a 404 page — which the client would otherwise open full-screen
  // in the overlay, stranding the user on an error page with broken back
  // navigation. A dead link is a config problem, so surface it as a clean
  // toastable error instead of letting the user hit it.
  try {
    const probe = await fetch(finalUrl, { method: 'GET', redirect: 'follow' });
    if (probe.status === 404 || probe.status === 410) {
      console.error(`create-checkout-session: checkout URL returned ${probe.status} — LEMON_SQUEEZY_REDIRECT_URL is stale`, checkoutBase);
      return json(502, { error: 'Checkout is temporarily unavailable. Please try again later.' });
    }
  } catch (e) {
    // Network hiccup probing LS — don't block checkout on it, just log.
    console.warn('create-checkout-session: probe failed, continuing', e?.message);
  }

  return json(200, { url: finalUrl });
}
