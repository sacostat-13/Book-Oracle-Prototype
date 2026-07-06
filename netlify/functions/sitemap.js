// Dynamic sitemap.xml — generated at request time from the live catalog.
// Wired via netlify.toml: GET /sitemap.xml -> this function (200 rewrite,
// not a redirect, so the URL bar and robots.txt both stay /sitemap.xml).
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same ones
// already used by send-notification-email.js).
//
// Covers:
//   - Static public routes (home, about, legal pages)
//   - Every verified book in the catalog, as /book/:bookKey
//   - Every distinct series referenced by a verified book, as /series/:name
//
// Does NOT cover user-generated public pages (shared lists, plans, friend
// profiles) — those are ephemeral/private-by-default and not meaningful
// to index. book-page/series-page are the SEO-relevant surface here.

import { createClient } from '@supabase/supabase-js';

const SITE = 'https://thebooksoracle.com';

// Mirrors src/lib/bookHelpers.js bookKey() — duplicated here since this
// function runs server-side and can't import client source directly.
function bookKey(title, author) {
  return (
    (title || '').toLowerCase().replace(/[^a-z0-9]/g, '') +
    '|' +
    (author || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  );
}

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
  urlEntry('/sitemap', { changefreq: 'monthly', priority: '0.3' }),
  urlEntry('/privacy', { changefreq: 'yearly', priority: '0.2' }),
  urlEntry('/terms', { changefreq: 'yearly', priority: '0.2' }),
  urlEntry('/refund', { changefreq: 'yearly', priority: '0.2' }),
];

export async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Without credentials, still serve the static entries rather than erroring —
  // a partial sitemap is better than a 500 for crawlers.
  if (!supabaseUrl || !serviceKey) {
    return xmlResponse(STATIC_ENTRIES);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);

    // v0.39.8: PostgREST caps returned rows at the project's Max Rows
    // setting (default 1000) regardless of .limit() — a single query
    // silently truncates on any catalog bigger than that. Paginate with
    // .range() until a page comes back short, same fix applied to
    // og-prerender.js's book lookup.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 20; // hard ceiling so a runaway catalog can't hang the function
    let books = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('books')
        .select('title, author, series:series(name)')
        // v0.39.8: widened from .eq('status', 'verified') — the app treats
        // 'oracle_categorized' as equivalent to verified everywhere else (see
        // DataContext.jsx's isVerified-style check), so books categorized by
        // the Oracle but not yet manually verified were missing from the
        // sitemap for no good reason. Same fix applied to og-prerender.js.
        .in('status', ['verified', 'oracle_categorized'])
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (error) throw error;
      books = books.concat(data);
      if (!data || data.length < PAGE_SIZE) break; // last page
    }

    const bookEntries = [];
    const seriesNames = new Set();

    for (const b of books || []) {
      if (!b.title || !b.author) continue;
      const key = bookKey(b.title, b.author);
      if (!key || key === '|') continue;
      bookEntries.push(urlEntry(`/book/${encodeURIComponent(key)}`, { priority: '0.7' }));
      if (b.series?.name) seriesNames.add(b.series.name);
    }

    const seriesEntries = [...seriesNames].map((name) =>
      urlEntry(`/series/${encodeURIComponent(name)}`, { priority: '0.6' })
    );

    return xmlResponse([...STATIC_ENTRIES, ...bookEntries, ...seriesEntries]);
  } catch (err) {
    console.error('sitemap generation failed', err);
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
