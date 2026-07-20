// src/components/landing/RitePath.jsx
// Act III — Rite II: The Path (Constellations motif). Reading Plans as a
// guided journey. Mirrored flagship split. The document-spanning GoldThread
// routes *through* this mock: the four star-nodes here are registered as
// thread anchors by LandingPage, so the one gold line literally passes
// through the plan. As the section enters, each node lights with its state:
// read ✦, reading ☾, ahead ✧.
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Book titles are proper nouns — identical in EN and ES, so they live here
// rather than in the catalogs. States drive sigil + styling.
const PLAN = [
  { title: 'The Secret History', state: 'read', sigil: '✦' },
  { title: 'Babel', state: 'read', sigil: '✦' },
  { title: 'Piranesi', state: 'reading', sigil: '☾' },
  { title: 'The Name of the Rose', state: 'ahead', sigil: '✧' },
];

export default function RitePath({ nodeRefs = [] }) {
  const t = useT();
  const rootRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      if (staticMode) return;
      const root = rootRef.current;
      const copy = root.querySelector('.lps-flagship__copy');
      const mock = root.querySelector('.lps-mock');
      const nodes = gsap.utils.toArray(root.querySelectorAll('.lps-plan-node'));
      const caption = root.querySelector('.lps-plan-caption');

      gsap.from(copy, {
        x: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: root, start: 'top 72%' },
      });
      gsap.from(mock, {
        x: -60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: root, start: 'top 72%' },
      });

      // Nodes light up in plan order as the thread draws through the panel.
      const tl = gsap.timeline({
        scrollTrigger: { trigger: mock, start: 'top 60%' },
      });
      tl.from(nodes, {
        scale: 0.4,
        autoAlpha: 0,
        transformOrigin: '50% 50%',
        stagger: 0.28,
        duration: 0.6,
        ease: 'back.out(2)',
      }, 0.3)
        .from(caption, { autoAlpha: 0, y: 12, duration: 0.5 }, '-=0.2');

      // The currently-reading node breathes — the live point on the path.
      const reading = root.querySelector('.lps-plan-node.is-reading .lps-plan-node__star');
      if (reading) {
        gsap.to(reading, {
          opacity: 0.55,
          duration: 1.6,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          delay: 2,
        });
      }
    },
    { scope: rootRef }
  );

  return (
    <section className={`lps-flagship lps-flagship--flip${staticMode ? ' is-static' : ''}`} ref={rootRef}>
      <div className="lps-flagship__copy">
        <p className="lps-index">{t('landing.rite2.index')}</p>
        <h3>{t('landing.rite2.title')}</h3>
        <p className="lps-body">{t('landing.rite2.body')}</p>
      </div>

      <div className="lps-mock lps-mock--plan">
        <div className="lps-mock__head">
          <span><span className="lps-mock__rune" aria-hidden="true">✧</span> {t('landing.rite2.mockTitle')}</span>
          <span>{t('landing.rite2.mockStatus')}</span>
        </div>
        <div className="lps-plan">
          {PLAN.map((book, i) => (
            <div className={`lps-plan-node is-${book.state}${i % 2 ? ' is-alt' : ''}`} key={book.title}>
              <span
                className="lps-plan-node__star"
                ref={nodeRefs[i]}
                aria-hidden="true"
              >
                {book.sigil}
              </span>
              <span className="lps-plan-node__label">
                {book.title}
                <em className="lps-plan-node__state">{t(`landing.rite2.state.${book.state}`)}</em>
              </span>
            </div>
          ))}
        </div>
        <p className="lps-plan-caption">{t('landing.rite2.caption')}</p>
      </div>
    </section>
  );
}
