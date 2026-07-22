// src/components/landing/Companions.jsx
// Act IV — The Companions. Eight quiet tiles, staggered rise.
//
// This used to also draw faint gold curves *between* related tiles (a
// "connections" motif). Removed: the page already has one gold line with a
// job — the document-spanning GoldThread — and a second set of gold curves
// on top of it read as stray marks across the grid rather than as meaning.
// The thread still weaves through this section via THREAD_TILES below.
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

// tileAnchorRefs: two refs from Landing.jsx, attached to the tiles the
// document-spanning GoldThread weaves through (top-center and bottom-center
// of the grid), so the thread is drawn over the tiles rather than skirting
// the section.
const THREAD_TILES = [1, 6];

export default function Companions({ tileAnchorRefs = [] }) {
  const t = useT();
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      if (staticMode) return undefined;

      const tiles = gsap.utils.toArray(gridRef.current.querySelectorAll('.lps-tile'));

      gsap.from(tiles, {
        y: 40,
        autoAlpha: 0,
        stagger: 0.09,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: rootRef.current, start: 'top 78%' },
      });

      return undefined;
    },
    { scope: rootRef }
  );

  return (
    <section className="lps-companions" ref={rootRef}>
      <p className="lps-eyebrow">{t('landing.companions.eyebrow')}</p>
      <h2 className="lps-title">{t('landing.companions.title')}</h2>
      <div className="lps-tile-grid" ref={gridRef}>
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
