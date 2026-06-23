// src/components/Nav.jsx — v0.27
// Primary nav: Dashboard · Wishlist · Library · Reading (dropdown) · Lists · Oracle
// Overflow "···": Profile · About · Language · Sign out

import { useState, useEffect, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/I18nContext';
import { useTheme } from '../lib/ThemeContext';
import { OracleQuotaBadge } from '../components/OracleQuotaBadge';
import NavSearch from './NavSearch';

export default function Nav({ onPreviewBook }) {
  const { state } = useData();
  const { route, go } = useRouter();
  const { user, signInWithGoogle, signOut } = useAuth();
  const { lang, toggleLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen]       = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const [moreOpen, setMoreOpen]       = useState(false);
  const readingRef = useRef(null);
  const moreRef    = useRef(null);

  const toggleLabel = lang === 'en' ? t('nav.switchToSpanish') : t('nav.switchToEnglish');

  // Close dropdowns on route change
  useEffect(() => { setMenuOpen(false); setReadingOpen(false); setMoreOpen(false); }, [route.name]);

  // Close dropdowns on outside click
  useEffect(() => {
    function onDown(e) {
      if (readingRef.current && !readingRef.current.contains(e.target)) setReadingOpen(false);
      if (moreRef.current    && !moreRef.current.contains(e.target))    setMoreOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Body scroll lock for mobile menu
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  function navigate(name, params) {
    setMenuOpen(false); setReadingOpen(false); setMoreOpen(false);
    go(name, params);
  }

  const readingCount = (state.currentlyReading?.length || 0) + (state.readNext?.length || 0);
  const readingActive = ['currently-reading','read-next'].includes(route.name);
  const listsCount = (state.lists || []).length;
  const clubsCount = (state.clubs || []).length;
  const clubsActive = ['book-clubs','book-club-create','book-club-detail','session-create','session-detail'].includes(route.name);

  return (
    <>
      <nav className="topnav">
        <div className="brand" onClick={() => navigate('dashboard')} role="button" tabIndex={0}>
          {t('app.brand', { wishlist: <span className="accent">{t('app.brandAccent')}</span> })}
        </div>

        <NavSearch onPreviewBook={onPreviewBook} />

        <div className="nav-spacer" />

        {/* ── Desktop nav ── */}
        <div className="nav-links">

          {/* Wishlist */}
          <button className={`nav-btn${route.name==='wishlist'?' active':''}`} onClick={() => go('wishlist')}>
            {t('nav.wishlist')}
            {state.wishlist.length > 0 && <span className="nav-badge">{state.wishlist.length}</span>}
          </button>

          {/* Library */}
          <button className={`nav-btn${route.name==='library'?' active':''}`} onClick={() => go('library')}>
            {t('nav.library')}
            {state.library.length > 0 && <span className="nav-badge">{state.library.length}</span>}
          </button>

          {/* Reading — dropdown for Currently Reading + Read Next */}
          <div className="nav-dropdown-wrap" ref={readingRef}>
            <button
              className={`nav-btn nav-btn--dropdown${readingActive?' active':''}`}
              onClick={() => setReadingOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={readingOpen}
            >
              {t('currentlyReading.titleAccent')}
              {readingCount > 0 && <span className="nav-badge">{readingCount}</span>}
              <span className="nav-dropdown-caret" aria-hidden>▾</span>
            </button>
            {readingOpen && (
              <div className="nav-dropdown">
                <button
                  className={`nav-dropdown-item${route.name==='currently-reading'?' active':''}`}
                  onClick={() => navigate('currently-reading')}
                >
                  {t('about.featureCurrentlyReadingTitle')}
                  {state.currentlyReading?.length > 0 && (
                    <span className="nav-badge">{state.currentlyReading.length}</span>
                  )}
                </button>
                <button
                  className={`nav-dropdown-item${route.name==='read-next'?' active':''}`}
                  onClick={() => navigate('read-next')}
                >
                  {t('nav.readNext')}
                  {state.readNext?.length > 0 && (
                    <span className="nav-badge">{state.readNext.length}</span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Lists */}
          <button className={`nav-btn${route.name==='lists'?' active':''}`} onClick={() => go('lists')}>
            {t('about.featureListsTitle')}
            {listsCount > 0 && <span className="nav-badge">{listsCount}</span>}
          </button>

          {/* Book Clubs */}
          <button className={`nav-btn${clubsActive?' active':''}`} onClick={() => go('book-clubs')}>
            {t('clubs.titleAccent')}
            {clubsCount > 0 && <span className="nav-badge">{clubsCount}</span>}
          </button>

          {/* Oracle */}
          <button className={`nav-btn${route.name==='oracle'?' active':''}`} onClick={() => go('oracle')}>
            {t('about.titleAccent')}
            <OracleQuotaBadge style={{ marginLeft: '0.4rem', verticalAlign: 'middle' }} />
          </button>

          {/* ··· overflow dropdown */}
          <div className="nav-dropdown-wrap nav-dropdown-wrap--right" ref={moreRef}>
            <button
              className={`nav-btn nav-btn--dropdown${['profile','about'].includes(route.name)?' active':''}`}
              onClick={() => setMoreOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              title="More"
            >
              ···
            </button>
            {moreOpen && (
              <div className="nav-dropdown nav-dropdown--right">
                <button
                  className={`nav-dropdown-item${route.name==='profile'?' active':''}`}
                  onClick={() => navigate('profile')}
                >
                  {t('nav.profile')}
                </button>
                <button
                  className={`nav-dropdown-item${route.name==='about'?' active':''}`}
                  onClick={() => navigate('about')}
                >
                  {t('nav.about')}
                </button>
                <div className="nav-dropdown-divider" />
                <button className="nav-dropdown-item" onClick={() => { toggleLang(); setMoreOpen(false); }}>
                  {toggleLabel}
                </button>
                <button className="nav-dropdown-item" onClick={() => { toggleTheme(); setMoreOpen(false); }}>
                  {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
                </button>
                <div className="nav-dropdown-divider" />
                {user ? (
                  <button className="nav-dropdown-item nav-dropdown-item--muted" onClick={() => { signOut(); setMoreOpen(false); }} title={user.email}>
                    {t('nav.signOut')}
                  </button>
                ) : (
                  <button className="nav-dropdown-item" onClick={() => { signInWithGoogle(); setMoreOpen(false); }}>
                    {t('nav.signIn')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile hamburger */}
        <button
          className={`nav-hamburger${menuOpen?' is-open':''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={menuOpen}
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* ── Mobile full-screen menu ── */}
      {menuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true" aria-label={t('nav.menuLabel')}>
          <nav className="mobile-menu-links">
            {[
              { name:'wishlist',          label: t('nav.wishlist'),                 count: state.wishlist.length },
              { name:'library',           label: t('nav.library'),                  count: state.library.length },
              { name:'currently-reading', label: t('nav.currentlyReadingFull'), count: state.currentlyReading?.length },
              { name:'read-next',         label: t('nav.readNext'),                 count: state.readNext?.length },
              { name:'lists',             label: t('nav.lists'),    count: listsCount },
              { name:'book-clubs',        label: t('nav.bookClubs'),    count: clubsCount },
              { name:'oracle',            label: t('nav.oracle'),      count: 0 },
              { name:'profile',           label: t('nav.profile'),                  count: 0 },
              { name:'about',             label: t('nav.about'),                    count: 0 },
            ].map(({ name, label, count }) => (
              <button
                key={name}
                className={`mobile-menu-btn${route.name===name?' active':''}`}
                onClick={() => navigate(name)}
              >
                {label}
                {count > 0 && <span className="nav-badge">{count}</span>}
              </button>
            ))}

            <div className="mobile-menu-divider" />

            <button className="mobile-menu-btn mobile-menu-btn--secondary" onClick={() => { toggleLang(); setMenuOpen(false); }}>
              {toggleLabel}
            </button>
            <button className="mobile-menu-btn mobile-menu-btn--secondary" onClick={() => { toggleTheme(); setMenuOpen(false); }}>
              {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
            </button>
            {user ? (
              <button className="mobile-menu-btn mobile-menu-btn--secondary" onClick={() => { signOut(); setMenuOpen(false); }} title={user.email}>
                {t('nav.signOut')}
              </button>
            ) : (
              <button className="mobile-menu-btn mobile-menu-btn--secondary" onClick={() => { signInWithGoogle(); setMenuOpen(false); }}>
                {t('nav.signIn')}
              </button>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
