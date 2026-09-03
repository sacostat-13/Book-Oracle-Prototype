import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const RouterContext = createContext(null);

// v0.39: path-based routing (replaces hash routing for SEO — real paths are
// crawlable, shareable, and support per-route <title>/meta/canonical tags,
// none of which are reliably visible to crawlers behind a `#`).
//
// Routes with a natural primary identifier get a pretty dynamic segment
// (e.g. /book/:bookKey). Everything else is a static path. Any params NOT
// consumed by the path template (from, fromLabel, anchor, snap, preview,
// prefillTitle, etc.) are carried as a query string exactly as before —
// only the mechanism for turning { name, params } into a URL changed, not
// the params contract consumed by the ~15 views that call useRouter().
//
// Order doesn't matter for correctness: static paths are matched via an
// exact-match table first, dynamic patterns second, so e.g. `/clubs/new`
// can never be misread as `/clubs/:clubId` with clubId === 'new'.
const ROUTE_DEFS = [
  // ── Dynamic (SEO-relevant / shareable primary-id routes) ──────────────────
  { name: 'reader-profile',    path: '/u/:username' },
  { name: 'book-page',         path: '/book/:bookKey' },
  { name: 'series-page',       path: '/series/:seriesName' },
  // v0.67 — the genre surface. /genres is the sixteen-family index, and both
  // dynamic routes below are public and prerendered: until now the app had NO
  // genre URL at all, so 167 genres were unreachable to a reader and invisible
  // to a crawler.
  { name: 'family-page',       path: '/genres/:familySlug' },
  { name: 'genre-page',        path: '/genre/:genreSlug' },
  { name: 'plan-view',         path: '/plans/:planId' },
  { name: 'list-view',         path: '/l/:listId' },          // public share link
  { name: 'list-detail',       path: '/lists/:listId' },      // owner management view
  { name: 'session-create',    path: '/clubs/:clubId/sessions/new' },
  { name: 'book-club-detail',  path: '/clubs/:clubId' },
  { name: 'session-detail',    path: '/sessions/:sessionId' },
  { name: 'join-club',         path: '/join/:token' },

  // ── Static ─────────────────────────────────────────────────────────────
  { name: 'dashboard',          path: '/' },
  { name: 'wishlist',           path: '/wishlist' },
  { name: 'library',            path: '/library' },
  { name: 'read-next',          path: '/read-next' },
  { name: 'currently-reading',  path: '/currently-reading' },
  { name: 'profile',            path: '/profile' },
  { name: 'about',              path: '/about' },
  { name: 'changelog',          path: '/changelog' },
  { name: 'stacks',             path: '/stacks' },
  { name: 'genres-index',       path: '/genres' },
  { name: 'oracle',             path: '/oracle' },
  { name: 'oracle-categories',  path: '/oracle/categories' },
  { name: 'oracle-similar',     path: '/oracle/similar' },
  { name: 'oracle-ask',         path: '/oracle/ask' },
  { name: 'plan-create',        path: '/plans/new' },
  { name: 'plan-list',          path: '/plans' },
  { name: 'lists',              path: '/lists' },
  // v0.63 — Curated Lists split into three. `lists` is the landing page (what
  // you follow + a way in), `lists-mine` is the management view, and
  // `lists-discover` is the public directory. Static paths are matched before
  // dynamic ones, so neither of these can be swallowed by `/lists/:listId`.
  { name: 'lists-mine',         path: '/lists/mine' },
  { name: 'lists-discover',     path: '/lists/discover' },
  { name: 'kindred',            path: '/kindred' },
  { name: 'book-clubs',         path: '/clubs' },
  { name: 'club-directory',     path: '/clubs/discover' },
  { name: 'book-club-create',   path: '/clubs/new' },
  { name: 'privacy',            path: '/privacy' },
  { name: 'terms',              path: '/terms' },
  { name: 'refund',             path: '/refund' },
  { name: 'sitemap',             path: '/sitemap' }, // human-readable page — distinct from the /sitemap.xml function
];

