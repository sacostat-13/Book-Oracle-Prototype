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
// Deliberate split from sitemap.js: this function has NO status filter
// (any book with a page renders here), while sitemap.js keeps its
// status filter to verified/oracle_categorized. Rationale: the sitemap
// invites Google to index pages, which is a stronger commitment than
// just serving a preview to someone who already has the URL.



const BOT_UA_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|slackbot|twitterbot|whatsapp|telegrambot|discordbot|linkedinbot|pinterest|embedly|quora link preview|w3c_validator|redditbot|skypeuripreview|vkshare|outbrain|nuzzel|flipboard|tumblr|bitlybot|applebot|semrushbot|ahrefsbot/i;

const SITE = 'https://thebooksoracle.com';

// Mirrors src/lib/bookHelpers.js bookKey() and netlify/functions/sitemap.js's
// copy of the same function — duplicated again here since Edge Functions run
// in a separate Deno bundle and can't import client source directly.
//
// v0.39.10: matching against this key is deliberately NOT a strict string
// equality check anymore (see matchesBookKey below). The client's author
// truncation length has drifted from this copy at least once already
// (was assumed to be 10 chars, production was actually generating 11) —
// duplicating the exact algorithm server-side is inherently fragile to
// that kind of drift, so the match is tolerant of it instead of exact.

// Title must match exactly (titles aren't truncated, so no drift risk there).
// Author is compared as a mutual prefix rather than an exact substring — this
// tolerates the client using any truncation length (10, 11, or a future
// change) without needing this file kept in perfect lockstep with it.
function matchesBookKey(title, author, wantedKey) {
  const [wantedTitle, wantedAuthor] = wantedKey.split('|');
  const normTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normAuthor = (author || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normTitle !== wantedTitle) return false;
  if (!wantedAuthor || !normAuthor) return wantedAuthor === normAuthor;
  const shorter = wantedAuthor.length <= normAuthor.length ? wantedAuthor : normAuthor;
  const longer = wantedAuthor.length <= normAuthor.length ? normAuthor : wantedAuthor;
  return longer.startsWith(shorter);
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

function injectMeta(html, {
  title,
  description,
  image,
  url,
  jsonLd
}) {
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
      const wantedKey = decodeURIComponent(bookMatch[1]);

      // v0.39.11: no status filter here. sitemap.js keeps its status filter
      // (verified/oracle_categorized) because the sitemap invites Google to
      // *index* pages, which is a stronger commitment than serving a link
      // preview to someone who already has the URL. If a page renders for a
      // signed-in visitor (all book pages do, regardless of status), it
      // should render a proper preview when shared — otherwise link
      // unfurls look broken for legitimately-reachable content. Deliberate
      // split: sitemap strict, OG-prerender permissive.
      //
      // No stored bookKey column to query by directly, so we fetch and
      // compute bookKey() per row to find the match — same tradeoff
      // sitemap.js already makes. PostgREST caps `limit` at the project's
      // Max Rows setting (default 1000) regardless of what's requested, so
      // a single fetch silently truncates on any catalog bigger than that
      // — paginate with `offset` until we find a match or run out of rows,
      // stopping early on match so most requests only cost one round trip.
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 20; // hard ceiling so a runaway catalog can't hang the function
      let match = null;
      let totalFetched = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/books?select=title,author,description,cover_url&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
            headers: restHeaders
          }
        );
        if (!res.ok) break;
        const rows = await res.json();
        totalFetched += rows.length;
        match = rows.find((b) => matchesBookKey(b.title, b.author, wantedKey));
        if (match || rows.length < PAGE_SIZE) break; // found it, or hit the last page
      }

      console.log(`[og-prerender] scanned ${totalFetched} books | wanted=${wantedKey} | match=${!!match}${match ? ` (${match.title} by ${match.author})` : ''}`);

      if (!match) return context.next();

      const response = await context.next();
      const html = await response.text();
      // v0.39.11: null-safe author fallback — some catalog rows have null
      // authors (seen in earlier diagnostic candidate list). "Untitled" is
      // never right for the book title, but "Unknown author" is a reasonable
      // fallback for a missing author in the OG title string.
      const authorDisplay = match.author || 'Unknown author';
      const injected = injectMeta(html, {
        title: `${match.title} by ${authorDisplay} — The Books Oracle`,
        description: match.description ? match.description.slice(0, 200) : undefined,
        image: match.cover_url || undefined,
        url: SITE + url.pathname,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Book',
          name: match.title,
          ...(match.author ? {
            author: {
              '@type': 'Person',
              name: match.author
            }
          } : {}),
          ...(match.description ? {
            description: match.description.slice(0, 300)
          } : {}),
          ...(match.cover_url ? {
            image: match.cover_url
          } : {}),
        },
      });
      return new Response(injected, response);
    }

    if (seriesMatch) {
      const seriesName = decodeURIComponent(seriesMatch[1]);
      const normalized = normalizeSeriesName(seriesName);
      const res = await fetch(
        `${supabaseUrl}/rest/v1/series?select=name,description&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1`, {
          headers: restHeaders
        }
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
          ...(match.description ? {
            description: match.description.slice(0, 300)
          } : {}),
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