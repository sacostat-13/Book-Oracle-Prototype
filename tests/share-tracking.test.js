// tests/share-tracking.test.js — v0.74
//
// Share tracking (src/lib/share/shareTracking.js + migration 20261125120000 +
// the unfurl branch of og-prerender.js). Four kinds of check:
//   - the pure helpers: tokens, tagged URLs, what a URL points at;
//   - the boot step takes ?s= out of the address and keeps everything else;
//   - the client, the SQL and the edge function agree on every whitelist;
//   - the privacy copy names what is actually collected, in both languages,
//     and the prerender never lets ?s= into a canonical.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const rpc = vi.fn(async () => ({ error: null }));
vi.mock('../src/lib/api/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

// The edge function reads Deno.env inside its handler; importing it needs only a stub.
globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } };

const st = await import('../src/lib/share/shareTracking.js');
const prerender = await import('../netlify/edge-functions/og-prerender.js');

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261125120000_share_tracking.sql');
const en = JSON.parse(read('../src/i18n/en.json'));
const es = JSON.parse(read('../src/i18n/es.json'));

const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
function between(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`not found: ${start}`);
  return src.slice(i + start.length, src.indexOf(end, i + start.length));
}

// ── Browser stand-ins ────────────────────────────────────────────────────────
function fakeBrowser({ href, referrer = '', ua = 'Mozilla/5.0 (iPhone) Safari', dnt = null, gpc = false, webdriver = false }) {
  const replace = vi.fn((_s, _t, next) => { win.location.href = new URL(next, win.location.href).toString(); });
  const win = { location: { href }, history: { state: null, replaceState: replace }, doNotTrack: null };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { referrer, documentElement: { lang: 'es' } });
  vi.stubGlobal('navigator', { userAgent: ua, doNotTrack: dnt, globalPrivacyControl: gpc, webdriver });
  vi.stubGlobal('localStorage', { getItem: () => 'es' });
  return { win, replace };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  rpc.mockClear();
  st._resetForTests();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────
describe('tokens', () => {
  it('are always 8 base62 characters', () => {
    for (let i = 0; i < 5000; i++) expect(st.newShareToken()).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  it('do not repeat', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => st.newShareToken()));
    expect(seen.size).toBe(5000);
  });

  it('use the whole alphabet', () => {
    const chars = new Set(Array.from({ length: 2000 }, () => st.newShareToken()).join(''));
    expect(chars.size).toBe(62);
  });
});

describe('tagged URLs', () => {
  it('adds ?s= and keeps other params', () => {
    expect(st.withShareToken('https://www.thebooksoracle.com/l/abc?lang=es', 'Xk3P9aQm'))
      .toBe('https://www.thebooksoracle.com/l/abc?lang=es&s=Xk3P9aQm');
  });

  it('keeps the encoded book key exactly as shareService built it', () => {
    const url = 'https://www.thebooksoracle.com/book/dune%7Cfrankherbe';
    expect(st.withShareToken(url, 'AAAAAAAA')).toBe(`${url}?s=AAAAAAAA`);
  });

  it('replaces a token rather than stacking two', () => {
    expect(st.withShareToken('https://x.test/u/sim?s=OLDOLDOL', 'NEWNEWNE')).toBe('https://x.test/u/sim?s=NEWNEWNE');
  });

  it('leaves an unparseable URL alone', () => {
    expect(st.withShareToken('not a url', 'AAAAAAAA')).toBe('not a url');
  });

  it('prepareShare gives a token, the tagged URL and the base', () => {
    const p = st.prepareShare('https://x.test/series/Dune');
    expect(p.url).toBe(`https://x.test/series/Dune?s=${p.token}`);
    expect(p.baseUrl).toBe('https://x.test/series/Dune');
  });
});