const STATIC_BY_PATH = new Map();
const STATIC_BY_NAME = new Map();
const DYNAMIC_DEFS = []; // { name, segments: [{ literal? , param? }] }

for (const def of ROUTE_DEFS) {
  const segments = def.path.split('/').filter(Boolean).map((seg) =>
    seg.startsWith(':') ? { param: seg.slice(1) } : { literal: seg }
  );
  const isDynamic = segments.some((s) => s.param);
  if (isDynamic) {
    DYNAMIC_DEFS.push({ name: def.name, segments });
  } else {
    STATIC_BY_PATH.set(def.path, def.name);
    STATIC_BY_NAME.set(def.name, def.path);
  }
}

function matchDynamic(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const def of DYNAMIC_DEFS) {
    if (def.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = def.segments[i];
      if (seg.literal) {
        if (seg.literal !== parts[i]) { ok = false; break; }
      } else {
        params[seg.param] = decodeURIComponent(parts[i]);
      }
    }
    if (ok) return { name: def.name, params };
  }
  return null;
}

function parseQuery(search) {
  const params = {};
  const qs = (search || '').replace(/^\?/, '');
  if (!qs) return params;
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return params;
}

// v0.39: one-time migration for old hash-based links (`#/book-page?bookKey=..`)
// that may still be bookmarked, shared, or indexed from before the switch to
// path routing. Rewrites the hash into the new path shape via replaceState
// so the URL bar and browser history reflect the real, permanent route.
function migrateLegacyHash() {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (!raw) return null;
  const [rawName, qs] = raw.split('?');
  const [routeName, anchor] = rawName.split('&');
  const def = ROUTE_DEFS.find((d) => d.name === routeName);
  if (!def) return null;
  const params = parseQuery(qs);
  if (anchor) params.anchor = anchor;
  const path = buildPath(routeName, params);
  if (path) {
    history.replaceState(null, '', path);
    return { name: routeName, params };
  }
  return null;
}

function parseLocation() {
  if (typeof window === 'undefined') return { name: 'dashboard', params: {} };

  const migrated = migrateLegacyHash();
  if (migrated) return migrated;

  const pathname = window.location.pathname;
  const queryParams = parseQuery(window.location.search);

  if (STATIC_BY_PATH.has(pathname)) {
    return { name: STATIC_BY_PATH.get(pathname), params: queryParams };
  }
  // Tolerate a trailing slash on otherwise-static paths.
  if (pathname.length > 1 && pathname.endsWith('/') && STATIC_BY_PATH.has(pathname.slice(0, -1))) {
    return { name: STATIC_BY_PATH.get(pathname.slice(0, -1)), params: queryParams };
  }

  const dynamicMatch = matchDynamic(pathname);
  if (dynamicMatch) {
    return { name: dynamicMatch.name, params: { ...dynamicMatch.params, ...queryParams } };
  }

  // v0.39: unmatched paths get a real 404 view (with a noindex tag) instead
  // of silently rendering the dashboard — that used to make broken/old
  // links look like they worked, which is bad for both users and crawlers.
  return { name: 'not-found', params: { path: pathname } };
}

