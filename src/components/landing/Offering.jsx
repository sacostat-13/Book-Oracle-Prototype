// src/components/landing/Offering.jsx
// Act V — The Offering (Cards motif). Pricing inside the story: choosing
// between two tarot-style tier cards. The Seeker (free) and The Adept (Pro).
// The Adept breathes a slow gold glow. Quotas and price come from the live
// values (free: 5 suggestions/month; Pro: 5/day at $5.99) — not the v4
// placeholder copy.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import OracleCard from './OracleCard';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const SEEKER_ROWS = [1, 2, 3, 4, 5];
const ADEPT_ROWS = [1, 2, 3, 4];

export default function Offering({ onOpenAuth, anchorRef }) {
  const t = useT();
  const rootRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      if (staticMode) return;
      const root = rootRef.current;
      gsap.from(root.querySelectorAll('.lps-offering__head > *'), {
        y: 30,
        autoAlpha: 0,
        stagger: 0.12,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: { trigger: root, start: 'top 75%' },
      });
      gsap.from(root.querySelectorAll('.oc--tier'), {
        y: 60,
        autoAlpha: 0,
        stagger: 0.18,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: root.querySelector('.lps-tiers'), start: 'top 80%' },
      });
      gsap.to(root.querySelector('.oc--tier.is-adept'), {
        boxShadow: '0 20px 80px rgba(var(--lps-gold-rgb), 0.18)',
        duration: 2.4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    },
    { scope: rootRef }
  );

  return (
    <section className="lps-offering" id="lp-pricing" ref={(el) => { rootRef.current = el; if (anchorRef) anchorRef.current = el; }}>
      <div className="lps-offering__head">
        <p className="lps-eyebrow">{t('landing.offering.eyebrow')}</p>
        <h2 className="lps-title">{t('landing.offering.title')}</h2>
        <p className="lps-sub">{t('landing.offering.sub')}</p>
      </div>

      <div className="lps-tiers">
        <OracleCard variant="tier" className="is-seeker">
          <span className="oc__tiertag">{t('landing.offering.seekerTag')}</span>
          <span className="oc__name oc__name--tier">{t('landing.offering.seekerName')}</span>
          <span className="oc__price">
            {t('landing.offering.seekerPrice')} <small>{t('landing.offering.perMonth')}</small>
          </span>
          <ul className="oc__rows">
            {SEEKER_ROWS.map((n) => (
              <li key={n}>{t(`landing.offering.seekerRow${n}`)}</li>
            ))}
          </ul>
          <button className="oc__tierbtn" onClick={() => onOpenAuth?.('signup')}>
            {t('landing.offering.seekerCta')}
          </button>
        </OracleCard>

        <OracleCard variant="tier" className="is-adept">
          <span className="oc__tiertag">☩ {t('landing.offering.adeptTag')}</span>
          <span className="oc__name oc__name--tier">{t('landing.offering.adeptName')}</span>
          <span className="oc__price">
            {t('landing.offering.adeptPrice')} <small>{t('landing.offering.perMonth')}</small>
          </span>
          <ul className="oc__rows">
            {ADEPT_ROWS.map((n) => (
              <li key={n}>{t(`landing.offering.adeptRow${n}`)}</li>
            ))}
          </ul>
          <button className="oc__tierbtn oc__tierbtn--gold" onClick={() => onOpenAuth?.('signup')}>
            {t('landing.offering.adeptCta')}
          </button>
        </OracleCard>
      </div>
    </section>
  );
}