describe('what a share URL points at', () => {
  it.each([
    ['https://x.test/book/dune%7Cfrankherbe', 'book', 'dune|frankherbe'],
    ['https://x.test/series/The%20Broken%20Earth', 'series', 'The Broken Earth'],
    ['https://x.test/l/4f2a?lang=es', 'list', '4f2a'],
    ['https://x.test/plans/9b1', 'plan', '9b1'],
    ['https://x.test/clubs/c7', 'club', 'c7'],
    ['https://x.test/u/simon', 'profile', 'simon'],
    ['https://x.test/sessions/s1', 'session', 's1'],
    ['https://x.test/', 'site', '/'],
    ['https://x.test/about', 'site', '/about'],
  ])('%s → %s', (url, type, key) => {
    expect(st.entityFromShareUrl(url)).toEqual({ type, key });
  });

  it('every entity type it can return is allowed by the database', () => {
    expect(st.SHARE_ENTITY_TYPES).toContain('site');
  });
});

describe('referrer host', () => {
  it.each([
    ['https://t.co/abc123', 't.co'],
    ['https://www.facebook.com/some/post?id=9', 'facebook.com'],
    ['https://l.instagram.com/?u=https%3A%2F%2Fx', 'l.instagram.com'],
    ['', null],
    ['garbage', null],
  ])('%s → %s', (ref, host) => expect(st.referrerHost(ref)).toBe(host));
});

