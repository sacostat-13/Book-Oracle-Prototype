// src/components/PublicBar.jsx
//
// The top of a public page (book, series) for a visitor who is not signed in.
// Someone who clicked a search result has never heard of the site: before this
// bar the page had no nav at all — no name, no way home, no way in. It says
// what the place is in one line and offers the door.
//
// Theme-aware on purpose (unlike LandingNav, which is parchment-only): it sits
// on top of the app-styled page the visitor is reading.

import { useRouter } from '../contexts/RouterContext';
import { useT } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthPrompt } from '../contexts/AuthPromptContext';
import { trackEvent } from '../lib/api/funnel';

/** @param {{ from: string }} props  funnel label of the page, e.g. 'book' */
export default function PublicBar({ from }) {
  const { route, go } = useRouter();
  const t = useT();
  const { theme } = useTheme();
  const { openAuth } = useAuthPrompt();

  function start() {
    trackEvent('cta_click', { cta: `${from}_bar_start` }, route.name);
    openAuth({ mode: 'signup', from: `${from}_bar` });
  }

  function signIn() {
    openAuth({ mode: 'signin', from: `${from}_bar_signin` });
  }

  return (
    <header className="public-bar">
      <div className="public-bar__inner">
        <a
          className="public-bar__brand"
          href="/"
          onClick={(e) => { e.preventDefault(); go('dashboard'); }}
          aria-label="The Books Oracle — Home"
        >
          <img
            src={theme === 'dark' ? '/logo-dark-mode.png' : '/logo-light-mode.png'}
            alt=""
            className="public-bar__logo"
          />
          <span className="public-bar__name">The Books Oracle</span>
        </a>
        <p className="public-bar__tagline">{t('growth.bar.tagline')}</p>
        <div className="public-bar__actions">
          <button className="btn-text" onClick={signIn}>{t('growth.bar.signIn')}</button>
          <button className="btn-accent btn--sm" onClick={start}>{t('growth.bar.start')}</button>
        </div>
      </div>
    </header>
  );
}
