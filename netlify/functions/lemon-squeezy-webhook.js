// netlify/functions/lemon-squeezy-webhook.js
// Receives Lemon Squeezy webhook events and updates subscription_status.
//
// Register in LS Dashboard → Settings → Webhooks:
//   URL: https://your-site.netlify.app/.netlify/functions/lemon-squeezy-webhook
//   Events: subscription_created, subscription_updated, subscription_cancelled,
//           subscription_expired, subscription_payment_success,
//           subscription_payment_failed, subscription_payment_recovered
//
// Required env vars:
//   LEMONSQUEEZY_SIGNING_SECRET  — from LS Dashboard → Settings → Webhooks
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { timingSafeEqual } from 'node:crypto';

async function verifySignature(rawBody, signatureHeader, secret) {
  try {
    const encoder   = new TextEncoder();
    const key       = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const computed  = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    // Constant-time comparison — a plain === leaks a timing side-channel.
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(String(signatureHeader || ''), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

function lsStatusToAppStatus(lsStatus) {
  // Lemon Squeezy subscription statuses
  const map = {
    active:       'active',
    on_trial:     'active',
    paused:       'past_due',
    past_due:     'past_due',
    unpaid:       'past_due',
    cancelled:    'cancelled',
    expired:      'cancelled',
  };
  return map[lsStatus] || 'free';
}

async function updateProfile(supabaseUrl, serviceKey, userId, fields) {
  if (!userId) return;

  // schema_v28: LS customer/subscription IDs live in profile_billing
  // (service-role only), not on the world-readable profiles row.
  const { ls_customer_id, ls_subscription_id, ...profileFields } = fields;

  const svcHeaders = {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer': 'return=minimal',
  };

  if (ls_customer_id || ls_subscription_id) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/profile_billing`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          ...(ls_customer_id     && { ls_customer_id }),
          ...(ls_subscription_id && { ls_subscription_id }),
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) console.error('Billing upsert failed:', res.status, await res.text());
    } catch (e) { console.error('Billing upsert error:', e); }
  }

  if (Object.keys(profileFields).length === 0) return;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: svcHeaders,
      body: JSON.stringify(profileFields),
    });
    if (!res.ok) console.error('Profile update failed:', res.status, await res.text());
  } catch (e) { console.error('Profile update error:', e); }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const signingSecret = process.env.LEMONSQUEEZY_SIGNING_SECRET;
  const supabaseUrl   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    !signingSecret && 'LEMONSQUEEZY_SIGNING_SECRET',
    !supabaseUrl   && 'SUPABASE_URL / VITE_SUPABASE_URL',
    !serviceKey    && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);

  if (missing.length) {
    console.error('lemon-squeezy-webhook: missing env vars:', missing.join(', '));
    return { statusCode: 500, body: `Server misconfigured — missing: ${missing.join(', ')}` };
  }

  // Verify HMAC-SHA256 signature
  const sigHeader = event.headers['x-signature'] || event.headers['X-Signature'];
  if (!sigHeader) return { statusCode: 400, body: 'Missing X-Signature header' };

  const valid = await verifySignature(event.body, sigHeader, signingSecret);
  if (!valid) {
    console.error('lemon-squeezy-webhook: invalid signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const eventName = payload.meta?.event_name;
  const data      = payload.data;
  const attrs     = data?.attributes;

  // user_id is stored in the custom_data we pass at checkout
  const userId = payload.meta?.custom_data?.user_id
    || attrs?.first_subscription_item?.custom_data?.user_id
    || null;

  if (!userId) {
    console.warn(`lemon-squeezy-webhook: no user_id in custom_data for event ${eventName}`);
    // Still return 200 so LS doesn't retry indefinitely
    return { statusCode: 200, body: JSON.stringify({ received: true, warning: 'no user_id' }) };
  }

  const lsSubscriptionId = data?.id || null;
  const lsCustomerId     = attrs?.customer_id ? String(attrs.customer_id) : null;

  try {
    switch (eventName) {
      case 'subscription_created':
      case 'subscription_payment_success':
      case 'subscription_payment_recovered': {
        const appStatus = lsStatusToAppStatus(attrs?.status || 'active');
        await updateProfile(supabaseUrl, serviceKey, userId, {
          subscription_status:       appStatus,
          ...(lsCustomerId     && { ls_customer_id:     lsCustomerId }),
          ...(lsSubscriptionId && { ls_subscription_id: lsSubscriptionId }),
        });
        console.log(`${eventName}: user ${userId} → ${appStatus}`);
        break;
      }

      case 'subscription_updated': {
        const appStatus = lsStatusToAppStatus(attrs?.status || 'free');
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: appStatus });
        console.log(`subscription_updated: user ${userId} → ${appStatus}`);
        break;
      }

      case 'subscription_cancelled':
      case 'subscription_expired': {
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: 'cancelled' });
        console.log(`${eventName}: user ${userId} → cancelled`);
        break;
      }

      case 'subscription_payment_failed': {
        await updateProfile(supabaseUrl, serviceKey, userId, { subscription_status: 'past_due' });
        console.log(`subscription_payment_failed: user ${userId} → past_due`);
        break;
      }

      default:
        console.log(`lemon-squeezy-webhook: unhandled event ${eventName}`);
    }
  } catch (e) {
    console.error('lemon-squeezy-webhook handler error:', e);
    // Return 200 so LS doesn't retry on our bugs
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
