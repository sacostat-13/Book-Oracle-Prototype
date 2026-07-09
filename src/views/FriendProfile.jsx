// src/views/FriendProfile.jsx — v0.36.2
// Public-facing profile for another user.
// v0.36.2: full filterable, searchable, sortable library with load-more pagination.

import { useEffect, useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useAuth } from '../lib/AuthContext';
import { useFriends, getProfileByUsername, getFriendLibrary, getFriendCurrentlyReading } from '../lib/useFriends';
import { openBookTab } from '../lib/bookHelpers';
import ShareModal from '../components/ShareModal';
import { profileShareUrl } from '../lib/shareService';

const PAGE_SIZE = 48;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeBook(row) {
  // row is a read_books row with book:books(*) join on row.book
  // _genres is attached by getFriendLibrary from a separate book_genres query
  const b = row.book || {};
  return {
    id: row.id,
    bookId: b.id,
    // books table uses 'title', 'author', 'cover_url', 'page_count'
    // (DataContext maps these to t, a, coverUrl, pp via bookRowToClient)
    t: b.title || '',
    a: b.author || '',
    coverUrl: b.cover_url || null,
    pp: b.page_count || null,
    g: b.genre || null,   // raw genre text field (pre-Oracle)
    rating: row.rating || null,
    notes: row.notes || null,
    dateRead: row.read_at || null,
    genres: row._genres || [],     // from separate book_genres query
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Cover({ book, size = 80, onClick }) {
  const style = {
    width: size, height: Math.round(size * 1.5), borderRadius: 2,
    objectFit: 'cover', display: 'block', flexShrink: 0,
    boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
    cursor: onClick ? 'pointer' : 'default',
  };
  if (book.coverUrl) return <img src={book.coverUrl} alt={book.t} style={style} onClick={onClick} />;
  return (
    <div style={{ ...style, background: 'linear-gradient(155deg,#3a2a1c,#1a100a)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--ro-border-subtle)' }} onClick={onClick}>
      <span style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: Math.max(7, size / 9), color: 'rgba(233,217,182,0.45)', textAlign: 'center', padding: '4px', lineHeight: 1.2 }}>
        {book.t?.slice(0, 14)}
      </span>
    </div>
  );
}

function Stars({ rating }) {
  if (!rating) return null;
  return (
    <div className="fp-mini-stars">
      {'★'.repeat(rating)}<span>{'★'.repeat(5 - rating)}</span>
    </div>
  );
}

// ── Friend Library ─────────────────────────────────────────────────────────────

