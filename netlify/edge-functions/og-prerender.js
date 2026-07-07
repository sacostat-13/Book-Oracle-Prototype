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
      const wantedKey = decodeURIComponent(bookMatch[1]);
      const [wantedTitle, wantedAuthor] = wantedKey.split('|');
      console.log(`[diagnostic] wantedTitle="${wantedTitle}" wantedAuthor="${wantedAuthor}"`);

      // No stored bookKey column to query by directly, so we fetch verified
      // books and compute bookKey() per row to find the match — same
      // tradeoff netlify/functions/sitemap.js already makes. PostgREST caps
      // `limit` at the project's Max Rows setting (default 1000) regardless
      // of what's requested here, so a single fetch silently truncates on
      // any catalog bigger than that — paginate with `offset` until we
      // either find a match or run out of rows, stopping early as soon as
      // a match is found so most requests only cost one or two round trips.
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 20; // hard ceiling so a bad/huge catalog can't hang the function
      let match = null;
      let totalFetched = 0;
      const candidates = []; // v0.39.11: diagnostic — rows whose normalized title looks similar to wanted, so we can see what the DB is actually returning

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/books?select=title,author,status,description,cover_url&status=in.(verified,oracle_categorized)&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
            headers: restHeaders
          }
        );
        if (!res.ok) {
          console.log(`[diagnostic] fetch failed page=${page} status=${res.status}`);
          break;
        }
        const rows = await res.json();
        totalFetched += rows.length;

        for (const b of rows) {
          const normTitle = (b.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (wantedTitle && normTitle.startsWith(wantedTitle.slice(0, 8))) {
            candidates.push({
              title: b.title,
              author: b.author,
              status: b.status,
              normTitle,
              normAuthor: (b.author || '').toLowerCase().replace(/[^a-z0-9]/g, '')
            });
          }
        }

        match = rows.find((b) => matchesBookKey(b.title, b.author, wantedKey));
        if (match || rows.length < PAGE_SIZE) break;
      }

      console.log(`[diagnostic] fetched ${totalFetched} total rows. Title-prefix candidates: ${candidates.length}`);
      if (candidates.length > 0) {
        console.log(`[diagnostic] candidates:`, JSON.stringify(candidates.slice(0, 5)));
      }
      console.log(`[diagnostic] Wanted key: ${wantedKey} | Match found: ${!!match}`);

      if (!match) {
        // v0.39.11: direct probe against the DB for this exact title,
        // ignoring status entirely, to see what its actual status column
        // says — helps distinguish "wrong status filter" from "book not
        // in DB" from "book in DB but not returned by the paginated scan".
        try {
          const probeTitle = wantedTitle.slice(0, 12);
          const probeRes = await fetch(
            `${supabaseUrl}/rest/v1/books?select=title,author,status&title=ilike.*${encodeURIComponent(probeTitle)}*&limit=10`, {
              headers: restHeaders
            }
          );
          if (probeRes.ok) {
            const probeRows = await probeRes.json();
            console.log(`[diagnostic] direct probe (no status filter) on title~"${probeTitle}" returned ${probeRows.length} rows:`, JSON.stringify(probeRows));
          } else {
            console.log(`[diagnostic] probe fetch failed status=${probeRes.status}`);
          }
        } catch (e) {
          console.log(`[diagnostic] probe threw:`, e.message);
        }
        return context.next();
      }

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
          author: {
            '@type': 'Person',
            name: match.author
          },
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