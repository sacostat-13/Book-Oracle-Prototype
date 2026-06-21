// src/lib/ThemeContext.jsx
// Theme switching — dark (default) and light modes.
// Mirrors the I18nContext pattern exactly: localStorage persistence,
// context + hook, toggler exposed for Nav to wire up.
//
// Applies [data-theme="light"] on <html>. All light-mode token overrides
// live in tokens.scss under that selector — no inline styles needed anywhere.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'oracle.theme';
const SUPPORTED   = ['dark', 'light'];

const ThemeContext = createContext(null);

function detectInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {}
  // Respect OS preference on first visit
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(detectInitialTheme);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch {}
    // data-theme on <html> is the single source of truth for CSS
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (SUPPORTED.includes(next)) setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((cur) => (cur === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
