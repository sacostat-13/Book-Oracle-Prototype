// prerender.test.js — the head and body og-prerender.js serves to crawlers.
//
// Exercises the three genre branches of og-prerender.js against the REAL
// injectMeta/injectBody, with Supabase stubbed and no network.
//
// This exists because the head this function emits has been wrong twice in ways
// nothing else would have caught: it nearly shipped a second robots meta on
// ~1,700 pages, and the client hook silently overwrote the prerendered title on
// every genre page. Both are invisible in a build and in a browser — you only
// see them by asserting on the injected HTML, which is what this does.
//
// The stub data deliberately puts ONE BOOK ON TWO GENRES of the same family:
// that is the case the family shelf has to dedupe, and the count assertion
// below is what proves it does.

// The edge function reads Deno.env; Node has no such global.
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }[k]) } };

const FAMS = [
  { id: 'f1', slug: 'horror', name: 'Horror & the Uncanny', description: 'The shelf of dread.' },
  { id: 'f2', slug: 'gothic', name: 'Gothic', description: 'Ruins and rain.' },
];
const GENRES = [
  { id: 'g1', name: 'Horror', normalized_name: 'horror', description: 'Fear, plainly.', usage_count: 40, family_id: 'f1', genre_families: { slug: 'horror', name: 'Horror & the Uncanny' } },
  { id: 'g2', name: 'Folk Horror', normalized_name: 'folkhorror', description: 'Old ground.', usage_count: 12, family_id: 'f1', genre_families: { slug: 'horror', name: 'Horror & the Uncanny' } },
  { id: 'g3', name: 'Cosmic Horror', normalized_name: 'cosmichorror', description: 'Indifference.', usage_count: 3, family_id: 'f1', genre_families: { slug: 'horror', name: 'Horror & the Uncanny' } },
];
// Deliberately overlapping: the same book on two genres of one family, which is
// the case the family shelf has to dedupe.
const BOOKS = [
  { id: 'b1', title: 'The Haunting of Hill House', author: 'Shirley Jackson', cover_url: 'https://x/1.jpg' },
  { id: 'b2', title: 'Harvest', author: 'Jim Crace', cover_url: null },
];
const LINKS = [
  { genre_id: 'g1', book_id: 'b1', title: 'The Haunting', author: 'Jackson' },
  { genre_id: 'g2', book_id: 'b1', title: 'The Haunting', author: 'Jackson' },
  { genre_id: 'g2', book_id: 'b2', title: 'Harvest', author: 'Crace' },
];

// THE SCHEMA, as PostgREST sees it. This is the half of the stub that matters.
//
// The first version of this probe returned whatever the caller asked for, so it
// passed while the real edge function was asking book_genres_view for `title` —
// a column that view does not have — and getting a 400 on every genre page in
// production. A stub that answers questions the database would refuse is not a
// test, it is a second implementation that agrees with the bug.
let lastHtml = '';
const lines = [];

const SCHEMA = {
  genre_families: ['id', 'slug', 'name', 'description', 'sort_order', 'plate_asset', 'frame_asset', 'created_at'],
  genres: ['id', 'name', 'normalized_name', 'description', 'usage_count', 'family_id', 'parent_id', 'source', 'genre_families'],
  book_genres: ['book_id', 'genre_id', 'assigned_by_source'],
  // No title. No author. No cover_url. It is book_genres joined to genres, so
  // the name and description on it are the GENRE's.
  book_genres_view: ['book_id', 'genre_id', 'genre_name', 'normalized_name', 'genre_source',
                     'usage_count', 'genre_description', 'assigned_by_source',
                     'family_id', 'family_slug', 'family_name', 'family_sort'],
  books: ['id', 'title', 'author', 'cover_url', 'status', 'genre'],
};

