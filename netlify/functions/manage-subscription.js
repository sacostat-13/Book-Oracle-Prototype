// netlify/functions/manage-subscription.js
// Returns the Lemon Squeezy customer portal URL for the current user.
//
// v0.39 hardening:
//   - JWT is verified against Supabase Auth (was: decoded without
//     verification, letting anyone request another user's portal URL).
//   - Billing IDs now live in public.profile_billing (schema_v28), which
//     has no client-readable policies — only this service-role path.
//   - CORS restricted to known origins.
//
// Required env vars:
//   LEMONSQUEEZY_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { corsHeaders, bearerToken, verifySupabaseJwt } from './_shared/auth.js';

const LS_API = 'https://api.lemonsqueezy.com/v1';

export async function handler(event) {
  const CORS = corsHeaders(event);
  const json = (statusCode, data) => ({
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey      = process.env.LEMONSQUEEZY_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return json(500, { error: 'Server misconfigured' });

  const jwt = bearerToken(event);
  if (!jwt) return json(401, { error: 'unauthenticated' });

  const user = await verifySupabaseJwt(jwt);
  if (!user) return json(401, { error: 'invalid_token' });
  const userId = user.userId;

  // Look up LS subscription ID from profile_billing (service role only)
  let lsSubscriptionId = null;
  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/profile_billing?user_id=eq.${userId}&select=ls_subscription_id`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        lsSubscriptionId = rows[0]?.ls_subscription_id || null;
      }
    } catch (e) { console.error('Billing lookup failed:', e); }
  }

  // v0.43.1: no more silent fallback to app.lemonsqueezy.com/my-orders.
  // That page requires a Lemon Squeezy login, so every failure below used
  // to strand the user on an LS sign-in screen with no hint anything went
  // wrong. The ONLY correct destination is the SIGNED customer_portal URL
  // from a fresh subscription fetch (signed URLs expire, so it must be
  // fetched per click, never cached). Anything else is an error the client
  // can toast.
  if (!lsSubscriptionId) {
    console.warn(`manage-subscription: no ls_subscription_id on file for user ${userId}`);
    return json(404, { error: 'No subscription found for this account.' });
  }

  try {
    const res = await fetch(`${LS_API}/subscriptions/${lsSubscriptionId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json',
      },
    });
    const data = await res.json();
    if (!res.ok) {
      // 404 here usually means test/live mode mismatch: a test-mode API key
      // can't see live subscriptions and vice versa.
      console.error(`LS subscription fetch failed: HTTP ${res.status} for sub ${lsSubscriptionId}`, JSON.stringify(data?.errors || data).slice(0, 500));
      return json(502, { error: 'Could not open the billing portal. Please try again shortly.' });
    }

    // Signed, short-lived customer portal URL — fetched fresh per request.
    const portalUrl = data.data?.attributes?.urls?.customer_portal;
    if (!portalUrl) {
      console.error('LS subscription has no customer_portal URL', JSON.stringify(data.data?.attributes?.urls || {}));
      return json(502, { error: 'Could not open the billing portal. Please try again shortly.' });
    }

    return json(200, { url: portalUrl });
  } catch (e) {
    console.error('LS manage error:', String(e));
    return json(502, { error: 'Could not open the billing portal. Please try again shortly.' });
  }
}
