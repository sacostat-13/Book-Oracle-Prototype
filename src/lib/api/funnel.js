// src/lib/api/funnel.js
//
// Visitor funnel: what happens between a search click and a new account.
// Schema + write RPC: supabase/migrations/20261110120000_visitor_funnel.sql.
// Reading the numbers: supabase/diagnostics/funnel_report.sql.
//
// What is recorded, and what is not (keep in step with privacy.whatDataWeCollectPara7):
//   - Signed-out visits only, page by page. A signed-in reader's browsing is
//     never recorded here; for them only the auth/onboarding milestones are.
//   - Per event: its name, the kind of page (book/series/home…), the path ONLY
//     for public catalogue pages (/book, /series, /genre[s]) — other paths can
//     carry list, plan or profile ids — where the visit came from as a site
//     name (`search:google`, `ref:alternativeto.net`, never the full referring
//     URL), language, phone/desktop, and a few whitelisted props.
//   - A random session id kept in sessionStorage: one tab, gone when it closes.
//     Not a cookie, not derived from the person, never joined to an account
//     except on the event that marks the account being created or signed in.
//   - First touch (source + landing page kind, 7 days, localStorage) so a
//     signup that finishes in another tab — a magic link — still says where
//     the visitor came from.
//   - Nothing at all under Do Not Track / Global Privacy Control, and nothing
//     from automated browsers (crawlers, headless renderers, Lighthouse).
//
// Every writer is fire-and-forget and silent: instrumentation must never break
// or slow down the page it measures.

import { supabase } from './supabase';
import { trackingAllowed } from '../util/trackingAllowed';

// Must match the check constraint and the RPC in the migration — see
// tests/visitor-funnel.test.js, which compares them.
export const FUNNEL_EVENTS = [
  'landing',             // first page of a signed-out session
  'page_view',           // every later page in that session, while signed out
  'cta_click',           // a sign-up call to action (props.cta names which)
  'auth_open',           // the sign-in window opened (props.from)
  'auth_submit',         // a sign-in/up attempt (props.method)
  'auth_error',          // it failed (props.kind — a bucket, never the message)
  'signup_completed',    // a new account exists
  'signin_completed',    // an existing reader signed in from a public page
  'onboarding_completed',
  'intent_resumed',      // the action they clicked before signing up was done for them
  'teaser_open',         // asked the Oracle on a public book page
  'teaser_result',       // …and got picks (props.count, props.cached)
  'teaser_save',         // clicked "save" on a pick
];

// Props a caller may attach. Anything else is dropped before sending.
export const PROP_KEYS = ['cta', 'from', 'mode', 'method', 'kind', 'type', 'count', 'cached', 'src', 'land'];

const SESSION_KEY = 'tbo_fsid';
const LANDED_KEY = 'tbo_fland';
const FIRST_TOUCH_KEY = 'tbo_ftouch';
const FIRST_TOUCH_TTL_MS = 7 * 86400e3;

// Routes whose path is a public catalogue address and therefore safe to keep.
const PATH_KEPT = new Set(['book-page', 'series-page', 'genre-page', 'family-page', 'genres-index']);

const PAGE_TYPES = {
  dashboard: 'home',
  'book-page': 'book',
  'series-page': 'series',
  'genre-page': 'genre',
  'family-page': 'genre',
  'genres-index': 'genre',
  'list-view': 'list',
  'lists-discover': 'list',
  'plan-view': 'plan',
  'join-club': 'club',
  about: 'about',
  changelog: 'about',
  privacy: 'legal',
  terms: 'legal',
  refund: 'legal',
  sitemap: 'legal',
  'not-found': 'not_found',
};

const SEARCH_ENGINES = [
  ['google.', 'google'],
  ['bing.com', 'bing'],
  ['duckduckgo.com', 'duckduckgo'],
  ['search.yahoo.', 'yahoo'],
  ['yahoo.', 'yahoo'],
  ['ecosia.org', 'ecosia'],
  ['yandex.', 'yandex'],
  ['search.brave.com', 'brave'],
  ['startpage.com', 'startpage'],
  ['qwant.com', 'qwant'],
  ['baidu.com', 'baidu'],
  ['naver.com', 'naver'],
  ['chatgpt.com', 'chatgpt'],
  ['perplexity.ai', 'perplexity'],
];

