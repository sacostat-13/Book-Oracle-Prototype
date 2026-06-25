// netlify/functions/send-notification-email.js — v0.36
// Triggered by a Supabase Database Webhook on INSERT to public.notifications.
//
// Setup (one-time):
//   1. Create a Resend account at resend.com → get API key
//   2. Add RESEND_API_KEY to Netlify env vars
//   3. Add WEBHOOK_SECRET to Netlify env vars (any strong random string)
//   4. In Supabase → Database → Webhooks:
//      - Table: notifications, Event: INSERT
//      - URL: https://your-site.netlify.app/.netlify/functions/send-notification-email
//      - HTTP header: x-webhook-secret: <same value as WEBHOOK_SECRET>
//
// Required env vars:
//   RESEND_API_KEY
//   WEBHOOK_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   URL  (set automatically by Netlify — used for app links in emails)

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-webhook-secret',
};

function respond(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // Verify the shared secret Supabase sends with every webhook call
  const secret = event.headers['x-webhook-secret'];
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    console.error('send-notification-email: invalid webhook secret');
    return respond(401, { error: 'Unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(event.body); } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const notification = payload?.record;
  if (!notification || notification.type === undefined) {
    return respond(400, { error: 'No notification record' });
  }

  // Only handle the two friend notification types
  if (!['friend_request', 'friend_accepted'].includes(notification.type)) {
    return respond(200, { skipped: true });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Look up recipient email via service role (bypasses RLS)
  const { data: recipientAuth } = await supabase.auth.admin.getUserById(notification.user_id);
  const recipientEmail = recipientAuth?.user?.email;
  if (!recipientEmail) {
    console.log('send-notification-email: no email for user', notification.user_id);
    return respond(200, { skipped: 'no_email' });
  }

  // Check recipient's email_notifications preference
  const { data: recipientProfile } = await supabase
    .from('profiles')
    .select('email_notifications')
    .eq('id', notification.user_id)
    .maybeSingle();

  if (recipientProfile?.email_notifications === false) {
    return respond(200, { skipped: 'opted_out' });
  }

  // Look up actor's display name and username
  const { data: actor } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('id', notification.actor_id)
    .maybeSingle();

  const actorLabel  = actor?.display_name || (actor?.username ? `@${actor.username}` : 'Someone');
  const actorHandle = actor?.username ? `@${actor.username}` : actorLabel;
  const appUrl      = process.env.URL || 'https://thebookoracle.netlify.app';
  const profileUrl  = actor?.username ? `${appUrl}/u/${actor.username}` : appUrl;

  let subject, htmlBody;

  if (notification.type === 'friend_request') {
    subject  = `${actorHandle} wants to be your reading friend`;
    htmlBody = `
      <p style="font-family:Georgia,serif;font-size:16px;color:#2a1d0e;line-height:1.6">
        <strong>${actorLabel}</strong> sent you a friend request on The Book Oracle.
      </p>
      <p style="margin-top:16px">
        <a href="${appUrl}" style="font-family:Georgia,serif;font-size:15px;color:#9a7a2e;text-decoration:underline">
          Open the app to accept or decline →
        </a>
      </p>
    `;
  } else if (notification.type === 'friend_accepted') {
    subject  = `${actorHandle} accepted your friend request`;
    htmlBody = `
      <p style="font-family:Georgia,serif;font-size:16px;color:#2a1d0e;line-height:1.6">
        You and <strong>${actorLabel}</strong> are now reading friends on The Book Oracle.
      </p>
      <p style="margin-top:16px">
        <a href="${profileUrl}" style="font-family:Georgia,serif;font-size:15px;color:#9a7a2e;text-decoration:underline">
          View their profile →
        </a>
      </p>
    `;
  }

  // Send via Resend
  // If RESEND_API_KEY is not set (local dev), just log and skip
  if (!process.env.RESEND_API_KEY) {
    console.log('send-notification-email: RESEND_API_KEY not set, would have sent:', { to: recipientEmail, subject });
    return respond(200, { dev_mode: true });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'The Book Oracle <noreply@thebookoracle.app>',
      to: [recipientEmail],
      subject,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="background:#f5edd8;margin:0;padding:32px 16px;font-family:Georgia,serif">
          <div style="max-width:480px;margin:0 auto;background:#ede3c8;border:1px solid rgba(42,29,14,0.14);border-radius:4px;padding:32px">
            <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#9a7a2e;margin-bottom:24px">
              The Book Oracle
            </div>
            ${htmlBody}
            <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(42,29,14,0.14);font-family:'Courier New',monospace;font-size:11px;color:#8c7060;letter-spacing:0.05em">
              You're receiving this because you have email notifications enabled.
              You can turn them off in your <a href="${appUrl}" style="color:#9a7a2e">profile settings</a>.
            </div>
          </div>
        </body>
        </html>
      `,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error('send-notification-email: Resend error', emailRes.status, err);
    return respond(500, { error: 'Email send failed' });
  }

  console.log('send-notification-email: sent', notification.type, 'to', recipientEmail);
  return respond(200, { sent: true });
};
