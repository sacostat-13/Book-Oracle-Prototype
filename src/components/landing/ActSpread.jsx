// src/components/landing/ActSpread.jsx
// Act I — The Spread. The pinned hero theater (~300% scroll depth, 220% on
// mobile). Five face-down cards fanned across the viewport; the scrubbed
// master timeline runs the story beats from the spec:
//
//   p 0.00–0.10  opening copy retreats
//   p 0.10–0.28  the consideration — cards illuminate one by one; four dim
//                and settle outward (not chosen *tonight*), one glides center
//   p 0.28–0.45  the flip → The Revelation
//   p ~0.45      gold spark burst (once; re-arms above p 0.05)
//   p 0.50–0.90  the threshold — zoom-through, beyond copy dollies in
//   p 0.90–1.00  beyond hands off; unpin into Act II
//
// Reduced motion: no pin, no timeline — a static, complete scene (chosen card
// face-up, all copy visible) via the .is-static class.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import OracleCard from './OracleCard';
import { burstFromElement } from './burst';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Pin depth in viewport-heights. GoldThread imports these to compute where in
// the document the thread ignites (the reveal happens at ~45% of the pin).
export const PIN_DEPTH_DESKTOP = 3.0;
export const PIN_DEPTH_MOBILE = 2.2;
export const IGNITE_PROGRESS = 0.45;

const CARD_COUNT = 5;
const CHOSEN = 2; // center card of the fan

