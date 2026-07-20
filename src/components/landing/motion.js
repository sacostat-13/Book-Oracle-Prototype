// src/components/landing/motion.js
// Tiny shared helpers for the story landing's motion system. Kept out of the
// components so every scene answers "should I animate at all?" the same way.

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Tilt (and other hover-only flourishes) are pointless on touch — there is no
// hover. The breathing idle stays; the tilt goes.
export function hasHoverPointer() {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}