function assertColumns(url) {
  const m = url.match(/\/rest\/v1\/([a-z_]+)\?/);
  if (!m) return null;
  const table = m[1];
  const cols = SCHEMA[table];
  if (!cols) return `relation "public.${table}" does not exist`;
  // Embeds first: `genre_families(slug,name)` is ONE requested relation, and
  // splitting the whole select on commas turns its inner columns into bogus
  // top-level ones. Strip the parenthesised part, keep the relation name.
  const sel = (new URL(url).searchParams.get('select') || '').replace(/\([^)]*\)/g, '');
  for (const raw of sel.split(',')) {
    const col = raw.trim();
    if (col && col !== '*' && !cols.includes(col)) {
      return `column ${table}.${col} does not exist`;
    }
  }
  return null;
}

globalThis.fetch = async (u) => {
  const bad = assertColumns(String(u));
  if (bad) {
    // Exactly what PostgREST does: 400 with a body, which the caller must not
    // mistake for an empty result.
    lines.push(`  [stub] 400 ${bad}`);
    return new Response(JSON.stringify({ code: '42703', message: bad }), { status: 400 });
  }
  return realStub(u);
};

const realStub = async (u) => {
  const url = String(u);
  const J = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('/genre_families')) {
    const m = url.match(/slug=eq\.([^&]+)/);
    return J(m ? FAMS.filter((f) => f.slug === m[1]) : FAMS);
  }
  if (url.includes('/book_genres?') || url.includes('/book_genres_view')) {
    const inM = url.match(/genre_id=in\.\(([^)]+)\)/);
    const eqM = url.match(/genre_id=eq\.([^&]+)/);
    const ids = inM ? inM[1].split(',') : eqM ? [eqM[1]] : [];
    return J(LINKS.filter((l) => ids.includes(l.genre_id)).map((l) => ({ book_id: l.genre_id && l.book_id, genre_id: l.genre_id })));
  }
  if (url.includes('/books?')) {
    const inM = url.match(/id=in\.\(([^)]+)\)/);
    const ids = inM ? inM[1].split(',') : [];
    return J(BOOKS.filter((b) => ids.includes(b.id)));
  }
  if (url.includes('/genres?')) {
    const nm = url.match(/normalized_name=eq\.([^&]+)/);
    if (nm) return J(GENRES.filter((g) => g.normalized_name === nm[1]));
    const fm = url.match(/family_id=eq\.([^&]+)/);
    if (fm) return J(GENRES.filter((g) => g.family_id === fm[1]));
    return J(GENRES);
  }
  return new Response('[]', { status: 200 });
};

const SHELL = `<!doctype html><html><head><title>The Books Oracle</title>
<meta name="description" content="generic"><meta property="og:title" content="generic">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="https://www.thebooksoracle.com/"></head><body><div id="root">
<!--PREMOUNT--><p>Consulting the shelves…</p><!--/PREMOUNT-->
</div></body></html>`;

import { describe, it, expect } from 'vitest';

const mod = await import(new URL('../netlify/edge-functions/og-prerender.js', import.meta.url).href);
const handler = mod.default;
const ctx = { next: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }) };

async function run(path) {
  const req = new Request('https://www.thebooksoracle.com' + path, { headers: { 'user-agent': 'Googlebot/2.1' } });
  const res = await handler(req, ctx);
  const html = await res.text();
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const canon = (html.match(/rel="canonical" href="([^"]*)"/) || [])[1];
  const robots = html.match(/name="robots"/g) || [];
  const robotsContent = (html.match(/name="robots" content="([^"]*)"/) || [])[1];
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const links = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  const types = ld.flat().map((n) => n['@type']);
  lines.push(`${path}`);
  lines.push(`  title   : ${title}`);
  lines.push(`  canon   : ${canon}`);
  lines.push(`  robots  : ${robots.length} tag(s) — ${robotsContent}`);
  lines.push(`  ld types: ${types.join(', ')}`);
  lines.push(`  links   : ${links.length}`);
  const body = html.match(/<h2>Books across[^<]*<\/h2><ul>([\s\S]*?)<\/ul>/);
  const booksUnique = body ? (body[1].match(/<li>/g) || []).length : null;
  if (body) lines.push(`  books   : ${booksUnique} unique`);
  // v0.68: the prerendered body mirrors the client DOM order — books first, the
  // annotated genre list after. They need not agree for a crawler, but when
  // they disagree it is because someone changed one and forgot the other, and
  // this is the half nobody looks at.
  const booksAt = html.indexOf('<h2>Books across');
  const listAt = html.indexOf('<h2>Every genre on this shelf');
  lastHtml = html;
  return { title, canon, robots: robots.length, robotsContent, types, links, booksAt, listAt, booksUnique };
}