function FriendLibrary({ library, go, t }) {
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);

  // Reset page when filters change
  useEffect(() => setPage(1), [search, genreFilter, yearFilter, sort]);

  // Build genre options from the library data
  const genreOptions = useMemo(() => {
    const map = new Map();
    for (const b of library) {
      for (const g of b.genres || []) {
        if (!map.has(g.normalized_name)) {
          map.set(g.normalized_name, { name: g.name, normalized_name: g.normalized_name });
        }
      }
      // Also surface the fallback genre field
      if ((!b.genres || b.genres.length === 0) && b.g) {
        const key = b.g.toLowerCase().replace(/\s+/g, '_');
        if (!map.has(key)) map.set(key, { name: b.g, normalized_name: key });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [library]);

  // Build year options
  const yearOptions = useMemo(() => {
    const years = new Set();
    for (const b of library) {
      if (b.dateRead) years.add(new Date(b.dateRead).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [library]);

  // Filter
  const filtered = useMemo(() => {
    let out = library;

    if (search) {
      const q = search.toLowerCase();
      out = out.filter((b) =>
        b.t?.toLowerCase().includes(q) || b.a?.toLowerCase().includes(q)
      );
    }

    if (genreFilter !== 'all') {
      out = out.filter((b) => {
        const hasGenreTag = (b.genres || []).some((g) => g.normalized_name === genreFilter);
        if (hasGenreTag) return true;
        // Fallback to raw genre field
        if (!b.genres?.length && b.g) {
          return b.g.toLowerCase().replace(/\s+/g, '_') === genreFilter;
        }
        return false;
      });
    }

    if (yearFilter !== 'all') {
      out = out.filter((b) => b.dateRead && new Date(b.dateRead).getFullYear() === Number(yearFilter));
    }

    // Sort
    switch (sort) {
      case 'title': out = [...out].sort((a, b) => (a.t || '').localeCompare(b.t || '')); break;
      case 'author': out = [...out].sort((a, b) => (a.a || '').localeCompare(b.a || '')); break;
      case 'rating': out = [...out].sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      case 'recent':
      default: out = [...out].sort((a, b) => (b.dateRead || '') > (a.dateRead || '') ? 1 : -1); break;
    }

    return out;
  }, [library, search, genreFilter, yearFilter, sort]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;
  const hasFilter = search || genreFilter !== 'all' || yearFilter !== 'all' || sort !== 'recent';

  return (
    <>
      {/* Toolbar — matches Library/Wishlist layout */}
      <div className="lv-toolbar">
        <div className="lv-toolbar__filters">
          {/* Search */}
          <div className="lv-search">
            <svg className="lv-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              className="lv-search__input"
              placeholder={t('friends.librarySearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Genre filter */}
          {genreOptions.length > 0 && (
            <select className="select" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
              <option value="all">{t('friends.libraryAllGenres')}</option>
              {genreOptions.map((o) => (
                <option key={o.normalized_name} value={o.normalized_name}>☩ {o.name}</option>
              ))}
            </select>
          )}

          {/* Year filter */}
          {yearOptions.length > 1 && (
            <select className="select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="all">{t('friends.libraryAllYears')}</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>

        {/* Sort + count — right side */}
        <div className="fp-hero__actions">
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">{t('friends.librarySortRecent')}</option>
            <option value="rating">{t('friends.librarySortRating')}</option>
            <option value="title">{t('friends.librarySortTitle')}</option>
            <option value="author">{t('friends.librarySortAuthor')}</option>
          </select>
          <span className="pf-overline">
            {t('friends.libraryCount', { count: filtered.length })}
          </span>
        </div>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <p className="fp-empty">
          {t('friends.libraryNoResults')}
        </p>
      ) : (
        <>
          <div className="fp-book-grid">
            {visible.map((b) => (
              <div
                key={b.id}
                className="fp-book-item"
                onClick={() => openBookTab(b, 'friend-profile')}
                title={`${b.t}${b.a ? ` · ${b.a}` : ''}${b.dateRead ? ` · ${new Date(b.dateRead).getFullYear()}` : ''}`}
              >
                <Cover book={b} size={90} onClick={() => openBookTab(b, 'friend-profile')} />
                <Stars rating={b.rating} />
                {/* Show title + author on hover via title attr; on mobile show abbreviated */}
                <div >
                  <div className="fp-book-title">
                    {b.t}
                  </div>
                  <div className="fp-book-title" style={{ fontSize: "0.65rem", marginTop: "1px" }}>
                    {b.a}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              className="btn-tertiary btn--block" style={{ marginTop: '1.5rem' }}
            >
              {t('friends.libraryLoadMore')} ({filtered.length - visible.length} {t('friends.moreBooks')})
            </button>
          )}
        </>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FriendProfile() {
  const { route, go } = useRouter();
  const { user } = useAuth();
  const { state } = useData();
  const t = useT();
  const { friends, sendRequest, declineRequest, pending } = useFriends();

  const username = route.params?.username;

  const [profile, setProfile] = useState(null);
  const [library, setLibrary] = useState([]);
  const [reading, setReading] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reqSent, setReqSent] = useState(false);
  const [reqError, setReqError] = useState(null);
  const [shareOpen, setShareOpen] = useState(false); // v0.43

  const isFriend = friends.some((f) => f.other?.username === username);
  const pendingEntry = pending.find((p) => p.other?.username === username);
  const hasPending = !!pendingEntry;
  const isSelf = state.profile?.username === username;

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

      const privacyPrefs = p.preferences || {};
      const showLibrary = privacyPrefs.friendsCanSeeLibrary !== false;

      const [libRaw, cr] = await Promise.all([
        showLibrary || isSelf ? getFriendLibrary(p.id) : Promise.resolve([]),
        getFriendCurrentlyReading(p.id),
      ]);
      setLibrary(libRaw.map(normalizeBook));
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

  async function handleWithdrawRequest() {
    if (!pendingEntry) { setReqSent(false); return; }
    await declineRequest(pendingEntry.id);
    setReqSent(false);
    setReqError(null);
  }

  if (loading) return (
    <div className="loading">
      <div className="loading-spinner" />
      <span className="loading-text">
        {t('common.loading')}
      </span>
    </div>
  );

  if (notFound) return (
    <div className="lv-empty">
      <div className="lv-empty-title">
        {t('friends.profileNotFound')}
      </div>
      <p className="lv-empty-text">{t('friends.profileNotFoundSub')}</p>
      <button className="btn-secondary" onClick={() => go('dashboard')}>{t('common.goHome')}</button>
    </div>
  );

  const displayName = profile.display_name || profile.username;
  const thisYear = new Date().getFullYear();
  const booksThisYear = library.filter((b) => b.dateRead?.startsWith(String(thisYear))).length;
  const showLibrary = (profile.preferences?.friendsCanSeeLibrary !== false) || isSelf;

  let friendBtn = null;
  if (!isSelf && user) {
    if (isFriend) {
      friendBtn = <span className="status status--read">{t('friends.alreadyFriends')}</span>;
    } else if (hasPending) {
      friendBtn = (
        <button className="btn-secondary friend-withdraw-btn" onClick={handleWithdrawRequest}>
          <span className="friend-withdraw-btn__sent">{t('friends.requestSent')}</span>
          <span className="friend-withdraw-btn__cancel">{t('friends.withdrawRequest')}</span>
        </button>
      );
    } else if (reqSent) {
      friendBtn = <span className="status status--reading">{t('friends.requestSent')}</span>;
    } else {
      friendBtn = <button className="btn-primary" onClick={handleSendRequest}>{t('friends.sendRequest')}</button>;
    }
  }

  return (
    <div className="fp-page">
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a>
        {' '}·{' '}{displayName}
      </div>

      {/* Header */}
      <div className="fp-hero">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt={displayName} className="friend-avatar" style={{ '--fa-sz': '88px' }} />
        ) : (
          <div className="friend-avatar--fallback" style={{ '--fa-sz': '88px' }}>
            {displayName[0].toUpperCase()}
          </div>
        )}

        <div className="fp-hero__info">
          <h1 className="fp-hero__name">
            {displayName}
          </h1>
          {profile.username && (
            <div className="fp-hero__handle">
              @{profile.username}
            </div>
          )}
          <div className="bp-meta">
            {booksThisYear > 0 && <span className="bp-pill">▤ {t('friends.booksThisYear', { count: booksThisYear, year: thisYear })}</span>}
            {library.length > 0 && <span className="bp-pill">◈ {t('friends.totalBooks', { count: library.length })}</span>}
            {reading.length > 0 && (
              <span className="bp-pill">
                ❧ {t('friends.currentlyReading', { count: reading.length })}
              </span>
            )}
          </div>
        </div>

        <div className="fp-hero__actions">
          {friendBtn}
          {reqError && (
            <div className="pf-error">
              {t(`friends.reqError_${reqError}`) || t('friends.reqErrorGeneric')}
            </div>
          )}
        </div>
      </div>

      {/* Currently Reading */}
      {reading.length > 0 && (
        <section>
          <div className="pf-overline">{t('friends.sectionReading')}</div>
          <div className="db-cr-grid">
            {reading.map((cr, i) => {
              const b = cr.book || cr;
              return (
                <div key={i} className="db-cr-card" onClick={() => openBookTab({ t: b.title || b.t, a: b.author || b.a, coverUrl: b.cover_url || b.coverUrl }, 'friend-profile')}>
                  <Cover book={{ t: b.title || b.t, a: b.author || b.a, coverUrl: b.cover_url || b.coverUrl }} size={72} />
                  <div className="db-cr-body">
                    <div className="db-cr-title">{b.title || b.t}</div>
                    <div className="db-cr-author">{b.author || b.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Full library with filters */}
      <section>
        <div className="pf-overline">
          {t('friends.sectionLibrary')}
        </div>
        {!showLibrary ? (
          <p className="fp-empty">
            {t('friends.libraryPrivate')}
          </p>
        ) : library.length === 0 ? (
          <p className="fp-empty">
            {t('friends.libraryEmpty')}
          </p>
        ) : (
          <FriendLibrary library={library} go={go} t={t} />
        )}
      </section>

      {/* Share own profile link — v0.43: opens the full share modal */}
      {isSelf && profile.username && (
        <section>
          <div className="pf-overline">{t('friends.shareProfile')}</div>
          <div className="panel pf-value-row">
            <code className="pf-username-url" style={{ flex: 1, wordBreak: "break-all" }}>
              {window.location.origin}/u/{profile.username}
            </code>
            <button
              className="btn-tertiary btn--sm"
              onClick={() => setShareOpen(true)}
            >
              ↗ {t('share.shareProfile')}
            </button>
          </div>
        </section>
      )}

      {shareOpen && profile.username && (
        <ShareModal
          title={profile.display_name || `@${profile.username}`}
          text={t('share.text.profile', { name: profile.display_name || profile.username })}
          url={profileShareUrl(profile.username)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
