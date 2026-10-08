// entity-seed.test.js — the record og-prerender.js hands the SPA, end to end.
//
// 2026-10-07. Search Console filed 866 book and genre pages as "Duplicate,
// Google chose different canonical". The crawled HTML showed React had replaced
// the prerendered body with BookPage's "Book not found" view under the
// placeholder title "Book — The Books Oracle": the client lookup failed inside
// Google's renderer, and every page where that happened rendered the same.
//
// The fix has two halves that only work together, and this file pins both:
//   1. the edge function writes the resolved row into <head> as
//      <script id="__ENTITY__">, with the book's canonical taken from the ROW's
//      share key (not the requested spelling) and noindex on placeholder books;
//   2. the SPA reads that seed synchronously, for the right entity only, and
//      maps it to exactly the shape its own lookup produces.

import { describe, it, expect, vi } from 'vitest';

globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }[k]) } };

const ROWS = {
  legion: {
    id: 'b-legion', title: 'Legion', author: 'Dan Abnett',
    // A description that would break naive injection twice over: it closes the
    // script tag, and it contains String.replace's `$&` / `$'` patterns.
    description: 'Horus </script><script>alert(1)</script> and $& and $\' and   end.',
    pages: 416, genre: 'Military Science Fiction', complexity: 3, depth: 2,
    cover_url: 'https://covers.example/legion.jpg', isbn: '9781844164660',
    status: 'oracle_categorized', source: 'hardcover',
    series_id: 's-hh', position_in_series: 7,
    some_internal_column: 'must not reach the seed',
  },
  bemyalibi: {
    id: 'b-alibi', title: 'Be my Alibi', author: null, description: 'A fake alibi.',
    pages: null, genre: 'Romantic Suspense', cover_url: 'https://covers.example/alibi.jpg',
    status: 'oracle_categorized', source: 'manual', series_id: null, position_in_series: null,
  },
};
const SHARE_KEYS = { 'b-legion': 'legion|danabnett', 'b-alibi': 'bemyalibi|' };
const SERIES = { 's-hh': { id: 's-hh', name: 'The Horus Heresy', total_books: 54, status: 'verified', publication_status: 'complete', source: 'hardcover' } };
const GENRE = {
  id: 'g-sf', name: 'Sapphic Fantasy', normalized_name: 'sapphicfantasy', description: 'Queer women, dragons optional.',
  usage_count: 9, family_id: 'f-fan', genre_families: { slug: 'fantasy', name: 'Fantasy & Myth' },
};

const J = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.includes('/rpc/find_book_by_client_key')) {
    const { _key } = JSON.parse(init.body);
    const title = _key.split('|')[0];
    return J(ROWS[title] ? [ROWS[title]] : []);
  }
  if (url.includes('/books_share_key?') && url.includes('id=eq.')) {
    const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
    return J(SHARE_KEYS[id] ? [{ share_key: SHARE_KEYS[id] }] : []);
  }
  if (url.includes('/series?') && url.includes('id=eq.')) {
    const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
    return J(SERIES[id] ? [SERIES[id]] : []);
  }
  if (url.includes('/genres?') && url.includes('normalized_name=eq.')) {
    return J(url.includes('sapphicfantasy') ? [GENRE] : []);
  }
  if (url.includes('/genres?') && url.includes('family_id=eq.')) {
    return J([{ name: 'Epic Fantasy', normalized_name: 'epicfantasy' }]);
  }
  return J([]);
};

const SHELL = `<!doctype html><html><head><title>The Books Oracle</title>
<meta name="description" content="generic">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="https://www.thebooksoracle.com/"></head><body><div id="root">
<!--PREMOUNT--><p>Consulting the shelves…</p><!--/PREMOUNT-->
</div></body></html>`;

const { default: handler } = await import(new URL('../netlify/edge-functions/og-prerender.js', import.meta.url).href);
const ctx = { next: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }) };

async function crawl(path) {
  const req = new Request('https://www.thebooksoracle.com' + path, { headers: { 'user-agent': 'Googlebot/2.1' } });
  const html = await (await handler(req, ctx)).text();
  const seedMatch = html.match(/<script type="application\/json" id="__ENTITY__">([\s\S]*?)<\/script>/);
  return {
    html,
    seedText: seedMatch ? seedMatch[1] : null,
    seed: seedMatch ? JSON.parse(seedMatch[1]) : null,
    title: (html.match(/<title>([^<]*)<\/title>/) || [])[1],
    canon: (html.match(/rel="canonical" href="([^"]*)"/) || [])[1],
    robots: (html.match(/name="robots" content="([^"]*)"/g) || []),
  };
}

const legion = await crawl('/book/legion%7Cdanabnett');
// Same row, other spellings Google has seen: raw pipe, and a longer author half
// that find_book_by_client_key accepts as a mutual prefix.
const legionPipe = await crawl('/book/legion|danabnett');
const legionLong = await crawl('/book/legion%7Cdanabnettx');
const alibi = await crawl('/book/bemyalibi%7C');
const genre = await crawl('/genre/sapphicfantasy');

