import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const RouterContext = createContext(null);

// Routes that are valid landing targets via hash. Unknown hashes fall back to dashboard.
const KNOWN_ROUTES = new Set([
  'dashboard',
  'wishlist',
  'library',
  'read-next',
  'profile',
  'about',
  'oracle',
  'oracle-categories',
  'oracle-similar',
  'plan-create',
  'plan-view',
]);

function parseHash() {
  if (typeof window === 'undefined') return { name: 'dashboard', params: {} };
  const raw = window.location.hash.replace(/^#/, '').trim();
  if (!raw) return { name: 'dashboard', params: {} };
  // Support "#about" and "#about?foo=bar" if ever needed
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

function writeHash(name, params) {
  if (typeof window === 'undefined') return;
  // dashboard is the implicit default — keep URLs clean
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
    history.replaceState(null, '', next);
  }
}

export function RouterProvider({ children }) {
  const [route, setRouteState] = useState(parseHash);
  // Guard against the hashchange listener echoing our own writes
  const writingRef = useRef(false);

  const go = useCallback((name, params = {}) => {
    writingRef.current = true;
    setRouteState({ name, params });
    writeHash(name, params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Release the guard on the next tick
    setTimeout(() => { writingRef.current = false; }, 0);
  }, []);

  // React to browser back/forward and to manually pasted URLs
  useEffect(() => {
    function onHashChange() {
      if (writingRef.current) return;
      setRouteState(parseHash());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <RouterContext.Provider value={{ route, go }}>
      {children}
    </RouterContext.Provider>
  );
}

export const useRouter = () => useContext(RouterContext);
