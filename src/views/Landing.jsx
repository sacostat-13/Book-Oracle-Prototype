// src/views/Landing.jsx
// Public, signed-out landing page at '/'. Signed-in visitors never see this —
// App.jsx branches to <Dashboard> for them. Structure follows
// landing-page-guideline.md section-by-section (Nav → Hero → Problem →
// Feature carousels → How it works → Pricing → Founder note → FAQ →
// Final CTA → Footer). Parchment-only regardless of the app's stored theme
// (scoped via the .lp-root class in _landing.scss), per the guideline's
// "light mode only" rule for the marketing surface.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../lib/RouterContext';
import { useI18n, useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import LandingNav from '../components/LandingNav';
import LandingFooter from '../components/LandingFooter';
import FeatureCarousel from '../components/FeatureCarousel';
import SignInGate from '../components/SignInGate';
import OracleIntro from '../components/OracleIntro';
import ConstellationThread from '../components/ConstellationThread';

// The Reading intro plays once per session, and never for reduced-motion
// visitors — they land directly on the parchment page.
function shouldPlayIntro() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return sessionStorage.getItem('tbo.introSeen') !== '1';
  } catch {
    return false;
  }
}

// ── Scroll-reveal: fades/slides sections in once, first time they enter the
// viewport. Subtle only, per guideline ("this audience associates restraint
// with quality"). No library — a single shared IntersectionObserver.
function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal');
    if (!('IntersectionObserver' in window) || els.length === 0) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

// ── Hero parallax: a slow, subtle translateY on the background texture as
// the user scrolls. Capped and eased — never more than a soft drift.
function useHeroParallax(ref) {
  useEffect(() => {
    let raf = null;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!ref.current) return;
        const y = Math.min(window.scrollY, 600);
        ref.current.style.transform = `translateY(${y * 0.12}px)`;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ref]);
}

// Decorative line-icons for the feature placeholders (no real screenshots yet).
const FEATURE_ICONS = {
  oracle: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0 14.5 9.5 24 12 14.5 14.5 12 24 9.5 14.5 0 12 9.5 9.5Z" /></svg>
  ),
  readingLife: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 5.5C5 4 8 4 11 5.5v14C8 18 5 18 3 19.5Z" /><path d="M21 5.5C19 4 16 4 13 5.5v14c3-1.5 6-1.5 8 0Z" /></svg>
  ),
  plans: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
  ),
  friends: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="8" r="3.2" /><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" /><circle cx="17" cy="7" r="2.6" /><path d="M15.5 13.6c2.9.3 5 2.3 5 5.4" /></svg>
  ),
  stats: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 20V10M12 20V4M20 20v-7" /></svg>
  ),
  clubs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-5 4v-4H4a1 1 0 0 1-1-1V7a2 2 0 0 1 1-2Z" /></svg>
  ),
};

// Small line-icons for the Problem section's 3 pain points.
const PROBLEM_ICONS = [
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 19V6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M9 12h6M9 15.5h4" /></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 20V10M12 20V4M20 20v-7" /><path d="M2 20h20" /></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3.2" /><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" /><circle cx="18" cy="7" r="2.4" /><path d="M16.6 13.4c2.6.4 4.4 2.3 4.4 5.1" /></svg>,
];

// Stable, language-independent filenames for the feature-carousel slide
// images (kept separate from the translated slide titles so switching to
// Spanish doesn't change which file a slide expects).
const SLIDE_SLUGS = {
  oracle: ['by-genre', 'by-other-books', 'ask-in-plain-language'],
  readingLife: ['whole-library', 'wishlist-at-a-glance', 'custom-categories', 'currently-reading-tracked'],
  plans: ['built-around-you', 'watch-it-come-together'],
  friends: ['living-feed', 'peek-at-shelves', 'curated-lists'],
  stats: ['yearly-goal', 'see-your-pace', 'keep-the-streak'],
  clubs: ['powered-by-the-oracle', 'inside-a-session', 'discover-clubs', 'spoiler-safe'],
};

function FaqItem({ q, a, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`lp-faq__item${open ? ' is-open' : ''}`}>
      <button className="lp-faq__question" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {q}
        <span className="lp-faq__caret" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && <p className="lp-faq__answer">{a}</p>}
    </div>
  );
}