const hub = await run('/genres');
const fam = await run('/genres/horror');
const gen = await run('/genre/horror');
const genHtml = lastHtml;
const thin = await run('/genre/cosmichorror');

describe('og-prerender: the genre surface as a crawler sees it', () => {
  it('the /genres hub is prerendered with an ItemList and breadcrumbs', () => {
    expect(hub.types).toContain('CollectionPage');
    expect(hub.types).toContain('BreadcrumbList');
  });

  it('the hub links out to shelves and genres', () => {
    // It was left to pass through until v0.68 on the reasoning that it is
    // "static enough" — but its sixteen links come from a runtime fetch, so a
    // crawler without JS saw an empty shell on the site's top genre hub.
    expect(hub.links.length).toBeGreaterThan(4);
  });

  it('the family page owns the intent phrase', () => {
    // Escaped, because injectMeta escapes — the first version of this check
    // compared against a raw & and failed the code rather than itself.
    expect(fam.title).toBe('Horror &amp; the Uncanny — what to read | The Books Oracle');
  });

  it('the genre page keeps the plain noun', () => {
    expect(gen.title).toBe('Horror books | The Books Oracle');
  });

  it('the two do not compete for the same query', () => {
    // /genres/horror and /genre/horror are one character apart, and six of the
    // sixteen families share a name with a genre on them.
    expect(fam.title).not.toBe(gen.title);
  });

  it('canonical is the page, not the homepage', () => {
    expect(fam.canon).toBe('https://www.thebooksoracle.com/genres/horror');
  });

  it('emits exactly one robots tag', () => {
    // index.html ships a permissive robots meta and this function strips what it
    // restates; restating it unconditionally would put TWO on ~1,700 pages.
    expect(fam.robots).toBe(1);
    expect(gen.robots).toBe(1);
    expect(thin.robots).toBe(1);
  });

  it('a genre under the index floor is noindex, and one above keeps the default', () => {
    // The sitemap must agree: a submitted URL answering noindex is an error
    // Search Console reports. tests/contracts.test.js checks the floor itself.
    expect(thin.robotsContent).toMatch(/noindex/);
    expect(gen.robotsContent).toMatch(/max-snippet/);
    expect(gen.robotsContent).not.toMatch(/noindex/);
  });

  it('breadcrumbs on the genre page', () => {
    expect(gen.types).toContain('BreadcrumbList');
  });

  it('the family body puts books before the annotated genre list', () => {
    expect(fam.booksAt).toBeGreaterThan(0);
    expect(fam.listAt).toBeGreaterThan(fam.booksAt);
  });

  it('the family wall dedupes a book shared by two of its genres', () => {
    // The stub deliberately files one book under two genres of one family.
    // Without the Set it would appear twice, and paging would run off the end
    // of a shelf whose length is the sum of usage counts.
    expect(fam.booksUnique).toBe(2);
  });

  it('both pages actually list books', () => {
    // THE REGRESSION GUARD. v0.67 asked book_genres_view for `title`, a column
    // that view does not have; PostgREST 400'd, the caller returned [], and
    // every prerendered genre page shipped bookless for two weeks. The schema
    // stub above 400s the same way, so this assertion is what turns that from a
    // silent empty page into a failing test.
    expect(genHtml).toMatch(/<h2>Books shelved as/);
    expect(fam.booksUnique).toBeGreaterThan(0);
  });

  it('no query asked for a column the schema does not have', () => {
    // Belt and braces: the stub logs every rejection it issued, so a swallowed
    // 400 that happens not to change the assertions above still fails here.
    const rejected = lines.filter((l) => l.includes('[stub] 400'));
    expect(rejected, rejected.join('\n')).toEqual([]);
  });
});
