// src/components/LandingNav.jsx
// Public-facing nav for the Landing page AND for legal pages viewed while
// signed out (Privacy/Terms/About/Sitemap) — per the landing-page guideline,
// logged-out visitors should see the marketing site's chrome everywhere,
// not the authenticated app's nav.
//
// In-page links (Features/Pricing/About) scroll within the Landing page when
// already there; from any other public route they navigate home with an
// `anchor` param that Landing.jsx picks up on mount to scroll into place.
import { useState, useEffect } from 'react';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import LandingToggles from './LandingToggles';

export default function LandingNav({ onOpenAuth, dark = false }) {
  const { route, go } = useRouter();
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const onLanding = route.name === 'dashboard';

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 8); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function goSection(id) {
    setMobileOpen(false);
    if (onLanding) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      go('dashboard', { anchor: id });
    }
  }

  const sections = [
    { id: 'lp-features', label: t('landing.nav.features') },
    { id: 'lp-pricing', label: t('landing.nav.pricing') },
  ];

  return (
    <nav className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`} role="navigation" aria-label="Main navigation">
      <div className="lp-nav__inner">
        <button className="lp-nav__brand" onClick={() => go('dashboard')} aria-label="The Books Oracle — Home">
          <img src={dark ? '/logo-dark-mode.png' : '/logo-light-mode.png'} alt="" className="lp-nav__logo-img" />
          <span className="lp-nav__brand-text">The <span>Books</span> Oracle</span>
        </button>

        {/* No About link: `about` isn't in App.jsx's legalViews map, so a
            signed-out visitor who clicks it is dropped into the authenticated
            app shell instead of the marketing chrome. Re-add only once /about
            renders under LandingNav for logged-out visitors the way
            Privacy/Terms do. */}
        <div className="lp-nav__links">
          {sections.map((s) => (
            <button key={s.id} className="lp-nav__link" onClick={() => goSection(s.id)}>{s.label}</button>
          ))}
        </div>

        {/* One auth entry point — login and signup share the same SignInGate
            modal, so two buttons were two names for the same door. */}
        <div className="lp-nav__actions">
          <LandingToggles variant="nav" />
          <button className="btn-accent btn--sm lp-nav__signup" onClick={() => onOpenAuth?.('login')}>
            {t('landing.nav.auth')}
          </button>
        </div>

        {/* On mobile the toggles stay in the bar rather than moving into the
            hamburger sheet — the whole point is that a visitor can set language
            and palette before the story starts, and a control behind a menu
            isn't a control they'll find in the first three seconds. */}
        <div className="lp-nav__bar-toggles">
          <LandingToggles variant="bar" />
        </div>

        <button
          className={`lp-nav__hamburger${mobileOpen ? ' is-open' : ''}`}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={mobileOpen}
        >
          <span /><span /><span />
        </button>
      </div>

      {/* Mobile quick-links sheet — a short slide-down panel, not the full-screen
          app hamburger menu (this page has ~4 destinations, not 20). */}
      {mobileOpen && (
        <div className="lp-nav__mobile">
          {sections.map((s) => (
            <button key={s.id} className="lp-nav__mobile-link" onClick={() => goSection(s.id)}>{s.label}</button>
          ))}
          <div className="lp-nav__mobile-actions">
            <button className="btn-accent btn--block" onClick={() => { setMobileOpen(false); onOpenAuth?.('login'); }}>
              {t('landing.nav.auth')}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
