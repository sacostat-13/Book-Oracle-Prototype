// netlify/functions/manage-subscription.js
// Returns the Lemon Squeezy customer portal URL for the current user.
//
// LS provides a customer portal URL per subscription at:
//   https://app.lemonsqueezy.com/my-orders
// We can deep-link to a specific subscription's management page
// if we have the ls_subscription_id stored on the profile.
//
// Required env vars:
//   LEMONSQUEEZY_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const LS_API = 'https://api.lemonsqueezy.com/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(statusCode, data) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey      = process.env.LEMONSQUEEZY_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) return json(500, { error: 'LEMONSQUEEZY_API_KEY not set' });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt        = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return json(401, { error: 'unauthenticated' });

  let userId;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    userId = payload.sub;
  } catch { return json(401, { error: 'invalid_token' }); }

  // Look up LS subscription ID from profile
  let lsSubscriptionId = null;
  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=ls_subscription_id`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        lsSubscriptionId = rows[0]?.ls_subscription_id || null;
      }
    } catch (e) { console.error('Profile lookup failed:', e); }
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
