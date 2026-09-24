// src/lib/webgl.js — one answer to "should this device get a WebGL scene?"
//
// Every three.js surface in the app (landing star field, Oracle wait spread,
// reader constellation) is an ENHANCEMENT over a DOM version that already
// works. So the gate is conservative: when in doubt, keep the DOM.
//
// Refused when:
//   - the reader asked for reduced motion
//   - Save-Data is on, or the device reports < 3 GB of memory
//   - no WebGL context can be created
//   - the context is a software rasteriser (SwiftShader / llvmpipe), which
//     would render the scene at a few frames per second
//   - `?gl=0` is in the URL — a manual kill switch, handy for comparing the
//     fallback side by side without touching OS settings.
// `?gl=1` forces it on (skipping the software-GL and memory checks, not the
// reduced-motion one) — for headless screenshots and old-laptop testing.

let cached;

export function canUseWebGL() {
  if (cached !== undefined) return cached;
  cached = detect();
  return cached;
}

function detect() {
  try {
    if (typeof window === 'undefined') return false;
    const flag = new URLSearchParams(window.location.search).get('gl');
    if (flag === '0') return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const force = flag === '1';
    const conn = navigator.connection;
    if (!force && conn?.saveData) return false;
    if (!force && navigator.deviceMemory && navigator.deviceMemory < 3) return false;

    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (!force && /swiftshader|llvmpipe|software/i.test(renderer)) return false;
    return true;
  } catch {
    return false;
  }
}

// Read an `r, g, b` channel triplet custom property (the --lps-*-rgb / --ro-*
// convention) as 0–1 floats. Falls back to the ink-palette gold.
export function readRgbVar(name, el = document.body, fallback = [201, 162, 75]) {
  try {
    const raw = getComputedStyle(el).getPropertyValue(name).trim();
    const parts = raw.split(',').map((s) => parseFloat(s));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return parts.slice(0, 3).map((n) => n / 255);
    }
  } catch { /* fall through */ }
  return fallback.map((n) => n / 255);
}

// Read any CSS colour custom property (hex, rgb(), named) as 0–1 floats by
// letting the browser resolve it.
export function readColorVar(name, el = document.body, fallback = [0.79, 0.64, 0.29]) {
  try {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    probe.style.display = 'none';
    el.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = rgb.match(/[\d.]+/g);
    if (m && m.length >= 3) return m.slice(0, 3).map((n) => Number(n) / 255);
  } catch { /* fall through */ }
  return fallback;
}

export function isParchment() {
  return typeof document !== 'undefined' && document.body.classList.contains('theme-parchment');
}

// Calls `fn` whenever ThemeContext swaps the body class. Returns a disposer.
export function onThemeChange(fn) {
  if (typeof MutationObserver === 'undefined') return () => {};
  const mo = new MutationObserver(() => fn(isParchment()));
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

// Run once the main thread is quiet — WebGL chunks never compete with first
// paint. Returns a cancel function.
export function whenIdle(fn, timeout = 1500) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 400);
  return () => clearTimeout(id);
}
