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

const PAGE_SIZE = 48;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeBook(row) {
  // row is a read_books row with book:books(*) join on row.book
  // _genres is attached by getFriendLibrary from a separate book_genres query
  const b = row.book || {};
  return {
    id:       row.id,
    bookId:   b.id,
    // books table uses 'title', 'author', 'cover_url', 'page_count'
    // (DataContext maps these to t, a, coverUrl, pp via bookRowToClient)
    t:        b.title      || '',
    a:        b.author     || '',
    coverUrl: b.cover_url  || null,
    pp:       b.page_count || null,
    g:        b.genre      || null,   // raw genre text field (pre-Oracle)
    rating:   row.rating   || null,
    notes:    row.notes    || null,
    dateRead: row.read_at  || null,
    genres:   row._genres  || [],     // from separate book_genres query
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
    <div style={{ ...style, background: 'linear-gradient(155deg,#3a2a1c,#1a100a)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)' }} onClick={onClick}>
      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: Math.max(7, size / 9), color: 'rgba(233,217,182,0.45)', textAlign: 'center', padding: '4px', lineHeight: 1.2 }}>
        {book.t?.slice(0, 14)}
      </span>
    </div>
  );
}

function Stars({ rating }) {
  if (!rating) return null;
  return (
    <div style={{ color: 'var(--gilt)', fontSize: '0.65rem', marginTop: '0.25rem', lineHeight: 1 }}>
      {'★'.repeat(rating)}<span style={{ opacity: 0.2 }}>{'★'.repeat(5 - rating)}</span>
    </div>
  );
}

// ── Friend Library ─────────────────────────────────────────────────────────────

