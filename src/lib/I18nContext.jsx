import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import en from '../i18n/en.json';
import es from '../i18n/es.json';

const CATALOGS = { en, es };
const SUPPORTED = ['en', 'es'];
const STORAGE_KEY = 'oracle.lang';

const I18nContext = createContext(null);

function detectInitialLang() {
  if (typeof window === 'undefined') return 'en';
  // 1. URL query param wins — for sharable links like ?lang=es
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('lang');
    if (fromUrl && SUPPORTED.includes(fromUrl.toLowerCase())) {
      return fromUrl.toLowerCase();
    }
  } catch {}
  // 2. Previously chosen language in localStorage
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {}
  // 3. Browser language
  const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  return nav.startsWith('es') ? 'es' : 'en';
}

// Keep the ?lang= query param in sync with current language, so the URL
// is always a faithful sharable link reflecting what the user is seeing.
function syncLangParam(lang) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const current = url.searchParams.get('lang');
    if (current === lang) return;
    url.searchParams.set('lang', lang);
    window.history.replaceState(null, '', url.toString());
  } catch {}
}

// Resolve "a.b.c" against a nested catalog. Returns the key itself if missing,
// so a missing translation is loud rather than silently empty.
function resolveKey(catalog, key) {
  const parts = key.split('.');
  let cur = catalog;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return null;
  }
  return typeof cur === 'string' ? cur : null;
}

// Simple {name} interpolation. Values can be strings or React nodes.
// If any value is a non-string, returns an array so React can render nodes inline.
function interpolate(template, vars) {
  if (!vars) return template;
  const parts = template.split(/(\{[a-zA-Z0-9_]+\})/g);
  const hasNode = Object.values(vars).some((v) => v !== null && typeof v === 'object');
  if (!hasNode) {
    return parts
      .map((p) => {
        const m = p.match(/^\{([a-zA-Z0-9_]+)\}$/);
        if (m && m[1] in vars) return String(vars[m[1]]);
        return p;
      })
      .join('');
  }
  return parts.map((p, i) => {
    const m = p.match(/^\{([a-zA-Z0-9_]+)\}$/);
    if (m && m[1] in vars) return <span key={i}>{vars[m[1]]}</span>;
    return p;
  });
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectInitialLang);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.lang = lang;
    } catch {}
    syncLangParam(lang);
  }, [lang]);

  const setLang = useCallback((next) => {
    if (SUPPORTED.includes(next)) setLangState(next);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((cur) => (cur === 'en' ? 'es' : 'en'));
  }, []);

  const t = useCallback(
    (key, vars) => {
      const catalog = CATALOGS[lang] || CATALOGS.en;
      const resolved = resolveKey(catalog, key) ?? resolveKey(CATALOGS.en, key) ?? key;
      return interpolate(resolved, vars);
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

// Convenience: just the t function
export function useT() {
  return useI18n().t;
}

// Convert app lang code to natural-language name for the Claude system prompt
export function langDirective(lang) {
  return lang === 'es'
    ? 'Respond in Spanish (Latin American Spanish where possible).'
    : 'Respond in English.';
}
