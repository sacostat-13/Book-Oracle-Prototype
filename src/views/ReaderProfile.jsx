// src/views/ReaderProfile.jsx — v0.66
//
// Another reader's public profile. Was FriendProfile; renamed with the model.
//
// v0.36.2: full filterable, searchable, sortable library with load-more pagination.
// v0.66: follows replace friendships, and the privacy check moved to the server.
//
// The old version read `preferences.friendsCanSeeLibrary` and decided in
// JavaScript whether to run the library query. That made a privacy setting only
// as strong as the client honouring it — anyone could call getFriendLibrary
// directly. Now shelf_visibility is enforced by can_view_shelf() inside the
// read_books policy, and this file reads the same column ONLY to choose which
// sentence to show when the rows do not arrive. If the two ever disagree, the
// rows win, and the reader sees an honest empty state rather than data they
// should not have.

import { useEffect, useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useAuth } from '../lib/AuthContext';
import {
  useFollows,
  getProfileByUsername,
  getReaderLibrary,
  getReaderCurrentlyReading,
  getFollowCounts,
  getVisibleListsFor,
} from '../lib/useFollows';
import { openBookTab } from '../lib/bookHelpers';
import ShareModal from '../components/ShareModal';
import { profileShareUrl } from '../lib/shareService';
import { titleLabel } from '../lib/titles';
import Avatar from '../components/Avatar';

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
      {/* Toolbar — filters and ordering are visually separated so it's clear
          which controls narrow the list vs. which reorder it. On mobile the
          two groups stack in a column (see .lv-toolbar--split styles). */}
      <div className="lv-toolbar lv-toolbar--split">
        {/* Filter group: search + genre + year */}
        <div className="lv-toolbar__group lv-toolbar__group--filter">
          <span className="lv-toolbar__label">{t('common.filterLabel')}</span>
          <div className="lv-toolbar__filters">
            {/* Search */}
            <div className="lv-search">
              <svg className="lv-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="text"
                className="lv-search__input"
                placeholder={t('kindred.librarySearch')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Genre filter */}
            {genreOptions.length > 0 && (
              <select className="select" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
                <option value="all">{t('kindred.libraryAllGenres')}</option>
                {genreOptions.map((o) => (
                  <option key={o.normalized_name} value={o.normalized_name}>☩ {o.name}</option>
                ))}
              </select>
            )}

            {/* Year filter */}
            {yearOptions.length > 1 && (
              <select className="select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="all">{t('kindred.libraryAllYears')}</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Order group: sort only (book count removed — it's redundant with the
            hero stats above, which already show total + books this year) */}
        <div className="lv-toolbar__group lv-toolbar__group--order">
          <span className="lv-toolbar__label">{t('common.orderLabel')}</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">{t('kindred.librarySortRecent')}</option>
            <option value="rating">{t('kindred.librarySortRating')}</option>
            <option value="title">{t('kindred.librarySortTitle')}</option>
            <option value="author">{t('kindred.librarySortAuthor')}</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <p className="fp-empty">
          {t('kindred.libraryNoResults')}
        </p>
      ) : (
        <>
          <div className="fp-book-grid">
            {visible.map((b) => (
              <div
                key={b.id}
                className="fp-book-item"
                onClick={() => openBookTab(b, 'reader-profile')}
                title={`${b.t}${b.a ? ` · ${b.a}` : ''}${b.dateRead ? ` · ${new Date(b.dateRead).getFullYear()}` : ''}`}
              >
                <Cover book={b} size={90} onClick={() => openBookTab(b, 'reader-profile')} />
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
              {t('kindred.libraryLoadMore')} ({filtered.length - visible.length} {t('kindred.moreBooks')})
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
  const { follow, unfollow, isFollowing, followers: myFollowers } = useFollows();

  const username = route.params?.username;

  const [profile, setProfile] = useState(null);
  const [library, setLibrary] = useState([]);
  const [reading, setReading] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shareOpen, setShareOpen] = useState(false); // v0.43
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [lists, setLists] = useState([]);
  const [followBusy, setFollowBusy] = useState(false);

  const isSelf = state.profile?.username === username;
  // Whether THEY follow ME — drives the Kinship badge. Read from my own
  // follower list rather than a query, since useFollows already has it.
  const followsMe = myFollowers.some((f) => f.profile?.username === username);

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

      // Every one of these is asked for unconditionally. RLS decides what
      // comes back — a shelf this viewer may not see returns [], the same as a
      // shelf with nothing on it. The distinction is drawn in the copy below,
      // from shelf_visibility, not by skipping the request.
      const [libRaw, cr, followCounts, theirLists] = await Promise.all([
        getReaderLibrary(p.id),
        getReaderCurrentlyReading(p.id),
        getFollowCounts(p.id),
        getVisibleListsFor(p.id),
      ]);
      setLibrary(libRaw.map(normalizeBook));
      setReading(cr);
      setCounts(followCounts);
      setLists(theirLists);
      setLoading(false);
    });
  }, [username, isSelf]);

  async function toggleFollow() {
    if (!profile) return;
    setFollowBusy(true);
    try {
      if (isFollowing(profile.id)) await unfollow(profile.id);
      else await follow(profile.id);
      // Following changes what this page may show, so re-ask. Cheap, and it
      // means "Follow to see what they're reading" is true the moment it stops
      // being true.
      const [libRaw, followCounts] = await Promise.all([
        getReaderLibrary(profile.id),
        getFollowCounts(profile.id),
      ]);
      setLibrary(libRaw.map(normalizeBook));
      setCounts(followCounts);
    } finally {
      setFollowBusy(false);
    }
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
        {t('kindred.profileNotFound')}
      </div>
      <p className="lv-empty-text">{t('kindred.profileNotFoundSub')}</p>
      <button className="btn-secondary" onClick={() => go('dashboard')}>{t('common.goHome')}</button>
    </div>
  );

  const displayName = profile.display_name || profile.username;
  const thisYear = new Date().getFullYear();
  const booksThisYear = library.filter((b) => b.dateRead?.startsWith(String(thisYear))).length;
  const visibility = profile.shelf_visibility || 'followers';
  const amFollowing = isFollowing(profile.id);
  // Not "may they see it" — "did anything arrive". The server already answered
  // the permission question; this only decides which sentence goes in the gap.
  const shelvesHidden = !isSelf && library.length === 0 && visibility !== 'public';

  const followBtn = !isSelf && user ? (
    <button
      className={amFollowing ? 'btn-secondary' : 'btn-primary'}
      onClick={toggleFollow}
      disabled={followBusy}
    >
      {amFollowing ? t('kindred.following') : (followsMe ? t('kindred.followBack') : t('kindred.follow'))}
    </button>
  ) : null;

  return (
    <div className="fp-page">
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a>
        {' '}·{' '}{displayName}
      </div>

      {/* Header */}
      <div className="fp-hero">
        <Avatar displayName={displayName} avatarUrl={profile.avatar_url} size={88} />

        <div className="fp-hero__info">
          <h1 className="fp-hero__name">
            {displayName}
          </h1>
          {profile.username && (
            <div className="fp-hero__handle">
              @{profile.username}
            </div>
          )}
          {/* v0.51: earned Reader Title — app-granted, so seeing one on a
              profile always means the reading behind it actually happened */}
          {titleLabel(profile.preferences?.displayTitle, t) && (
            <div className="reader-title">
              {titleLabel(profile.preferences?.displayTitle, t)}
            </div>
          )}
          <div className="bp-meta">
            {/* Follower count first, and shown even when the shelves are not.
                It is the credential a stranger judges a curator by — 1,000
                readers behind someone means something that 6 does not — and it
                comes from a SECURITY DEFINER function precisely so it survives
                a private profile. The identities behind it never leave the
                server. */}
            <span className="bp-pill">
              ✦ {counts.followers === 1
                ? t('kindred.followerCount_one')
                : t('kindred.followerCount', { count: counts.followers })}
            </span>
            {profile.is_curator && (
              <span className="bp-pill bp-pill--gold" title={t('kindred.curatorHint')}>
                {t('kindred.curator')}
              </span>
            )}
            {followsMe && amFollowing && (
              <span className="bp-pill" title={t('kindred.mutualHint')}>{t('kindred.mutual')}</span>
            )}
            {booksThisYear > 0 && <span className="bp-pill">▤ {t('kindred.booksThisYear', { count: booksThisYear, year: thisYear })}</span>}
            {library.length > 0 && <span className="bp-pill">◈ {t('kindred.totalBooks', { count: library.length })}</span>}
            {reading.length > 0 && (
              <span className="bp-pill">
                ❧ {t('kindred.currentlyReading', { count: reading.length })}
              </span>
            )}
          </div>

          {profile.bio && <p className="fp-hero__bio">{profile.bio}</p>}

          {profile.favorite_genres?.length > 0 && (
            <div className="fp-hero__genres">
              <span className="fp-hero__genres-label">{t('kindred.sectionGenres')}</span>
              {profile.favorite_genres.slice(0, 6).map((g) => (
                <span key={g} className="bp-pill bp-pill--subtle">{g}</span>
              ))}
            </div>
          )}
        </div>

        <div className="fp-hero__actions">
          {followBtn}
        </div>
      </div>

      {/* Currently Reading */}
      {reading.length > 0 && (
        <section>
          <div className="pf-overline">{t('kindred.sectionReading')}</div>
          <div className="db-cr-grid">
            {reading.map((cr, i) => {
              const b = cr.book || cr;
              return (
                <div key={i} className="db-cr-card" onClick={() => openBookTab({ t: b.title || b.t, a: b.author || b.a, coverUrl: b.cover_url || b.coverUrl }, 'reader-profile')}>
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
          {t('kindred.sectionLibrary')}
        </div>
        {shelvesHidden ? (
          <div className="fp-empty">
            <p>{visibility === 'private' ? t('kindred.shelfPrivate') : t('kindred.shelfFollowersOnly')}</p>
            {/* Only offered when following would actually change the answer.
                Telling someone to follow a reader whose shelves are private
                would be a lie with a button on it. */}
            {visibility === 'followers' && !amFollowing && user && (
              <p className="fp-empty__hint">{t('kindred.shelfFollowToSee')}</p>
            )}
            {lists.length > 0 && <p className="fp-empty__hint">{t('kindred.listsOnly')}</p>}
          </div>
        ) : library.length === 0 ? (
          <p className="fp-empty">
            {t('kindred.libraryEmpty')}
          </p>
        ) : (
          <FriendLibrary library={library} go={go} t={t} />
        )}
      </section>

      {/* Their lists — the section this page never had, and the reason a
          curator's profile is worth opening at all. Rendered above the share
          block and below the library, so a reader whose shelves are private
          still has something here rather than a closed door. */}
      <section>
        <div className="pf-overline">{t('kindred.sectionLists')}</div>
        {lists.length === 0 ? (
          <p className="fp-empty">{t('kindred.noLists')}</p>
        ) : (
          <div className="fp-lists">
            {lists.map((l) => (
              <button
                key={l.id}
                className="fp-list-row"
                onClick={() => go('list-detail', { slug: l.slug, listId: l.id })}
              >
                <div className="fp-list-row__body">
                  <div className="fp-list-row__title">
                    {l.title}
                    {/* Labelled only on your own profile: a visitor seeing
                        "Followers only" on a list they can read learns nothing,
                        but the owner needs to know what a stranger would find. */}
                    {isSelf && l.visibility !== 'public' && (
                      <span className="kin-badge">
                        {l.visibility === 'followers' ? t('kindred.listFollowersOnly') : t('kindred.listPrivate')}
                      </span>
                    )}
                  </div>
                  {l.description && <div className="fp-list-row__desc">{l.description}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Share own profile link — v0.43: opens the full share modal */}
      {isSelf && profile.username && (
        <section>
          <div className="pf-overline">{t('kindred.shareProfile')}</div>
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
