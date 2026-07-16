// v0.39: OG-tag prerendering for social/link-preview bots.
//
// The client-side useDocumentMeta() hook (src/lib/useDocumentMeta.js) sets
// title/description/OG tags after React renders — fine for Google (which
// executes JS before indexing) but useless for the bots that generate link
// previews in Slack, Twitter/X, Facebook, Discord, WhatsApp, iMessage, etc.
// Those fetch the HTML once and never run JS, so they only ever see
// index.html's generic static <title>/description.
//
// This Edge Function intercepts requests to /book/:bookKey,
// /series/:seriesName, /l/:listId, /plans/:planId, /clubs/:clubId and
// /u/:username, checks the User-Agent against known bot patterns,
// and — only for those — fetches the real entity data and rewrites
// the <head> of the served HTML before it reaches the bot. Everything else
// (real browsers, Googlebot, any path this doesn't match) passes straight
// through untouched via context.next().
//
// v0.43: lists, plans, clubs and profiles added for Share Cards. Public
// gating is inherited from what already exists rather than re-invented:
//   - lists/plans go through the same get_public_list / get_public_plan
//     RPCs the ListView share pages use — a non-public entity returns
//     null there and we simply pass through with no OG injection.
//   - clubs are only served when visibility = 'public' (v26 column).
//   - profiles render for any username, matching /u/:username page
//     behaviour (the page itself is publicly reachable).
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

// v0.48 Branded Link Previews: build the og:image URL for the share-card
// function's landscape OG layout (?layout=og, 1200×630). Strings are built
// server-side here (i18n-agnostic English, same convention as the rest of
// this file); share-card just renders what it's given. `origin` comes from
// the request so deploy previews render their own images.
function ogCardImage(origin, { ornament, eyebrow, headline, sub, cover }) {
  const params = new URLSearchParams({ layout: 'og' });
  if (ornament) params.set('ornament', ornament);
  if (eyebrow) params.set('eyebrow', eyebrow);
  if (headline) params.set('headline', headline);
  if (sub) params.set('sub', sub);
  if (cover) params.set('cover', cover);
  return `${origin}/.netlify/functions/share-card?${params.toString()}`;
}

