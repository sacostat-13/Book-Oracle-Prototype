// v0.39: OG-tag prerendering for social/link-preview bots.
//
// The client-side useDocumentMeta() hook (src/lib/useDocumentMeta.js) sets
// title/description/OG tags after React renders — fine for Google (which
// executes JS before indexing) but useless for the bots that generate link
// previews in Slack, Twitter/X, Facebook, Discord, WhatsApp, iMessage, etc.
// Those fetch the HTML once and never run JS, so they only ever see
// index.html's generic static <title>/description.
//
// This Edge Function intercepts requests to /book/:bookKey and
// /series/:seriesName, checks the User-Agent against known bot patterns,
// and — only for those — fetches the real book/series data and rewrites
// the <head> of the served HTML before it reaches the bot. Everything else
// (real browsers, Googlebot, any path this doesn't match) passes straight
// through untouched via context.next().
//
// ⚠️ IMPORTANT — NOT YET VERIFIED ON A LIVE DEPLOY. Edge Functions run on a
// Deno runtime that can't be simulated in a local/sandbox environment, so
// this has only been reviewed for logical correctness, not run against a
// real Netlify preview. Test with a real bot-UA request (or a tool like
// https://www.opengraph.xyz or Twitter's card validator) before trusting
// it in production, and check Netlify's function logs for the first few
// real bot hits.



const BOT_UA_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|slackbot|twitterbot|whatsapp|telegrambot|discordbot|linkedinbot|pinterest|embedly|quora link preview|w3c_validator|redditbot|skypeuripreview|vkshare|outbrain|nuzzel|flipboard|tumblr|bitlybot|applebot|semrushbot|ahrefsbot/i;

const SITE = 'https://thebooksoracle.com';

// Mirrors src/lib/bookHelpers.js bookKey() and netlify/functions/sitemap.js's
// copy of the same function — duplicated again here since Edge Functions run
// in a separate Deno bundle and can't import client source directly.
function bookKey(title, author) {
  return (
    (title || '').toLowerCase().replace(/[^a-z0-9]/g, '') +
    '|' +
    (author || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  );
}

function normalizeSeriesName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectMeta(html, { title, description, image, url, jsonLd }) {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description || '')}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description || '')}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:type" content="website">`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description || '')}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '',
  ].filter(Boolean).join('\n    ');

  // Remove the static <title> and description <meta> from index.html so we
  // don't end up with two of each — bots typically use the first tag they
  // see, but better to not rely on that.
  let out = html
    .replace(/<title>.*?<\/title>/is, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '');

  return out.replace('</head>', `    ${tags}\n  </head>`);
}

export default async (request, context) => {
  const userAgent = request.headers.get('user-agent') || '';
  const isBot = BOT_UA_PATTERN.test(userAgent);

  // This will print every single time the function triggers
  console.log("Edge function triggered! URL:", request.url);

  console.log("User-Agent detected:", userAgent);

  // Not a bot, or Netlify somehow routed a path this function isn't scoped
  // to — just pass through untouched.
  if (!isBot) return context.next();

  const url = new URL(request.url);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return context.next();

  const restHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    const bookMatch = url.pathname.match(/^\/book\/([^/]+)$/);
    const seriesMatch = url.pathname.match(/^\/series\/([^/]+)$/);

    if (bookMatch) {
      const pureKeyString = bookMatch[1].split('?')[0];
      const wantedKey = decodeURIComponent(pureKeyString);

      // Extract just the title portion of the key (everything before the '|')
      const titlePart = wantedKey.split('|')[0];

      // Query only for rows where the lowercase title matches our URL title letters
      const res = await fetch(
        `${supabaseUrl}/rest/v1/books?select=title,author,description,cover_url&title=ilike.*${encodeURIComponent(titlePart)}*&limit=10`, {
          headers: restHeaders
        }
      );

      if (!res.ok) return context.next();
      const rows = await res.json();

      // Now we only look through a tiny handful of rows!
      const match = rows.find((b) => bookKey(b.title, b.author) === wantedKey);

      console.log(`Wanted Key: ${wantedKey} | Rows evaluated: ${rows.length} | Match Found: ${!!match}`);

      if (!match) return context.next();

      const response = await context.next();
      const html = await response.text();
      const injected = injectMeta(html, {
        title: `${match.title} by ${match.author} — The Books Oracle`,
        description: match.description ? match.description.slice(0, 200) : undefined,
        image: match.cover_url || undefined,
        url: SITE + url.pathname,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Book',
          name: match.title,
          author: { '@type': 'Person', name: match.author },
          ...(match.description ? { description: match.description.slice(0, 300) } : {}),
          ...(match.cover_url ? { image: match.cover_url } : {}),
        },
      });
      return new Response(injected, response);
    }

    if (seriesMatch) {
      const seriesName = decodeURIComponent(seriesMatch[1]);
      const normalized = normalizeSeriesName(seriesName);
      const res = await fetch(
        `${supabaseUrl}/rest/v1/series?select=name,description&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1`,
        { headers: restHeaders }
      );
      if (!res.ok) return context.next();
      const rows = await res.json();
      const match = rows[0];
      if (!match) return context.next();

      const response = await context.next();
      const html = await response.text();
      const injected = injectMeta(html, {
        title: `${match.name} series — The Books Oracle`,
        description: match.description ? match.description.slice(0, 200) : undefined,
        url: SITE + url.pathname,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BookSeries',
          name: match.name,
          ...(match.description ? { description: match.description.slice(0, 300) } : {}),
        },
      });
      return new Response(injected, response);
    }
  } catch (err) {
    console.error('og-prerender failed', err);
    // Fall through to the unmodified response on any error — a missing
    // OG tag is much better than a broken page for a bot or a real user.
  }

  return context.next();
};

export const config = {
  path: ['/book/*', '/series/*'],
};
