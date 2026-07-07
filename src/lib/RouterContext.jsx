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
  { name: 'friend-profile',    path: '/u/:username' },
  { name: 'book-page',         path: '/book/:bookKey' },
  { name: 'series-page',       path: '/series/:seriesName' },
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
  { name: 'oracle',             path: '/oracle' },
  { name: 'oracle-categories',  path: '/oracle/categories' },
  { name: 'oracle-similar',     path: '/oracle/similar' },
  { name: 'plan-create',        path: '/plans/new' },
  { name: 'plan-list',          path: '/plans' },
  { name: 'lists',              path: '/lists' },
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
    .filter(([k]) => !usedKeys.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return path + (qs ? '?' + qs : '');
}

export function RouterProvider({ children }) {
  const [route, setRouteState] = useState(parseLocation);
  // Guard against the popstate listener echoing our own writes
  const writingRef = useRef(false);

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
