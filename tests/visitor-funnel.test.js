// tests/visitor-funnel.test.js — 2026-11-10
//
// The visitor funnel (src/lib/api/funnel.js + migration 20261110120000), the
// sign-up intent (src/lib/util/pendingIntent.js) and the book-page Oracle
// teaser (netlify/functions/book-teaser.js). Three kinds of check:
//   - the pure helpers do what the privacy page says they do;
//   - the client and the SQL agree on the event and prop whitelists;
//   - the privacy copy names what is actually collected, in both languages.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/api/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ error: null })) } }));

const funnel = await import('../src/lib/api/funnel.js');
const intent = await import('../src/lib/util/pendingIntent.js');
const teaser = await import('../netlify/functions/book-teaser.js');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261110120000_visitor_funnel.sql');
const en = JSON.parse(read('../src/i18n/en.json'));
const es = JSON.parse(read('../src/i18n/es.json'));

describe('where a visit came from', () => {
  const own = 'www.thebooksoracle.com';
  it.each([
    ['https://www.google.com/', 'search:google'],
    ['https://www.google.co.cr/', 'search:google'],
    ['android-app://com.google.android.googlequicksearchbox/', 'search:google'],
    ['https://www.bing.com/search?q=dune+series', 'search:bing'],
    ['https://duckduckgo.com/', 'search:duckduckgo'],
    ['https://chatgpt.com/', 'search:chatgpt'],
    ['https://t.co/abc', 'social:x'],
    ['https://old.reddit.com/r/books/comments/1', 'social:reddit'],
    ['https://l.instagram.com/?u=x', 'social:instagram'],
    ['https://alternativeto.net/software/goodreads/', 'ref:alternativeto.net'],
    ['https://www.thebooksoracle.com/series/Dune', 'internal'],
    ['https://readingoracle.com/', 'internal'],
    ['', 'direct'],
    ['not a url', 'direct'],
  ])('%s → %s', (ref, expected) => {
    expect(funnel.classifySource(ref, own)).toBe(expected);
  });

  it('never keeps the path or the query', () => {
    const src = funnel.classifySource('https://example.org/secret/path?q=my+search', own);
    expect(src).toBe('ref:example.org');
  });

  it('a campaign tag wins, cleaned', () => {
    expect(funnel.classifySource('https://www.google.com/', own, 'News Letter!')).toBe('utm:newsletter');
  });
});

describe('what is kept about a page', () => {
  it('keeps paths only for public catalogue pages', () => {
    expect(funnel.keptPath('book-page', '/book/dune|frankherbe')).toBe('/book/dune|frankherbe');
    expect(funnel.keptPath('series-page', '/series/Dune')).toBe('/series/Dune');
    expect(funnel.keptPath('list-view', '/list/2c1e…')).toBeNull();
    expect(funnel.keptPath('reader-profile', '/reader/someone')).toBeNull();
    expect(funnel.keptPath('plan-view', '/plan/abc')).toBeNull();
  });

  it('names page kinds, and calls anything unknown "app"', () => {
    expect(funnel.pageTypeFor('dashboard')).toBe('home');
    expect(funnel.pageTypeFor('book-page')).toBe('book');
    expect(funnel.pageTypeFor('wishlist')).toBe('app');
  });

  it('drops props outside the whitelist and long strings', () => {
    const out = funnel.cleanProps({ cta: 'book_save', email: 'a@b.c', count: 3, kind: 'x'.repeat(200), nested: { a: 1 } });
    expect(out).toEqual({ cta: 'book_save', count: 3, kind: 'x'.repeat(60) });
  });

  it('spots crawlers and automated browsers', () => {
    expect(funnel.isLikelyBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(funnel.isLikelyBot('Mozilla/5.0 … Chrome-Lighthouse')).toBe(true);
    expect(funnel.isLikelyBot('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120')).toBe(true);
    expect(funnel.isLikelyBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1')).toBe(false);
    expect(funnel.isLikelyBot('Mozilla/5.0 (iPhone)', true)).toBe(true);
  });
});

describe('account arrival', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  it('a brand-new account is a signup', () => {
    expect(funnel.accountArrivalEvent({ created_at: '2026-11-10T11:55:00Z' }, false, now)).toBe('signup_completed');
  });
  it('an old account through the sign-in window is a sign-in', () => {
    expect(funnel.accountArrivalEvent({ created_at: '2025-01-01T00:00:00Z' }, true, now)).toBe('signin_completed');
  });
  it('a session restored on load is nothing', () => {
    expect(funnel.accountArrivalEvent({ created_at: '2025-01-01T00:00:00Z' }, false, now)).toBeNull();
  });
});

describe('client and SQL agree', () => {
  const constraint = migration.slice(migration.indexOf('funnel_events_event_check'), migration.indexOf('funnel_events_session_fmt'));
  const rpcBody = migration.slice(migration.indexOf('function public.log_funnel_event'), migration.indexOf('$function$;', migration.indexOf('function public.log_funnel_event')));
  const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it('the check constraint allows exactly the client events', () => {
    expect(new Set(quoted(constraint))).toEqual(new Set(funnel.FUNNEL_EVENTS));
  });

  it('the RPC accepts exactly the client events', () => {
    const list = rpcBody.slice(rpcBody.indexOf("p_event not in ("), rpcBody.indexOf(') then return; end if;', rpcBody.indexOf('p_event not in (')));
    expect(new Set(quoted(list))).toEqual(new Set(funnel.FUNNEL_EVENTS));
  });

  it('the RPC keeps exactly the client prop keys', () => {
    const line = rpcBody.slice(rpcBody.indexOf('if v_key in ('), rpcBody.indexOf(')', rpcBody.indexOf('if v_key in (')));
    expect(new Set(quoted(line))).toEqual(new Set(funnel.PROP_KEYS));
  });

  it('account rows are the only ones tied to an account', () => {
    expect(rpcBody).toMatch(/p_event in \('signup_completed', 'signin_completed', 'onboarding_completed', 'intent_resumed'\)/);
    expect(rpcBody).toMatch(/v_user\s+uuid := null/);
  });

  it('retention matches the privacy page', () => {
    expect(migration).toMatch(/interval '12 months'/);
    expect(en.privacy.whatDataWeCollectPara7).toMatch(/12 months/);
    expect(es.privacy.whatDataWeCollectPara7).toMatch(/12 meses/);
  });
});

describe('privacy page names what is collected', () => {
  it.each([['en', en], ['es', es]])('%s', (_, cat) => {
    const p = cat.privacy;
    expect(p.whatDataWeCollectPara7).toBeTruthy();
    expect(p.howDoWeUseYourDataPara3).toBeTruthy();
    expect(p.cookiesPara1).toMatch(/sessionStorage/);
    expect(p.cookiesPara1).toMatch(/7/);
    expect(p.cookiesPara1).toMatch(/2/);
    expect(p.whatDataWeCollectPara7).toMatch(/Global Privacy Control/);
    expect(p.lastUpdated).toMatch(/2026/);
  });

  it('the Privacy view renders the new paragraphs', () => {
    const view = read('../src/views/Privacy.jsx');
    expect(view).toMatch(/privacy\.whatDataWeCollectPara7/);
    expect(view).toMatch(/privacy\.howDoWeUseYourDataPara3/);
  });

  it('every growth string exists in both languages', () => {
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(es.growth).sort()).toEqual(keys(en.growth).sort());
  });
});

