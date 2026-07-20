// src/components/landing/useCardTilt.js
// Pointer tilt + travelling glare for an OracleCard, on springy gsap.quickTo
// setters. Used by the Act I chosen card and the Epilogue claim card.
//
//   const tiltEnabled = useCardTilt(cardRef, { listenRef: stageRef });
//   ...later: tiltEnabled.current = false;   // e.g. once the flip begins
//
// Self-disables under prefers-reduced-motion and on touch (no hover pointer).
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion, hasHoverPointer } from './motion';

export default function useCardTilt(
  targetRef,
  { listenRef = null, maxTiltX = 12, maxTiltY = 14, glareSelector = '.oc__glare' } = {}
) {
  const enabledRef = useRef(true);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || prefersReducedMotion() || !hasHoverPointer()) return undefined;
    const listen = listenRef?.current || target;

    const qRotX = gsap.quickTo(target, 'rotationX', { duration: 0.5, ease: 'power3.out' });
    const qRotY = gsap.quickTo(target, 'rotationY', { duration: 0.5, ease: 'power3.out' });
    const glares = Array.from(target.querySelectorAll(glareSelector));
    const qGlare = glares.map((g) => ({
      x: gsap.quickTo(g, 'xPercent', { duration: 0.35, ease: 'power2.out' }),
      y: gsap.quickTo(g, 'yPercent', { duration: 0.35, ease: 'power2.out' }),
      o: gsap.quickTo(g, 'opacity', { duration: 0.35, ease: 'power2.out' }),
    }));

    function onMove(e) {
      if (!enabledRef.current) return;
      const r = target.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      qRotY(nx * maxTiltY);
      qRotX(-ny * maxTiltX);
      qGlare.forEach((g) => { g.x(nx * 30); g.y(ny * 30); g.o(0.55); });
    }
    function onLeave() {
      if (!enabledRef.current) return;
      gsap.to(target, { rotationX: 0, rotationY: 0, duration: 0.9, ease: 'elastic.out(1, 0.5)' });
      qGlare.forEach((g) => g.o(0));
    }

    listen.addEventListener('pointermove', onMove);
    listen.addEventListener('pointerleave', onLeave);
    return () => {
      listen.removeEventListener('pointermove', onMove);
      listen.removeEventListener('pointerleave', onLeave);
      gsap.killTweensOf(target);
      glares.forEach((g) => gsap.killTweensOf(g));
    };
    // Refs are stable; options are read once by design.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return enabledRef;
}
