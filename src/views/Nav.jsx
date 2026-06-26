// src/components/Nav.jsx — v0.36
// Primary nav: Dashboard · Wishlist · Library · Reading (dropdown) · Lists · Oracle
// Overflow "···": Profile · About · Language · Sign out
// v0.36: notification bell with unread badge + slide-in panel

import { useState, useEffect, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/I18nContext';
import { useTheme } from '../lib/ThemeContext';
import { useNotifications, notificationLabel, notificationRoute } from '../lib/useNotifications';
import AnnouncementModal from './AnnouncementModal';
import { useFriends } from '../lib/useFriends';
import NavSearch from './NavSearch';

export default function Nav({ onPreviewBook }) {
  const { state } = useData();
  const { route, go } = useRouter();
  const { user, signInWithGoogle, signOut } = useAuth();
  const { lang, toggleLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { notifications, unreadCount, markAllRead, markOneRead } = useNotifications();
  const { acceptRequest, declineRequest } = useFriends();
  const [menuOpen, setMenuOpen]                     = useState(false);
  const [readingOpen, setReadingOpen]               = useState(false);
  const [moreOpen, setMoreOpen]                     = useState(false);
  const [bellOpen, setBellOpen]                     = useState(false);
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);
  const readingRef = useRef(null);
  const moreRef    = useRef(null);
  const bellRef    = useRef(null);

  const toggleLabel = lang === 'en' ? t('nav.switchToSpanish') : t('nav.switchToEnglish');

  // Close dropdowns on route change
  useEffect(() => { setMenuOpen(false); setReadingOpen(false); setMoreOpen(false); setBellOpen(false); }, [route.name]);

  // Close dropdowns on outside click
  useEffect(() => {
    function onDown(e) {
      if (readingRef.current && !readingRef.current.contains(e.target)) setReadingOpen(false);
      if (moreRef.current    && !moreRef.current.contains(e.target))    setMoreOpen(false);
      if (bellRef.current    && !bellRef.current.contains(e.target))    setBellOpen(false);
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
    setMenuOpen(false); setReadingOpen(false); setMoreOpen(false); setBellOpen(false);
    go(name, params);
  }

  function openBell() {
    setBellOpen((v) => {
      if (!v) markAllRead(); // mark all read when opening
      return !v;
    });
    setMoreOpen(false);
    setReadingOpen(false);
  }

  async function handleAccept(friendshipId, notifId) {
    await acceptRequest(friendshipId);
    markOneRead(notifId);
  }

  async function handleDecline(friendshipId, notifId) {
    await declineRequest(friendshipId);
    markOneRead(notifId);
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
          </button>

          {/* Library */}
          <button className={`nav-btn${route.name==='library'?' active':''}`} onClick={() => go('library')}>
            {t('nav.library')}
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
              <span className="nav-dropdown-caret" aria-hidden>▾</span>
            </button>
            {readingOpen && (
              <div className="nav-dropdown">
                <button
                  className={`nav-dropdown-item${route.name==='currently-reading'?' active':''}`}
                  onClick={() => navigate('currently-reading')}
                >
                  {t('about.featureCurrentlyReadingTitle')}
                </button>
                <button
                  className={`nav-dropdown-item${route.name==='read-next'?' active':''}`}
                  onClick={() => navigate('read-next')}
                >
                  {t('nav.readNext')}
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
          </button>

          {/* Notification bell */}
          {user && (
            <div className="nav-dropdown-wrap nav-dropdown-wrap--right" ref={bellRef}>
              <button
                className={`nav-btn nav-bell${bellOpen ? ' active' : ''}`}
                onClick={openBell}
                aria-label={t('nav.notifications')}
                title={t('nav.notifications')}
              >
                🔔
                {unreadCount > 0 && (
                  <span className="nav-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>

              {bellOpen && (
                <div className="nav-dropdown nav-dropdown--right nav-notif-panel">
                  <div className="nav-notif-header">
                    <span style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gilt)' }}>
                      {t('nav.notifications')}
                    </span>
                  </div>

                  {notifications.length === 0 ? (
                    <div className="nav-notif-empty">
                      {t('nav.noNotifications')}
                    </div>
                  ) : (
                    <div className="nav-notif-list">
                      {notifications.map((n) => {
                        const actor      = n.actor;
                        const actorLabel = actor?.display_name || (actor?.username ? `@${actor.username}` : t('notifications.someone'));
                        const label      = notificationLabel(n, t);
                        const route      = notificationRoute(n);
                        const friendshipId = n.data?.friendship_id;

                        return (
                          <div
                            key={n.id}
                            className={`nav-notif-item${n.read ? '' : ' nav-notif-item--unread'}`}
                            onClick={() => {
                              markOneRead(n.id);
                              if (n.type === 'announcement') {
                                setActiveAnnouncement(n.data || {});
                                setBellOpen(false);
                              } else if (route) {
                                go(route[0], route[1]);
                                setBellOpen(false);
                              }
                            }}
                            style={{ cursor: (n.type === 'announcement' || route) ? 'pointer' : 'default' }}
                          >
                            {/* Avatar */}
                            {actor?.avatar_url ? (
                              <img src={actor.avatar_url} alt={actorLabel} className="nav-notif-avatar" />
                            ) : (
                              <div className="nav-notif-avatar nav-notif-avatar--fallback">
                                {n.type === 'announcement' ? '✦' : (actor?.display_name || actor?.username || '?')[0].toUpperCase()}
                              </div>
                            )}

                            <div className="nav-notif-body">
                              <div className="nav-notif-text">{label}</div>

                              {/* Friend request inline actions */}
                              {n.type === 'friend_request' && !n.read && (
                                <div className="nav-notif-actions" onClick={(e) => e.stopPropagation()}>
                                  <button className="btn" style={{ fontSize: 'var(--text-xs)', padding: '0.25rem 0.65rem' }} onClick={() => handleAccept(friendshipId, n.id)}>
                                    {t('nav.accept')}
                                  </button>
                                  <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.25rem 0.65rem' }} onClick={() => handleDecline(friendshipId, n.id)}>
                                    {t('nav.decline')}
                                  </button>
                                </div>
                              )}

                              <div className="nav-notif-time">
                                {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
              { name:'wishlist',          label: t('nav.wishlist'),              count: 0 },
              { name:'library',           label: t('nav.library'),               count: 0 },
              { name:'currently-reading', label: t('nav.currentlyReadingFull'),  count: 0 },
              { name:'read-next',         label: t('nav.readNext'),              count: 0 },
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

      {activeAnnouncement && (
        <AnnouncementModal
          announcement={activeAnnouncement}
          onClose={() => setActiveAnnouncement(null)}
        />
      )}
    </>
  );
}
