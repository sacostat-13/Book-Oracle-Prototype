import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

// Lightweight update toast. Paired with registerType: 'prompt' in vite.config.js.
//
// With 'prompt', a new deploy's service worker installs but WAITS instead of
// force-reloading the page. useRegisterSW surfaces that as needRefresh=true.
// Normal releases show a dismissible toast and only reload when the user clicks
// Refresh — this is what stopped the deploy-time reload storm that raced
// Supabase's token refresh and logged users out (see vite.config.js note).
//
// Critical hotfixes: flip "critical": true in public/app-version.json for that
// deploy. Open tabs poll for the new SW every UPDATE_CHECK_INTERVAL, and when a
// critical update is detected they apply it automatically (after letting any
// in-flight token refresh settle) instead of waiting for a click. Everything
// else stays a normal prompt.
const UPDATE_CHECK_INTERVAL = 60 * 1000; // how often open tabs check for a new SW

export default function PWAUpdatePrompt() {
  const t = useT();
  const [forcing, setForcing] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL);
      }
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    let cancelled = false;

    (async () => {
      let critical = false;
      try {
        const res = await fetch('/app-version.json', { cache: 'no-store' });
        if (res.ok) critical = !!(await res.json()).critical;
      } catch {
        // Version file unreachable → fall back to the safe default (prompt).
      }
      if (cancelled || !critical) return;

      setForcing(true);
      // Let Supabase settle any in-flight token refresh before reloading, so a
      // forced update can't race single-use refresh-token rotation and drop the
      // session — the exact failure 'prompt' was introduced to avoid.
      try {
        await supabase.auth.getSession();
      } catch {
        // ignore — proceed with the update regardless
      }
      if (!cancelled) updateServiceWorker(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [needRefresh, updateServiceWorker]);

  if (!needRefresh) return null;

  const wrap = {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    maxWidth: 'calc(100vw - 2rem)',
    padding: '0.6rem 0.75rem 0.6rem 1rem',
    borderRadius: '10px',
    border: '1px solid var(--ro-border, rgba(255,255,255,0.15))',
    background: 'var(--ro-field, #241b14)',
    color: 'var(--ro-text, #f3e9d8)',
    fontFamily: 'var(--ro-font-body, system-ui, sans-serif)',
    fontSize: '0.9rem',
    boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
  };
  const refreshBtn = {
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    padding: '0.4rem 0.85rem',
    borderRadius: '7px',
    border: '1px solid var(--ro-gold, #c9a24b)',
    background: 'var(--ro-gold, #c9a24b)',
    color: 'var(--ro-gold-on, #1a1410)',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
  };
  const dismissBtn = {
    cursor: 'pointer',
    lineHeight: 1,
    padding: '0.2rem 0.4rem',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontSize: '1.2rem',
    opacity: 0.7,
  };

  return (
    <div style={wrap} role="status" aria-live="polite">
      <span>{forcing ? t('pwa.updating') : t('pwa.updateAvailable')}</span>
      {!forcing && (
        <>
          <button style={refreshBtn} onClick={() => updateServiceWorker(true)}>
            {t('pwa.refresh')}
          </button>
          <button
            style={dismissBtn}
            onClick={() => setNeedRefresh(false)}
            aria-label={t('pwa.dismiss')}
            title={t('pwa.dismiss')}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
