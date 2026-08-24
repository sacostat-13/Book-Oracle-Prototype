// Dynamic sitemap.xml — generated at request time from the live catalog.
// Wired via netlify.toml: GET /sitemap.xml -> this function (200 rewrite,
// not a redirect, so the URL bar and robots.txt both stay /sitemap.xml).
//
// Required env vars: SUPABASE_URL (or VITE_SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY. Both must be scoped to Functions in Netlify, not
// Builds only — a build-scoped variable is inlined into the client bundle and
// is invisible here at runtime.
//
// Covers:
//   - Static public routes (home, about, legal pages)
//   - Every verified book in the catalog, as /book/:bookKey
//   - Every distinct series referenced by a verified book, as /series/:name
//
// Does NOT cover user-generated public pages (shared lists, plans, friend
// profiles) — those are ephemeral/private-by-default and not meaningful
// to index. book-page/series-page are the SEO-relevant surface here.

// v0.61.2: supabase-js REMOVED. Importing it crashed this function outright on
// Netlify's Node 20 runtime:
//
//   Error: Node.js 20 detected without native WebSocket support.
//   at WebSocketFactory.getWebSocketConstructor (@supabase/realtime-js/...)
//   at new SupabaseClient (...)  at createClient (...)  at sitemap.js:57
//
// createClient() constructs a RealtimeClient unconditionally, and realtime-js
// requires a global WebSocket, which Node 20 does not provide. The throw
// happened inside the try block, so the catch below did its job and served the
// 7 static entries with a clean 200 — which is why this looked for weeks like a
// credentials problem rather than a crash.
//
// THIS FUNCTION WAS THE ONE THAT MISSED THE MEMO. The same crash was hit and
// fixed twice already, two different ways, both documented in place:
//
//   send-notification-email.js — imports `ws` and passes it as
//     realtime.transport, satisfying the RealtimeClient constructor without
//     ever opening a channel.
//   catalog-crawl.mjs — dropped supabase-js entirely and calls PostgREST over
//     fetch, on the grounds that "pulling a websocket stack into a function
//     that only makes one RPC call is the wrong shape".
//
// This file predates both and kept the naive createClient() call. It follows
// catalog-crawl's route, for the same reason: one SELECT does not justify a
// client library, let alone a websocket stack. That also makes it immune to
// the Node version rather than dependent on a workaround.

// v0.61.2 — www, matching Netlify's primary domain. thebooksoracle.com 301s
// here, so the previous non-www value meant every URL emitted by this file
// redirected. Google treats a redirecting sitemap entry and a canonical that
// points at a redirect as weaker signals than the real thing, and it split
// authority across two hosts. Changing the primary domain in Netlify means
// changing this in four places: index.html, robots.txt,
// netlify/functions/sitemap.js and netlify/edge-functions/og-prerender.js.
const SITE = 'https://www.thebooksoracle.com';