function injectMeta(html, {
  title,
  description,
  image,
  imageWidth,
  imageHeight,
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
    image && imageWidth ? `<meta property="og:image:width" content="${imageWidth}">` : '',
    image && imageHeight ? `<meta property="og:image:height" content="${imageHeight}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description || '')}">`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : '',
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

  // POST to a PostgREST RPC endpoint. Returns the parsed JSON result or
  // null on any failure — callers treat null as "not public / not found"
  // and pass through untouched.
  async function callRpc(name, args) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { ...restHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // Shared tail for every match: get the SPA HTML, inject, respond.
  async function respond(meta) {
    const response = await context.next();
    const html = await response.text();
    return new Response(injectMeta(html, meta), response);
  }

  try {
    const bookMatch = url.pathname.match(/^\/book\/([^/]+)$/);
    const seriesMatch = url.pathname.match(/^\/series\/([^/]+)$/);
    const listMatch = url.pathname.match(/^\/l\/([^/]+)$/);
    const planMatch = url.pathname.match(/^\/plans\/([^/]+)$/);
    const clubMatch = url.pathname.match(/^\/clubs\/([^/]+)$/);
    const profileMatch = url.pathname.match(/^\/u\/([^/]+)$/);

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
        // v0.48: branded 1200×630 card (cover + title on the ink/gold frame)
        // instead of the raw cover — raw covers are portrait and crop badly
        // in landscape unfurls, and carried no branding.
        image: ogCardImage(url.origin, {
          ornament: '❦',
          headline: match.title,
          sub: `by ${authorDisplay}`,
          cover: match.cover_url || undefined,
        }),
        imageWidth: 1200,
        imageHeight: 630,
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

      return respond({
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
    }

    // ── Lists: /l/:listId (public share links) ────────────────────────────
    if (listMatch) {
      const data = await callRpc('get_public_list', { p_list_id: decodeURIComponent(listMatch[1]) });
      if (!data || !data.list) return context.next();
      const { list, owner, books = [] } = data;
      const firstCover = books.find((e) => e.book?.cover_url)?.book?.cover_url;
      const curator = owner?.display_name;
      return respond({
        title: `${list.title} — a reading list on The Books Oracle`,
        description: list.description
          ? list.description.slice(0, 200)
          : `${books.length} books${curator ? `, curated by ${curator}` : ''}.`,
        // v0.48: branded card — first cover (when any) + list title/count.
        image: ogCardImage(url.origin, {
          eyebrow: 'A reading list',
          headline: list.title,
          sub: `${books.length} ${books.length === 1 ? 'book' : 'books'}${curator ? ` · curated by ${curator}` : ''}`,
          cover: firstCover || undefined,
        }),
        imageWidth: 1200,
        imageHeight: 630,
        url: SITE + url.pathname,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: list.title,
          numberOfItems: books.length,
          ...(list.description ? { description: list.description.slice(0, 300) } : {}),
        },
      });
    }

    // ── Plans: /plans/:planId ──────────────────────────────────────────────
    // /plans/new (the create page) hits this matcher too — the RPC just
    // returns null for a non-uuid id and we pass through. Cheap enough to
    // not special-case, but skip the obvious static route to save the call.
    if (planMatch && planMatch[1] !== 'new') {
      const data = await callRpc('get_public_plan', { p_plan_id: decodeURIComponent(planMatch[1]) });
      if (!data || !data.plan) return context.next();
      const { plan, owner } = data;
      const content = plan.content || {};
      const books = content.books || [];
      const title = plan.title || content.title || 'A reading plan';
      const curator = owner?.display_name;
      return respond({
        title: `${title} — a reading plan on The Books Oracle`,
        description: content.intro
          ? content.intro.slice(0, 200)
          : `${books.length} books${content.timeline ? ` over ${content.timeline} months` : ''}${curator ? `, by ${curator}` : ''}.`,
        // v0.48: branded card. Plan content carries no cover URLs, so this is
        // the text-only centered layout — still fully branded, no bare unfurl.
        image: ogCardImage(url.origin, {
          ornament: '✺',
          eyebrow: 'A reading plan',
          headline: title,
          sub: `${books.length} ${books.length === 1 ? 'book' : 'books'}${content.timeline ? ` over ${content.timeline} months` : ''}${curator ? ` · by ${curator}` : ''}`,
        }),
        imageWidth: 1200,
        imageHeight: 630,
        url: SITE + url.pathname,
      });
    }

    // ── Clubs: /clubs/:clubId (public clubs only) ─────────────────────────
    // Static club routes (/clubs/new, /clubs/discover) fall into this
    // matcher; the eq filter simply finds no row and we pass through.
    if (clubMatch && clubMatch[1] !== 'new' && clubMatch[1] !== 'discover') {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/book_clubs?select=name,description,visibility&id=eq.${encodeURIComponent(decodeURIComponent(clubMatch[1]))}&limit=1`,
        { headers: restHeaders }
      );
      if (!res.ok) return context.next();
      const club = (await res.json())[0];
      // Service role bypasses RLS, so visibility must be enforced here:
      // private clubs get no preview, exactly like a private list/plan.
      if (!club || club.visibility !== 'public') return context.next();
      return respond({
        title: `${club.name} — a book club on The Books Oracle`,
        description: club.description ? club.description.slice(0, 200) : 'Join this book club on The Books Oracle.',
        url: SITE + url.pathname,
      });
    }

    // ── Profiles: /u/:username ────────────────────────────────────────────
    if (profileMatch) {
      const username = decodeURIComponent(profileMatch[1]).toLowerCase();
      const res = await fetch(
        `${supabaseUrl}/rest/v1/profiles?select=username,display_name,avatar_url&username=eq.${encodeURIComponent(username)}&limit=1`,
        { headers: restHeaders }
      );
      if (!res.ok) return context.next();
      const profile = (await res.json())[0];
      if (!profile) return context.next();
      const name = profile.display_name || profile.username;
      return respond({
        title: `${name} (@${profile.username}) — The Books Oracle`,
        description: `${name}'s reading profile on The Books Oracle.`,
        image: profile.avatar_url || undefined,
        url: SITE + url.pathname,
      });
    }
  } catch (err) {
    console.error('og-prerender failed', err);
    // Fall through to the unmodified response on any error — a missing
    // OG tag is much better than a broken page for a bot or a real user.
  }

  return context.next();
};

export const config = {
  path: ['/book/*', '/series/*', '/l/*', '/plans/*', '/clubs/*', '/u/*'],
};