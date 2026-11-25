// src/lib/share/shareTracking.js — v0.74
//
// Share tracking: every link that leaves ShareModal / ShareMomentModal carries
// ?s=<token>, so we can count what gets shared, where, and whether anyone
// opened it. Schema + write RPCs: supabase/migrations/20261125120000_share_tracking.sql.
// Link-preview fetches are counted in netlify/edge-functions/og-prerender.js.
// Reading the numbers: supabase/diagnostics/share_report.sql.
//
// What is recorded, and what is not (keep in step with privacy.whatDataWeCollectPara8):
//   - A share: the kind of page, its public key (the same thing that is in the
//     link), which button was used, and the sharer's account when signed in.
//   - A visit through a shared link: the token, the referring site's HOST only,
//     and whether the visitor was signed in. Never who they are.
//   - Nothing under Do Not Track / Global Privacy Control, nothing from
//     automated browsers. Nothing new is stored on the device.
//
// The token is made here, synchronously, at render or tap time. Popup
// blockers only allow window.open / navigator.share inside the tap; asking the
// server for a token first would lose it.
//
// Every writer is fire-and-forget and silent: instrumentation must never break
// or slow down the share it measures.

import { supabase } from '../api/supabase';
import { trackingAllowed } from '../util/trackingAllowed';
import { isLikelyBot } from '../api/funnel';

// Must match the check constraints and RPCs in the migration — see
// tests/share-tracking.test.js, which compares them.
export const SHARE_CHANNELS = [
  'x', 'whatsapp', 'telegram', 'facebook', 'bluesky', 'threads', 'reddit',
  'linkedin', 'email', 'copy', 'native', 'other',
];
export const SHARE_SURFACES = ['page', 'moment_link', 'moment_image'];
export const SHARE_ENTITY_TYPES = ['book', 'series', 'list', 'plan', 'club', 'profile', 'session', 'site'];

