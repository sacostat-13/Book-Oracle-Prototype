// src/components/Nav.jsx — The Books Oracle R2
// Grouped topbar: Logo · My Books ▾ · Social ▾ · [Oracle pill] · Search · 🔔 · User ▾
// Mobile: wordmark + ☰ → full-screen overlay menu (DS mobmenu pattern)
// Zero inline styles — all classes from layout/_nav.scss.

import { useState, useEffect, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/I18nContext';
import { useTheme } from '../lib/ThemeContext';
import { useNotifications, notificationLabel, notificationRoute } from '../lib/useNotifications';
import { useFriends } from '../lib/useFriends';
import AnnouncementModal from './AnnouncementModal';
import NavSearch from './NavSearch';

// ── SVG icons ─────────────────────────────────────────────────────────────────
const IconBell = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const IconChevron = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const IconOracle = () => (
  // 4-pointed sparkle — the Oracle's sigil
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5Z" />
  </svg>
);

// ── Logo mark (theme-aware raster logo) ──────────────────────────────────────
// Both images are always in the DOM; CSS shows only the one matching the
// current theme via the `theme-dark` / `theme-parchment` class Body carries
// (see ThemeContext.jsx). No re-render needed when the theme toggles.
const LogoMark = () => (
  <div className="nav-logo__mark" aria-hidden>
    <img src="/logo-dark-mode.png" alt="" className="nav-logo__img nav-logo__img--dark" />
    <img src="/logo-light-mode.png" alt="" className="nav-logo__img nav-logo__img--light" />
  </div>
);

// ── Utility: close-on-outside-click hook ──────────────────────────────────────
function useClickOutside(ref, onClose) {
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

// ── Notification item ─────────────────────────────────────────────────────────
function NotifItem({ n, t, onClose, go, markOneRead, onAnnouncement, handleAccept, handleDecline }) {
  const actor = n.actor;
  const label = notificationLabel(n, t);
  const dest = notificationRoute(n);
  const fId = n.data?.friendship_id;
  const clickable = n.type === 'announcement' || !!dest;

  function handleClick() {
    markOneRead(n.id);
    if (n.type === 'announcement') { onAnnouncement(n.data || {}); onClose(); }
    else if (dest) { go(dest[0], dest[1]); onClose(); }
  }

  const avatarContent = n.type === 'announcement'
    ? '✦'
    : (actor?.display_name || actor?.username || '?')[0].toUpperCase();

  return (
    <div
      className={`notif-item${n.read ? '' : ' notif-item--unread'}${clickable ? ' notif-item--clickable' : ''}`}
      onClick={clickable ? handleClick : undefined}
    >
      {actor?.avatar_url
        ? <img src={actor.avatar_url} alt="" className="notif-item__avatar" />
        : <div className="notif-item__avatar">{avatarContent}</div>
      }
      <div className="notif-item__body">
        <div className="notif-item__text" dangerouslySetInnerHTML={{ __html: label }} />
        {n.type === 'friend_request' && !n.read && (
          <div className="notif-item__actions" onClick={e => e.stopPropagation()}>
            <button className="btn-primary btn--sm" onClick={() => handleAccept(fId, n.id)}>
              {t('nav.accept')}
            </button>
            <button className="btn-tertiary btn--sm" onClick={() => handleDecline(fId, n.id)}>
              {t('nav.decline')}
            </button>
          </div>
        )}
        <div className="notif-item__time">
          {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Nav({ onPreviewBook }) {
  const { state } = useData();
  const { route, go } = useRouter();
  const { user, signInWithGoogle, signOut } = useAuth();
  const { lang, toggleLang, t, tNode } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { notifications, unreadCount, markAllRead, markOneRead } = useNotifications();
  const { acceptRequest, declineRequest } = useFriends();

  const [menuOpen, setMenuOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);

  const booksRef = useRef(null);
  const socialRef = useRef(null);
  const bellRef = useRef(null);
  const userRef = useRef(null);

  useClickOutside(booksRef, () => setBooksOpen(false));
  useClickOutside(socialRef, () => setSocialOpen(false));
  useClickOutside(bellRef, () => setBellOpen(false));
  useClickOutside(userRef, () => setUserOpen(false));

  // Close all dropdowns on route change, unlock scroll
  useEffect(() => {
    setBooksOpen(false); setSocialOpen(false);
    setBellOpen(false); setUserOpen(false);
    setMenuOpen(false);
  }, [route.name]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  function nav(name, params) {
    setMenuOpen(false); setBooksOpen(false); setSocialOpen(false);
    setBellOpen(false); setUserOpen(false);
    go(name, params);
  }

  function openBell() {
    const next = !bellOpen;
    setBellOpen(next);
    if (next) markAllRead();
    setSocialOpen(false); setBooksOpen(false); setUserOpen(false);
  }

  async function handleAccept(fId, nId) { await acceptRequest(fId); markOneRead(nId); }
  async function handleDecline(fId, nId) { await declineRequest(fId); markOneRead(nId); }

  // Counts
  const readingCount = (state.currentlyReading?.length || 0) + (state.readNext?.length || 0);
  const listsCount = (state.lists || []).length;
  const clubsCount = (state.clubs || []).length;

  // Active-state helpers
  const booksActive = ['wishlist', 'library', 'currently-reading', 'read-next', 'plan-create', 'plan-view'].includes(route.name);
  const socialActive = ['lists', 'book-clubs', 'book-club-create', 'book-club-detail',
    'session-create', 'session-detail', 'friends', 'friend-profile'].includes(route.name);

  // User display
  const userLabel = state.profile?.displayName || user?.email?.split('@')[0] || '';
  const userAvatar = state.profile?.avatar_url;
  const userInitial = userLabel?.[0]?.toUpperCase() || '?';
  const toggleLangLabel = lang === 'en' ? t('nav.switchToSpanish') : t('nav.switchToEnglish');

  return (
    <>
      {/* ════ Top bar ════════════════════════════════════════════════════════ */}
      <nav className="topnav" role="navigation" aria-label="Main navigation">

        {/* Logo */}
        <button className="nav-logo" onClick={() => nav('dashboard')} aria-label="The Books Oracle — Home">
          <LogoMark />
        </button>

        {/* ── Desktop nav groups ── */}
        <div className="nav-groups">

          {/* My Books ▾ */}
          <div className="nav-group" ref={booksRef}>
            <button
              className={`nav-group__trigger${booksActive ? ' is-active' : ''}`}
              onClick={() => { setBooksOpen(v => !v); setSocialOpen(false); setUserOpen(false); }}
              aria-haspopup="true"
              aria-expanded={booksOpen}
            >
              {t('nav.myBooks') || 'My Books'}
              {/* {readingCount > 0 && <span className="nav-group__badge">{readingCount}</span>} */}
              <span className="nav-group__caret"><IconChevron /></span>
            </button>

            {booksOpen && (
              <div className="nav-group__menu">
                <button className={`nav-group__item${route.name === 'wishlist' ? ' is-active' : ''}`} onClick={() => nav('wishlist')}>
                  {t('nav.wishlist')}
                  {state.wishlist?.length > 0 && <span className="nav-group__badge">{state.wishlist.length}</span>}
                </button>
                <button className={`nav-group__item${route.name === 'library' ? ' is-active' : ''}`} onClick={() => nav('library')}>
                  {t('nav.library')}
                  {state.library?.length > 0 && <span className="nav-group__badge">{state.library.length}</span>}
                </button>
                <div className="nav-group__divider" />
                <button className={`nav-group__item${route.name === 'currently-reading' ? ' is-active' : ''}`} onClick={() => nav('currently-reading')}>
                  {t('nav.currentlyReadingFull')}
                  {state.currentlyReading?.length > 0 && <span className="nav-group__badge">{state.currentlyReading.length}</span>}
                </button>
                <button className={`nav-group__item${route.name === 'read-next' ? ' is-active' : ''}`} onClick={() => nav('read-next')}>
                  {t('nav.readNext')}
                  {state.readNext?.length > 0 && <span className="nav-group__badge">{state.readNext.length}</span>}
                </button>
                <div className="nav-group__divider" />
                <button className={`nav-group__item${(route.name === 'plan-create' || route.name === 'plan-view') ? ' is-active' : ''}`} onClick={() => nav('plan-create')}>
                  {t('nav.plans')}
                </button>
              </div>
            )}
          </div>

          {/* Social ▾ */}
          <div className="nav-group" ref={socialRef}>
            <button
              className={`nav-group__trigger${socialActive ? ' is-active' : ''}`}
              onClick={() => { setSocialOpen(v => !v); setBooksOpen(false); setUserOpen(false); }}
              aria-haspopup="true"
              aria-expanded={socialOpen}
            >
              {t('nav.social') || 'Social'}
              <span className="nav-group__caret"><IconChevron /></span>
            </button>

            {socialOpen && (
              <div className="nav-group__menu">
                <button className={`nav-group__item${route.name === 'lists' ? ' is-active' : ''}`} onClick={() => nav('lists')}>
                  {t('nav.lists')}
                  {listsCount > 0 && <span className="nav-group__badge">{listsCount}</span>}
                </button>
                <button className={`nav-group__item${['book-clubs', 'book-club-detail', 'book-club-create'].includes(route.name) ? ' is-active' : ''}`} onClick={() => nav('book-clubs')}>
                  {t('nav.bookClubs')}
                  {clubsCount > 0 && <span className="nav-group__badge">{clubsCount}</span>}
                </button>
                <button className={`nav-group__item${['friends', 'friend-profile'].includes(route.name) ? ' is-active' : ''}`} onClick={() => nav('friends')}>
                  {t('nav.friends') || 'Friends'}
                </button>
              </div>
            )}
          </div>

          {/* Oracle pill — distinct accent CTA */}
          <button
            className={`nav-oracle${route.name === 'oracle' ? ' is-active' : ''}`}
            onClick={() => nav('oracle')}
            aria-label="The Oracle"
          >
            <span className="nav-oracle__icon"><IconOracle /></span>
            {t('nav.oracle')}
          </button>
        </div>

        <div className="nav-spacer" />

        {/* Search */}
        <div className="nav-search">
          <NavSearch onPreviewBook={onPreviewBook} />
        </div>

        {/* ── Icon cluster ── */}
        <div className="nav-icons">

          {/* Bell */}
          {user && (
            <div style={{ position: 'relative' }} ref={bellRef}>
              <button
                className={`nav-bell${bellOpen ? ' is-open' : ''}`}
                onClick={openBell}
                aria-label={t('nav.notifications')}
              >
                <IconBell />
                {unreadCount > 0 && (
                  <span className="nav-bell__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>

              {bellOpen && (
                <div className="notif-panel">
                  <div className="notif-panel__head">{t('nav.notifications')}</div>
                  {notifications.length === 0 ? (
                    <div className="notif-panel__empty">{t('nav.noNotifications')}</div>
                  ) : (
                    <div className="notif-panel__list">
                      {notifications.map(n => (
                        <NotifItem
                          key={n.id}
                          n={n} t={t}
                          onClose={() => setBellOpen(false)}
                          go={go}
                          markOneRead={markOneRead}
                          onAnnouncement={setActiveAnnouncement}
                          handleAccept={handleAccept}
                          handleDecline={handleDecline}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* User chip */}
          <div style={{ position: 'relative' }} ref={userRef}>
            <button
              className={`nav-user${userOpen ? ' is-open' : ''}`}
              onClick={() => { setUserOpen(v => !v); setBooksOpen(false); setSocialOpen(false); setBellOpen(false); }}
              aria-haspopup="true"
              aria-expanded={userOpen}
            >
              <div className="nav-user__avatar">
                {userAvatar
                  ? <img src={userAvatar} alt={userLabel} />
                  : userInitial
                }
              </div>
              {userLabel && <span className="nav-user__label">{userLabel}</span>}
            </button>

            {userOpen && (
              <div className="nav-group__menu nav-group__menu--right">
                <button className={`nav-group__item${route.name === 'profile' ? ' is-active' : ''}`} onClick={() => nav('profile')}>
                  {t('nav.profile')}
                </button>
                <button className={`nav-group__item${route.name === 'about' ? ' is-active' : ''}`} onClick={() => nav('about')}>
                  {t('nav.about')}
                </button>
                <div className="nav-group__divider" />
                <button className="nav-group__item" onClick={() => { toggleLang(); setUserOpen(false); }}>
                  {toggleLangLabel}
                </button>
                <button className="nav-group__item" onClick={() => { toggleTheme(); setUserOpen(false); }}>
                  {theme === 'dark' ? '☀ ' + (t('nav.parchmentMode') || 'Parchment') : '☾ ' + (t('nav.darkMode') || 'Dark mode')}
                </button>
                <div className="nav-group__divider" />
                {user
                  ? <button className="nav-group__item" onClick={() => { signOut(); setUserOpen(false); }} title={user.email}>{t('nav.signOut')}</button>
                  : <button className="nav-group__item" onClick={() => { signInWithGoogle(); setUserOpen(false); }}>{t('nav.signIn')}</button>
                }
              </div>
            )}
          </div>
        </div>

        {/* Mobile hamburger */}
        <button
          className={`nav-hamburger${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* ════ Mobile full-screen menu ════════════════════════════════════════ */}
      {menuOpen && (
        <div id="mobile-menu" className="mobile-menu" role="dialog" aria-modal="true" aria-label={t('nav.menuLabel')}>
          <div className="mobile-menu__head">
            <LogoMark />
            <div className="mobile-menu__search">
              <NavSearch onPreviewBook={onPreviewBook} compact />
            </div>
            <button
              className="btn-icon"
              onClick={() => setMenuOpen(false)}
              aria-label={t('nav.closeMenu')}
            >✕</button>
          </div>

          <div className="mobile-menu__body">
            <div className="mobile-menu__section-label">{t('nav.myBooks') || 'My Books'}</div>
            {[
              { name: 'wishlist', label: t('nav.wishlist'), count: state.wishlist?.length },
              { name: 'library', label: t('nav.library'), count: state.library?.length },
              { name: 'currently-reading', label: t('nav.currentlyReadingFull'), count: state.currentlyReading?.length },
              { name: 'read-next', label: t('nav.readNext'), count: state.readNext?.length },
            ].map(({ name, label, count }) => (
              <button key={name} className={`mobile-menu__item${route.name === name ? ' is-active' : ''}`} onClick={() => nav(name)}>
                {label}
                {count > 0 && <span className="mobile-menu__badge">{count}</span>}
              </button>
            ))}
            <button className={`mobile-menu__item${(route.name === 'plan-create' || route.name === 'plan-view') ? ' is-active' : ''}`} onClick={() => nav('plan-create')}>
              {t('nav.plans')}
            </button>

            <div className="mobile-menu__section-label">Social</div>
            {[
              { name: 'lists', label: t('nav.lists'), count: listsCount },
              { name: 'book-clubs', label: t('nav.bookClubs'), count: clubsCount },
              { name: 'friends', label: t('nav.friends') || 'Friends', count: 0 },
            ].map(({ name, label, count }) => (
              <button key={name} className={`mobile-menu__item${route.name === name ? ' is-active' : ''}`} onClick={() => nav(name)}>
                {label}
                {count > 0 && <span className="mobile-menu__badge">{count}</span>}
              </button>
            ))}

            <div className="mobile-menu__section-label">Oracle</div>
            <button className={`mobile-menu__item${route.name === 'oracle' ? ' is-active' : ''}`} onClick={() => nav('oracle')}>
              ✦ {t('nav.oracle')}
            </button>
          </div>

          <div className="mobile-menu__foot">
            <button className="mobile-menu__item" onClick={() => nav('profile')}>{t('nav.profile')}</button>
            <button className="mobile-menu__item" onClick={() => nav('about')}>{t('nav.about')}</button>
            <div className="mobile-menu__divider" />
            <button className="mobile-menu__item" onClick={() => { toggleLang(); setMenuOpen(false); }}>{toggleLangLabel}</button>
            <button className="mobile-menu__item" onClick={() => { toggleTheme(); setMenuOpen(false); }}>
              {theme === 'dark' ? '☀ Parchment' : '☾ Dark mode'}
            </button>
            <div className="mobile-menu__divider" />
            {user
              ? <button className="mobile-menu__item" onClick={() => { signOut(); setMenuOpen(false); }} title={user.email}>{t('nav.signOut')}</button>
              : <button className="mobile-menu__item" onClick={() => { signInWithGoogle(); setMenuOpen(false); }}>{t('nav.signIn')}</button>
            }
          </div>
        </div>
      )}

      {activeAnnouncement && (
        <AnnouncementModal announcement={activeAnnouncement} onClose={() => setActiveAnnouncement(null)} />
      )}
    </>
  );
}