// Builds a real path + query string for { name, params }. Params consumed by
// the path template are substituted in; everything else becomes a query
// string, same as the old hash router's behavior.
// ── Transient params — v0.67 ─────────────────────────────────────────────────
//
// Route params come in two kinds and, until now, both were serialised into the
// query string by buildPath().
//
//   ADDRESSABLE — describes WHICH page this is, and must survive a reload,
//   a bookmark, a paste into Slack: `tab`, `anchor`, `auth`, `scrollTo`, `lang`.
//
//   TRANSIENT — an in-app handoff between two views. `snap` is a base64 blob of
//   the whole book so BookPage can paint before its fetch returns; `from` and
//   `fromLabel` are the back-breadcrumb; `plan` is an entire plan object.
//
// Serialising the second kind produced URLs like
//
//   /book/galahadandthegrail%7Cmalcolmgui?from=app&snap=JTdCJTIyYm9va0lkJTIy…
//                                                       …600 more characters
//
// which is what a reader copies when they mean to share a book. It also invites
// Google to treat every entry path to the same book as a different document —
// with 3,742 book URLs already sitting in "Discovered – currently not indexed",
// multiplying them is the last thing this catalogue needs.
//
// These stay in `route.params` — every consumer keeps working on the click that
// set them — they are simply never written to the address bar. On a reload they
// are gone, which is correct and already handled: BookPage checks
// `route.params?.snap` and fetches when it is absent, because /book/:key has
// always been a public shareable URL that arrives without one.
const TRANSIENT_PARAMS = new Set([
  'snap',
  'from',
  'fromLabel',
  'plan',
  'prefillTitle',
  'prefillAuthor',
]);

function buildPath(name, params) {
  const dynamicDef = DYNAMIC_DEFS.find((d) => d.name === name);
  const staticPath = STATIC_BY_NAME.get(name);
  const usedKeys = new Set();
  let path;

  if (dynamicDef) {
    // If a required param is missing (e.g. go('plan-view') fired before an
    // id is known yet), don't write a broken '/plans/undefined' into the
    // address bar — the view still renders fine from React state either
    // way; skip the URL update rather than produce a bad, bookmarkable URL.
    const hasAllParams = dynamicDef.segments.every((seg) => seg.literal || (params?.[seg.param] != null && params[seg.param] !== ''));
    if (!hasAllParams) return null;
    path = '/' + dynamicDef.segments.map((seg) => {
      if (seg.literal) return seg.literal;
      usedKeys.add(seg.param);
      return encodeURIComponent(params[seg.param]);
    }).join('/');
  } else if (staticPath) {
    path = staticPath;
  } else {
    return null; // unknown route name
  }

  const qs = Object.entries(params || {})
    .filter(([k, v]) => !usedKeys.has(k) && !TRANSIENT_PARAMS.has(k) && v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return path + (qs ? '?' + qs : '');
}

export function RouterProvider({ children }) {
  const [route, setRouteState] = useState(parseLocation);
  // Guard against the popstate listener echoing our own writes
  const writingRef = useRef(false);

  // Scrub transient params out of an address bar that already has them.
  //
  // buildPath() stops NEW ones being written, but every link shared before this
  // shipped — and every back-button return to a history entry written before
  // it — still carries `?from=app&snap=…`. Rewriting once on mount means what
  // the reader copies is clean even when what they opened was not.
  //
  // replaceState, not pushState: this is a correction to the current entry, not
  // a navigation, and it must not put a back-button step between the reader and
  // wherever they came from. It runs AFTER parseLocation has already read the
  // params into state, so a snap that arrived in the URL still paints this view
  // before it disappears from the bar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const current = new URLSearchParams(window.location.search);
    let dirty = false;
    for (const k of TRANSIENT_PARAMS) {
      if (current.has(k)) { current.delete(k); dirty = true; }
    }
    if (!dirty) return;
    const qs = current.toString();
    window.history.replaceState(
      null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    );
  }, []);

  const go = useCallback((name, params = {}) => {
    writingRef.current = true;
    setRouteState({ name, params });

    // Preserve ?lang=xx across navigations — I18nContext manages it
    // independently of route params, and buildPath() rebuilds the full
    // query string per navigation, so it would otherwise be dropped.
    let effectiveParams = params;
    try {
      const currentLang = new URLSearchParams(window.location.search).get('lang');
      if (currentLang && !('lang' in params)) {
        effectiveParams = { ...params, lang: currentLang };
      }
    } catch {}

    const url = buildPath(name, effectiveParams);
    if (url && url !== window.location.pathname + window.location.search) {
      history.pushState(null, '', url);
    } else if (!url && import.meta.env?.DEV) {
      // v0.62.2: buildPath() returns null when a dynamic route is missing a
      // segment param, and skipping the pushState is the right call — writing
      // '/book/undefined' into the address bar is worse than not writing
      // anything. But it failed SILENTLY, and the result is a view that
      // renders correctly while the URL still points at wherever the reader
      // came from. Back, refresh, copy-link and share all break, and nothing
      // anywhere says so.
      //
      // That is how NavSearch shipped go('book-page') with no bookKey and went
      // unnoticed until someone watched the address bar. Loud in dev, silent in
      // production — the user-facing behaviour is unchanged either way.
      console.warn(
        `[router] go('${name}') did not update the URL: the route needs a path ` +
        `param that wasn't provided. The view will render but back/refresh/share ` +
        `will be wrong. Params given: ${JSON.stringify(Object.keys(effectiveParams || {}))}`
      );
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { writingRef.current = false; }, 0);
  }, []);

  // React to browser back/forward and manually edited/pasted URLs.
  useEffect(() => {
    function onNavigate() {
      if (writingRef.current) return;
      setRouteState(parseLocation());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('popstate', onNavigate);
    return () => window.removeEventListener('popstate', onNavigate);
  }, []);

  return (
    <RouterContext.Provider value={{ route, go }}>
      {children}
    </RouterContext.Provider>
  );
}

