// Install-to-home-screen support.
//
// Chrome/Edge/Samsung fire `beforeinstallprompt` ONCE, early, often before the
// Profile view has mounted. So the listener lives at module scope and this file
// is imported for its side effect from main.jsx; the hook just reads what was
// captured. iOS Safari has no install API at all — it gets instructions.

import { useEffect, useState } from 'react';

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports itself as Mac; touch support gives it away.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the mini-infobar quiet; we offer it in Profile
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

/**
 * status:
 *  'installed'   — already running as the installed app
 *  'available'   — native prompt captured; call install()
 *  'ios'         — iPhone/iPad: show Share → Add to Home Screen steps
 *  'unsupported' — browser offers no install path (e.g. Firefox desktop)
 */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  let status = 'unsupported';
  if (isStandalone()) status = 'installed';
  else if (deferredPrompt) status = 'available';
  else if (isIOS()) status = 'ios';

  const install = async () => {
    if (!deferredPrompt) return 'unavailable';
    const evt = deferredPrompt;
    evt.prompt();
    const { outcome } = await evt.userChoice; // 'accepted' | 'dismissed'
    deferredPrompt = null; // a prompt event can only be used once
    notify();
    return outcome;
  };

  return { status, install };
}