describe('sign-up intent', () => {
  const book = { t: 'Dune', a: 'Frank Herbert', coverUrl: 'x.jpg', d: 'a long description', notes: 'mine' };
  const route = { name: 'book-page', params: { bookKey: 'dune|frankherbe' } };

  it('carries catalogue fields only', () => {
    expect(intent.slimBook(book)).toEqual({ t: 'Dune', a: 'Frank Herbert', coverUrl: 'x.jpg' });
  });

  it('accepts a fresh wishlist intent', () => {
    const now = Date.now();
    expect(intent.validIntent({ type: 'wishlist', book: { t: 'Dune' }, route, at: now }, now)).toBeTruthy();
  });

  it.each([
    ['expired', { type: 'wishlist', book: { t: 'Dune' }, route, at: 0 }],
    ['unknown type', { type: 'delete_everything', book: { t: 'Dune' }, at: Date.now() }],
    ['no book', { type: 'wishlist', at: Date.now() }],
    ['route not resumable', { type: 'wishlist', book: { t: 'Dune' }, route: { name: 'profile', params: {} }, at: Date.now() }],
  ])('rejects: %s', (_, i) => {
    expect(intent.validIntent(i)).toBeNull();
  });
});

describe('book teaser', () => {
  it('reads the JSON array out of the reply', () => {
    const text = 'Here you go:\n[{"title":"Hyperion","author":"Dan Simmons","why":"If the scale held you…"}, {"title":""}]\n';
    expect(teaser.parsePicks(text)).toEqual([{ title: 'Hyperion', author: 'Dan Simmons', why: 'If the scale held you…' }]);
    expect(teaser.parsePicks('no json here')).toEqual([]);
    expect(teaser.parsePicks('[not json]')).toEqual([]);
  });

  it('keeps only resolved picks, never the book itself, at most three', () => {
    const raw = [1, 2, 3, 4, 5].map((n) => ({ title: `T${n}`, author: `A${n}`, why: `why ${n}` }));
    const resolved = [
      { ord: 1, book_id: 'self', title: 'T1', author: 'A1', share_key: 't1|a1' },
      { ord: 2, book_id: 'b2', title: 'T2', author: 'A2', share_key: 't2|a2', cover_url: 'c2' },
      { ord: 4, book_id: 'b4', title: 'T4', author: 'A4', share_key: 't4|a4' },
      { ord: 5, book_id: 'b5', title: 'T5', author: 'A5', share_key: 't5|a5' },
      { ord: 3, book_id: 'b3', title: 'T3', author: 'A3', share_key: 't3|a3' },
    ];
    const picks = teaser.mergePicks(resolved, raw, 'self');
    expect(picks.map((p) => p.shareKey)).toEqual(['t2|a2', 't4|a4', 't5|a5']);
    expect(picks[0]).toMatchObject({ coverUrl: 'c2', why: 'why 2' });
  });

  it('the prompt holds the book and nothing about the visitor', () => {
    const prompt = teaser.buildPrompt({ title: 'Mandíbula', author: 'Mónica Ojeda', description: 'Una novela.' }, 'es');
    expect(prompt).toMatch(/Mandíbula/);
    expect(prompt).toMatch(/vos/);
    expect(prompt).not.toMatch(/user|email|visitor/i);
  });

  it('throttles generations per IP', () => {
    const store = new Map();
    const t0 = 1_000_000;
    const results = [0, 1, 2, 3, 4].map((i) => teaser.allow('1.2.3.4', 'gen', t0 + i, store));
    expect(results).toEqual([true, true, true, true, false]);
    expect(teaser.allow('1.2.3.4', 'gen', t0 + 11 * 60e3, store)).toBe(true);
  });
});

describe('no dead sign-in links on public pages', () => {
  it.each(['../src/views/BookPage.jsx', '../src/views/SeriesPage.jsx'])('%s', (p) => {
    expect(read(p)).not.toMatch(/href=\{window\.location\.pathname\}/);
  });
});
