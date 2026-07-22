// src/components/LandingToggles.jsx
// The two visitor controls that sit at the very top of the landing story:
// language (EN/ES) and appearance (ink/parchment).
//
// Both are thin wrappers over the existing app-wide contexts — I18nContext
// owns `lang` + the ?lang= URL param, ThemeContext owns `oracle.theme` in
// localStorage and the `theme-*` body class. Nothing new is persisted here,
// so a visitor who switches on the landing page and later signs up lands in
// the app with the same language and palette they chose while scrolling.
//
// Rendered in two places (see LandingNav): the desktop nav bar and the mobile
// slide-down sheet. `variant="sheet"` lays them out full-width, stacked.
import { useI18n } from '../lib/I18nContext';
import { useTheme } from '../lib/ThemeContext';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9z" />
    </svg>
  );
}

export default function LandingToggles({ variant = 'nav' }) {
  const { lang, setLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const isDark = theme === 'dark';
  const themeLabel = isDark ? t('landing.nav.toParchment') : t('landing.nav.toInk');

  return (
    <div className={`lp-toggles lp-toggles--${variant}`}>
      {/* Language: a segmented control rather than a single flip button, so the
          option you are NOT on is always visible and labelled. A visitor who
          reads no English still sees "ES" and knows where to click. */}
      <div className="lp-toggles__seg" role="group" aria-label={t('landing.nav.langLabel')}>
        <button
          type="button"
          className={`lp-toggles__segbtn${lang === 'en' ? ' is-active' : ''}`}
          onClick={() => setLang('en')}
          aria-pressed={lang === 'en'}
          title={t('landing.nav.toEnglish')}
        >
          {t('landing.nav.langEn')}
        </button>
        <span className="lp-toggles__segdiv" aria-hidden="true" />
        <button
          type="button"
          className={`lp-toggles__segbtn${lang === 'es' ? ' is-active' : ''}`}
          onClick={() => setLang('es')}
          aria-pressed={lang === 'es'}
          title={t('landing.nav.toSpanish')}
        >
          {t('landing.nav.langEs')}
        </button>
      </div>

      {/* Appearance: one button showing the destination, not the current state —
          the icon is what you'll get, which is the convention visitors expect. */}
      <button
        type="button"
        className="lp-toggles__theme"
        onClick={toggleTheme}
        aria-label={themeLabel}
        title={themeLabel}
      >
        <span className="lp-toggles__icon">{isDark ? <SunIcon /> : <MoonIcon />}</span>
        {variant === 'sheet' && <span className="lp-toggles__themetext">{themeLabel}</span>}
      </button>
    </div>
  );
}
