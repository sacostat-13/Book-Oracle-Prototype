// src/components/LandingFooter.jsx
// Footer for the Landing page and for legal pages viewed signed-out.
// Includes the ES/EN language dropdown called for in the landing guideline —
// copy still lives in the same src/i18n/*.json catalogs as the rest of the
// app, just under the `landing` key, so translators edit one place.
import { useState, useRef, useEffect } from 'react';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';

function useClickOutside(ref, onClose) {
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

export default function LandingFooter() {
  const { go } = useRouter();
  const { lang, setLang, t } = useI18n();
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));

  const legalLinks = [
    { label: t('footer.privacy') || 'Privacy Policy', route: 'privacy' },
    { label: t('footer.terms') || 'Terms of Service', route: 'terms' },
    { label: t('footer.refund') || 'Refund Policy', route: 'refund' },
    { label: t('footer.sitemap') || 'Sitemap', route: 'sitemap' },
    { label: t('footer.about') || 'About', route: 'about' },
  ];

  const current = LANGS.find((l) => l.code === lang) || LANGS[0];

  return (
    <footer className="lp-footer" role="contentinfo">
      <div className="lp-footer__inner">
        <div className="lp-footer__brand">
          <span className="lp-footer__wordmark">The <span>Books</span> Oracle</span>
          <p className="lp-footer__tagline">{t('footer.tagline')}</p>
        </div>

        <div className="lp-footer__links">
          {legalLinks.map(({ label, route }) => (
            <button key={route} className="lp-footer__link" onClick={() => go(route)}>{label}</button>
          ))}
        </div>

        <div className="lp-footer__lang" ref={ref}>
          <button
            className="lp-footer__lang-trigger"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            🌐 {current.label}
          </button>
          {open && (
            <div className="lp-footer__lang-menu" role="listbox">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  role="option"
                  aria-selected={l.code === lang}
                  className={`lp-footer__lang-option${l.code === lang ? ' is-active' : ''}`}
                  onClick={() => { setLang(l.code); setOpen(false); }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lp-footer__bar">
        <span>{t('footer.copyright', { year })}</span>
      </div>
    </footer>
  );
}
