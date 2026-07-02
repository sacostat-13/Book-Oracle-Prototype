import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const RouterContext = createContext(null);

// Routes that are valid landing targets via hash. Unknown hashes fall back to dashboard.
const KNOWN_ROUTES = new Set([
  'dashboard',
  'wishlist',
  'library',
  'read-next',
  'currently-reading',
  'profile',
  'friend-profile',
  'about',
  'oracle',
  'oracle-categories',
  'oracle-similar',
  'plan-create',
  'plan-list',
  'plan-view',
  'book-page',
  'series-page',
  'lists',
  'list-detail',
  'list-view',
  // v0.28: book clubs
  'book-clubs',
  'book-club-create',
  'book-club-detail',
  'session-create',
  'session-detail',
  'join-club',
]);

function parseHash() {
  if (typeof window === 'undefined') return { name: 'dashboard', params: {} };

  // Handle pathname-based friend profile URLs: /u/:username
  // These are shared links that land directly on the path without a hash.
  const pathMatch = window.location.pathname.match(/^\/u\/([a-z0-9_-]{3,24})$/i);
  if (pathMatch) {
    return { name: 'friend-profile', params: { username: pathMatch[1].toLowerCase() } };
  }

  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw) return { name: 'dashboard', params: {} };
  const [name, qs] = raw.split('?');
  const params = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }
  return { name: KNOWN_ROUTES.has(name) ? name : 'dashboard', params };
}

// push=true creates a real browser history entry (back button works).
// push=false (default) silently syncs the URL without stacking history.
function writeHash(name, params, push = false) {
  if (typeof window === 'undefined') return;
  // dashboard is the implicit root — clear the hash, always replace
  if (name === 'dashboard' && Object.keys(params || {}).length === 0) {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return;
  }
  const qs = Object.entries(params || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const next = '#' + name + (qs ? '?' + qs : '');
  if (window.location.hash !== next) {
    if (push) {
      history.pushState(null, '', next);
    } else {
      history.replaceState(null, '', next);
    }
  }
}

export function RouterProvider({ children }) {
  const [route, setRouteState] = useState(parseHash);
  // Guard against the hashchange listener echoing our own writes
  const writingRef = useRef(false);

  const go = useCallback((name, params = {}) => {
    writingRef.current = true;
    setRouteState({ name, params });

    // Friend profile gets a clean pathname URL (/u/:username) so the link
    // is shareable and lands correctly when pasted into a new tab.
    if (name === 'friend-profile' && params.username) {
      history.pushState(null, '', `/u/${params.username}`);
    } else {
      writeHash(name, params, true);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { writingRef.current = false; }, 0);
  }, []);

  // React to browser back/forward (popstate) and to manually pasted URLs (hashchange).
  // pushState changes don't fire hashchange, so we need both listeners.
  useEffect(() => {
    function onNavigate() {
      if (writingRef.current) return;
      setRouteState(parseHash());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);
    return () => {
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('popstate', onNavigate);
    };
  }, []);

  return (
    <RouterContext.Provider value={{ route, go }}>
      {children}
    </RouterContext.Provider>
  );
}

export const useRouter = () => useContext(RouterContext);
