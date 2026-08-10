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

// v0.61.2 — www, matching Netlify's primary domain. thebooksoracle.com 301s
// here, so the previous non-www value meant every URL emitted by this file
// redirected. Google treats a redirecting sitemap entry and a canonical that
// points at a redirect as weaker signals than the real thing, and it split
// authority across two hosts. Changing the primary domain in Netlify means
// changing this in four places: index.html, robots.txt,
// netlify/functions/sitemap.js and netlify/edge-functions/og-prerender.js.
const SITE = 'https://www.thebooksoracle.com';

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

  // Strip everything from index.html that this function is about to restate.
  //
  // Originally this only had to remove <title> and the description meta,
  // because index.html carried nothing else. v0.61.2 gave it a full static
  // head — og:*, twitter:*, canonical, hreflang — and appending on top of that
  // left every entity page serving TWO og:title tags, TWO canonicals, and an
  // hreflang set pointing at the homepage. Bots usually take the first tag they
  // see, which would have been the generic homepage one on all ~1,700 pages:
  // strictly worse than before the static head existed.
  //
  // hreflang goes too. The homepage genuinely is available in both languages
  // at the same URL; a book page inheriting that claim says nothing true.
  let out = html
    .replace(/<title>.*?<\/title>/is, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<meta\s+property="og:(?:title|description|url|image|image:width|image:height|type)"[^>]*>/gi, '')
    .replace(/<meta\s+name="twitter:(?:card|title|description|image)"[^>]*>/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>/gi, '')
    .replace(/<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>/gi, '');

  return out.replace('</head>', `    ${tags}\n  </head>`);
}


// ── v0.61.3: BODY injection ───────────────────────────────────────────────────
//
// injectMeta() only ever rewrote <head>. That was fine while index.html shipped
// an empty <div id="root">: every entity page was thin, but thin in the same
// way an empty page is thin.
//
// v0.61.2 put real fallback copy inside #root to make the HOMEPAGE indexable —
// and because the SPA serves that same index.html for every route, all ~1,700
// book and series URLs in the sitemap started serving byte-identical body copy.
// Google handles 1,700 duplicates worse than 1,700 blanks.
//
// So the fallback is now swapped for per-entity content on the routes this
// function already understands. It is written between explicit HTML comment
// markers in index.html rather than matched by a div regex, because the block
// will be edited by people who have no reason to know this function exists.
//
// ON DYNAMIC RENDERING: this runs for bots only, like everything else here.
// The injected content states the same facts the React page renders — title,
// author, description, series order — so it is within what Google tolerates,
// but their guidance treats dynamic rendering as a workaround rather than a
// destination. The real fix is server rendering these routes. Revisit if the
// app ever grows an SSR story.
const PREMOUNT_RE = /<!--PREMOUNT-->[\s\S]*?<!--\/PREMOUNT-->/;

function injectBody(html, blockHtml) {
  if (!PREMOUNT_RE.test(html)) return html; // markers gone — leave it alone
  return html.replace(PREMOUNT_RE, `<div class="pre-mount">${blockHtml}</div>`);
}

// Internal links are the point of this as much as the prose. Google discovers
// and weighs deep pages through links from other pages; 1,700 orphans reachable
// only from a sitemap is a much weaker position than 1,700 pages that reference
// each other by series and genre.
function bookLink(title, author) {
  const key = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '') +
    '|' + (author || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return `/book/${encodeURIComponent(key)}`;
}

function listItems(rows) {
  return rows.map((b) => {
    const pos = b.position_in_series != null ? `${Number(b.position_in_series)}. ` : '';
    return `<li>${escapeHtml(pos)}<a href="${escapeHtml(bookLink(b.title, b.author))}">${escapeHtml(b.title)}</a>` +
      `${b.author ? ` — ${escapeHtml(b.author)}` : ''}</li>`;
  }).join('');
}