function FriendLibrary({ library, go, t }) {
  const [search,      setSearch]      = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [yearFilter,  setYearFilter]  = useState('all');
  const [sort,        setSort]        = useState('recent');
  const [page,        setPage]        = useState(1);

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
      case 'title':   out = [...out].sort((a, b) => (a.t || '').localeCompare(b.t || '')); break;
      case 'author':  out = [...out].sort((a, b) => (a.a || '').localeCompare(b.a || '')); break;
      case 'rating':  out = [...out].sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      case 'recent':
      default:        out = [...out].sort((a, b) => (b.dateRead || '') > (a.dateRead || '') ? 1 : -1); break;
    }

    return out;
  }, [library, search, genreFilter, yearFilter, sort]);

  const visible  = filtered.slice(0, page * PAGE_SIZE);
  const hasMore  = visible.length < filtered.length;
  const hasFilter = search || genreFilter !== 'all' || yearFilter !== 'all' || sort !== 'recent';

  const selectStyle = {
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    color: 'var(--text-primary)',
    borderRadius: '2px',
    padding: '0.4rem 0.6rem',
    fontFamily: "'Special Elite', monospace",
    fontSize: 'var(--text-xs)',
    letterSpacing: '0.08em',
    cursor: 'pointer',
  };

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.25rem' }}>
        {/* Search */}
        <input
          type="text"
          placeholder={t('friends.librarySearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...selectStyle, fontFamily: "'EB Garamond', serif", fontSize: 'var(--text-sm)', fontStyle: 'italic', minWidth: '200px', flex: '1 1 200px', maxWidth: '300px' }}
        />

        {/* Genre filter */}
        {genreOptions.length > 0 && (
          <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)} style={selectStyle}>
            <option value="all">{t('friends.libraryAllGenres')}</option>
            {genreOptions.map((o) => (
              <option key={o.normalized_name} value={o.normalized_name}>☩ {o.name}</option>
            ))}
          </select>
        )}

        {/* Year filter */}
        {yearOptions.length > 1 && (
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={selectStyle}>
            <option value="all">{t('friends.libraryAllYears')}</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}

        {/* Sort */}
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...selectStyle, marginLeft: 'auto' }}>
          <option value="recent">{t('friends.librarySortRecent')}</option>
          <option value="rating">{t('friends.librarySortRating')}</option>
          <option value="title">{t('friends.librarySortTitle')}</option>
          <option value="author">{t('friends.librarySortAuthor')}</option>
        </select>

        {/* Result count */}
        <span style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {t('friends.libraryCount', { count: filtered.length })}
        </span>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', color: 'var(--text-muted)', padding: '1rem 0' }}>
          {t('friends.libraryNoResults')}
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '1rem' }}>
            {visible.map((b) => (
              <div
                key={b.id}
                style={{ cursor: 'pointer', transition: 'transform 0.15s' }}
                onClick={() => openBookTab(b, 'friend-profile')}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = ''}
                title={`${b.t}${b.a ? ` · ${b.a}` : ''}${b.dateRead ? ` · ${new Date(b.dateRead).getFullYear()}` : ''}`}
              >
                <Cover book={b} size={90} onClick={() => openBookTab(b, 'friend-profile')} />
                <Stars rating={b.rating} />
                {/* Show title + author on hover via title attr; on mobile show abbreviated */}
                <div style={{ marginTop: '0.3rem', overflow: 'hidden' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.t}
                  </div>
                  <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>
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
              style={{ display: 'block', width: '100%', marginTop: '1.5rem', padding: '0.75rem', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '2px', cursor: 'pointer', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1rem', color: 'var(--text-muted)', transition: 'background 0.15s, border-color 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.borderColor = 'var(--border-mid)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
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
  const { friends, sendRequest, pending } = useFriends();

  const username = route.params?.username;

  const [profile,  setProfile]  = useState(null);
  const [library,  setLibrary]  = useState([]);
  const [reading,  setReading]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reqSent,  setReqSent]  = useState(false);
  const [reqError, setReqError] = useState(null);

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

      const privacyPrefs = p.preferences || {};
      const showLibrary  = privacyPrefs.friendsCanSeeLibrary !== false;

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

  const displayName   = profile.display_name || profile.username;
  const thisYear      = new Date().getFullYear();
  const booksThisYear = library.filter((b) => b.dateRead?.startsWith(String(thisYear))).length;
  const showLibrary   = (profile.preferences?.friendsCanSeeLibrary !== false) || isSelf;

  let friendBtn = null;
  if (!isSelf && user) {
    if (isFriend) {
      friendBtn = <span className="status-pill status-pill--read">{t('friends.alreadyFriends')}</span>;
    } else if (hasPending || reqSent) {
      friendBtn = <span className="status-pill status-pill--queued">{t('friends.requestSent')}</span>;
    } else {
      friendBtn = <button className="btn" onClick={handleSendRequest}>{t('friends.sendRequest')}</button>;
    }
  }

  return (
    <div className="friend-profile">
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a>
        {' '}·{' '}{displayName}
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
            {booksThisYear > 0 && <span className="level-pill">▤ {t('friends.booksThisYear', { count: booksThisYear, year: thisYear })}</span>}
            {library.length > 0 && <span className="level-pill">◈ {t('friends.totalBooks', { count: library.length })}</span>}
            {reading.length > 0 && (
              <span className="level-pill" style={{ background: 'var(--status-reading-bg)', borderColor: 'var(--status-reading-border)', color: 'var(--status-reading-fg)' }}>
                ❧ {t('friends.currentlyReading', { count: reading.length })}
              </span>
            )}
          </div>
        </div>

        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {friendBtn}
          {reqError && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--blood-bright)', marginTop: '0.4rem', fontStyle: 'italic' }}>
              {t(`friends.reqError_${reqError}`) || t('friends.reqErrorGeneric')}
            </div>
          )}
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
                <div key={i} className="db-cr__card" onClick={() => openBookTab({ t: b.title || b.t, a: b.author || b.a, coverUrl: b.cover_url || b.coverUrl }, 'friend-profile')}>
                  <Cover book={{ t: b.title || b.t, a: b.author || b.a, coverUrl: b.cover_url || b.coverUrl }} size={72} />
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

      {/* Full library with filters */}
      <section className="friend-profile__section">
        <div className="page-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
          {t('friends.sectionLibrary')}
        </div>
        {!showLibrary ? (
          <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', color: 'var(--text-muted)' }}>
            {t('friends.libraryPrivate')}
          </p>
        ) : library.length === 0 ? (
          <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', color: 'var(--text-muted)' }}>
            {t('friends.libraryEmpty')}
          </p>
        ) : (
          <FriendLibrary library={library} go={go} t={t} />
        )}
      </section>

      {/* Share own profile link */}
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
