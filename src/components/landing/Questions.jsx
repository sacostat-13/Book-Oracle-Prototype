// src/components/landing/Questions.jsx
// Act VI — Questions. A quiet accordion; the thread runs past it. Six Q&As
// (ported from v4, translated), with the voice-rule fix in the first answer:
// the Oracle *finds and suggests* — the reader always chooses.
// Reduced motion: toggles instantly, no height tween.
import { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useT } from '../../lib/I18nContext';
import { prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

function QuestionItem({ q, a }) {
  const [open, setOpen] = useState(false);
  const answerRef = useRef(null);
  const staticMode = prefersReducedMotion();

  function toggle() {
    const next = !open;
    setOpen(next);
    const el = answerRef.current;
    if (!el) return;
    if (staticMode) {
      el.style.height = next ? 'auto' : '0px';
      return;
    }
    if (next) {
      gsap.to(el, {
        height: el.scrollHeight,
        duration: 0.5,
        ease: 'power2.out',
        onComplete: () => {
          el.style.height = 'auto';
          ScrollTrigger.refresh(); // thread + triggers re-measure below us
        },
      });
    } else {
      gsap.to(el, {
        height: 0,
        duration: 0.45,
        ease: 'power2.inOut',
        onComplete: () => ScrollTrigger.refresh(),
      });
    }
  }

  return (
    <div className={`lps-faq__item${open ? ' is-open' : ''}`}>
      <button className="lps-faq__q" aria-expanded={open} onClick={toggle}>
        {q}
        <span className="lps-faq__mark" aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      <div className="lps-faq__a" ref={answerRef} style={{ height: 0 }}>
        <p>{a}</p>
      </div>
    </div>
  );
}

export default function Questions({ anchorRef }) {
  const t = useT();
  const rootRef = useRef(null);
  const staticMode = prefersReducedMotion();

  useGSAP(
    () => {
      if (staticMode) return;
      gsap.from(rootRef.current.querySelectorAll('.lps-faq__item'), {
        y: 26,
        autoAlpha: 0,
        stagger: 0.08,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: rootRef.current, start: 'top 72%' },
      });
    },
    { scope: rootRef }
  );

  return (
    <section className="lps-faq" id="lp-faq" ref={(el) => { rootRef.current = el; if (anchorRef) anchorRef.current = el; }}>
      <h2 className="lps-title">{t('landing.questions.title')}</h2>
      <div className="lps-faq__list">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <QuestionItem key={n} q={t(`landing.questions.q${n}`)} a={t(`landing.questions.a${n}`)} />
        ))}
      </div>
    </section>
  );
}
