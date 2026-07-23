// netlify/functions/send-notification-email.js — v0.37.2
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
// v0.37.3 fix: converted to ESM. The project's root package.json has
// "type": "module", so Lambda treated this .js file as an ES module and
// `exports.handler` threw a ReferenceError at init — the function crashed
// before any request logic ran.
//
// The `ws` transport from v0.37.1 is REQUIRED and has been restored (as an
// ESM import). SupabaseClient's constructor calls _initRealtimeClient()
// unconditionally, even though this function only makes REST calls, and on
// Netlify's Node 20 runtime there is no native WebSocket — so createClient()
// throws at construction time without an explicit transport. Passing `ws`
// satisfies the RealtimeClient constructor; no channel is ever opened.
//
// Requires the `ws` package: npm install ws --save
// (Alternative: run functions on Node 22, which has native WebSocket, and
//  drop both the `ws` dep and the realtime.transport option.)

import {
  createClient
} from '@supabase/supabase-js';
import ws from 'ws';

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
    body: JSON.stringify(body),
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
  const actorLabel =
    actor ?.display_name || (actor ?.username ? `@${actor.username}` : 'Someone');
  const clubLink = data ?.club_id ?
    `${appUrl}/#book-club-detail?clubId=${data.club_id}` :
    appUrl;
  const sessionLink = data ?.session_id ?
    `${appUrl}/#session-detail?sessionId=${data.session_id}` :
    clubLink;
  const friendsLink = `${appUrl}/friends`;

  switch (type) {
    case 'friend_request':
      return {
        subject: `${actorLabel} wants to be your reading friend`,
          body: `<strong>${actorLabel}</strong> sent you a friend request on The Books Oracle.`,
          ctaUrl: friendsLink,
          ctaLabel: 'View request →',
      };
    case 'friend_accepted':
      return {
        subject: `${actorLabel} accepted your friend request`,
          body: `You and <strong>${actorLabel}</strong> are now reading friends.`,
          ctaUrl: friendsLink,
          ctaLabel: 'Open app →',
      };
    case 'club_invite':
      return {
        subject: `You've been added to ${data?.club_name || 'a book club'}`,
          body: `<strong>${actorLabel}</strong> added you to <strong>${data?.club_name || 'a book club'}</strong>.`,
          ctaUrl: clubLink,
          ctaLabel: 'View club →',
      };
    case 'poll_started':
      return {
        subject: `New poll in ${data?.club_name || 'your book club'}`,
          body: `A new poll has started in <strong>${data?.club_name || 'your club'}</strong>: <em>${data?.question || ''}</em>`,
          ctaUrl: clubLink,
          ctaLabel: 'Vote now →',
      };
    case 'poll_finalized':
      return {
        subject: `Poll closed in ${data?.club_name || 'your book club'}`,
          body: `The poll in <strong>${data?.club_name || 'your club'}</strong> is closed. The group will read: <strong>${data?.winner || 'the chosen book'}</strong>.`,
          ctaUrl: clubLink,
          ctaLabel: 'View result →',
      };
    case 'discussion_question':
      return {
        subject: `New discussion question in ${data?.club_name || 'your book club'}`,
          body: `<strong>${actorLabel}</strong> posted a new question in <strong>${data?.club_name || 'your club'}</strong>: <em>${data?.question || ''}</em>`,
          ctaUrl: sessionLink,
          ctaLabel: 'Join discussion →',
      };
    case 'discussion_reply':
      return {
        subject: `${actorLabel} replied to your comment`,
          body: `<strong>${actorLabel}</strong> replied to your comment in <strong>${data?.club_name || 'your club'}</strong>: <em>${(data?.preview || '').slice(0, 100)}</em>`,
          ctaUrl: sessionLink,
          ctaLabel: 'View reply →',
      };
    case 'announcement': {
      const raw =
        data ?.body ||
        data ?.preview ||
        'There is a new announcement from the The Books Oracle team.';
      const htmlBody = String(raw)
        .replace(/\\n/g, '\n') // unescape literal "\n" if stored that way
        .replace(/\n/g, '<br>'); // real newlines → <br> for the email HTML
      return {
        subject: data ?.title || 'Announcement from The Books Oracle',
        body: htmlBody,
        ctaUrl: appUrl,
        ctaLabel: 'Open app →',
      };
    }
    default:
      return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS,
      body: ''
    };
  }

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
  } = await supabaseClient.auth.admin.getUserById(
    notification.user_id
  );
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
  if (prefs[category] === false) {
    return respond(200, {
      skipped: `category_${category}_off`
    });
  }

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
    appUrl,
  });
  if (!email) return respond(200, {
    skipped: 'no_template'
  });

  // Plain-text preheader (inbox preview snippet) derived from the HTML body.
  const preheader = String(email.body).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);

  if (!process.env.RESEND_API_KEY) {
    console.log(
      'send-notification-email: dev mode, would send:',
      email.subject,
      'to',
      recipientEmail
    );
    return respond(200, {
      dev_mode: true
    });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'The Books Oracle <noreply@thebooksoracle.com>',
      to: [recipientEmail],
      subject: email.subject,
      html: `
        <!DOCTYPE html>
        <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="X-UA-Compatible" content="IE=edge">
          <meta name="color-scheme" content="light dark">
          <meta name="supported-color-schemes" content="light dark">
          <title>${email.subject}</title>
          <!--[if mso]><style>* { font-family: Arial, sans-serif !important; }</style><![endif]-->
          <style>
            body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
            img { -ms-interpolation-mode: bicubic; border: 0; line-height: 100%; outline: none; text-decoration: none; }
            body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
            a { color: #9a7a2e; }
            @media only screen and (max-width: 600px) {
              .bo-card { padding: 28px 22px !important; }
              .bo-btn { width: 100% !important; }
            }
            @media (prefers-color-scheme: dark) {
              .bo-body { background: #16130f !important; }
              .bo-card { background: #201b15 !important; border-color: #342c20 !important; }
              .bo-text { color: #ede4d2 !important; }
              .bo-muted { color: #a99d89 !important; }
              .bo-wordmark { color: #cba33f !important; }
            }
          </style>
        </head>
        <body class="bo-body" style="margin:0;padding:0;background:#f4f1ea;">
          <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f1ea;">${preheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bo-body" style="background:#f4f1ea;">
            <tr>
              <td align="center" style="padding:40px 16px;">
                <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;">
                  <tr>
                    <td class="bo-card" style="background:#ffffff;border:1px solid #ebe6da;border-radius:12px;padding:40px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      <p class="bo-wordmark" style="margin:0 0 28px;font-family:'IBM Plex Mono',ui-monospace,'Courier New',monospace;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#9a7a2e;">The Books Oracle</p>
                      <p class="bo-text" style="margin:0 0 28px;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.55;color:#2a2620;">${email.body}</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td class="bo-btn" align="center" bgcolor="#9a7a2e" style="border-radius:8px;">
                            <!--[if mso]>
                            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${email.ctaUrl}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="17%" strokecolor="#9a7a2e" fillcolor="#9a7a2e">
                              <w:anchorlock/>
                              <center style="color:#fdfaf2;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${email.ctaLabel}</center>
                            </v:roundrect>
                            <![endif]-->
                            <!--[if !mso]><!-- -->
                            <a href="${email.ctaUrl}" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.02em;color:#fdfaf2;text-decoration:none;border-radius:8px;background:#9a7a2e;">${email.ctaLabel}</a>
                            <!--<![endif]-->
                          </td>
                        </tr>
                      </table>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:36px;">
                        <tr><td style="border-top:1px solid #ebe6da;font-size:0;line-height:0;">&nbsp;</td></tr>
                      </table>
                      <p class="bo-muted" style="margin:18px 0 0;font-family:'IBM Plex Mono',ui-monospace,'Courier New',monospace;font-size:11px;line-height:1.6;letter-spacing:0.03em;color:#8c8474;">
                        Manage your notification preferences in your <a href="${appUrl}/profile" style="color:#9a7a2e;text-decoration:underline;">profile settings</a>.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:20px 8px 0;font-family:'IBM Plex Mono',ui-monospace,'Courier New',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#b3ab9a;">
                      The Books Oracle
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
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