export const SHARE_PARAM = 's';
export const TOKEN_RE = /^[0-9A-Za-z]{8}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A fresh 8-character base62 token. */
export function newShareToken() {
  const bytes = new Uint8Array(8);
  try { crypto.getRandomValues(bytes); } catch {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // 248 = 62 × 4: rejecting the top 8 values keeps every character equally likely.
  let out = '';
  for (let i = 0; i < 8; i++) {
    let b = bytes[i];
    while (b >= 248) {
      const r = new Uint8Array(1);
      try { crypto.getRandomValues(r); } catch { r[0] = Math.floor(Math.random() * 248); }
      b = r[0];
    }
    out += ALPHABET[b % 62];
  }
  return out;
}

/** `url` with ?s=token added, other params kept. Unparseable input comes back unchanged. */
export function withShareToken(url, token) {
  try {
    const u = new URL(url);
    u.searchParams.set(SHARE_PARAM, token);
    return u.toString();
  } catch {
    return url;
  }
}

// Route shapes from shareService.js. The key is what is already in the link.
const ENTITY_ROUTES = [
  [/^\/book\/([^/]+)\/?$/, 'book'],
  [/^\/series\/([^/]+)\/?$/, 'series'],
  [/^\/l\/([^/]+)\/?$/, 'list'],
  [/^\/plans\/([^/]+)\/?$/, 'plan'],
  [/^\/clubs\/([^/]+)\/?$/, 'club'],
  [/^\/u\/([^/]+)\/?$/, 'profile'],
  [/^\/sessions\/([^/]+)\/?$/, 'session'],
];

/**
 * What a share URL points at.
 * @returns {{ type: string, key: string }}  type is one of SHARE_ENTITY_TYPES
 */
export function entityFromShareUrl(url) {
  let path = '/';
  try { path = new URL(url).pathname; } catch { /* fall through to site */ }
  for (const [re, type] of ENTITY_ROUTES) {
    const m = path.match(re);
    if (m) {
      let key = m[1];
      try { key = decodeURIComponent(key); } catch { /* keep raw */ }
      return { type, key: key.slice(0, 200) };
    }
  }
  return { type: 'site', key: path.slice(0, 200) || '/' };
}

/** A token and the tagged URL for one share action. */
export function prepareShare(url) {
  const token = newShareToken();
  return { token, url: withShareToken(url, token), baseUrl: url };
}

function enabled() {
  if (typeof window === 'undefined') return false;
  if (!trackingAllowed()) return false;
  try { return !isLikelyBot(navigator.userAgent, navigator.webdriver); } catch { return false; }
}

function currentLocale() {
  try {
    const l = (localStorage.getItem('oracle.lang') || document.documentElement.lang || '').slice(0, 2);
    return l === 'en' || l === 'es' ? l : null;
  } catch { return null; }
}

const recorded = new Set();

/**
 * Register a share once it has happened. Same token twice is a no-op here and
 * in the database.
 * @param {{ token: string, baseUrl: string }} prep  from prepareShare()
 * @param {string} channel  one of SHARE_CHANNELS
 * @param {string} [surface]  one of SHARE_SURFACES
 */
export function recordShare(prep, channel, surface = 'page') {
  if (!prep || !TOKEN_RE.test(prep.token || '')) return;
  if (!SHARE_CHANNELS.includes(channel) || !SHARE_SURFACES.includes(surface)) return;
  if (recorded.has(prep.token) || !enabled()) return;
  recorded.add(prep.token);
  const { type, key } = entityFromShareUrl(prep.baseUrl);
  (async () => {
    try {
      const { error } = await supabase.rpc('log_share', {
        p_id: prep.token,
        p_entity_type: type,
        p_entity_key: key,
        p_channel: channel,
        p_surface: surface,
        p_locale: currentLocale(),
      });
      if (error && import.meta.env?.DEV) console.warn('log_share:', error.message);
    } catch { /* instrumentation never surfaces */ }
  })();
}

// ── Arriving through a shared link ───────────────────────────────────────────

let incoming = null;       // token read from this page load's URL
let incomingRef = null;    // referrer host captured at the same moment
let clickReported = false;

/** The host of a referrer URL, lower-cased, or null. Never the path or query. */
export function referrerHost(referrer) {
  try {
    const h = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,100}$/.test(h) ? h : null;
  } catch { return null; }
}

/**
 * Read ?s= from the address and take it out again, before the router reads the
 * URL. Out of the address bar, a refresh, a bookmark or a re-share doesn't
 * carry someone else's token. Call once, at boot (src/main.jsx).
 * @returns {string|null} the token, when there was a valid one
 */
export function captureIncomingShare() {
  if (typeof window === 'undefined') return null;
  try {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get(SHARE_PARAM);
    if (raw === null) return null;
    u.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    if (!TOKEN_RE.test(raw)) return null;
    incoming = raw;
    incomingRef = referrerHost(document.referrer);
    return raw;
  } catch { return null; }
}

/** The token this page load arrived with, or null. */
export function incomingShareToken() {
  return incoming;
}

/**
 * Count the visit. Once per page load, after the auth check, so `signed_in` is
 * known. The server drops it when the visitor is the sharer.
 * @param {boolean} signedIn
 */
export function reportIncomingShareClick(signedIn) {
  if (!incoming || clickReported || !enabled()) return;
  clickReported = true;
  const token = incoming;
  (async () => {
    try {
      const { error } = await supabase.rpc('log_share_hit', {
        p_share: token,
        p_kind: 'click',
        p_ref_host: incomingRef,
        p_signed_in: !!signedIn,
      });
      if (error && import.meta.env?.DEV) console.warn('log_share_hit:', error.message);
    } catch { /* instrumentation never surfaces */ }
  })();
}

// Test hook — module state is per page load in the browser, per file in tests.
export function _resetForTests() {
  incoming = null; incomingRef = null; clickReported = false; recorded.clear();
}
