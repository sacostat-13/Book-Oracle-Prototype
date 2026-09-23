// src/components/landing/sceneBus.js
// The one-way wire between Act I's GSAP timeline and the (optional, lazy)
// WebGL star field. ActSpread writes; the scene reads every frame. A plain
// mutable object on purpose: no React state, no re-renders, and when the
// WebGL layer never loads, writing to it costs nothing.
export const sceneBus = {
  progress: 0, // Act I pin progress, 0–1
  burstAt: 0,  // performance.now() of the reveal burst, 0 = none yet
};
