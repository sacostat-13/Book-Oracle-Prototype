// src/components/landing/RiteSuggestion.jsx
// Act II — Rite I: The Suggestion (Cards motif). The product's main power,
// promoted to first feature. Flagship split: copy left, mock right. The mock
// deals three mini-cards face-down from a deck origin, then flips them one by
// one into ranked suggestions — each with its reason. A smaller echo of Act I.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import OracleCard from './OracleCard';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const RANKS = ['I', 'II', 'III'];

export default function RiteSuggestion({ anchorRef }) {
  const t = useT();
  const rootRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      if (staticMode) return;
      const root = rootRef.current;
      const copy = root.querySelector('.lps-flagship__copy');
      const mock = root.querySelector('.lps-mock');
      const deals = gsap.utils.toArray(root.querySelectorAll('.lps-deal'));
      const flips = gsap.utils.toArray(root.querySelectorAll('.lps-deal__flip'));

      gsap.from(copy, {
        x: -60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: root, start: 'top 72%' },
      });
      gsap.from(mock, {
        x: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: root, start: 'top 72%' },
      });

      // The dealing: slide+rotate in from a deck origin (upper right), then
      // flip face-up one by one.
      const tl = gsap.timeline({
        scrollTrigger: { trigger: mock, start: 'top 65%' },
      });
      tl.from(deals, {
        x: 150,
        y: -120,
        rotation: 12,
        autoAlpha: 0,
        stagger: 0.16,
        duration: 0.55,
        ease: 'power3.out',
      }, 0.35);
      flips.forEach((flip, i) => {
        tl.to(flip, { rotationY: 0, duration: 0.55, ease: 'power2.inOut' }, 1.0 + i * 0.3);
      });
    },
    { scope: rootRef }
  );

  return (
    <section
      className={`lps-flagship${staticMode ? ' is-static' : ''}`}
      id="lp-features"
      ref={rootRef}
    >
      <div className="lps-flagship__copy">
        <p className="lps-index">{t('landing.rite1.index')}</p>
        <h3>{t('landing.rite1.title')}</h3>
        <p className="lps-body">{t('landing.rite1.body')}</p>
      </div>

      <div className="lps-mock lps-mock--deal" ref={anchorRef}>
        <div className="lps-mock__head">
          <span><span className="lps-mock__rune" aria-hidden="true">☾</span> {t('landing.rite1.mockTitle')}</span>
          <span>{t('landing.rite1.mockStatus')}</span>
        </div>
        <div className="lps-deal-row">
          {RANKS.map((rank, i) => (
            <div className="lps-deal" key={rank}>
              <div className="lps-deal__flip">
                <OracleCard variant="mini" className="oc--dealface oc--dealfront">
                  <span className="oc__sigil oc__sigil--rank" aria-hidden="true">{rank}</span>
                  <span className="oc__name oc__name--mini">{t(`landing.rite1.pick${i + 1}Title`)}</span>
                  <span className="oc__divider" aria-hidden="true" />
                  <span className="oc__meaning oc__meaning--why">{t(`landing.rite1.pick${i + 1}Why`)}</span>
                </OracleCard>
                <OracleCard variant="back" className="oc--dealface oc--dealback" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
