// netlify/functions/stripe-webhook.js
//
// Receives Stripe events and updates subscription_status in Supabase.
// Must be registered in Stripe Dashboard → Webhooks.
//
// Events handled:
//   checkout.session.completed       → mark active, save customer ID
//   customer.subscription.updated    → sync status changes
//   customer.subscription.deleted    → mark cancelled
//   invoice.payment_succeeded        → ensure active (handles renewals)
//   invoice.payment_failed           → mark past_due
//
// Required Netlify env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe Dashboard → Webhooks
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeGet(path, secretKey) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  return res.ok ? res.json() : null;
}

async function updateProfile(supabaseUrl, serviceKey, userId, fields) {
  if (!userId) return;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Profile update failed:', res.status, text);
    }
  } catch (e) {
    console.error('Profile update error:', e);
  }
}

// Minimal Stripe webhook signature verification without the SDK.
// Stripe signs the raw body with HMAC-SHA256.
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts    = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Reject if timestamp is more than 5 minutes old
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const payload   = `${timestamp}.${rawBody}`;
  const encoder   = new TextEncoder();
  const keyData   = encoder.encode(secret);
  const msgData   = encoder.encode(payload);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed  = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return computed === signature;
}

function stripeStatusToAppStatus(stripeStatus) {
  // Stripe subscription statuses → our subscription_status enum
  const map = {
    active:             'active',
    trialing:           'active',
    past_due:           'past_due',
    canceled:           'cancelled',
    unpaid:             'past_due',
    incomplete:         'free',
    incomplete_expired: 'free',
    paused:             'past_due',
  };
  return map[stripeStatus] || 'free';
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey     = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret || !stripeKey || !supabaseUrl || !serviceKey) {
    console.error('stripe-webhook: missing env vars');
    return { statusCode: 500, body: 'Server misconfigured' };
  }

  // Verify signature
  const sigHeader = event.headers['stripe-signature'];
  const rawBody   = event.body;
  const valid     = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!valid) {
    console.error('stripe-webhook: invalid signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const obj = stripeEvent.data?.object;

  try {
    switch (stripeEvent.type) {
      // ── New subscription created via Checkout ────────────────────────────────
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription') break;
        // user_id should be in session metadata (set by create-checkout-session.js)
        const userId     = obj.metadata?.user_id;
        const customerId = obj.customer;
        const subId      = obj.subscription;
        if (!userId) {
          // Fallback: fetch subscription and read from its metadata
          console.warn('checkout.session.completed: no user_id in session metadata, trying subscription');
          const sub = subId ? await stripeGet(`/subscriptions/${subId}`, stripeKey) : null;
          const fallbackUserId = sub?.metadata?.user_id;
          if (!fallbackUserId) { console.error('checkout.session.completed: could not resolve user_id'); break; }
          const appStatus = stripeStatusToAppStatus(sub.status);
          await updateProfile(supabaseUrl, serviceKey, fallbackUserId, {
            subscription_status:    appStatus,
            stripe_customer_id:     customerId,
            stripe_subscription_id: subId,
          });
          console.log(`checkout.session.completed (fallback): user ${fallbackUserId} → ${appStatus}`);
          break;
        }

        const sub = subId ? await stripeGet(`/subscriptions/${subId}`, stripeKey) : null;
        const appStatus = sub ? stripeStatusToAppStatus(sub.status) : 'active';

        await updateProfile(supabaseUrl, serviceKey, userId, {
          subscription_status:    appStatus,
          stripe_customer_id:     customerId,
          stripe_subscription_id: subId,
        });
        console.log(`checkout.session.completed: user ${userId} → ${appStatus}`);
        break;
      }

      // ── Subscription status changed ──────────────────────────────────────────
      case 'customer.subscription.updated': {
        const userId    = obj.metadata?.user_id;
        const appStatus = stripeStatusToAppStatus(obj.status);
        if (!userId) {
          // Try looking up by customer ID
          console.warn('customer.subscription.updated: no user_id in metadata, skipping');
          break;
        }
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: appStatus });
        console.log(`customer.subscription.updated: user ${userId} → ${appStatus}`);
        break;
      }

      // ── Subscription cancelled ───────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const userId = obj.metadata?.user_id;
        if (!userId) { console.warn('customer.subscription.deleted: no user_id, skipping'); break; }
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: 'cancelled' });
        console.log(`customer.subscription.deleted: user ${userId} → cancelled`);
        break;
      }

      // ── Payment succeeded (renewal) ──────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        // Support both old shape (obj.subscription) and new shape (obj.parent.subscription_details)
        const subId  = obj.subscription || obj.parent?.subscription_details?.subscription;
        // user_id may be in subscription metadata directly (new shape) or need a lookup
        let userId = obj.parent?.subscription_details?.metadata?.user_id;
        if (!userId && subId) {
          const sub = await stripeGet(`/subscriptions/${subId}`, stripeKey);
          userId = sub?.metadata?.user_id;
        }
        if (!userId) { console.warn('invoice.payment_succeeded: could not resolve user_id'); break; }
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: 'active' });
        console.log(`invoice.payment_succeeded: user ${userId} → active`);
        break;
      }

      // ── Payment failed ───────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const subId  = obj.subscription || obj.parent?.subscription_details?.subscription;
        let userId = obj.parent?.subscription_details?.metadata?.user_id;
        if (!userId && subId) {
          const sub = await stripeGet(`/subscriptions/${subId}`, stripeKey);
          userId = sub?.metadata?.user_id;
        }
        if (!userId) { console.warn('invoice.payment_failed: could not resolve user_id'); break; }
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: 'past_due' });
        console.log(`invoice.payment_failed: user ${userId} → past_due`);
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt so Stripe doesn't retry
        console.log(`stripe-webhook: unhandled event type ${stripeEvent.type}`);
    }
  } catch (e) {
    console.error('stripe-webhook handler error:', e);
    // Still return 200 to prevent Stripe from retrying on our bugs
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