describe('og-prerender: the book seed', () => {
  it('lands in <head>, outside #root where React would replace it', () => {
    expect(legion.seed).not.toBeNull();
    const seedAt = legion.html.indexOf('id="__ENTITY__"');
    expect(seedAt).toBeGreaterThan(-1);
    expect(seedAt).toBeLessThan(legion.html.indexOf('</head>'));
  });

  it('carries the requested key, the row key and the series', () => {
    expect(legion.seed.kind).toBe('book');
    expect(legion.seed.key).toBe('legion|danabnett');
    expect(legion.seed.shareKey).toBe('legion|danabnett');
    expect(legion.seed.row.title).toBe('Legion');
    expect(legion.seed.series.name).toBe('The Horus Heresy');
  });

  it('carries only the columns the SPA reads, not the whole row', () => {
    expect(legion.seed.row.some_internal_column).toBeUndefined();
  });

  it('cannot be broken out of by the description', () => {
    expect(legion.seedText).not.toMatch(/<\/script>/i);
    expect(legion.seedText).not.toMatch(/<script/i);
    // ...and still round-trips to the exact text.
    expect(legion.seed.row.description).toBe(ROWS.legion.description);
  });

  it('is not mangled by $-patterns in the description', () => {
    expect(legion.seed.row.description).toContain("$& and $'");
    // Exactly one seed and one PREMOUNT replacement: `$&` re-inserting the
    // matched </head> would show up as a second seed or a doubled head.
    expect(legion.html.match(/id="__ENTITY__"/g)).toHaveLength(1);
    expect(legion.html.match(/<\/head>/gi)).toHaveLength(1);
  });

  it('the body still carries the book (PREMOUNT unchanged)', () => {
    expect(legion.html).toContain('<h1>Legion</h1>');
    expect(legion.html).not.toContain('Book not found');
  });
});

describe('og-prerender: one canonical per row', () => {
  it('names the row key, encoded the way sitemap.js encodes it', () => {
    expect(legion.canon).toBe('https://www.thebooksoracle.com/book/legion%7Cdanabnett');
  });

  it('every spelling of the key names the same canonical', () => {
    expect(legionPipe.canon).toBe(legion.canon);
    expect(legionLong.canon).toBe(legion.canon);
  });

  it('the specific title survives', () => {
    expect(legion.title).toBe('Legion by Dan Abnett — The Books Oracle');
  });
});

describe('og-prerender: placeholder books are not advertised', () => {
  it('a book with no author is noindex, with exactly one robots tag', () => {
    expect(alibi.robots).toHaveLength(1);
    expect(alibi.robots[0]).toContain('noindex');
  });

  it('a normal book keeps the default robots tag', () => {
    expect(legion.robots).toHaveLength(1);
    expect(legion.robots[0]).not.toContain('noindex');
  });

  it('a placeholder book is still seeded, so the page renders rather than failing', () => {
    expect(alibi.seed.row.title).toBe('Be my Alibi');
  });
});

describe('og-prerender: the genre seed', () => {
  it('has the shape fetchGenre() returns', () => {
    expect(genre.seed.kind).toBe('genre');
    expect(genre.seed.key).toBe('sapphicfantasy');
    expect(genre.seed.row).toMatchObject({
      id: 'g-sf',
      name: 'Sapphic Fantasy',
      normalized_name: 'sapphicfantasy',
      family: { slug: 'fantasy', name: 'Fantasy & Myth' },
      siblings: [{ name: 'Epic Fantasy', normalized_name: 'epicfantasy' }],
    });
  });
});

// ── The SPA half ─────────────────────────────────────────────────────────────

describe('the SPA reads the seed', () => {
  it('only for the entity it describes', async () => {
    vi.resetModules();
    globalThis.document = { getElementById: (id) => (id === '__ENTITY__' ? { textContent: legion.seedText } : null) };
    const { readEntitySeed } = await import('../src/lib/entitySeed.js');
    expect(readEntitySeed('book', 'legion|danabnett')).not.toBeNull();
    // The route param may arrive encoded.
    expect(readEntitySeed('book', 'legion%7Cdanabnett')).not.toBeNull();
    // Another book, or another kind, never renders this one's data.
    expect(readEntitySeed('book', 'horusrising|dangabnett')).toBeNull();
    expect(readEntitySeed('genre', 'legion|danabnett')).toBeNull();
    delete globalThis.document;
  });

  it('a page with no seed (every human visit today) reads null', async () => {
    vi.resetModules();
    globalThis.document = { getElementById: () => null };
    const { readEntitySeed } = await import('../src/lib/entitySeed.js');
    expect(readEntitySeed('book', 'legion|danabnett')).toBeNull();
    delete globalThis.document;
  });

  it('maps to the same book shape the share-key lookup produces', async () => {
    const { bookFromSeed } = await import('../src/lib/shareKey.js');
    const book = bookFromSeed(legion.seed);
    expect(book).toMatchObject({
      bookId: 'b-legion', t: 'Legion', a: 'Dan Abnett', pp: 416, g: 'Military Science Fiction',
      coverUrl: 'https://covers.example/legion.jpg', seriesId: 's-hh', seriesPosition: 7,
      s: { name: 'The Horus Heresy', n: 7, total: 54, seriesId: 's-hh', fromHardcover: true },
    });
  });

  it('flags the same placeholder books the prerender noindexes', async () => {
    const { isPlaceholderBook } = await import('../src/lib/bookHelpers.js');
    expect(isPlaceholderBook({ t: 'Be my Alibi', a: '' })).toBe(true);
    expect(isPlaceholderBook({ t: 'Expecting Better', a: 'Unknown author' })).toBe(true);
    expect(isPlaceholderBook({ t: 'Out', a: '桐野夏生' })).toBe(true); // author key empty
    expect(isPlaceholderBook({ t: 'Untitled', a: 'Rebecca Yarros' })).toBe(true);
    expect(isPlaceholderBook({ t: 'Legion', a: 'Dan Abnett' })).toBe(false);
    expect(isPlaceholderBook(null)).toBe(false);
  });
});
