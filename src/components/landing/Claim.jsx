// src/components/landing/Claim.jsx
// Epilogue — The Claim. All three motifs converge: the gold thread terminates
// into a returned Revelation card, small, face-up, breathing, tilting toward
// the cursor. The card IS the CTA — clicking it fires the second (and final)
// gold burst and opens signup. A plain text button below carries
// accessibility and mobile.
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import OracleCard from './OracleCard';
import useCardTilt from './useCardTilt';
import { burstFromElement } from './burst';
import { prefersReducedMotion } from './motion';

export default function Claim({ onOpenAuth, cardRef }) {
  const t = useT();
  const rootRef = useRef(null);
  const localCardRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useCardTilt(localCardRef, { maxTiltX: 10, maxTiltY: 12 });

  useGSAP(
    () => {
      if (staticMode) return;
      // The returned card floats, as it did in Act I…
      gsap.to(rootRef.current.querySelector('.lps-claim__cardwrap'), {
        y: -8,
        duration: 2.4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
      // …and carries a slow pulse — a quiet lub-dub every few seconds, the
      // drawn card still alive on the table, waiting to be claimed.
      const beat = gsap.timeline({ repeat: -1, repeatDelay: 2.2 });
      beat
        .to(localCardRef.current, { scale: 1.04, duration: 0.16, ease: 'power2.out' })
        .to(localCardRef.current, { scale: 1, duration: 0.2, ease: 'power2.in' })
        .to(localCardRef.current, { scale: 1.055, duration: 0.16, ease: 'power2.out' }, '+=0.1')
        .to(localCardRef.current, { scale: 1, duration: 0.5, ease: 'power2.inOut' });
    },
    { scope: rootRef }
  );

  function claim() {
    // The second — and last — burst on the page.
    burstFromElement(localCardRef.current, 34);
    onOpenAuth?.('signup');
  }

  return (
    <section className="lps-claim" ref={rootRef}>
      <h2 className="lps-claim__title">{t('landing.epilogue.title')}</h2>
      <div
        className="lps-claim__cardwrap"
        ref={(el) => { if (cardRef) cardRef.current = el; }}
      >
        <OracleCard
          ref={localCardRef}
          as="button"
          variant="cta"
          sigil="✧"
          name={t('landing.act1.cardName')}
          meaning={t('landing.act1.cardMeaning')}
          onClick={claim}
          aria-label={t('landing.epilogue.cta')}
        />
      </div>
      <button className="lps-claim__textcta" onClick={claim}>
        {t('landing.epilogue.cta')}
      </button>
      <small className="lps-claim__sub">{t('landing.epilogue.sub')}</small>
    </section>
  );
}
