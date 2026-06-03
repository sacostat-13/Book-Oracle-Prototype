import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/I18nContext';

export default function Nav() {
  const { state } = useData();
  const { route, go } = useRouter();
  const { user, signInWithGoogle, signOut } = useAuth();
  const { lang, toggleLang, t } = useI18n();
  const wishCount = state.wishlist.length;

  // Show the *other* language as the toggle label, since clicking switches to it
  const toggleLabel = lang === 'en' ? t('nav.switchToSpanish') : t('nav.switchToEnglish');

  return (
    <nav className="topnav">
      <div className="brand" onClick={() => go('dashboard')} role="button" tabIndex={0}>
        {t('app.brand', { wishlist: <span className="accent">{t('app.brandAccent')}</span> })}
      </div>
      <div className="nav-spacer"></div>
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
        <button
          className="nav-btn"
          onClick={toggleLang}
          title={toggleLabel}
          aria-label={toggleLabel}
        >
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
    </nav>
  );
}
