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



// 2026-09-01: google-inspectiontool and googleother added explicitly. Neither
// contains the substring "bot", so both fell through to context.next() and got
// the generic index.html — including its homepage canonical. Googlebot itself
// always matched via /bot/, so indexing was never affected, but URL Inspection
// ("Test live URL") in Search Console runs as Google-InspectionTool: the page
// it showed was NOT the page the indexer sees, which makes this console lie
// about exactly the pages you go there to debug.
const BOT_UA_PATTERN = /bot|crawl|spider|slurp|google-inspectiontool|googleother|facebookexternalhit|slackbot|twitterbot|whatsapp|telegrambot|discordbot|linkedinbot|pinterest|embedly|quora link preview|w3c_validator|redditbot|skypeuripreview|vkshare|outbrain|nuzzel|flipboard|tumblr|bitlybot|applebot|semrushbot|ahrefsbot/i;

// v0.61.2 — www, matching Netlify's primary domain. thebooksoracle.com 301s
// here, so the previous non-www value meant every URL emitted by this file
// redirected. Google treats a redirecting sitemap entry and a canonical that
// points at a redirect as weaker signals than the real thing, and it split
// authority across two hosts. Changing the primary domain in Netlify means
// changing this in four places: index.html, robots.txt,
// netlify/functions/sitemap.js and netlify/edge-functions/og-prerender.js.
const SITE = 'https://www.thebooksoracle.com';

// v0.63.3: the local copy of bookKey()/matchesBookKey() that used to live here
// is gone. Its own comment recorded why it was a liability — the client's author
// truncation length had already drifted from it once (assumed 10, production was
// generating 11) — and the tolerant matching it grew in response was a patch over
// the real problem, which was three implementations of one algorithm.
//
// It now lives once, in SQL: client_title_key / client_author_key /
// find_book_by_client_key, migration 20260813120000. This function and the SPA
// both call it, so there is nothing left to drift.

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
  jsonLd,
  // v0.67 — a genre page below the index floor is reachable and linked but not
  // advertised. index.html ships a static robots meta with
  // max-image-preview/max-snippet; that is stripped below along with everything
  // else this function restates, so a noindex page has to emit its own — and a
  // page that does NOT set this keeps the permissive default it always had.
  noindex = false,
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
    // Emitted ONLY for noindex. index.html ships
    // `index, follow, max-image-preview:large, max-snippet:-1` and every other
    // prerendered page should keep it untouched — restating it here would put
    // two robots tags on ~1,700 pages, the exact duplication the strip below
    // exists to prevent.
    noindex ? `<meta name="robots" content="noindex, follow">` : '',
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

  // Strip the static robots meta only when this page is replacing it. Leaving
  // both would serve `index, follow` and `noindex` on the same page, and a bot
  // taking the first tag it sees would index the thin page anyway.
  if (noindex) out = out.replace(/<meta\s+name="robots"[^>]*>/gi, '');

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
// v0.63.3: takes the precomputed share_key from public.books_share_key rather
// than recomputing it. This was the last copy of the algorithm in this file,
// and it generated the internal links Google follows — drift here meant
// advertising 404s to a crawler, the same failure sitemap.js had.
function bookLink(row) {
  const key = row?.share_key;
  // Title half must be non-empty — see the note in sitemap.js. "|author" is a
  // key that find_book_by_client_key deliberately refuses to resolve.
  if (!key || key.startsWith('|')) return null;
  return `/book/${encodeURIComponent(key)}`;
}

