/* global __APP_VERSION__ */
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
//
// v0.56: that mechanism has a blind spot. It hangs off needRefresh, which only
// goes true once THIS tab has observed a new SW reach the waiting state. A
// returning visitor is served the precached old index.html and old chunks
// immediately, and if they leave before the SW update check completes they
// never see the new build at all — no toast, no auto-update, nothing. That was
// the landing-page report: the affected users were first-time-in-a-while
// visitors, i.e. exactly the population needRefresh cannot describe.
//
// So there are now two independent paths, and they own different cases:
//   1. needRefresh (unchanged, below) — this tab has been open and watched a
//      new SW arrive. Normal deploys show the dismissible toast; critical ones
//      auto-apply. This is the path for people already sitting on the site.
//   2. version poll (this block) — compare the version this bundle was BUILT
//      with against the version currently deployed, on mount and whenever the
//      tab becomes visible. Catches stale clients on arrival and on resume
//      (incl. iOS home-screen installs waking from suspension), which is the
//      case path 1 structurally cannot reach.
// Path 2 only ever acts when critical is set, so ordinary deploys still never
// reload anyone mid-session — the v0.45 constraint that produced 'prompt'.
const UPDATE_CHECK_INTERVAL = 60 * 1000; // how often open tabs check for a new SW

// Guard against a reload loop. If the deployed version is genuinely ahead but
// this client can't actually get it — SW refuses to activate, CDN edge still
// serving old chunks, whatever — an unguarded force-reload would spin forever,
// on the landing page, for logged-out visitors. One attempt per tab session is
// enough to fix the real case and cannot loop in the broken one.
const FORCED_KEY = 'pwa:forced-version';

async function forceUpdateTo(version, updateServiceWorker) {
  try {
    if (sessionStorage.getItem(FORCED_KEY) === version) return; // already tried this tab
    sessionStorage.setItem(FORCED_KEY, version);
  } catch {
    return; // sessionStorage unavailable (Safari private mode) → don't risk an unguarded loop
  }

  // Same reasoning as the needRefresh path: let any in-flight Supabase token
  // refresh settle first, so a forced reload can't race single-use refresh
  // token rotation and drop the session.
  try {
    await supabase.auth.getSession();
  } catch {
    // ignore — proceed with the update regardless
  }

  const registration = await navigator.serviceWorker?.getRegistration();

  // Ask for the newest SW before deciding how to apply it — on a cold arrival
  // the new worker usually isn't waiting yet, which is precisely why the
  // needRefresh path hadn't fired.
  try {
    await registration?.update();
  } catch {
    // ignore — fall through to the reload below
  }

  if (registration?.waiting) {
    updateServiceWorker(true); // posts SKIP_WAITING and reloads on controllerchange
    return;
  }

  // No waiting worker: the stale bytes are in the precache, not in a pending
  // SW. Drop the caches and reload so the next fetch goes to the network.
  // location.reload() alone is not enough — it does not bypass the SW.
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // ignore — reload anyway
  }
  window.location.reload();
}

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

  // Path 2: version poll. Independent of needRefresh by design — see header.
  useEffect(() => {
    let cancelled = false;

    async function checkVersion() {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/app-version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const { version, critical } = await res.json();
        if (cancelled || !critical || !version) return;
        // 'unknown' means the build couldn't read the version file; treat it as
        // "can't tell" rather than "stale", so we never reload on a guess.
        if (__APP_VERSION__ === 'unknown' || version === __APP_VERSION__) return;
        setForcing(true);
        await forceUpdateTo(version, updateServiceWorker);
      } catch {
        // Version file unreachable → stay on the current build, same as path 1.
      }
    }

    checkVersion();
    document.addEventListener('visibilitychange', checkVersion);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', checkVersion);
    };
  }, [updateServiceWorker]);

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

  // `forcing` can be true with needRefresh still false — that's path 2 acting on
  // a stale client that never observed a waiting SW. Render the updating notice
  // in that case too, so a forced reload isn't visually silent.
  if (!needRefresh && !forcing) return null;

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
