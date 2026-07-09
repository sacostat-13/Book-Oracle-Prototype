// src/components/ConstellationThread.jsx
// The intro's divination motif, carried down the Landing page: a thin gold
// thread in the left gutter that draws itself with scroll progress, with a
// star at each section that lights up as the section reaches the reading
// position. Purely decorative (aria-hidden, pointer-events: none).
//
// Wide screens (>= 1280px) only — below that the gutter is gone and the
// existing ✦ section eyebrows carry the motif. Hidden entirely under
// prefers-reduced-motion (both handled in _oracle-intro.scss; this component
// also skips its scroll work when reduced motion is set).
//
// Measures the vertical position of each section id inside .lp-root, then:
//   • line: stroke-dashoffset driven by scroll progress through the page
//   • stars: .is-lit once scroll passes them (never unlit — the story is
//     read forward, like the intro's cards)
import { useEffect, useRef, useState } from 'react';

const DEFAULT_SECTIONS = ['lp-hero', 'lp-features', 'lp-how', 'lp-pricing', 'lp-faq'];

export default function ConstellationThread({ sectionIds = DEFAULT_SECTIONS }) {
  const wrapRef = useRef(null);
  const lineRef = useRef(null);
  const [nodes, setNodes] = useState([]); // [{ id, y }] in .lp-root coords
  const [height, setHeight] = useState(0);
  const [lit, setLit] = useState({});

  // ── measure section anchors (re-measure when images/layout settle) ────────
  useEffect(() => {
    const root = wrapRef.current?.parentElement; // .lp-root
    if (!root) return undefined;

    function measure() {
      const rootTop = root.getBoundingClientRect().top + window.scrollY;
      const next = sectionIds
        .map((id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { id, y: r.top + window.scrollY - rootTop + Math.min(r.height * 0.25, 160) };
        })
        .filter(Boolean);
      setNodes(next);
      setHeight(root.scrollHeight);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [sectionIds]);

  // ── draw with scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const first = nodes[0].y;
    const last = nodes[nodes.length - 1].y;
    const span = Math.max(last - first, 1);
    let raf = null;

    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        // reading position: 55% down the viewport
        const pos = window.scrollY + window.innerHeight * 0.55;
        const progress = Math.max(0, Math.min(1, (pos - first) / span));
        if (lineRef.current) {
          lineRef.current.style.strokeDashoffset = String(span * (1 - progress));
        }
        setLit((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const n of nodes) {
            if (!next[n.id] && pos >= n.y) { next[n.id] = true; changed = true; }
          }
          return changed ? next : prev;
        });
      });
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [nodes]);

  if (nodes.length < 2) {
    return <div className="lp-thread" ref={wrapRef} aria-hidden />;
  }

  const first = nodes[0].y;
  const last = nodes[nodes.length - 1].y;
  const span = Math.max(last - first, 1);

  return (
    <div className="lp-thread" ref={wrapRef} aria-hidden>
      <svg viewBox={`0 0 24 ${Math.max(height, 1)}`} preserveAspectRatio="none">
        <line
          ref={lineRef}
          className="lp-thread__line"
          x1="12" y1={first} x2="12" y2={last}
          strokeDasharray={span}
          strokeDashoffset={span}
        />
        {nodes.map((n) => (
          <g key={n.id} className={`lp-thread__node${lit[n.id] ? ' is-lit' : ''}`}>
            <circle className="lp-thread__halo" cx="12" cy={n.y} r="8" />
            <circle className={`lp-thread__star${lit[n.id] ? ' is-lit' : ''}`} cx="12" cy={n.y} r="3" />
          </g>
        ))}
      </svg>
    </div>
  );
}
