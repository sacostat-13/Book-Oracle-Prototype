// src/components/landing/burst.js
// The gold spark burst. Per the landing story spec this fires exactly TWICE
// on the page: the reveal in Act I and the claim in the Epilogue. Scarcity is
// the point — do not sprinkle it anywhere else.
import gsap from 'gsap';
import { prefersReducedMotion } from './motion';

export default function burst(x, y, count = 26) {
  if (prefersReducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'lps-spark';
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    document.body.append(s);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 90 + Math.random() * 190;
    gsap.fromTo(
      s,
      { scale: 1.2, opacity: 1, x: 0, y: 0 },
      {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist + 40,
        scale: 0,
        opacity: 0,
        duration: 0.9 + Math.random() * 0.7,
        ease: 'power3.out',
        onComplete: () => s.remove(),
      }
    );
  }
}

// Convenience: burst from the center of an element (the card that earned it).
export function burstFromElement(el, count) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, count);
}
