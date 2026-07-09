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

  if (!lsSubscriptionId) {
    // No subscription on file — send to general orders page
    return json(200, { url: 'https://app.lemonsqueezy.com/my-orders' });
  }

  // Fetch the subscription from LS to get the management URL
  try {
    const res = await fetch(`${LS_API}/subscriptions/${lsSubscriptionId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json',
      },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('LS subscription fetch error:', data);
      return json(200, { url: 'https://app.lemonsqueezy.com/my-orders' });
    }

    // LS returns a urls object with customer_portal and update_payment_method
    const portalUrl = data.data?.attributes?.urls?.customer_portal
      || 'https://app.lemonsqueezy.com/my-orders';

    return json(200, { url: portalUrl });
  } catch (e) {
    console.error('LS manage error:', String(e));
    // Fallback to generic orders page rather than erroring
    return json(200, { url: 'https://app.lemonsqueezy.com/my-orders' });
  }
}
