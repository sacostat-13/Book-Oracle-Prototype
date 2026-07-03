// netlify/functions/send-notification-email.js — v0.37.1
// Triggered by a Supabase Database Webhook on INSERT to public.notifications.
//
// Setup (one-time):
//   1. Create a Resend account → get API key
//   2. Add RESEND_API_KEY to Netlify env vars
//   3. Add WEBHOOK_SECRET to Netlify env vars (any strong random string)
//   4. In Supabase → Database → Webhooks:
//      - Table: notifications, Event: INSERT
//      - URL: https://your-site.netlify.app/.netlify/functions/send-notification-email
//      - HTTP header: x-webhook-secret: <same value as WEBHOOK_SECRET>
//
// Required env vars: RESEND_API_KEY, WEBHOOK_SECRET, SUPABASE_URL,
//                    SUPABASE_SERVICE_ROLE_KEY, URL
//
// v0.37.1 fix: Netlify's Node 20 function runtime doesn't expose a native
// WebSocket global the way @supabase/realtime-js expects, so createClient()
// was throwing at call time ("Node.js 20 detected without native WebSocket
// support") before the function ever reached the Resend send logic. This
// function has no need for Realtime at all — it's a one-shot server-side
// lookup — so we explicitly pass the `ws` package in as the transport and
// disable session persistence/auto-refresh (irrelevant for a service-role
// server context anyway).
//
// Requires the `ws` package to be installed:
//   npm install ws --save

const {
  createClient
} = require('@supabase/supabase-js');
const ws = require('ws');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-webhook-secret',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

// Map notification type → preference category key
function prefCategory(type) {
  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
      return 'friends';
    case 'club_invite':
    case 'poll_started':
    case 'poll_finalized':
    case 'discussion_question':
    case 'discussion_reply':
      return 'book_club';
    case 'announcement':
      return 'announcements';
    default:
      return null;
  }
}

