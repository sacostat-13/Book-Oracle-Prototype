// src/components/ScrollSentinel.jsx
// A zero-height sentinel div placed after the rendered list.
// When it enters the viewport (within rootMargin), it fires onVisible once.
// Set enabled=false while a load is in progress to prevent double-fires.
//
// rootMargin '400px' means the callback fires ~400px before the user's
// scroll position reaches the sentinel — pages load ahead of time, so
// there's no perceptible loading gap in normal scrolling.

import { useEffect, useRef } from 'react';

export default function ScrollSentinel({ onVisible, enabled = true }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onVisible();
      },
      { rootMargin: '400px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, onVisible]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="scroll-sentinel"
    />
  );
}
