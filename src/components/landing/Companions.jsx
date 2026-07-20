// src/components/landing/Companions.jsx
// Act IV — The Companions (Connections motif). Six quiet tiles, staggered
// rise. As they settle, faint gold lines draw *between* related tiles —
// relationships made visible: Clubs↔Friends, Series↔Self-sorting,
// Vault↔Lists. Lines sit at ~0.15 opacity; the tiles stay calm.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const TILES = [
  { key: 'sorting', sigil: '✎' },
  { key: 'clubs', sigil: '⚭' },
  { key: 'series', sigil: '⧉' },
  { key: 'vault', sigil: '◈' },
  { key: 'lists', sigil: '☽' },
  { key: 'bilingual', sigil: 'Æ' },
  { key: 'share', sigil: '❧' },
  { key: 'categories', sigil: '❖' },
];

// Related pairs, as tile indexes: Clubs↔Lists&Friends, Series↔Self-sorting,
// Vault↔Lists&Friends, Share↔Clubs, Categories↔Self-sorting.
const PAIRS = [
  [1, 4],
  [2, 0],
  [3, 4],
  [6, 1],
  [7, 0],
];

// tileAnchorRefs: two refs from LandingPage, attached to the tiles the
// document-spanning GoldThread weaves through (top-center and bottom-center
// of the grid), so the thread is drawn over the tiles rather than skirting
// the section.
const THREAD_TILES = [1, 6];

export default function Companions({ tileAnchorRefs = [] }) {
  const t = useT();
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const svgRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      const grid = gridRef.current;
      const svg = svgRef.current;
      const tiles = gsap.utils.toArray(grid.querySelectorAll('.lps-tile'));
      const lines = gsap.utils.toArray(svg.querySelectorAll('path'));

      // Connection lines are drawn tile-center to tile-center in the grid's
      // local coordinate space; rebuilt whenever layout shifts.
      function buildLines() {
        const gr = grid.getBoundingClientRect();
        svg.setAttribute('viewBox', `0 0 ${gr.width} ${gr.height}`);
        PAIRS.forEach(([a, b], i) => {
          const ra = tiles[a].getBoundingClientRect();
          const rb = tiles[b].getBoundingClientRect();
          const ax = ra.left - gr.left + ra.width / 2;
          const ay = ra.top - gr.top + ra.height / 2;
          const bx = rb.left - gr.left + rb.width / 2;
          const by = rb.top - gr.top + rb.height / 2;
          const mx = (ax + bx) / 2 + (i % 2 ? -40 : 40);
          const my = (ay + by) / 2 + (i % 2 ? 30 : -30);
          lines[i].setAttribute('d', `M ${ax},${ay} Q ${mx},${my} ${bx},${by}`);
        });
      }

      buildLines();

      if (staticMode) {
        gsap.set(lines, { opacity: 0.15 });
        window.addEventListener('resize', buildLines);
        return () => window.removeEventListener('resize', buildLines);
      }

      ScrollTrigger.addEventListener('refresh', buildLines);

      const tl = gsap.timeline({
        scrollTrigger: { trigger: rootRef.current, start: 'top 78%' },
      });
      tl.from(tiles, {
        y: 40,
        autoAlpha: 0,
        stagger: 0.09,
        duration: 0.8,
        ease: 'power3.out',
      });
      lines.forEach((line, i) => {
        const len = line.getTotalLength() || 600;
        tl.fromTo(
          line,
          { strokeDasharray: len, strokeDashoffset: len, opacity: 0.3 },
          { strokeDashoffset: 0, opacity: 0.15, duration: 1.1, ease: 'power2.inOut' },
          0.7 + i * 0.25
        );
      });

      return () => ScrollTrigger.removeEventListener('refresh', buildLines);
    },
    { scope: rootRef }
  );

  return (
    <section className="lps-companions" ref={rootRef}>
      <p className="lps-eyebrow">{t('landing.companions.eyebrow')}</p>
      <h2 className="lps-title">{t('landing.companions.title')}</h2>
      <div className="lps-tile-grid" ref={gridRef}>
        <svg className="lps-tile-lines" ref={svgRef} aria-hidden="true" preserveAspectRatio="none">
          {PAIRS.map((pair, i) => (
            <path key={pair.join('-')} className="lps-tile-lines__path" d="M 0,0" />
          ))}
        </svg>
        {TILES.map(({ key, sigil }, i) => (
          <div
            className="lps-tile"
            key={key}
            ref={THREAD_TILES.includes(i) ? tileAnchorRefs[THREAD_TILES.indexOf(i)] : undefined}
          >
            <span className="lps-tile__sigil" aria-hidden="true">{sigil}</span>
            <h4>{t(`landing.companions.${key}Title`)}</h4>
            <p>{t(`landing.companions.${key}Body`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
