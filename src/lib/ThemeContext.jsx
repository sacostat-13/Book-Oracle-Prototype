// src/lib/ThemeContext.jsx
// Theme switching — dark (default) and parchment (light).
// Design system v1: applies `theme-dark` | `theme-parchment` class on <body>
// so the --ro-* CSS custom properties resolve from themes.css.
// Also sets data-theme on <html> for any remaining legacy selectors.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'oracle.theme';
const SUPPORTED   = ['dark', 'parchment'];

const ThemeContext = createContext(null);

function detectInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {}
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'parchment';
  return 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(detectInitialTheme);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch {}
    // Apply new design system class to body
    document.body.className = `theme-${theme}`;
    // Legacy data-theme for any remaining old selectors
    document.documentElement.setAttribute('data-theme', theme === 'parchment' ? 'light' : 'dark');
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (SUPPORTED.includes(next)) setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((cur) => (cur === 'dark' ? 'parchment' : 'dark'));
  }, []);

  // Expose 'light' alias for legacy Nav.jsx checks (theme === 'light')
  const themeAlias = theme === 'parchment' ? 'light' : 'dark';

  return (
    <ThemeContext.Provider value={{ theme: themeAlias, rawTheme: theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