// v0.63.3: the local copy of bookKey() is gone. It generated the URLs a shared
// link resolves against, so any drift between it and the client's version
// produced sitemap entries that 404'd — advertising broken URLs to search
// engines, which is worse than omitting them.
//
// The key now comes precomputed from public.books_share_key (migration
// 20260813120000), the same functions find_book_by_client_key resolves with.
// Generation and lookup cannot disagree because they are the same expression.

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(path, { changefreq = 'weekly', priority = '0.5' } = {}) {
  return `  <url>\n    <loc>${xmlEscape(SITE + path)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

const STATIC_ENTRIES = [
  urlEntry('/', { changefreq: 'daily', priority: '1.0' }),
  urlEntry('/about', { priority: '0.6' }),
  urlEntry('/changelog', { changefreq: 'weekly', priority: '0.5' }),
  urlEntry('/sitemap', { changefreq: 'monthly', priority: '0.3' }),
  urlEntry('/privacy', { changefreq: 'yearly', priority: '0.2' }),
  urlEntry('/terms', { changefreq: 'yearly', priority: '0.2' }),
  urlEntry('/refund', { changefreq: 'yearly', priority: '0.2' }),
];

export async function handler() {
  // v0.61.2: added the VITE_ fallback. This function was the ONLY one reading
  // process.env.SUPABASE_URL without it — claude.js, create-checkout-session,
  // lemon-squeezy-webhook, manage-subscription and _shared/auth.js all do
  // `SUPABASE_URL || VITE_SUPABASE_URL`. With only VITE_SUPABASE_URL set in
  // Netlify, the guard below fired on every request and the sitemap served
  // exactly its 7 static entries — no books, no series — while still returning
  // a valid 200. Search Console reported "Success · 7 pages discovered", which
  // looks like a working sitemap rather than a broken one.
  //
  // That is the trap in the graceful degradation below: silently serving a
  // truncated sitemap is indistinguishable from serving a correct one unless
  // you know what the count should be. Hence the console.error — a missing
  // credential is now visible in the function log instead of only inferable
  // from a suspiciously round number.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Without credentials, still serve the static entries rather than erroring —
  // a partial sitemap is better than a 500 for crawlers.
  if (!supabaseUrl || !serviceKey) {
    console.error(
      '[sitemap] DEGRADED: serving static entries only. Missing ' +
      [!supabaseUrl && 'SUPABASE_URL / VITE_SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY']
        .filter(Boolean).join(' and ')
    );
    return xmlResponse(STATIC_ENTRIES);
  }

  try {
    // PostgREST caps returned rows at the project's Max Rows setting (default
    // 1000) regardless of any limit — a single request silently truncates on
    // any catalog bigger than that. Page with Range headers until a short page
    // comes back. Same fix as og-prerender.js and DataContext's wishlist load.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 20; // hard ceiling so a runaway catalog can't hang the function
    // status is filtered server-side: 'oracle_categorized' is treated as
    // equivalent to 'verified' everywhere else in the app, so books the Oracle
    // classified but nobody hand-checked belong in the sitemap too.
    // cover_url joins the select for the quality bar below. NOT description:
    // that column only reaches this view via migration 20260824120000, and a
    // select on a column the view lacks is a 400 that takes the WHOLE sitemap
    // down to its seven static entries. Add it here once that migration is
    // applied and verified, not before.
    const select = 'share_key,series_name,cover_url';
    const query = `${supabaseUrl}/rest/v1/books_share_key` +
      `?select=${encodeURIComponent(select)}` +
      `&status=in.(verified,oracle_categorized)`;

    let books = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const res = await fetch(`${query}&order=id.asc`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Range: `${from}-${from + PAGE_SIZE - 1}`,
          'Range-Unit': 'items',
        },
      });
      if (!res.ok) {
        throw new Error(`PostgREST ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json();
      books = books.concat(data);
      if (!Array.isArray(data) || data.length < PAGE_SIZE) break; // last page
    }

    console.log(`[sitemap] ${books.length} catalog rows fetched`);

    const bookEntries = [];
    const seriesNames = new Set();

    for (const b of books || []) {
      const key = b.share_key;
      // Not addressable unless the TITLE half is non-empty. The old guard tested
      // `key === '|'`, which catches a book with neither title nor author but
      // misses the real case: a title with no ASCII alphanumerics — anything
      // written wholly in Korean, Japanese, Cyrillic — produces "|author", which
      // passes that test and resolves to nothing. Advertising it to a crawler is
      // advertising a 404.
      if (!key || key.startsWith('|')) continue;

      // A series page is worth advertising even when the volume rows under it
      // are not, so collect the name BEFORE the book-level quality bar.
      if (b.series_name) seriesNames.add(b.series_name);

      // ── Quality bar, 2026-08-24 ─────────────────────────────────────────
      //
      // The guard above catches a title with NO ascii alphanumerics. It does
      // not catch a title half that survived as digits alone:
      //
      //   /book/12|hirohikoar        <- books.title is a Japanese title with a
      //   /book/14|hirohikoar           leading volume number. client_title_key
      //                                 strips [^a-z0-9], the CJK vanishes, and
      //                                 the volume number is the entire key.
      //
      // Those URLs carry no keyword a query could match and nothing a human
      // can read before clicking. Same reasoning as the startsWith('|') guard,
      // applied one step further.
      //
      // NOTE ON SCOPE. As of 2026-08-24 Search Console reports 3,742 book URLs
      // as "Discovered - currently not indexed" against just 22 "Crawled - not
      // indexed". Google is not REJECTING these pages; it has never fetched
      // them. This filter therefore is NOT the fix for that number -- crawl
      // priority follows internal links, and the app emits almost none (every
      // in-app navigation is an onClick handler on a div, so /book/:key is
      // reachable only from og-prerender.js's series list). Submitting fewer,
      // better URLs is worth doing on its own terms. Do not expect it to move
      // the indexed count by itself.
      const titleHalf = key.split('|')[0];
      if (/^[0-9]+$/.test(titleHalf)) continue;   // digits only -- no title left
      if (titleHalf.length < 3) continue;         // too little to match anything
      if (!b.cover_url) continue;                 // nothing to show a reader

      bookEntries.push(urlEntry(`/book/${encodeURIComponent(key)}`, { priority: '0.7' }));
    }

    const seriesEntries = [...seriesNames].map((name) =>
      urlEntry(`/series/${encodeURIComponent(name)}`, { priority: '0.6' })
    );

    return xmlResponse([...STATIC_ENTRIES, ...bookEntries, ...seriesEntries]);
  } catch (err) {
    // Loud on purpose. This catch previously turned any failure — including a
    // hard crash in createClient — into a valid-looking 7-entry sitemap, and
    // Search Console cheerfully reported "Success". Graceful degradation is
    // still right for a crawler-facing endpoint, but it must never be silent.
    console.error('[sitemap] DEGRADED: falling back to static entries only.', err);
    // Degrade gracefully — static entries only, still a 200.
    return xmlResponse(STATIC_ENTRIES);
  }
}

function xmlResponse(entries) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600', // 1h — catalog doesn't change minute-to-minute
    },
    body,
  };
}
