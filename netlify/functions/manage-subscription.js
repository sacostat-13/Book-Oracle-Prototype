// netlify/functions/manage-subscription.js
//
// Creates a Stripe Customer Portal session so the user can manage
// their subscription (cancel, update card, view invoices) without
// us ever touching payment data.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   URL  (Netlify sets this automatically)

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

  const stripeKey   = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const siteUrl     = process.env.URL || 'http://localhost:8888';

  if (!stripeKey) return json(500, { error: 'Stripe not configured' });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt        = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return json(401, { error: 'unauthenticated' });

  let userId;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    userId = payload.sub;
  } catch {
    return json(401, { error: 'invalid_token' });
  }

  // Get Stripe customer ID from profile
  let customerId = null;
  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      });
      if (res.ok) {
        const rows = await res.json();
        customerId = rows[0]?.stripe_customer_id || null;
      }
    } catch (e) {
      console.error('Profile lookup failed:', e);
    }
  }

  if (!customerId) {
    return json(404, { error: 'no_customer', message: 'No Stripe customer found for this account.' });
  }

  // Create portal session
  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   customerId,
        return_url: `${siteUrl}/#profile`,
      }).toString(),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error('Stripe portal error:', session);
      return json(502, { error: 'Portal creation failed', detail: session.error?.message });
    }

    return json(200, { url: session.url });
  } catch (e) {
    return json(502, { error: 'Stripe request failed', detail: String(e) });
  }
}