const SOCIAL = [
  ['t.co', 'x'], ['twitter.com', 'x'], ['x.com', 'x'],
  ['facebook.com', 'facebook'], ['instagram.com', 'instagram'],
  ['threads.net', 'threads'], ['bsky.app', 'bluesky'],
  ['reddit.com', 'reddit'], ['tiktok.com', 'tiktok'],
  ['linkedin.com', 'linkedin'], ['lnkd.in', 'linkedin'],
  ['youtube.com', 'youtube'], ['pinterest.', 'pinterest'],
  ['discord.com', 'discord'], ['whatsapp.com', 'whatsapp'],
  ['t.me', 'telegram'],
];

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|google-inspectiontool|chrome-lighthouse|bingpreview|facebookexternalhit|embedly|preview/i;

// 'bing.com' matches bing.com and *.bing.com. A needle ending in '.' names a
// label of any country domain: 'google.' matches google.com, google.co.cr and
// news.google.com. Never a bare substring — 'reddit.com' contains 't.co'.
function hostMatches(host, needle) {
  if (needle.endsWith('.')) return host.startsWith(needle) || host.includes(`.${needle}`);
  return host === needle || host.endsWith(`.${needle}`);
}

/**
 * Where a visit came from, as a short label. Only the referrer's HOST is read;
 * paths and query strings (a search query, a post URL) are never kept.
 * @param {string} referrer  document.referrer
 * @param {string} ownHost   location.hostname
 * @param {string|null} utmSource  ?utm_source=, when a campaign link set one
 * @returns {string} e.g. 'search:google', 'social:reddit', 'ref:alternativeto.net', 'direct', 'internal', 'utm:newsletter'
 */
export function classifySource(referrer, ownHost, utmSource = null) {
  const utm = String(utmSource || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (utm) return `utm:${utm}`;
  let host = '';
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : ''; } catch { host = ''; }
  if (!host) return 'direct';
  host = host.replace(/^www\./, '');
  const own = String(ownHost || '').toLowerCase().replace(/^www\./, '');
  const OWN_DOMAINS = ['thebooksoracle.com', 'readingoracle.com', own].filter(Boolean);
  if (OWN_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return 'internal';
  // Android's Google app sends this package name instead of a URL host.
  if (host === 'com.google.android.googlequicksearchbox') return 'search:google';
  for (const [needle, name] of SEARCH_ENGINES) if (hostMatches(host, needle)) return `search:${name}`;
  for (const [needle, name] of SOCIAL) if (hostMatches(host, needle)) return `social:${name}`;
  return `ref:${host.slice(0, 60)}`;
}

/** The kind of page a route is, for grouping. */
export function pageTypeFor(routeName) {
  return PAGE_TYPES[routeName] || 'app';
}

/** The path worth keeping for this route, or null. */
export function keptPath(routeName, pathname) {
  if (!PATH_KEPT.has(routeName)) return null;
  return String(pathname || '').slice(0, 300) || null;
}

/** True for crawlers, headless renderers and other automated browsers. */
export function isLikelyBot(userAgent, webdriver = false) {
  if (webdriver) return true;
  return BOT_UA.test(String(userAgent || ''));
}

/** Keep only whitelisted, short, primitive props. */
export function cleanProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const k of PROP_KEYS) {
    const v = props[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else out[k] = String(v).slice(0, 60);
  }
  return out;
}

// ── Browser plumbing ──────────────────────────────────────────────────────────