export default async (request, context) => {
  const userAgent = request.headers.get('user-agent') || '';
  const isBot = BOT_UA_PATTERN.test(userAgent);

  // This will print every single time the function triggers
  // Not a bot, or Netlify somehow routed a path this function isn't scoped
  // to — just pass through untouched.
  if (!isBot) return context.next();

  const url = new URL(request.url);
  // v0.61.2: added the VITE_ fallback, same fix as sitemap.js. Every other
  // Supabase consumer in netlify/functions reads `SUPABASE_URL ||
  // VITE_SUPABASE_URL`; these two read only the short name. If Netlify has just
  // VITE_SUPABASE_URL set, this returns context.next() on every request and
  // NO entity page ever gets its OG tags injected — every book, series, list
  // and plan shared to Slack or WhatsApp falls back to the generic site
  // preview. Silent by construction: passing through is also the correct
  // behaviour for a non-public entity, so the failure looks like normal
  // operation. The log line distinguishes them.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('[og-prerender] DEGRADED: no Supabase credentials — serving generic previews for every entity page.');
    return context.next();
  }

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
  // v0.61.3: `body` is optional. Branches that pass one get the #root fallback
  // replaced with entity content; branches that don't (lists, plans, clubs,
  // profiles) keep the generic block. That is deliberate — those are private-
  // by-default share targets that the sitemap never invites Google to index,
  // so there is nothing to gain from describing them in crawlable HTML.
  async function respond(meta, body) {
    const response = await context.next();
    const html = await response.text();
    const injected = injectMeta(html, meta);
    return new Response(body ? injectBody(injected, body) : injected, response);
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
          `${supabaseUrl}/rest/v1/books?select=title,author,description,cover_url,genre,series_id,position_in_series&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
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
      // ── Body content + internal links ──────────────────────────────────
      // Two extra reads, bots only. Series siblings first (strongest possible
      // relation between two book pages), then same-genre neighbours to give
      // standalone books something to link to as well.
      let siblings = [];
      let neighbours = [];
      let seriesName = null;
      if (match.series_id) {
        const [sRes, bRes] = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/series?select=name&id=eq.${encodeURIComponent(match.series_id)}&limit=1`, { headers: restHeaders }),
          fetch(`${supabaseUrl}/rest/v1/books?select=title,author,position_in_series&series_id=eq.${encodeURIComponent(match.series_id)}&order=position_in_series.asc&limit=30`, { headers: restHeaders }),
        ]);
        if (sRes.ok) seriesName = (await sRes.json())[0]?.name || null;
        if (bRes.ok) siblings = await bRes.json();
      } else if (match.genre) {
        const nRes = await fetch(
          `${supabaseUrl}/rest/v1/books?select=title,author&genre=eq.${encodeURIComponent(match.genre)}` +
          `&status=in.(verified,oracle_categorized)&title=neq.${encodeURIComponent(match.title)}&limit=8`,
          { headers: restHeaders }
        );
        if (nRes.ok) neighbours = await nRes.json();
      }

      const bookBody = [
        `<p class="eyebrow">${escapeHtml(match.genre || 'The Books Oracle')}</p>`,
        `<h1>${escapeHtml(match.title)}</h1>`,
        `<p>by ${escapeHtml(authorDisplay)}${seriesName ? ` · ${escapeHtml(seriesName)} series` : ''}</p>`,
        match.description ? `<p>${escapeHtml(match.description.slice(0, 600))}</p>` : '',
        siblings.length > 1
          ? `<h2>${escapeHtml(seriesName || 'This series')} in reading order</h2><ul>${listItems(siblings)}</ul>`
          : '',
        neighbours.length
          ? `<h2>More ${escapeHtml(match.genre)}</h2><ul>${listItems(neighbours)}</ul>`
          : '',
        `<p><a href="/">The Books Oracle</a> — reading tracker and book recommendations drawn from your own shelf.</p>`,
      ].filter(Boolean).join('');

      return new Response(injectBody(injected, bookBody), response);
    }

    if (seriesMatch) {
      const seriesName = decodeURIComponent(seriesMatch[1]);
      const normalized = normalizeSeriesName(seriesName);
      const res = await fetch(
        `${supabaseUrl}/rest/v1/series?select=id,name,description&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1`, {
          headers: restHeaders
        }
      );
      if (!res.ok) return context.next();
      const rows = await res.json();
      const match = rows[0];
      if (!match) return context.next();

      // v0.61.3: fetch the books, in order. "<series> reading order" is the
      // query these pages can realistically win — high intent, thin
      // competition, and the answer is already in position_in_series. Serving
      // a page titled after the series with none of its books on it was
      // leaving the entire point of the page unsaid.
      let volumes = [];
      const vRes = await fetch(
        `${supabaseUrl}/rest/v1/books?select=title,author,position_in_series,description` +
        `&series_id=eq.${encodeURIComponent(match.id)}&order=position_in_series.asc&limit=60`,
        { headers: restHeaders }
      );
      if (vRes.ok) volumes = await vRes.json();

      const first = volumes[0];
      const seriesDesc = match.description
        || (first?.description ? first.description.slice(0, 300) : null)
        || `Every book in the ${match.name} series, in reading order.`;

      const seriesBody = [
        `<p class="eyebrow">Series</p>`,
        `<h1>${escapeHtml(match.name)} series in reading order</h1>`,
        `<p>${escapeHtml(seriesDesc)}</p>`,
        volumes.length
          ? `<h2>All ${volumes.length} book${volumes.length === 1 ? '' : 's'}</h2><ul>${listItems(volumes)}</ul>`
          : '',
        `<p><a href="/">The Books Oracle</a> — track the series you are partway through, and see what to read next.</p>`,
      ].filter(Boolean).join('');

      return respond({
        // Front-load the words people actually type. "X series — The Books
        // Oracle" said nothing a searcher was looking for.
        title: `${match.name} series in order — every book | The Books Oracle`,
        description: seriesDesc.slice(0, 200),
        url: SITE + url.pathname,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BookSeries',
          name: match.name,
          ...(match.description ? { description: match.description.slice(0, 300) } : {}),
          ...(volumes.length ? {
            hasPart: volumes.map((b) => ({
              '@type': 'Book',
              name: b.title,
              ...(b.author ? { author: { '@type': 'Person', name: b.author } } : {}),
              ...(b.position_in_series != null ? { position: Number(b.position_in_series) } : {}),
              url: SITE + bookLink(b.title, b.author),
            })),
          } : {}),
        },
      }, seriesBody);
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