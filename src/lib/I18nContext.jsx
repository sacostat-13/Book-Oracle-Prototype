// src/lib/I18nContext.jsx — v0.38
// Pontoon-style i18n: keys are complete semantic ideas; values may contain
// safe HTML (<b>, <em>, <span>, <br>) rendered by the <T> component.
// Plain t() still works for attribute strings and non-HTML values.
// Rich keys are rendered via <T k="myKey" vars={{}} /> or useRichT().

import {
  createContext, useContext, useEffect, useState, useCallback,
  createElement, Fragment, isValidElement,
} from 'react';
import en from '../i18n/en.json';
import es from '../i18n/es.json';

const CATALOGS  = { en, es };
const SUPPORTED = ['en', 'es'];
const STORAGE_KEY = 'oracle.lang';

// ── Language detection ────────────────────────────────────────────────────────
function detectInitialLang() {
  if (typeof window === 'undefined') return 'en';
  try {
    const params   = new URLSearchParams(window.location.search);
    const fromUrl  = params.get('lang');
    if (fromUrl && SUPPORTED.includes(fromUrl.toLowerCase())) return fromUrl.toLowerCase();
  } catch {}
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {}
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('es') ? 'es' : 'en';
}

function syncLangParam(lang) {
  if (typeof window === 'undefined') return;
  try {
    const hash = window.location.hash;
    const url  = new URL(window.location.origin + window.location.pathname + window.location.search);
    if (url.searchParams.get('lang') === lang) return;
    url.searchParams.set('lang', lang);
    window.history.replaceState(null, '', url.toString() + hash);
  } catch {}
}

// ── Key resolver ──────────────────────────────────────────────────────────────
function resolveKey(catalog, key) {
  const parts = key.split('.');
  let cur = catalog;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return null;
  }
  return typeof cur === 'string' ? cur : null;
}

