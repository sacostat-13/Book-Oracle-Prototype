// src/lib/coverMorph.js — the cover-to-page morph (three.js-motion experiment,
// though it needs no three.js: it is the browser's View Transitions API).
//
// When a navigation to a Book Page starts from a click on (or near) a book
// cover, that cover is snapshotted, the route changes, and the browser
// animates the snapshot into the Book Page's hero cover while the rest of the
// page cross-fades. Everything else navigates exactly as before.
//
// How the source is found without threading refs through ~25 call sites:
// BookCover marks its root with `data-cover`, and a capture-phase pointerdown
// listener remembers what was last pressed. From there we climb a few
// ancestors looking for exactly one cover — a card, a row, a grid cell. If a
// container holds more than one before a single one is found, the press was
// not on a specific book and we don't guess.
//
// Skipped when: no View Transitions support (Firefox < 144, older Safari),
// reduced motion, no source cover, or the press was more than 2 s ago.
import { flushSync } from 'react-dom';

const NAME = 'book-cover';
let lastTarget = null;
let lastAt = 0;

if (typeof document !== 'undefined') {
  const remember = (e) => { lastTarget = e.target; lastAt = performance.now(); };
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { lastTarget = document.activeElement; lastAt = performance.now(); }
  }, true);
}

function onScreen(el) {
  const r = el.getBoundingClientRect();
  return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < window.innerHeight;
}

function findSourceCover() {
  if (!lastTarget?.isConnected || performance.now() - lastAt > 2000) return null;
  const direct = lastTarget.closest?.('[data-cover]');
  if (direct) return onScreen(direct) ? direct : null;
  let el = lastTarget;
  for (let depth = 0; el && depth < 7; depth++, el = el.parentElement) {
    const found = el.querySelectorAll?.('[data-cover]');
    if (!found?.length) continue;
    if (found.length > 1) return null;
    return onScreen(found[0]) ? found[0] : null;
  }
  return null;
}

function waitFor(get, ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const el = get();
      if (el || performance.now() - t0 > ms) resolve(el || null);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const destCover = () => {
  const el = document.querySelector('.bp-cover-col [data-cover]');
  // Wait for the real image when there is one, so the morph lands on a cover
  // and not on an empty box that fills in afterwards.
  if (el && el.tagName === 'IMG' && !el.complete) return null;
  return el;
};

/**
 * Run `update` (a synchronous React state change) inside a view transition
 * when a cover morph applies; otherwise just run it. Returns true when the
 * morph ran, so the caller can skip its own smooth scroll.
 */
export function navigateWithMorph(update, { toBookPage }) {
  if (!toBookPage || typeof document === 'undefined' || !document.startViewTransition) return (update(), false);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return (update(), false);
  const src = findSourceCover();
  if (!src) return (update(), false);

  lastTarget = null;
  src.style.viewTransitionName = NAME;
  let dest = null;
  try {
    const vt = document.startViewTransition(async () => {
      src.style.viewTransitionName = '';
      flushSync(update);
      window.scrollTo(0, 0);
      dest = await waitFor(destCover, 450);
      if (dest) dest.style.viewTransitionName = NAME;
    });
    const clear = () => {
      if (dest) dest.style.viewTransitionName = '';
      src.style.viewTransitionName = '';
    };
    vt.finished.then(clear, clear);
    return true;
  } catch {
    src.style.viewTransitionName = '';
    update();
    return false;
  }
}
