// src/components/Footer.jsx — The Books Oracle R2
// DS footer: 3-column inset card (brand+social | Product | Legal) + bottom bar.
// Zero inline styles — all classes from layout/_footer.scss.

import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { useTheme } from '../lib/ThemeContext';

const IconFacebook = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8v-2.9h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.5.7-1.5 1.5v1.8h2.6l-.4 2.9h-2.2v7A10 10 0 0 0 22 12z" /></svg>
);
const IconInstagram = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5zm-5 6.5A3.5 3.5 0 1 1 8.5 12 3.5 3.5 0 0 1 12 8.5zm4.8-1.3a.9.9 0 1 1-.9-.9.9.9 0 0 1 .9.9z" /></svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M22 5.9c-.7.3-1.5.5-2.3.6a4 4 0 0 0 1.8-2.2c-.8.5-1.7.8-2.6 1a4 4 0 0 0-6.8 3.6A11.3 11.3 0 0 1 3.7 4.6a4 4 0 0 0 1.2 5.3c-.6 0-1.2-.2-1.8-.5a4 4 0 0 0 3.2 4 4 4 0 0 1-1.8.1 4 4 0 0 0 3.7 2.8A8 8 0 0 1 2 18a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.4-6.1 11.4-11.4v-.5c.8-.6 1.5-1.3 2-2z" /></svg>
);

export default function Footer({ guestMode = false }) {
  const { go } = useRouter();
  const { lang, toggleLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const year = new Date().getFullYear();

  const productLinks = [
    { label: t('footer.about') || 'About', route: 'about' },
    { label: t('nav.oracle') || 'The Oracle', route: 'oracle' },
    { label: t('nav.readNext') || 'Reading plans', route: 'read-next' },
    { label: t('footer.pricing') || 'Pricing', route: 'profile' },
  ];

  const legalLinks = [
    { label: t('footer.privacy') || 'Privacy Policy', route: 'privacy' },
    { label: t('footer.terms') || 'Terms of Service', route: 'terms' },
    { label: t('footer.refund') || 'Refund Policy', route: 'refund' },
    { label: t('footer.sitemap') || 'Sitemap', route: 'sitemap' },
  ];

  const socialLinks = [
    { href: 'https://facebook.com', Icon: IconFacebook, label: 'Facebook' },
    { href: 'https://instagram.com', Icon: IconInstagram, label: 'Instagram' },
    { href: 'https://x.com', Icon: IconX, label: 'X / Twitter' },
  ];

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="footer-card">

        {/* ── Three-column body ── */}
        <div className="footer-body">

          {/* Col 1: brand + tagline + social */}
          <div className="footer-brand">
            <button className="footer-brand__wordmark footer-link" onClick={() => go('dashboard')}>
              The <span>Books</span> Oracle
            </button>
            <p className="footer-brand__tagline">
              {t('footer.tagline') || 'Your reading companion — wishlist, library, plans and an Oracle that knows what you\'ll love next.'}
            </p>
            <div className="footer-brand__social">
              {socialLinks.map(({ href, Icon, label }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-social-btn"
                  aria-label={label}
                >
                  <Icon />
                </a>
              ))}
            </div>
          </div>

          {/* Col 2: Product — hidden in guest mode (unauthenticated legal pages) */}
          {!guestMode && (
            <div className="footer-col">
              <div className="footer-col__heading">{t('footer.product') || 'Product'}</div>
              <div className="footer-col__links">
                {productLinks.map(({ label, route }) => (
                  <button key={route} className="footer-link" onClick={() => go(route)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Col 3: Legal */}
          <div className="footer-col">
            <div className="footer-col__heading">{t('footer.legal') || 'Legal'}</div>
            <div className="footer-col__links">
              {legalLinks.map(({ label, route }) => (
                <button key={route} className="footer-link" onClick={() => go(route)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="footer-bar">
          <span className="footer-copy">
            {t('footer.copyright', { year }) || `© ${year} The Books Oracle. All rights reserved.`}
          </span>

          <div className="footer-legal">
            {legalLinks.map(({ label, route }) => (
              <button key={route} className="footer-link" onClick={() => go(route)}>
                {label}
              </button>
            ))}
            <button className="footer-link" onClick={toggleTheme}>
              {theme === 'dark' ? '☀ Parchment' : '☾ Dark'}
            </button>
            <button className="footer-link" onClick={toggleLang}>
              {lang === 'en' ? t('nav.switchToSpanish') : t('nav.switchToEnglish')}
            </button>
          </div>
        </div>

      </div>
    </footer>
  );
}