export const useRouter = () => useContext(RouterContext);

// ── Crawlable links ──────────────────────────────────────────────────────────
//
// 2026-09-01. Every in-app navigation was an onClick handler on a <div> or a
// <button>. The app therefore emitted no <a href> at all: as of this change
// there were exactly three in src/, and all three pointed off-site (Wikipedia,
// purchase links, share intents). sitemap.js already called this out in a
// comment — "crawl priority follows internal links, and the app emits almost
// none" — while Search Console reported 2,316 book URLs as "Discovered –
// currently not indexed". Google had not fetched them because nothing linked
// to them; a sitemap is a hint, a link is a path.
//
// hrefFor() builds the CANONICAL url for a route: path params only. Everything
// else a view passes to go() — from, fromLabel, snap, anchor — is in-app state
// that must never reach an href, or one page would be advertised under a dozen
// distinct URLs. The rich params still go to go() on click via `navParams`, so
// breadcrumbs and instant-render snapshots behave exactly as before.
export function hrefFor(name, params = {}) {
  const dynamicDef = DYNAMIC_DEFS.find((d) => d.name === name);
  if (dynamicDef) {
    const segs = [];
    for (const seg of dynamicDef.segments) {
      if (seg.literal) { segs.push(seg.literal); continue; }
      const v = params?.[seg.param];
      // Same reasoning as buildPath(): no href at all beats '/book/undefined'.
      if (v == null || v === '') return null;
      segs.push(encodeURIComponent(v));
    }
    return '/' + segs.join('/');
  }
  return STATIC_BY_NAME.get(name) ?? null;
}

// A real anchor that still navigates client-side.
//
// `params`    → the path params, used to build the href (canonical URL).
// `navParams` → what go() receives on click; defaults to `params`. Use it for
//               the from/fromLabel/snap payloads that must stay out of the URL.
//
// Modified clicks (cmd/ctrl/shift/alt, middle button) fall through to the
// browser, so open-in-new-tab and copy-link-address work — which they never did
// on a <div onClick>. Falls back to a plain <span> if the href can't be built,
// rather than rendering a dead <a href="undefined">.
//
// NOTE ON STYLING: _reset.scss already sets `a { color: inherit;
// text-decoration: none; }`, so an element converted from <div>/<button> to
// <a> keeps its existing appearance with no SCSS change.
export function RouteLink({ to, params, navParams, children, onClick, ...rest }) {
  const { go } = useRouter();
  const href = hrefFor(to, params);

  if (!href) return <span {...rest}>{children}</span>;

  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        go(to, navParams ?? params ?? {});
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