function buildEmail({
  type,
  actor,
  data,
  appUrl
}) {
  const actorLabel = actor ?.display_name || (actor ?.username ? `@${actor.username}` : 'Someone');
  const clubLink = data ?.club_id ? `${appUrl}/#book-club-detail?clubId=${data.club_id}` : appUrl;
  const sessionLink = data ?.session_id ? `${appUrl}/#session-detail?sessionId=${data.session_id}` : clubLink;

  switch (type) {
    case 'friend_request':
      return {
        subject: `${actorLabel} wants to be your reading friend`,
          body: `<strong>${actorLabel}</strong> sent you a friend request on The Books Oracle.`,
          ctaUrl: appUrl, ctaLabel: 'View request →',
      };
    case 'friend_accepted':
      return {
        subject: `${actorLabel} accepted your friend request`,
          body: `You and <strong>${actorLabel}</strong> are now reading friends.`,
          ctaUrl: appUrl, ctaLabel: 'Open app →',
      };
    case 'club_invite':
      return {
        subject: `You've been added to ${data?.club_name || 'a book club'}`,
          body: `<strong>${actorLabel}</strong> added you to <strong>${data?.club_name || 'a book club'}</strong>.`,
          ctaUrl: clubLink, ctaLabel: 'View club →',
      };
    case 'poll_started':
      return {
        subject: `New poll in ${data?.club_name || 'your book club'}`,
          body: `A new poll has started in <strong>${data?.club_name || 'your club'}</strong>: <em>${data?.question || ''}</em>`,
          ctaUrl: clubLink, ctaLabel: 'Vote now →',
      };
    case 'poll_finalized':
      return {
        subject: `Poll closed in ${data?.club_name || 'your book club'}`,
          body: `The poll in <strong>${data?.club_name || 'your club'}</strong> is closed. The group will read: <strong>${data?.winner || 'the chosen book'}</strong>.`,
          ctaUrl: clubLink, ctaLabel: 'View result →',
      };
    case 'discussion_question':
      return {
        subject: `New discussion question in ${data?.club_name || 'your book club'}`,
          body: `<strong>${actorLabel}</strong> posted a new question in <strong>${data?.club_name || 'your club'}</strong>: <em>${data?.question || ''}</em>`,
          ctaUrl: sessionLink, ctaLabel: 'Join discussion →',
      };
    case 'discussion_reply':
      return {
        subject: `${actorLabel} replied to your comment`,
          body: `<strong>${actorLabel}</strong> replied to your comment in <strong>${data?.club_name || 'your club'}</strong>: <em>${(data?.preview || '').slice(0, 100)}</em>`,
          ctaUrl: sessionLink, ctaLabel: 'View reply →',
      };
    case 'announcement':
      return {
        subject: data ?.title || 'Announcement from The Books Oracle',
          body : data ?.preview || 'There is a new announcement from the The Books Oracle team.',
          ctaUrl : appUrl, ctaLabel: 'Open app →',
      };
    default:
      return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return {
    statusCode: 204,
    headers: CORS,
    body: ''
  };

  const secret = event.headers['x-webhook-secret'];
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    console.error('send-notification-email: invalid webhook secret');
    return respond(401, {
      error: 'Unauthorized'
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return respond(400, {
      error: 'Invalid JSON'
    });
  }

  const notification = payload ?.record;
  if (!notification) return respond(400, {
    error: 'No notification record'
  });

  const category = prefCategory(notification.type);
  if (!category) return respond(200, {
    skipped: 'unknown_type'
  });

  const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      realtime: {
        transport: ws
      },
    }
  );

  // Look up recipient
  const {
    data: recipientAuth
  } = await supabaseClient.auth.admin.getUserById(notification.user_id);
  const recipientEmail = recipientAuth ?.user ?.email;
  if (!recipientEmail) return respond(200, {
    skipped: 'no_email'
  });

  // Check notification preferences
  const {
    data: profile
  } = await supabaseClient
    .from('profiles')
    .select('notification_preferences, email_notifications')
    .eq('id', notification.user_id)
    .maybeSingle();

  const prefs = profile ?.notification_preferences || {};
  // Email master toggle (new JSONB prefs or legacy boolean)
  const emailOn = prefs.email !== false && profile ?.email_notifications !== false;
  if (!emailOn) return respond(200, {
    skipped: 'email_off'
  });
  // Category toggle
  if (prefs[category] === false) return respond(200, {
    skipped: `category_${category}_off`
  });

  // Look up actor
  const {
    data: actor
  } = await supabaseClient
    .from('profiles')
    .select('username, display_name, avatar_url')
    .eq('id', notification.actor_id)
    .maybeSingle();

  const appUrl = process.env.URL || 'https://thebooksoracle.com';
  const email = buildEmail({
    type: notification.type,
    actor,
    data: notification.data || {},
    appUrl
  });
  if (!email) return respond(200, {
    skipped: 'no_template'
  });

  if (!process.env.RESEND_API_KEY) {
    console.log('send-notification-email: dev mode, would send:', email.subject, 'to', recipientEmail);
    return respond(200, {
      dev_mode: true
    });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'The Books Oracle <noreply@thebooksoracle.com>',
      to: [recipientEmail],
      subject: email.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="background:#f5edd8;margin:0;padding:32px 16px;font-family:Georgia,serif">
          <div style="max-width:480px;margin:0 auto;background:#ede3c8;border:1px solid rgba(42,29,14,0.14);border-radius:4px;padding:32px">
            <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#9a7a2e;margin-bottom:24px">
              The Books Oracle
            </div>
            <p style="font-family:Georgia,serif;font-size:16px;color:#2a1d0e;line-height:1.6;margin:0 0 20px">
              ${email.body}
            </p>
            <p style="margin:0">
              <a href="${email.ctaUrl}" style="font-family:Georgia,serif;font-size:15px;color:#9a7a2e;text-decoration:underline">
                ${email.ctaLabel}
              </a>
            </p>
            <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(42,29,14,0.14);font-family:'Courier New',monospace;font-size:11px;color:#8c7060;letter-spacing:0.05em">
              Manage your notification preferences in your
              <a href="${appUrl}/#profile" style="color:#9a7a2e">profile settings</a>.
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
    return respond(500, {
      error: 'Email send failed'
    });
  }

  console.log('send-notification-email: sent', notification.type, 'to', recipientEmail);
  return respond(200, {
    sent: true
  });
};