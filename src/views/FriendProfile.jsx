// src/views/FriendProfile.jsx — v0.36
// Public-facing profile for another user. Reached via /u/:username or from
// the notification panel. Shows: currently reading, library, stats, public lists.
// Privacy prefs (show_library, show_wishlist) are respected.

import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/useFriends';
import { getProfileByUsername, getFriendLibrary, getFriendCurrentlyReading } from '../lib/useFriends';
import { openBookTab } from '../lib/bookHelpers';

function Cover({ book, size = 56 }) {
  const style = { width: size, height: Math.round(size * 1.5), borderRadius: 2, objectFit: 'cover', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.45)', display: 'block', cursor: 'pointer' };
  if (book?.coverUrl || book?.cover_url) {
    return <img src={book.coverUrl || book.cover_url} alt={book.t || book.book?.title} style={style} onClick={() => openBookTab(book.book || book, 'friend-profile')} />;
  }
  return <div style={{ ...style, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }} />;
}

export default function FriendProfile() {
  const { route, go } = useRouter();
  const { user } = useAuth();
  const { state } = useData();
  const t = useT();
  const { friends, sendRequest, pending } = useFriends();

  const username = route.params?.username;

  const [profile,  setProfile]  = useState(null);
  const [library,  setLibrary]  = useState([]);
  const [reading,  setReading]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reqSent,  setReqSent]  = useState(false);
  const [reqError, setReqError] = useState(null);

  // Friendship state with this user
  const isFriend   = friends.some((f) => f.other?.username === username);
  const hasPending = pending.some((p) => p.other?.username === username);
  const isSelf     = state.profile?.username === username;

  useEffect(() => {
    if (!username) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    setNotFound(false);
    setProfile(null);
    setLibrary([]);
    setReading([]);

    getProfileByUsername(username).then(async (p) => {
      if (!p) { setNotFound(true); setLoading(false); return; }
      setProfile(p);

      // Load library and currently reading in parallel
      const privacyPrefs = p.preferences || {};
      const showLibrary = privacyPrefs.friendsCanSeeLibrary !== false; // default true

      const [lib, cr] = await Promise.all([
        showLibrary || isSelf ? getFriendLibrary(p.id) : [],
        getFriendCurrentlyReading(p.id),
      ]);
      setLibrary(lib);
      setReading(cr);
      setLoading(false);
    });
  }, [username, isSelf]);

  async function handleSendRequest() {
    if (!profile) return;
    const result = await sendRequest(profile.id);
    if (result?.ok) { setReqSent(true); setReqError(null); }
    else { setReqError(result?.error || 'error'); }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem', gap: '0.75rem' }}>
      <div className="loading-spinner" />
      <span style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {t('common.loading')}
      </span>
    </div>
  );

  if (notFound) return (
    <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '2rem', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
        {t('friends.profileNotFound')}
      </div>
      <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('friends.profileNotFoundSub')}</p>
      <button className="btn btn-ghost" style={{ marginTop: '1.5rem' }} onClick={() => go('dashboard')}>{t('common.goHome')}</button>
    </div>
  );

  const displayName = profile.display_name || profile.username;
  const thisYear = new Date().getFullYear();
  const booksThisYear = library.filter((b) => b.read_at?.startsWith(String(thisYear))).length;
  const totalBooks    = library.length;

  // Friendship action button
  let friendBtn = null;
  if (!isSelf && user) {
    if (isFriend) {
      friendBtn = <span className="status-pill status-pill--read">{t('friends.alreadyFriends')}</span>;
    } else if (hasPending || reqSent) {
      friendBtn = <span className="status-pill status-pill--queued">{t('friends.requestSent')}</span>;
    } else {
      friendBtn = (
        <button className="btn" onClick={handleSendRequest}>
          {t('friends.sendRequest')}
        </button>
      );
    }
  }

  return (
    <div className="friend-profile">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a>
        {' '}·{' '}
        {displayName}
      </div>

      {/* Header */}
      <div className="friend-profile__header">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt={displayName} className="friend-profile__avatar" />
        ) : (
          <div className="friend-profile__avatar friend-profile__avatar--fallback">
            {displayName[0].toUpperCase()}
          </div>
        )}
        <div className="friend-profile__identity">
          <h1 className="page-title" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', marginBottom: '0.2rem' }}>
            {displayName}
          </h1>
          {profile.username && (
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              @{profile.username}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {booksThisYear > 0 && (
              <span className="level-pill">▤ {t('friends.booksThisYear', { count: booksThisYear, year: thisYear })}</span>
            )}
            {totalBooks > 0 && (
              <span className="level-pill">◈ {t('friends.totalBooks', { count: totalBooks })}</span>
            )}
            {reading.length > 0 && (
              <span className="level-pill" style={{ background: 'var(--status-reading-bg)', borderColor: 'var(--status-reading-border)', color: 'var(--status-reading-fg)' }}>
                ❧ {t('friends.currentlyReading', { count: reading.length })}
              </span>
            )}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {friendBtn}
          {reqError && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--blood-bright)', marginTop: '0.4rem', fontStyle: 'italic' }}>{t(`friends.reqError_${reqError}`, { defaultValue: t('friends.reqErrorGeneric') })}</div>}
        </div>
      </div>

      {/* Currently Reading */}
      {reading.length > 0 && (
        <section className="friend-profile__section">
          <div className="page-eyebrow">{t('friends.sectionReading')}</div>
          <div className="db-cr__grid">
            {reading.map((cr, i) => {
              const b = cr.book || cr;
              return (
                <div key={i} className="db-cr__card" onClick={() => openBookTab(b, 'friend-profile')}>
                  <Cover book={{ ...b, coverUrl: b.cover_url || b.coverUrl }} size={72} />
                  <div className="db-cr__meta">
                    <div className="db-cr__title">{b.title || b.t}</div>
                    <div className="db-cr__author">{b.author || b.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Library */}
      {library.length > 0 && (
        <section className="friend-profile__section">
          <div className="page-eyebrow">{t('friends.sectionLibrary')}</div>
          <div className="friend-profile__library-grid">
            {library.slice(0, 24).map((row, i) => {
              const b = row.book || row;
              return (
                <div key={i} className="friend-profile__library-item" onClick={() => openBookTab(b, 'friend-profile')}>
                  <Cover book={{ ...b, coverUrl: b.cover_url || b.coverUrl }} size={80} />
                  {row.rating > 0 && (
                    <div style={{ marginTop: '0.3rem', color: 'var(--gilt)', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
                      {'★'.repeat(row.rating)}<span style={{ opacity: 0.2 }}>{'★'.repeat(5 - row.rating)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {library.length > 24 && (
            <p style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              +{library.length - 24} {t('friends.moreBooks')}
            </p>
          )}
        </section>
      )}

      {/* Share own profile link (only when viewing own profile) */}
      {isSelf && profile.username && (
        <section className="friend-profile__section">
          <div className="page-eyebrow">{t('friends.shareProfile')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', background: 'var(--surface-tint)', border: '1px solid var(--border-subtle)', borderRadius: '3px', flexWrap: 'wrap' }}>
            <code style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              {window.location.origin}/u/{profile.username}
            </code>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem', flexShrink: 0 }}
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/u/${profile.username}`)}
            >
              {t('friends.copyLink')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