export default function Landing() {
  const { route } = useRouter();
  const { lang } = useI18n();
  const t = useT();
  const heroBgRef = useRef(null);
  const [authMode, setAuthMode] = useState(null); // null | 'login' | 'signup'
  const [introPlaying, setIntroPlaying] = useState(shouldPlayIntro);

  useScrollReveal();
  useHeroParallax(heroBgRef);

  // ── SEO: title/description tuned for search + social, not the generic
  // in-app defaults. JSON-LD adds a SoftwareApplication + FAQPage graph so
  // the FAQ section is eligible for rich results.
  useDocumentMeta({
    title: 'The Books Oracle — An Oracle that knows what you’ll love next',
    description: 'Track your reading, get AI recommendations that actually fit your taste, and join book clubs. Free to start, full library import, English & Spanish.',
    image: 'https://thebooksoracle.com/images/landing/og-share.png',
  });

  useEffect(() => {
    const faqEntities = [1, 2, 3, 4, 5, 6].map((i) => ({
      '@type': 'Question',
      name: t(`landing.faq.q${i}`),
      acceptedAnswer: { '@type': 'Answer', text: t(`landing.faq.a${i}`) },
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
          description: 'A reading companion with AI-powered recommendations, wishlist, library, reading plans, book clubs, and friends activity.',
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

  // Deep-link from another public page, e.g. Privacy footer "Features" link
  // arriving as /?anchor=lp-features (carried via RouterContext's generic
  // query-param passthrough).
  useEffect(() => {
    const anchor = route.params?.anchor;
    if (!anchor || introPlaying) return;
    const el = document.getElementById(anchor);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [route.params?.anchor, introPlaying]);

  // Arrived from a legal page's nav/footer CTA with ?auth=login|signup —
  // open the sign-in modal directly instead of making them click again.
  useEffect(() => {
    const auth = route.params?.auth;
    if (auth === 'login' || auth === 'signup') setAuthMode(auth);
  }, [route.params?.auth]);

  function featureData(key) {
    const base = `landing.features.${key}`;
    const slideCount = { oracle: 3, readingLife: 4, plans: 2, friends: 3, stats: 3, clubs: 4 }[key];
    const slides = Array.from({ length: slideCount }, (_, idx) => ({
      title: t(`${base}.slide${idx + 1}Title`),
      body: t(`${base}.slide${idx + 1}Body`),
      image: `/images/landing/features/${key}-${idx + 1}-${SLIDE_SLUGS[key][idx]}.png`,
    }));
    return {
      number: t(`${base}.number`),
      title: t(`${base}.title`),
      subtitle: t(`${base}.subtitle`),
      description: t(`${base}.description`),
      slides,
      icon: FEATURE_ICONS[key],
    };
  }

  const faqKeys = [1, 2, 3, 4, 5, 6];

  return (
    <div className="lp-root">
      {introPlaying && <OracleIntro onDone={() => setIntroPlaying(false)} />}
      <ConstellationThread />
      <LandingNav onOpenAuth={setAuthMode} />

      {/* ═══ Hero ═══════════════════════════════════════════════════════ */}
      <header className="lp-hero" id="lp-hero">
        <div className="lp-hero__bg" ref={heroBgRef} aria-hidden />
        <div className="lp-hero__content">
          <div className="lp-hero__eyebrow">{t('landing.hero.eyebrow')}</div>
          <h1 className="lp-hero__headline">{t('landing.hero.headline')}</h1>
          <p className="lp-hero__subheadline">{t('landing.hero.subheadline')}</p>
          <div className="lp-hero__ctas">
            <button className="btn-accent btn--lg" onClick={() => setAuthMode('signup')}>
              {t('landing.hero.ctaPrimary')}
            </button>
            <button
              className="btn-text lp-hero__secondary"
              onClick={() => document.getElementById('lp-how')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('landing.hero.ctaSecondary')} ↓
            </button>
          </div>
        </div>
        <div className="lp-hero__frame lp-reveal">
          <div className="lp-hero__frame-bar"><span /><span /><span /></div>
          <img
            className="lp-hero__frame-img"
            src="/images/landing/hero-dashboard.png"
            alt={t('landing.hero.imageAlt')}
            loading="eager"
            fetchpriority="high"
          />
        </div>
      </header>

      {/* ═══ The problem — atmospheric library photo, dark overlay for text ═══ */}
      <section className="lp-problem lp-reveal">
        <img
          className="lp-problem__bg"
          src="https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Beinecke_Rare_Book_%26_Manuscript_Library_Interior.jpg/1920px-Beinecke_Rare_Book_%26_Manuscript_Library_Interior.jpg"
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
        <div className="lp-problem__inner">
          <div className="lp-eyebrow">{t('landing.problem.eyebrow')}</div>
          <h2 className="lp-problem__heading">{t('landing.problem.heading')}</h2>
          <ul className="lp-problem__list">
            {[t('landing.problem.point1'), t('landing.problem.point2'), t('landing.problem.point3')].map((point, i) => (
              <li key={i}>
                <div className="lp-problem__icon" aria-hidden>{PROBLEM_ICONS[i]}</div>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══ Feature carousels ═══════════════════════════════════════════ */}
      <section className="lp-features" id="lp-features">
        <div className="lp-features__head lp-reveal">
          <div className="lp-eyebrow">{t('landing.features.eyebrow')}</div>
          <h2 className="lp-features__heading">{t('landing.features.heading')}</h2>
          <p className="lp-features__subheading">{t('landing.features.subheading')}</p>
        </div>

        {['oracle', 'readingLife', 'plans', 'friends', 'stats', 'clubs'].map((key, i) => (
          <FeatureCarousel key={key} reverse={i % 2 === 1} {...featureData(key)} />
        ))}
      </section>

      {/* ═══ How it works — photo band, same wine-gradient scrim family as
          the Final CTA band below for a consistent branded motif ═══ */}
      <section className="lp-how lp-reveal" id="lp-how">
        <img
          className="lp-how__bg"
          src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Long_Room_Interior%2C_Trinity_College_Dublin%2C_Ireland_-_Diliff.jpg/1920px-Long_Room_Interior%2C_Trinity_College_Dublin%2C_Ireland_-_Diliff.jpg"
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
        <div className="lp-how__scrim" aria-hidden />
        <div className="lp-how__inner">
          <div className="lp-eyebrow">{t('landing.howItWorks.eyebrow')}</div>
          <h2 className="lp-how__heading">{t('landing.howItWorks.heading')}</h2>
          <div className="lp-how__steps">
            {[1, 2, 3].map((n) => (
              <div className="lp-how__step" key={n}>
                <div className="lp-how__step-number">{n}</div>
                <h3>{t(`landing.howItWorks.step${n}Title`)}</h3>
                <p>{t(`landing.howItWorks.step${n}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Pricing ═════════════════════════════════════════════════════ */}
      <section className="lp-pricing lp-reveal" id="lp-pricing">
        <div className="lp-pricing__inner">
        <div className="lp-eyebrow">{t('landing.pricing.eyebrow')}</div>
        <h2 className="lp-pricing__heading">{t('landing.pricing.heading')}</h2>

        <div className="lp-pricing__table">
          <div className="lp-pricing__col">
            <div className="lp-pricing__plan">{t('landing.pricing.freeName')}</div>
            <div className="lp-pricing__price">{t('landing.pricing.freePrice')}</div>
            <ul className="lp-pricing__rows">
              <li>✓ {t('landing.pricing.row1')}</li>
              <li>✓ {t('landing.pricing.row2')}</li>
              <li>{t('landing.pricing.row3Free')}</li>
              <li>✓ {t('landing.pricing.row4')}</li>
            </ul>
          </div>

          <div className="lp-pricing__col lp-pricing__col--pro">
            <div className="lp-pricing__plan">{t('landing.pricing.proName')}</div>
            <div className="lp-pricing__price">{t('landing.pricing.proPrice')}</div>
            <ul className="lp-pricing__rows">
              <li>✓ {t('landing.pricing.row1')}</li>
              <li>✓ {t('landing.pricing.row2')}</li>
              <li>{t('landing.pricing.row3Pro')}</li>
              <li>✓ {t('landing.pricing.row4')}</li>
            </ul>
          </div>
        </div>
        <p className="lp-pricing__note">{t('landing.pricing.note')}</p>
        </div>
      </section>

      {/* ═══ FAQ ═════════════════════════════════════════════════════════ */}
      <section className="lp-faq lp-reveal" id="lp-faq">
        <div className="lp-eyebrow">{t('landing.faq.eyebrow')}</div>
        <h2 className="lp-faq__heading">{t('landing.faq.heading')}</h2>
        <div className="lp-faq__list">
          {faqKeys.map((n) => (
            <FaqItem key={n} q={t(`landing.faq.q${n}`)} a={t(`landing.faq.a${n}`)} defaultOpen={n === 1} />
          ))}
        </div>
      </section>

      {/* ═══ Final CTA band — full-bleed photo, breaking out of the content
          rail on purpose for visual impact ═══ */}
      <section className="lp-final-cta lp-reveal">
        <img
          className="lp-final-cta__bg"
          src="https://upload.wikimedia.org/wikipedia/commons/1/11/Library_of_Congress_Main_Reading_Room.jpg"
          alt=""
          aria-hidden="true"
          loading="lazy"
        />
        <div className="lp-final-cta__scrim" aria-hidden />
        <div className="lp-final-cta__content">
          <h2>{t('landing.finalCta.heading')}</h2>
          <p>{t('landing.finalCta.sub')}</p>
          <div className="lp-final-cta__ctas">
            <button className="btn-accent btn--lg" onClick={() => setAuthMode('signup')}>
              {t('landing.finalCta.ctaPrimary')}
            </button>
            <button className="btn-text" onClick={() => setAuthMode('login')}>
              {t('landing.finalCta.ctaSecondary')}
            </button>
          </div>
        </div>
      </section>

      <LandingFooter />

      {/* Mobile sticky CTA — the "one clear primary action repeated at every
          scroll depth" from the guideline, without duplicating the full nav. */}
      <div className="lp-sticky-cta">
        <button className="btn-secondary btn--sm" onClick={() => setAuthMode('login')}>
          {t('landing.nav.login')}
        </button>
        <button className="btn-accent btn--sm lp-sticky-cta__primary" onClick={() => setAuthMode('signup')}>
          {t('landing.nav.signup')}
        </button>
      </div>

      {authMode && (
        <div className="lp-auth-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setAuthMode(null); }}>
          <SignInGate onClose={() => setAuthMode(null)} />
        </div>
      )}
    </div>
  );
}