export default function ActSpread() {
  const t = useT();
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const cardRefs = useRef([]);
  const glowRefs = useRef([]);
  const breatherRefs = useRef([]);
  const zoomerRef = useRef(null);
  const flipperRef = useRef(null);
  const tiltRef = useRef(null);
  const copyAboveRef = useRef(null);
  const considerRef = useRef(null);
  const revealRef = useRef(null);
  const hintRef = useRef(null);
  const beyondRef = useRef(null);
  const dustRef = useRef(null);
  const staticMode = prefersReducedMotion();
  // Note: no cursor tilt here by design — in the theater, only the scroll
  // moves the cards. (The Epilogue's returned card keeps its tilt.)

  useGSAP(
    () => {
      if (staticMode) return;

      const cards = cardRefs.current.filter(Boolean);
      const glows = glowRefs.current.filter(Boolean);
      const breathers = breatherRefs.current.filter(Boolean);

      // ── Fan layout (function-based so it survives resize/refresh) ──────
      const fanX = (i) => {
        // Mobile shows three smaller cards, so the fan opens a little wider
        // relative to the viewport to keep the decoys readable.
        const spread = window.innerWidth <= 640
          ? window.innerWidth * 0.24
          : Math.min(window.innerWidth * 0.16, 190);
        return (i - CHOSEN) * spread;
      };
      const fanY = (i) => Math.pow(Math.abs(i - CHOSEN), 1.2) * 14;
      const fanR = (i) => (i - CHOSEN) * 7;
      cards.forEach((el, i) => gsap.set(el, { x: fanX(i), y: fanY(i), rotation: fanR(i) }));

      // ── Idle breathing (subtle levitation, staggered phases) ───────────
      const idle = breathers.map((el, i) =>
        gsap.to(el, {
          y: -9,
          duration: 2.2,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          delay: i * 0.35,
        })
      );

      // ── Ambient dust ───────────────────────────────────────────────────
      const dust = dustRef.current;
      for (let i = 0; i < 22; i++) {
        const m = document.createElement('div');
        m.className = 'lps-mote';
        const s = gsap.utils.random(1.5, 3.5);
        gsap.set(m, {
          width: s,
          height: s,
          left: `${gsap.utils.random(0, 100)}%`,
          top: `${gsap.utils.random(0, 100)}%`,
          opacity: gsap.utils.random(0.08, 0.4),
        });
        dust.append(m);
        gsap.to(m, {
          y: () => gsap.utils.random(-90, 90),
          x: () => gsap.utils.random(-50, 50),
          opacity: () => gsap.utils.random(0.05, 0.45),
          duration: () => gsap.utils.random(6, 14),
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          delay: () => gsap.utils.random(0, 5),
        });
      }

      // ── The master scrubbed timeline ───────────────────────────────────
      let hasBurst = false;

      const mm = gsap.matchMedia();
      mm.add(
        {
          isMobile: '(max-width: 640px)',
          isDesktop: '(min-width: 641px)',
        },
        (ctx) => {
          const depth = ctx.conditions.isMobile ? PIN_DEPTH_MOBILE : PIN_DEPTH_DESKTOP;

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: rootRef.current,
              start: 'top top',
              end: `+=${Math.round(depth * 100)}%`,
              pin: true,
              scrub: 0.5,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                const p = self.progress;
                // Breathing while the spread is "in hand"; still through the zoom.
                if (p < IGNITE_PROGRESS) idle.forEach((tw) => tw.play());
                else idle.forEach((tw) => tw.pause());
                // The burst — once, exactly at the reveal. Re-arm on scroll-back.
                if (p >= IGNITE_PROGRESS && !hasBurst) {
                  hasBurst = true;
                  burstFromElement(flipperRef.current);
                }
                if (p < 0.05) hasBurst = false;
              },
            },
          });

          const others = cards.filter((_, i) => i !== CHOSEN);

          tl
            // Opening copy retreats (0 → 0.10)
            .to(copyAboveRef.current, { autoAlpha: 0, y: -40, ease: 'power1.in', duration: 0.10 }, 0)
            .to(hintRef.current, { autoAlpha: 0, ease: 'power1.in', duration: 0.08 }, 0)
            // The consideration (0.10 → 0.28): illumination one by one…
            .fromTo(considerRef.current, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.10);

          [0, 4, 1, 3, 2].forEach((i, k) => {
            tl.to(glows[i], { opacity: 1, duration: 0.02 }, 0.11 + k * 0.028)
              .to(glows[i], { opacity: i === CHOSEN ? 0.9 : 0.12, duration: 0.02 }, 0.13 + k * 0.028);
          });

          tl
            // …four settle outward and dim — not rejected, just not tonight.
            .to(others, {
              x: (idx, el) => {
                const i = cards.indexOf(el);
                return fanX(i) * 2.3;
              },
              y: 70,
              rotation: (idx, el) => fanR(cards.indexOf(el)) * 2,
              autoAlpha: 0.22,
              ease: 'power2.inOut',
              duration: 0.09,
            }, 0.19)
            .to(considerRef.current, { autoAlpha: 0, y: -30, duration: 0.05 }, 0.25)
            // The flip (0.28 → 0.45): face-down 180° → face-up 0°
            .to(flipperRef.current, { rotationY: 0, ease: 'power2.inOut', duration: 0.17 }, 0.28)
            .to(glows[CHOSEN], { opacity: 0, duration: 0.06 }, 0.32)
            .fromTo(revealRef.current, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.06 }, 0.39)
            // A proud beat at the reveal
            .to(zoomerRef.current, { scale: 1.08, ease: 'power1.out', duration: 0.05 }, IGNITE_PROGRESS)
            // The threshold (0.50 → 0.90): zoom-through, face dissolves
            .to(revealRef.current, { autoAlpha: 0, y: -30, duration: 0.06 }, 0.50)
            .to(zoomerRef.current, { scale: 15, ease: 'power2.in', duration: 0.40 }, 0.50)
            .to(zoomerRef.current, { autoAlpha: 0, ease: 'none', duration: 0.18 }, 0.68)
            .to(others, { autoAlpha: 0, ease: 'none', duration: 0.10 }, 0.50)
            // Beyond copy dollies in behind
            .fromTo(
              beyondRef.current,
              { autoAlpha: 0, scale: 0.9 },
              { autoAlpha: 1, scale: 1, ease: 'power2.out', duration: 0.30 },
              0.58
            )
            // Hand off into Act II (0.90 → 1.00)
            .to(beyondRef.current, { autoAlpha: 0, y: -40, ease: 'power1.in', duration: 0.10 }, 0.90);

          return () => tl.scrollTrigger?.kill();
        }
      );
    },
    { scope: rootRef }
  );

  return (
    <div className={`lps-theater${staticMode ? ' is-static' : ''}`} ref={rootRef}>
      <div className="lps-stage" ref={stageRef}>
        <div className="lps-dust" ref={dustRef} aria-hidden="true" />

        <div className="lps-stage-copy lps-stage-copy--above" ref={copyAboveRef}>
          <p className="lps-eyebrow">{t('landing.act1.eyebrow')}</p>
          <h1>{t('landing.act1.opening')}</h1>
        </div>

        <p className="lps-stage-copy lps-stage-copy--consider" ref={considerRef} aria-hidden={!staticMode}>
          {t('landing.act1.consideration')}
        </p>

        <div className="lps-card-scene">
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <div
              className={`lps-card${i === CHOSEN ? ' lps-card--chosen' : ''}`}
              key={i}
              ref={(el) => { cardRefs.current[i] = el; }}
            >
              <div className="lps-breather" ref={(el) => { breatherRefs.current[i] = el; }}>
                {i === CHOSEN ? (
                  <div className="lps-zoomer" ref={zoomerRef}>
                    <div className="lps-flipper" ref={flipperRef}>
                      <div className="lps-tiltlayer" ref={tiltRef}>
                        <OracleCard
                          variant="front"
                          className="oc--face oc--facefront"
                          sigil="✧"
                          name={t('landing.act1.cardName')}
                          meaning={t('landing.act1.cardMeaning')}
                        />
                        <OracleCard variant="back" className="oc--face oc--faceback" />
                      </div>
                    </div>
                    <span className="lps-cardglow" ref={(el) => { glowRefs.current[i] = el; }} aria-hidden="true" />
                  </div>
                ) : (
                  <>
                    {/* The obvious books — face-up bestseller decoys the
                        Oracle considers and lets settle aside. */}
                    <OracleCard variant="front" className="oc--decoy">
                      <span className="oc__ribbon">{t('landing.act1.decoyRibbon')}</span>
                      <span className="oc__name oc__name--decoy">
                        {t(`landing.act1.decoy${i < CHOSEN ? i + 1 : i}`)}
                      </span>
                      <span className="oc__divider" aria-hidden="true" />
                    </OracleCard>
                    <span className="lps-cardglow" ref={(el) => { glowRefs.current[i] = el; }} aria-hidden="true" />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="lps-stage-copy lps-stage-copy--reveal" ref={revealRef} aria-hidden={!staticMode}>
          {t('landing.act1.reveal')}
        </p>

        <div className="lps-stage-copy lps-stage-copy--below" ref={hintRef}>
          <span className="lps-hint">{t('landing.act1.scrollHint')}</span>
        </div>

        <div className="lps-beyond" ref={beyondRef}>
          <h2>{t('landing.act1.beyond')}</h2>
        </div>
      </div>
    </div>
  );
}