// ── Recording a share ────────────────────────────────────────────────────────
describe('recordShare', () => {
  it('sends the entity, channel, surface and locale once per token', () => {
    fakeBrowser({ href: 'https://x.test/' });
    const p = st.prepareShare('https://x.test/book/dune%7Cfrankherbe');
    st.recordShare(p, 'whatsapp');
    st.recordShare(p, 'whatsapp');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('log_share', {
      p_id: p.token, p_entity_type: 'book', p_entity_key: 'dune|frankherbe',
      p_channel: 'whatsapp', p_surface: 'page', p_locale: 'es',
    });
  });

  it('drops an unknown channel or surface', () => {
    fakeBrowser({ href: 'https://x.test/' });
    st.recordShare(st.prepareShare('https://x.test/u/a'), 'myspace');
    st.recordShare(st.prepareShare('https://x.test/u/a'), 'copy', 'banner');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['Do Not Track', { dnt: '1' }],
    ['Global Privacy Control', { gpc: true }],
    ['an automated browser', { webdriver: true }],
    ['a crawler', { ua: 'Googlebot/2.1' }],
  ])('records nothing under %s', (_, opts) => {
    fakeBrowser({ href: 'https://x.test/', ...opts });
    st.recordShare(st.prepareShare('https://x.test/u/a'), 'copy');
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ── Arriving through a shared link ───────────────────────────────────────────
describe('captureIncomingShare', () => {
  it('reads the token and takes it out of the address, keeping the rest', () => {
    const { win, replace } = fakeBrowser({ href: 'https://x.test/l/4f2a?lang=es&s=Xk3P9aQm#top', referrer: 'https://t.co/x' });
    expect(st.captureIncomingShare()).toBe('Xk3P9aQm');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(win.location.href).toBe('https://x.test/l/4f2a?lang=es#top');
    expect(st.incomingShareToken()).toBe('Xk3P9aQm');
  });

  it('strips a malformed token but does not keep it', () => {
    const { win } = fakeBrowser({ href: 'https://x.test/book/a%7Cb?s=%3Cscript%3E' });
    expect(st.captureIncomingShare()).toBeNull();
    expect(win.location.href).toBe('https://x.test/book/a%7Cb');
    expect(st.incomingShareToken()).toBeNull();
  });

  it('leaves the address alone when there is no token', () => {
    const { replace } = fakeBrowser({ href: 'https://x.test/l/4f2a?lang=es' });
    expect(st.captureIncomingShare()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('reportIncomingShareClick', () => {
  it('counts the visit once, with the referrer host only', () => {
    fakeBrowser({ href: 'https://x.test/u/a?s=Xk3P9aQm', referrer: 'https://t.co/abc?x=1' });
    st.captureIncomingShare();
    st.reportIncomingShareClick(false);
    st.reportIncomingShareClick(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('log_share_hit', {
      p_share: 'Xk3P9aQm', p_kind: 'click', p_ref_host: 't.co', p_signed_in: false,
    });
  });

  it('does nothing without a token', () => {
    fakeBrowser({ href: 'https://x.test/u/a' });
    st.captureIncomingShare();
    st.reportIncomingShareClick(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does nothing under Do Not Track', () => {
    fakeBrowser({ href: 'https://x.test/u/a?s=Xk3P9aQm', dnt: '1' });
    st.captureIncomingShare();
    st.reportIncomingShareClick(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the visitor funnel attributes share landings', () => {
  const funnel = read('../src/lib/api/funnel.js');
  const hook = read('../src/hooks/useVisitorFunnel.js');
  it('uses share:<token> as the landing source when one arrived', () => {
    expect(funnel).toMatch(/`share:\$\{shareToken\}`/);
    expect(hook).toMatch(/trackPage\(route\.name, incomingShareToken\(\)\)/);
  });
  it('fits the funnel source column', () => {
    expect('share:Xk3P9aQm'.length).toBeLessThanOrEqual(80);
  });
});

// ── Link previews (og-prerender.js) ──────────────────────────────────────────
describe('unfurl agents', () => {
  it.each([
    ['WhatsApp/2.23.20.0 A', 'whatsapp'],
    ['Mozilla/5.0 (Macintosh) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0', 'imessage'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'facebook'],
    ['meta-externalagent/1.1', 'facebook'],
    ['Twitterbot/1.0', 'x'],
    ['TelegramBot (like TwitterBot)', 'telegram'],
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'slack'],
    ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'discord'],
    ['LinkedInBot/1.0 (compatible; Mozilla/5.0)', 'linkedin'],
    ['Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)', 'bluesky'],
    ['Mozilla/5.0 (compatible; redditbot/1.0)', 'reddit'],
    ['Embedly/0.2', 'other_preview'],
  ])('%s → %s', (ua, agent) => expect(prerender.unfurlAgent(ua)).toBe(agent));

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1',
  ])('a search crawler or a person is not an unfurl: %s', (ua) => {
    expect(prerender.unfurlAgent(ua)).toBeNull();
  });

  it('every agent it can return is allowed by the database', () => {
    const agents = new Set(quoted(between(migration, 'constraint share_hits_agent_check check (agent is null or agent in (', '))')));
    const src = read('../netlify/edge-functions/og-prerender.js');
    const used = new Set(quoted(between(src, 'const UNFURL_AGENTS = [', '];')));
    for (const a of used) expect(agents.has(a)).toBe(true);
  });

  it('the prerender counts unfurls only for a valid token, before any entity lookup', () => {
    const src = read('../netlify/edge-functions/og-prerender.js');
    expect(src).toMatch(/SHARE_TOKEN_RE\.test\(shareToken\)/);
    expect(src).toMatch(/await callRpc\('log_share_hit', \{ p_share: shareToken, p_kind: 'unfurl', p_agent: agent \}\)/);
    expect(src.indexOf("callRpc('log_share_hit'")).toBeLessThan(src.indexOf('const bookMatch'));
  });

  it('no canonical or og:url is ever built from the query string', () => {
    const src = read('../netlify/edge-functions/og-prerender.js');
    expect(src).not.toMatch(/url:\s*[^,\n]*(url\.search|url\.href|request\.url)/);
  });
});

// ── Client / SQL contracts ───────────────────────────────────────────────────
describe('client and database agree', () => {
  const rpcShare = between(migration, 'create or replace function public.log_share (', '$function$;\n\nrevoke');

  it('channels: constraint = RPC = client', () => {
    const constraint = new Set(quoted(between(migration, 'constraint shares_channel_check check (channel in (', '))')));
    const rpcList = new Set(quoted(between(rpcShare, 'if p_channel not in (', ') then return;')));
    expect(constraint).toEqual(new Set(st.SHARE_CHANNELS));
    expect(rpcList).toEqual(new Set(st.SHARE_CHANNELS));
  });

  it('entity types: constraint = RPC = client', () => {
    const constraint = new Set(quoted(between(migration, 'constraint shares_entity_type_check check (entity_type in (', '))')));
    const rpcList = new Set(quoted(between(rpcShare, 'if p_entity_type not in (', ') then return;')));
    expect(constraint).toEqual(new Set(st.SHARE_ENTITY_TYPES));
    expect(rpcList).toEqual(new Set(st.SHARE_ENTITY_TYPES));
  });

  it('surfaces: constraint = RPC = client', () => {
    const constraint = new Set(quoted(between(migration, 'constraint shares_surface_check check (surface in (', '))')));
    const rpcList = new Set(quoted(between(rpcShare, "if coalesce(p_surface, 'page') not in (", ') then return;')));
    expect(constraint).toEqual(new Set(st.SHARE_SURFACES));
    expect(rpcList).toEqual(new Set(st.SHARE_SURFACES));
  });

  it('the token format is the same everywhere', () => {
    expect(migration).toMatch(/\^\[0-9A-Za-z\]\{8\}\$/);
    expect(String(st.TOKEN_RE)).toBe(String(prerender.SHARE_TOKEN_RE));
  });

  it('every channel the share modals use is allowed', () => {
    const used = [
      ...read('../src/components/ShareModal.jsx').matchAll(/recordShare\([^,]+,\s*'([a-z_]+)'/g),
      ...read('../src/components/ShareMomentModal.jsx').matchAll(/recordShare\([^,]+,\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const c of used) expect(st.SHARE_CHANNELS).toContain(c);
  });

  it('only the service role can record an unfurl', () => {
    expect(migration).toMatch(/p_kind = 'unfurl' and coalesce\(auth\.role\(\), ''\) <> 'service_role' then return/);
  });

  it('a sharer opening their own link is not counted', () => {
    expect(migration).toMatch(/p_kind = 'click' and v_uid is not null and v_uid = v_sharer then return/);
  });

  it('a hit never stores who opened the link', () => {
    const table = between(migration, 'create table if not exists public.share_hits (', ');\n');
    expect(table).not.toMatch(/user_id|session|\bip\b|user_agent/);
  });

  it('nothing is readable over the API', () => {
    expect(migration).toMatch(/revoke all on public\.shares\s+from anon, authenticated/);
    expect(migration).toMatch(/revoke all on public\.share_hits\s+from anon, authenticated/);
  });

  it('shares go with the account', () => {
    expect(migration).toMatch(/sharer_id\s+uuid\s+references auth\.users\(id\) on delete cascade/);
  });
});

// ── Privacy copy ─────────────────────────────────────────────────────────────
describe('privacy page names what is collected', () => {
  it('retention matches', () => {
    expect(migration).toMatch(/interval '12 months'/);
    expect(en.privacy.whatDataWeCollectPara8).toMatch(/12 months/);
    expect(es.privacy.whatDataWeCollectPara8).toMatch(/12 meses/);
  });

  it.each([['en', en], ['es', es]])('%s', (_, cat) => {
    const p = cat.privacy.whatDataWeCollectPara8;
    expect(p).toBeTruthy();
    expect(p).toMatch(/Global Privacy Control/);
    expect(p).toMatch(/WhatsApp/);
    expect(p).toMatch(/t\.co/);
  });

  it('the Privacy view renders it', () => {
    expect(read('../src/views/Privacy.jsx')).toMatch(/privacy\.whatDataWeCollectPara8/);
  });
});