function enabled() {
  if (typeof window === 'undefined') return false;
  if (!trackingAllowed()) return false;
  try { return !isLikelyBot(navigator.userAgent, navigator.webdriver); } catch { return false; }
}

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`).toLowerCase();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch { return null; }
}

function deviceKind() {
  try { return window.matchMedia('(max-width: 720px)').matches ? 'mobile' : 'desktop'; } catch { return null; }
}

function currentLang() {
  try { return (localStorage.getItem('oracle.lang') || document.documentElement.lang || '').slice(0, 2) || null; } catch { return null; }
}

function readFirstTouch() {
  try {
    const raw = localStorage.getItem(FIRST_TOUCH_KEY);
    if (!raw) return null;
    const ft = JSON.parse(raw);
    if (!ft?.at || Date.now() - ft.at > FIRST_TOUCH_TTL_MS) {
      localStorage.removeItem(FIRST_TOUCH_KEY);
      return null;
    }
    return ft;
  } catch { return null; }
}

function rememberFirstTouch(src, land) {
  try {
    if (readFirstTouch()) return;
    localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify({ src, land, at: Date.now() }));
  } catch { /* private mode */ }
}

async function send(event, { routeName = null, pathname = null, source = null, props = null } = {}) {
  if (!enabled() || !FUNNEL_EVENTS.includes(event)) return;
  const sid = sessionId();
  if (!sid) return;
  try {
    const { error } = await supabase.rpc('log_funnel_event', {
      p_session: sid,
      p_event: event,
      p_page_type: routeName ? pageTypeFor(routeName) : null,
      p_path: routeName ? keptPath(routeName, pathname) : null,
      p_source: source,
      p_lang: currentLang(),
      p_device: deviceKind(),
      p_props: cleanProps(props),
    });
    if (error && import.meta.env?.DEV) console.warn('log_funnel_event:', error.message);
  } catch { /* instrumentation never surfaces */ }
}

// ── Public writers ────────────────────────────────────────────────────────────

/**
 * A signed-out visitor's page. The first one in a tab is the `landing`
 * (with where they came from); every later one is a `page_view`.
 * @param {string} routeName  route.name from RouterContext
 */
export function trackPage(routeName) {
  if (!enabled()) return;
  let landed = false;
  try { landed = sessionStorage.getItem(LANDED_KEY) === '1'; } catch { /* treat as first */ }
  const pathname = window.location.pathname;
  if (landed) {
    send('page_view', { routeName, pathname });
    return;
  }
  try { sessionStorage.setItem(LANDED_KEY, '1'); } catch { /* ignore */ }
  let utm = null;
  try { utm = new URLSearchParams(window.location.search).get('utm_source'); } catch { /* ignore */ }
  const source = classifySource(document.referrer, window.location.hostname, utm);
  rememberFirstTouch(source, pageTypeFor(routeName));
  send('landing', { routeName, pathname, source });
}

/**
 * Any other funnel event. `routeName` is optional context; `props` are
 * filtered to the whitelist.
 */
export function trackEvent(event, props = null, routeName = null) {
  send(event, { routeName, pathname: typeof window !== 'undefined' ? window.location.pathname : null, props });
}

/**
 * The account milestone. Carries the first-touch source so a signup that
 * finishes in another tab is still attributed. Sent at most once per tab.
 * @param {'signup_completed'|'signin_completed'} event
 */
export function trackAccountEvent(event) {
  try {
    const key = `tbo_f_${event}`;
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  } catch { /* ignore */ }
  const ft = readFirstTouch();
  send(event, { props: ft ? { src: ft.src, land: ft.land } : null });
}

// ── Account arrival ───────────────────────────────────────────────────────────

const AUTH_ATTEMPT_KEY = 'tbo_fauth';
const NEW_ACCOUNT_WINDOW_MS = 15 * 60e3;

/** Remember, for this tab, that the visitor started signing in. */
export function markAuthAttempt() {
  try { sessionStorage.setItem(AUTH_ATTEMPT_KEY, '1'); } catch { /* ignore */ }
}

/**
 * Called by AuthContext whenever a session appears where there was none.
 * A brand-new account → signup_completed. An existing account that got here
 * through the sign-in window in this tab → signin_completed. Anything else
 * (a returning reader whose session was simply restored on load) → nothing.
 * @param {{ created_at?: string }} user  Supabase auth user
 * @param {number} [now]
 */
export function accountArrivalEvent(user, attempted, now = Date.now()) {
  const created = Date.parse(user?.created_at || '');
  if (Number.isFinite(created) && now - created < NEW_ACCOUNT_WINDOW_MS) return 'signup_completed';
  if (attempted) return 'signin_completed';
  return null;
}

export function noteAccountArrival(user) {
  let attempted = false;
  try {
    attempted = sessionStorage.getItem(AUTH_ATTEMPT_KEY) === '1';
    sessionStorage.removeItem(AUTH_ATTEMPT_KEY);
  } catch { /* ignore */ }
  const event = accountArrivalEvent(user, attempted);
  if (event) trackAccountEvent(event);
}