// ── Plain {var} interpolation (for non-HTML strings) ─────────────────────────
function interpolatePlain(template, vars) {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

// Same as interpolatePlain, but if any var is a real React element (e.g. an
// <a> passed in for a "click here" link), it's spliced in as an actual child
// node instead of being coerced to the string "[object Object]".
function interpolateNode(template, vars) {
  if (!vars) return template;
  const hasElementVar = Object.values(vars).some((v) => isValidElement(v));
  if (!hasElementVar) return interpolatePlain(template, vars);

  const parts = template.split(/\{([a-zA-Z0-9_]+)\}/g);
  const nodes = parts.map((part, i) => (
    i % 2 === 0 ? part : (part in vars ? vars[part] : `{${part}}`)
  ));
  return createElement(Fragment, null, ...nodes);
}

// ── Safe HTML renderer ────────────────────────────────────────────────────────
// Parses a string that may contain simple HTML tags into React nodes.
// Allowed tags: b, strong, em, i, span, br, code, small.
// Variable substitution {name} is applied to text nodes before parsing.
// This is intentionally NOT a full HTML parser — only the tags above.

const ALLOWED_TAGS = new Set(['b','strong','em','i','span','br','code','small','u']);

function htmlToReact(html, vars) {
  // Substitute vars in the raw string. Primitive values (strings/numbers)
  // are inlined directly, same as before. A React element passed as a var
  // (e.g. a clickable <a>{...}</a> built by the caller) is swapped in via a
  // unique sentinel instead of String(v) — otherwise it silently rendered
  // as the text "[object Object]" once the surrounding HTML was parsed.
  const elementVars = {};
  let substituted = html;
  if (vars) {
    substituted = html.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, k) => {
      if (!(k in vars)) return match;
      const v = vars[k];
      if (isValidElement(v)) {
        const sentinel = `\u0000${k}\u0000`;
        elementVars[sentinel] = v;
        return sentinel;
      }
      return String(v);
    });
  }
  const hasElementVars = Object.keys(elementVars).length > 0;

  // Tokenize into text + tag segments
  const tokens = substituted.split(/(<[^>]+>)/g);
  const stack  = [{ tag: null, children: [] }];

  for (const token of tokens) {
    if (!token) continue;
    const closeMatch = token.match(/^<\/([a-zA-Z]+)>$/);
    const openMatch  = token.match(/^<([a-zA-Z]+)([^>]*)>$/);
    const selfClose  = token.match(/^<([a-zA-Z]+)[^>]*\/>$/);

    if (selfClose && selfClose[1] === 'br') {
      stack[stack.length - 1].children.push(createElement('br'));
    } else if (openMatch && ALLOWED_TAGS.has(openMatch[1].toLowerCase())) {
      const tag   = openMatch[1].toLowerCase();
      const attrs = {};
      // extract class="..." → className
      const classMatch = openMatch[2].match(/class="([^"]*)"/);
      if (classMatch) attrs.className = classMatch[1];
      stack.push({ tag, attrs, children: [] });
    } else if (closeMatch && ALLOWED_TAGS.has(closeMatch[1].toLowerCase())) {
      if (stack.length > 1) {
        const { tag, attrs, children } = stack.pop();
        const el = createElement(tag, { key: Math.random(), ...attrs }, ...children);
        stack[stack.length - 1].children.push(el);
      }
    } else if (hasElementVars && token.includes('\u0000')) {
      // Text segment containing one or more element-var sentinels — split
      // it apart so the real element gets pushed as a child, not text.
      const bits = token.split(/(\u0000[a-zA-Z0-9_]+\u0000)/g);
      for (const bit of bits) {
        if (bit === '') continue;
        if (elementVars[bit] !== undefined) stack[stack.length - 1].children.push(elementVars[bit]);
        else stack[stack.length - 1].children.push(bit);
      }
    } else {
      // Plain text (may contain unrecognised tags — render as-is)
      stack[stack.length - 1].children.push(token);
    }
  }

  // Drain any unclosed tags back to root
  while (stack.length > 1) {
    const { tag, attrs, children } = stack.pop();
    stack[stack.length - 1].children.push(createElement(tag, { key: Math.random(), ...attrs }, ...children));
  }

  const root = stack[0].children;
  if (root.length === 0) return '';
  if (root.length === 1 && typeof root[0] === 'string') return root[0];
  return createElement(Fragment, null, ...root);
}

// Returns true if a resolved string contains HTML tags
function containsHTML(str) {
  return /<[a-zA-Z]/.test(str);
}

// ── Context ───────────────────────────────────────────────────────────────────
const I18nContext = createContext(null);

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

  // t() — returns a plain string (strips HTML, interpolates vars).
  // Use for: aria-labels, title attributes, non-rendered strings.
  const t = useCallback((key, vars) => {
    const catalog  = CATALOGS[lang] || CATALOGS.en;
    const resolved = resolveKey(catalog, key) ?? resolveKey(CATALOGS.en, key) ?? key;
    const plain    = resolved.replace(/<[^>]+>/g, ''); // strip tags for plain usage
    return interpolatePlain(plain, vars);
  }, [lang]);

  // tNode() — returns a React node (renders HTML tags, interpolates vars).
  // Use for: h1, p, span — anywhere the value may contain markup.
  const tNode = useCallback((key, vars) => {
    const catalog  = CATALOGS[lang] || CATALOGS.en;
    const resolved = resolveKey(catalog, key) ?? resolveKey(CATALOGS.en, key) ?? key;
    if (!containsHTML(resolved)) return interpolateNode(resolved, vars);
    return htmlToReact(resolved, vars);
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t, tNode }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

// Convenience hooks
export function useT()     { return useI18n().t; }
export function useTNode() { return useI18n().tNode; }

// <T k="some.key" vars={{count: 3}} /> — renders rich or plain transparently
export function T({ k, vars }) {
  const { tNode } = useI18n();
  return tNode(k, vars);
}

export function langDirective(lang) {
  return lang === 'es'
    ? 'Respond in Spanish (Latin American Spanish where possible).'
    : 'Respond in English.';
}
