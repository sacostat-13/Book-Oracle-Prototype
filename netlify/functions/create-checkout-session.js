// netlify/functions/create-checkout-session.js
//
// Creates a Stripe Checkout session and returns the URL.
// The client redirects the browser to that URL — Stripe handles
// card entry on their hosted page. We never touch card data.
//
// Required Netlify env vars:
//   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
//   STRIPE_PRICE_ID          — price_... (monthly recurring price from Stripe dashboard)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   URL                      — your site's base URL (Netlify sets this automatically)

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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId   = process.env.STRIPE_PRICE_ID;
  const siteUrl   = process.env.URL || 'http://localhost:8888';

  if (!stripeKey || !priceId) {
    return json(500, { error: 'Stripe not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.' });
  }

  // Verify user identity from JWT
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt        = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return json(401, { error: 'unauthenticated' });

  let userId, userEmail;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    userId    = payload.sub;
    userEmail = payload.email;
  } catch {
    return json(401, { error: 'invalid_token' });
  }

  // Look up existing Stripe customer ID from the profile (if any)
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let stripeCustomerId = null;

  if (supabaseUrl && serviceKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      });
      if (res.ok) {
        const rows = await res.json();
        stripeCustomerId = rows[0]?.stripe_customer_id || null;
      }
    } catch (e) {
      console.error('Profile lookup failed:', e);
    }
  }

  // Create Stripe Checkout session
  try {
    const body = new URLSearchParams({
      'mode': 'subscription',
      'payment_method_types[]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'success_url': `${siteUrl}/#profile?checkout=success`,
      'cancel_url':  `${siteUrl}/#profile?checkout=cancelled`,
      // Pass user metadata so the webhook can link this session to a user
      'metadata[user_id]': userId,
      'subscription_data[metadata][user_id]': userId,
    });

    // Pre-fill email and reuse existing customer if we have one
    if (userEmail) body.append('customer_email', userEmail);
    if (stripeCustomerId) {
      body.delete('customer_email');
      body.append('customer', stripeCustomerId);
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error('Stripe error:', session);
      return json(502, { error: 'Stripe checkout creation failed', detail: session.error?.message });
    }

    return json(200, { url: session.url });
  } catch (e) {
    return json(502, { error: 'Stripe request failed', detail: String(e) });
  }
}