function listItems(rows) {
  return rows.map((b) => {
    const pos = b.position_in_series != null ? `${Number(b.position_in_series)}. ` : '';
    const href = bookLink(b);
    // An unaddressable row is listed without a link rather than dropped: the
    // title is still useful context, and a dead href is not.
    if (!href) {
      return `<li>${escapeHtml(pos)}${escapeHtml(b.title)}` +
        `${b.author ? ` — ${escapeHtml(b.author)}` : ''}</li>`;
    }
    return `<li>${escapeHtml(pos)}<a href="${escapeHtml(href)}">${escapeHtml(b.title)}</a>` +
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
    // v0.67 — the genre surface. /genres itself is static enough to need no
    // prerender; the two dynamic shapes below do.
    const familyMatch = url.pathname.match(/^\/genres\/([^/]+)$/);
    const genreMatch = url.pathname.match(/^\/genre\/([^/]+)$/);

    // ── Family page ──────────────────────────────────────────────────────
    // Sixteen hubs, each linking down to ~10 genre pages. This is the internal
    // link graph the 2026-08-24 postmortem found entirely absent — every
    // prerendered page then carried exactly one link, `<a href="/">`.
    if (familyMatch) {
      const slug = decodeURIComponent(familyMatch[1]);
      const famRes = await fetch(
        `${supabaseUrl}/rest/v1/genre_families?slug=eq.${encodeURIComponent(slug)}` +
        `&select=id,name,description&limit=1`,
        { headers: restHeaders }
      );
      const fam = famRes.ok ? (await famRes.json())[0] : null;
      if (fam) {
        const gRes = await fetch(
          `${supabaseUrl}/rest/v1/genres?family_id=eq.${fam.id}` +
          `&select=name,normalized_name,description,usage_count&order=usage_count.desc&limit=40`,
          { headers: restHeaders }
        );
        const genres = gRes.ok ? await gRes.json() : [];
        const body = [
          `<h1>${escapeHtml(fam.name)}</h1>`,
          fam.description ? `<p>${escapeHtml(fam.description)}</p>` : '',
          genres.length
            ? `<h2>Genres on this shelf</h2><ul>${genres.map((g) =>
                `<li><a href="/genre/${encodeURIComponent(g.normalized_name)}">${escapeHtml(g.name)}</a>` +
                `${g.description ? ` — ${escapeHtml(g.description)}` : ''}</li>`).join('')}</ul>`
            : '',
          `<p><a href="/genres">All sixteen shelves</a> · <a href="/">The Books Oracle</a></p>`,
        ].filter(Boolean).join('');

        return respond({
          title: `${fam.name} books — every genre on the shelf | The Books Oracle`,
          description: (fam.description || `Every genre on the ${fam.name} shelf.`).slice(0, 200),
          url: SITE + url.pathname,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: fam.name,
            ...(fam.description ? { description: fam.description.slice(0, 300) } : {}),
            hasPart: genres.slice(0, 20).map((g) => ({
              '@type': 'CollectionPage',
              name: g.name,
              url: `${SITE}/genre/${encodeURIComponent(g.normalized_name)}`,
            })),
          },
        }, body);
      }
    }

    // ── Genre page ───────────────────────────────────────────────────────
    if (genreMatch) {
      const slug = decodeURIComponent(genreMatch[1]);
      const gRes = await fetch(
        `${supabaseUrl}/rest/v1/genres?normalized_name=eq.${encodeURIComponent(slug)}` +
        `&select=id,name,description,usage_count,family_id,genre_families(slug,name)&limit=1`,
        { headers: restHeaders }
      );
      const genre = gRes.ok ? (await gRes.json())[0] : null;
      if (genre) {
        // Siblings and a sample of the shelf. Both are links, which is the
        // entire point: a genre page that lists no books and no siblings is the
        // thin page Google declined to index in August.
        const [bRes, sRes] = await Promise.all([
          fetch(
            `${supabaseUrl}/rest/v1/book_genres_view?genre_id=eq.${genre.id}` +
            `&select=books:book_id(share_key,title,author)&limit=24`,
            { headers: restHeaders }
          ),
          genre.family_id
            ? fetch(
                `${supabaseUrl}/rest/v1/genres?family_id=eq.${genre.family_id}&id=neq.${genre.id}` +
                `&select=name,normalized_name&order=usage_count.desc&limit=12`,
                { headers: restHeaders }
              )
            : Promise.resolve(null),
        ]);
        const books = bRes && bRes.ok ? (await bRes.json()).map((r) => r.books).filter(Boolean) : [];
        const siblings = sRes && sRes.ok ? await sRes.json() : [];
        const fam = genre.genre_families || null;

        const body = [
          `<h1>${escapeHtml(genre.name)} books</h1>`,
          genre.description ? `<p>${escapeHtml(genre.description)}</p>` : '',
          fam ? `<p>On the <a href="/genres/${encodeURIComponent(fam.slug)}">${escapeHtml(fam.name)}</a> shelf.</p>` : '',
          books.length
            ? `<h2>Books shelved as ${escapeHtml(genre.name)}</h2><ul>${books.map((b) =>
                `<li><a href="/book/${encodeURIComponent(b.share_key)}">${escapeHtml(b.title)}</a>` +
                `${b.author ? ` — ${escapeHtml(b.author)}` : ''}</li>`).join('')}</ul>`
            : '',
          siblings.length
            ? `<h2>Related genres</h2><ul>${siblings.map((g) =>
                `<li><a href="/genre/${encodeURIComponent(g.normalized_name)}">${escapeHtml(g.name)}</a></li>`).join('')}</ul>`
            : '',
          `<p><a href="/genres">All sixteen shelves</a> · <a href="/">The Books Oracle</a></p>`,
        ].filter(Boolean).join('');

        return respond({
          title: `${genre.name} books — what to read | The Books Oracle`,
          description: (genre.description || `Books shelved as ${genre.name}.`).slice(0, 200),
          url: SITE + url.pathname,
          // Under the floor this page is reachable and linked but not
          // advertised — and the sitemap agrees, because a submitted URL that
          // answers with noindex is a contradiction Google reports as an error.
          noindex: (genre.usage_count || 0) < 5,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: `${genre.name} books`,
            ...(genre.description ? { description: genre.description.slice(0, 300) } : {}),
            hasPart: books.slice(0, 20).map((b) => ({
              '@type': 'Book',
              name: b.title,
              ...(b.author ? { author: { '@type': 'Person', name: b.author } } : {}),
            })),
          },
        }, body);
      }
    }

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
      // v0.63.3: was a paginated scan of the whole `books` table, recomputing
      // the key per row, because there was no way to query by it. There is now
      // — find_book_by_client_key (migration 20260813120000) holds the same
      // matching logic in SQL, indexed on the title half, and the SPA calls the
      // very same function. One definition, three callers, no drift.
      //
      // The scan is gone rather than kept as a fallback on purpose: a silent
      // fallback would hide a broken migration until someone noticed link
      // previews had quietly stopped working.
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/find_book_by_client_key`, {
        method: 'POST',
        headers: { ...restHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ _key: wantedKey }),
      });

      let match = null;
      if (res.ok) {
        const rows = await res.json();
        match = Array.isArray(rows) ? rows[0] : rows;
      } else {
        console.log(`[og-prerender] lookup failed ${res.status} | wanted=${wantedKey}`);
      }

      console.log(`[og-prerender] wanted=${wantedKey} | match=${!!match}${match ? ` (${match.title} by ${match.author})` : ''}`);

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
          // status filter added 2026-08-24 to match sitemap.js and the series
          // branch below. All three must list the same rows.
          fetch(`${supabaseUrl}/rest/v1/books_share_key?select=title,author,share_key,position_in_series&series_id=eq.${encodeURIComponent(match.series_id)}&status=in.(verified,oracle_categorized)&order=position_in_series.asc&limit=30`, { headers: restHeaders }),
        ]);
        if (sRes.ok) seriesName = (await sRes.json())[0]?.name || null;
        if (bRes.ok) {
          siblings = await bRes.json();
        } else {
          // See the series branch below for the full version of this lesson.
          // Until 2026-08-24 this query selected position_in_series and filtered
          // on series_id, NEITHER of which the view had — so it 400d on every
          // book page ever prerendered, and the "in reading order" list that is
          // the main internal link out of a book page was never rendered once.
          console.warn(`[og-prerender] sibling query failed: ${bRes.status} book="${match.title}" — no series links on this page.`);
        }
      } else if (match.genre) {
        const nRes = await fetch(
          `${supabaseUrl}/rest/v1/books_share_key?select=title,author,share_key&genre=eq.${encodeURIComponent(match.genre)}` +
          `&status=in.(verified,oracle_categorized)&title=neq.${encodeURIComponent(match.title)}&limit=8`,
          { headers: restHeaders }
        );
        if (nRes.ok) {
          neighbours = await nRes.json();
        } else {
          // Same story, different column: this one filters on `genre`, which
          // the view also lacked. Standalone books got no outbound links at all.
          console.warn(`[og-prerender] neighbour query failed: ${nRes.status} genre="${match.genre}" — no genre links on this page.`);
        }
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
      const vUrl =
        `${supabaseUrl}/rest/v1/books_share_key?select=title,author,share_key,position_in_series,description` +
        `&series_id=eq.${encodeURIComponent(match.id)}` +
        // Match the sitemap. It emits /series/:name from rows with these two
        // statuses, so the page behind those URLs must list the same rows --
        // otherwise a crawler is invited to a list containing books the rest
        // of the app treats as unverified.
        `&status=in.(verified,oracle_categorized)` +
        `&order=position_in_series.asc&limit=60`;
      const vRes = await fetch(vUrl, { headers: restHeaders });
      if (vRes.ok) {
        volumes = await vRes.json();
      } else {
        // SAY SO. Until 2026-08-24 this was `if (vRes.ok) volumes = ...` with
        // no else, and the view was missing three of the columns selected
        // above. Every series page shipped to Googlebot as a heading with no
        // list under it, for as long as v0.61.3 has been live, and nothing
        // anywhere said a word. A 400 is not an empty series.
        //
        // Third time this exact shape has cost a release (postmortem
        // 2026-08-17 #1; v0.64 getJson). The page still renders -- a heading
        // beats a 500 -- but the log line is the difference between finding
        // this in a minute and finding it in Search Console two months later.
        console.warn(
          `[og-prerender] series volume query failed: ${vRes.status} ` +
          `series="${match.name}" — the page will render with NO book list. ` +
          `Check that books_share_key exposes series_id, position_in_series and description.`
        );
      }

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
              // v0.63.3: omit `url` rather than emit a broken one — structured
              // data pointing at a 404 is worse for SEO than structured data
              // with one fewer field.
              ...(bookLink(b) ? { url: SITE + bookLink(b) } : {}),
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