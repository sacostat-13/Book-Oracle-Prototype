// src/views/Landing.jsx
// Public, signed-out landing page at '/'. Signed-in visitors never see this —
// App.jsx branches to <Dashboard> for them.
//
// Rebuilt per LANDING_STORY_SPEC.md: the page tells one continuous story —
// a reader lost in their TBR is guided by the Oracle to their next book,
// along a path, to the moment they claim it. There is no intro gate and no
// curtain (the old OracleIntro/ConstellationThread are absorbed); the scroll
// *is* the reading.
//
// Composition + Lenis provider + the GoldThread anchor wiring live here.
// Acts: I Spread (pinned hero) → II Rite I Suggestion → III Rite II Path →
// IV Companions → V Offering (pricing) → VI Questions (FAQ) → Epilogue Claim.
import { createRef, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { useRouter } from '../lib/RouterContext';
import { useI18n, useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import LandingNav from '../components/LandingNav';
import LandingFooter from '../components/LandingFooter';
import SignInGate from '../components/SignInGate';
import GoldThread from '../components/landing/GoldThread';
import ActSpread from '../components/landing/ActSpread';
import RiteSuggestion from '../components/landing/RiteSuggestion';
import RitePath from '../components/landing/RitePath';
import RiteRecord from '../components/landing/RiteRecord';
import Companions from '../components/landing/Companions';
import Offering from '../components/landing/Offering';
import Questions from '../components/landing/Questions';
import Claim from '../components/landing/Claim';
import { prefersReducedMotion } from '../components/landing/motion';

gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
  const { route } = useRouter();
  const { lang } = useI18n();
  const t = useT();
  const [authMode, setAuthMode] = useState(null); // null | 'login' | 'signup'

  // ── GoldThread anchors, in document order after the Act I ignition ──────
  const rite1Ref = useRef(null);
  const planNodeRefs = useMemo(() => [0, 1, 2, 3].map(() => createRef()), []);
  const recordRef = useRef(null);
  const companionTileRefs = useMemo(() => [createRef(), createRef()], []);
  const offeringRef = useRef(null);
  const questionsRef = useRef(null);
  const claimCardRef = useRef(null);
  const threadAnchors = useMemo(
    () => [
      { ref: rite1Ref },
      ...planNodeRefs.map((ref) => ({ ref })),
      { ref: recordRef },
      ...companionTileRefs.map((ref) => ({ ref })),
      { ref: offeringRef, edge: 'top' },
      { ref: questionsRef, edge: 'top' },
      { ref: claimCardRef, edge: 'top' },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Lenis smooth scroll, driven by the single gsap ticker ───────────────
  // Reduced motion ⇒ no Lenis at all: native scroll, same information.
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  // A refresh after first paint so the pin + thread measure settled layout
  // (fonts arriving late shift every anchor).
  useEffect(() => {
    const id = setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => clearTimeout(id);
  }, []);

  // ── SEO: title/description + JSON-LD (SoftwareApplication + FAQPage) ────
  useDocumentMeta({
    title: 'The Books Oracle — An Oracle that knows what you’ll love next',
    description:
      'Track your reading, get suggestions that actually fit your taste, and join book clubs. Free to start, full library import, English & Spanish.',
    image: 'https://thebooksoracle.com/images/landing/og-share.png',
  });

  useEffect(() => {
    const faqEntities = [1, 2, 3, 4, 5, 6].map((i) => ({
      '@type': 'Question',
      name: t(`landing.questions.q${i}`),
      acceptedAnswer: { '@type': 'Answer', text: t(`landing.questions.a${i}`) },
    }));
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: 'The Books Oracle',
          applicationCategory: 'LifestyleApplication',
          operatingSystem: 'Web',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          url: 'https://thebooksoracle.com/',
          inLanguage: ['en', 'es'],
          description:
            'A reading companion with AI-powered suggestions, wishlist, library, reading plans, book clubs, and friends activity.',
        },
        { '@type': 'FAQPage', mainEntity: faqEntities },
      ],
    };
    let script = document.getElementById('lp-jsonld');
    if (!script) {
      script = document.createElement('script');
      script.id = 'lp-jsonld';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
    return () => { script?.remove(); };
  }, [lang, t]);

  // Deep-link from another public page, e.g. /?anchor=lp-pricing.
  useEffect(() => {
    const anchor = route.params?.anchor;
    if (!anchor) return;
    const el = document.getElementById(anchor);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, [route.params?.anchor]);

  // Arrived with ?auth=login|signup — open the modal directly.
  useEffect(() => {
    const auth = route.params?.auth;
    if (auth === 'login' || auth === 'signup') setAuthMode(auth);
  }, [route.params?.auth]);

  return (
    <div className="lps-root">
      <GoldThread anchors={threadAnchors} />
      <LandingNav onOpenAuth={setAuthMode} dark />

      {/* Act I — The Spread (pinned theater) */}
      <ActSpread />

      {/* Act II — Rite I: The Suggestion */}
      <RiteSuggestion anchorRef={rite1Ref} />

      {/* Act III — Rite II: The Path */}
      <RitePath nodeRefs={planNodeRefs} />

      {/* Act IV — Rite III: The Record */}
      <RiteRecord anchorRef={recordRef} />

      {/* Act V — The Companions */}
      <Companions tileAnchorRefs={companionTileRefs} />

      {/* Act V — The Offering */}
      <Offering onOpenAuth={setAuthMode} anchorRef={offeringRef} />

      {/* Act VI — Questions */}
      <Questions anchorRef={questionsRef} />

      {/* Epilogue — The Claim */}
      <Claim onOpenAuth={setAuthMode} cardRef={claimCardRef} />

      <LandingFooter />

      {/* Mobile sticky CTA — one auth entry point, mirroring the nav */}
      <div className="lp-sticky-cta">
        <button className="btn-accent btn--sm lp-sticky-cta__primary" onClick={() => setAuthMode('login')}>
          {t('landing.nav.auth')}
        </button>
      </div>

      {authMode && (
        <div
          className="lp-auth-modal"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setAuthMode(null); }}
        >
          <SignInGate onClose={() => setAuthMode(null)} />
        </div>
      )}
    </div>
  );
}
