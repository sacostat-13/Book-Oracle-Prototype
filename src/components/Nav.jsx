import { useState, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/I18nContext';

export default function Nav() {
  const { state } = useData();
  const { route, go } = useRouter();
  const { user, signInWithGoogle, signOut } = useAuth();
  const { lang, toggleLang, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const wishCount = state.wishlist.length;

  const toggleLabel = lang === 'en' ? t('nav.switchToSpanish') : t('nav.switchToEnglish');

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [route.name]);

  // Lock body scroll while menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  function navigate(name) {
    setMenuOpen(false);
    go(name);
  }

  return (
    <>
      <nav className="topnav">
        <div className="brand" onClick={() => navigate('dashboard')} role="button" tabIndex={0}>
          {t('app.brand', { wishlist: <span className="accent">{t('app.brandAccent')}</span> })}
        </div>

        {/* Search placeholder — functional in v0.18 */}
        <div className="nav-search-placeholder" aria-hidden="true" />

        <div className="nav-spacer" />

        {/* Desktop nav links */}
        <div className="nav-links">
          <button
            className={`nav-btn ${route.name === 'wishlist' ? 'active' : ''}`}
            onClick={() => go('wishlist')}
          >
            {t('nav.wishlist')} {wishCount > 0 && <span className="nav-badge">{wishCount}</span>}
          </button>
          <button
            className={`nav-btn ${route.name === 'library' ? 'active' : ''}`}
            onClick={() => go('library')}
          >
            {t('nav.library')} {state.library.length > 0 && <span className="nav-badge">{state.library.length}</span>}
          </button>
          <button
            className={`nav-btn ${route.name === 'read-next' ? 'active' : ''}`}
            onClick={() => go('read-next')}
          >
            {t('nav.readNext')} {state.readNext.length > 0 && <span className="nav-badge">{state.readNext.length}</span>}
          </button>
          <button
            className={`nav-btn ${route.name === 'profile' ? 'active' : ''}`}
            onClick={() => go('profile')}
          >
            {t('nav.profile')}
          </button>
          <button
            className={`nav-btn ${route.name === 'about' ? 'active' : ''}`}
            onClick={() => go('about')}
          >
            {t('nav.about')}
          </button>
          <button className="nav-btn" onClick={toggleLang} title={toggleLabel} aria-label={toggleLabel}>
            {toggleLabel}
          </button>
          {user ? (
            <button className="nav-btn" onClick={signOut} title={user.email}>
              {t('nav.signOut')}
            </button>
          ) : (
            <button className="nav-btn" onClick={signInWithGoogle}>
              {t('nav.signIn')}
            </button>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className={`nav-hamburger${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      {/* Mobile full-screen menu */}
      {menuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true" aria-label={t('nav.menuLabel')}>
          <nav className="mobile-menu-links">
            <button
              className={`mobile-menu-btn${route.name === 'wishlist' ? ' active' : ''}`}
              onClick={() => navigate('wishlist')}
            >
              {t('nav.wishlist')}
              {wishCount > 0 && <span className="nav-badge">{wishCount}</span>}
            </button>
            <button
              className={`mobile-menu-btn${route.name === 'library' ? ' active' : ''}`}
              onClick={() => navigate('library')}
            >
              {t('nav.library')}
              {state.library.length > 0 && <span className="nav-badge">{state.library.length}</span>}
            </button>
            <button
              className={`mobile-menu-btn${route.name === 'read-next' ? ' active' : ''}`}
              onClick={() => navigate('read-next')}
            >
              {t('nav.readNext')}
              {state.readNext.length > 0 && <span className="nav-badge">{state.readNext.length}</span>}
            </button>
            <button
              className={`mobile-menu-btn${route.name === 'profile' ? ' active' : ''}`}
              onClick={() => navigate('profile')}
            >
              {t('nav.profile')}
            </button>
            <button
              className={`mobile-menu-btn${route.name === 'about' ? ' active' : ''}`}
              onClick={() => navigate('about')}
            >
              {t('nav.about')}
            </button>

            <div className="mobile-menu-divider" />

            <button className="mobile-menu-btn mobile-menu-btn--secondary" onClick={() => { toggleLang(); setMenuOpen(false); }}>
              {toggleLabel}
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
