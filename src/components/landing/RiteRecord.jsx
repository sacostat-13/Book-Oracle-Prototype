// src/components/landing/RiteRecord.jsx
// Act IV — Rite III: The Record. The Oracle remembers the reader: stats and
// streaks kept as you read, a yearly goal filling, and the title ladder —
// epithets granted by the Oracle alone, earned purely by books read.
// Flagship split (copy left, mock right, like Rite I — the three rites
// alternate sides I/II/III = left/right/left).
//
// Mock beats on enter: the numbers count up, the goal bar fills, the worn
// title stamps in. Reduced motion: final values are already in the DOM.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// The mock reader: 47 books read, 12-week streak, goal of 60 — which lands
// them on the Archivist rung (30) with Keeper (60) ahead.
const BOOKS_READ = 47;
const STREAK = 12;
const GOAL = 60;

export default function RiteRecord({ anchorRef }) {
  const t = useT();
  const rootRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      if (staticMode) return;
      const root = rootRef.current;
      const copy = root.querySelector('.lps-flagship__copy');
      const mock = root.querySelector('.lps-mock');

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

      const tl = gsap.timeline({
        scrollTrigger: { trigger: mock, start: 'top 65%' },
      });

      // Numbers count up from zero.
      root.querySelectorAll('.lps-record__num[data-count]').forEach((el, i) => {
        tl.from(el, {
          textContent: 0,
          snap: { textContent: 1 },
          duration: 1.1,
          ease: 'power2.out',
        }, 0.4 + i * 0.15);
      });

      // The goal bar fills to 47/60.
      tl.from(root.querySelector('.lps-record__barfill'), {
        scaleX: 0,
        transformOrigin: '0% 50%',
        duration: 1.1,
        ease: 'power2.inOut',
      }, 0.6);

      // The worn title stamps in; the memory line follows quietly.
      tl.from(root.querySelector('.lps-record__titlerow'), {
        y: 16,
        autoAlpha: 0,
        duration: 0.6,
        ease: 'power2.out',
      }, 1.3)
        .from(root.querySelector('.lps-record__memory'), {
          autoAlpha: 0,
          duration: 0.7,
        }, 1.7);
    },
    { scope: rootRef }
  );

  return (
    <section className={`lps-flagship${staticMode ? ' is-static' : ''}`} ref={rootRef}>
      <div className="lps-flagship__copy">
        <p className="lps-index">{t('landing.rite3.index')}</p>
        <h3>{t('landing.rite3.title')}</h3>
        <p className="lps-body">{t('landing.rite3.body')}</p>
      </div>

      <div className="lps-mock lps-mock--record" ref={anchorRef}>
        <div className="lps-mock__head">
          <span><span className="lps-mock__rune" aria-hidden="true">☩</span> {t('landing.rite3.mockTitle')}</span>
          <span>{t('landing.rite3.mockStatus')}</span>
        </div>

        <div className="lps-record__stats">
          <div className="lps-record__stat">
            <span className="lps-record__num" data-count>{BOOKS_READ}</span>
            <span className="lps-record__label">{t('landing.rite3.statBooks')}</span>
          </div>
          <div className="lps-record__stat">
            <span className="lps-record__num" data-count>{STREAK}</span>
            <span className="lps-record__label">{t('landing.rite3.statStreak')}</span>
          </div>
          <div className="lps-record__stat">
            <span className="lps-record__num">{BOOKS_READ}<em>/{GOAL}</em></span>
            <span className="lps-record__label">{t('landing.rite3.statGoal')}</span>
          </div>
        </div>

        <div className="lps-record__bar" role="presentation">
          <span
            className="lps-record__barfill"
            style={{ width: `${Math.round((BOOKS_READ / GOAL) * 100)}%` }}
          />
        </div>

        <div className="lps-record__titlerow">
          <span className="lps-record__sigil" aria-hidden="true">✦</span>
          <span className="lps-record__titleworn">{t('landing.rite3.titleWorn')}</span>
          <span className="lps-record__titlenext">{t('landing.rite3.titleNext')}</span>
        </div>

        <p className="lps-record__memory">{t('landing.rite3.memory')}</p>
      </div>
    </section>
  );
}
