// src/views/ClubDirectory.jsx — v0.40
// Public Club Directory: in-app, auth-gated search over clubs with
// visibility = 'public'. Not indexed/crawlable — this is discovery for
// signed-in members only, distinct from the invite-token flow in
// BookClubs.jsx / JoinClub.jsx.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import BookCover from '../components/BookCover';

const MOODS = ['comfort', 'challenge', 'escapism', 'mind-bending', 'character-driven', 'atmospheric', 'fast-paced', 'short-read'];

function DirectoryCard({ club, onJoin, joining }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const descRef = useRef(null);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    // Only show "View more" if the text actually overflows the 3-line clamp.
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [club.description]);

  const hasCap = club.maxMembers != null;
  const full = hasCap && club.memberCount >= club.maxMembers;
  const openSlots = hasCap ? Math.max(0, club.maxMembers - club.memberCount) : null;
  const pct = hasCap ? Math.min(100, Math.round((club.memberCount / club.maxMembers) * 100)) : 100;

  const badgeClass = full
    ? 'join-badge join-badge--waitlist'
    : club.joinMode === 'approval'
      ? 'join-badge join-badge--approval'
      : 'join-badge join-badge--auto';
  const badgeText = full
    ? t('clubs.directory.badgeFullWaitlist')
    : club.joinMode === 'approval'
      ? t('clubs.directory.badgeApproval')
      : t('clubs.directory.badgeOpen');

  let actionLabel = t('clubs.directory.joinButton');
  let actionVariant = 'btn-primary';
  let note = null;
  if (club.callerStatus === 'member') {
    actionLabel = t('clubs.directory.alreadyMember');
    actionVariant = 'btn-tertiary';
  } else if (club.callerStatus === 'pending_approval') {
    actionLabel = t('clubs.directory.requestPending');
    actionVariant = 'btn-tertiary';
  } else if (club.callerStatus === 'waitlisted') {
    actionLabel = t('clubs.directory.onWaitlist');
    actionVariant = 'btn-tertiary';
  } else if (full) {
    actionLabel = t('clubs.directory.joinWaitlistButton');
    actionVariant = 'btn-tertiary';
    note = t('clubs.directory.waitlistNote');
  } else if (club.joinMode === 'approval') {
    actionLabel = t('clubs.directory.requestButton');
    actionVariant = 'btn-secondary';
    note = t('clubs.directory.approvalNote');
  }
  const disabled = club.callerStatus !== 'none' || joining;

  return (
    <div className="directory-card">
      <div className="directory-card__top">
        <div className="directory-card__emblem">{(club.name || '?').charAt(0).toUpperCase()}</div>
        <div className="directory-card__head">
          <div className="directory-card__name">{club.name}</div>
          <div className="directory-card__meta">
            {t('clubs.directory.memberCountShort', { count: club.memberCount })}
          </div>
        </div>
        <span className={badgeClass}>{badgeText}</span>
      </div>

      {club.description && (
        <>
          <p
            ref={descRef}
            className={`directory-card__desc${expanded ? ' directory-card__desc--expanded' : ''}`}
          >
            {club.description}
          </p>
          {(clamped || expanded) && (
            <button
              type="button"
              className="directory-card__desc-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? t('clubs.directory.viewLess') : t('clubs.directory.viewMore')}
            </button>
          )}
        </>
      )}

      {(club.genreNames.length > 0 || club.moods.length > 0) && (
        <div className="directory-card__tags">
          {club.genreNames.map((g) => (
            <span key={g} className="directory-tag">{g}</span>
          ))}
          {club.moods.map((m) => (
            <span key={m} className="directory-tag directory-tag--mood">
              {t(`onboarding.moods.${m}.title`)}
            </span>
          ))}
        </div>
      )}

      {club.currentBook && (
        <div className="directory-now-reading">
          <div className="directory-now-reading__cover">
            <BookCover
              title={club.currentBook.title}
              author={club.currentBook.author}
              coverUrl={club.currentBook.coverUrl}
            />
          </div>
          <div className="directory-now-reading__body">
            <div className="directory-now-reading__label">{t('clubs.directory.currentlyReading')}</div>
            <div className="directory-now-reading__title">{club.currentBook.title}</div>
            <div className="directory-now-reading__author">{club.currentBook.author}</div>
          </div>
        </div>
      )}

      {hasCap ? (
        <div>
          <div className="directory-members-row">
            <span><strong>{club.memberCount}</strong> / {club.maxMembers} {t('clubs.directory.members')}</span>
            <span>{full ? t('clubs.directory.full') : t('clubs.directory.openSlots', { count: openSlots })}</span>
          </div>
          <div className="directory-members-bar">
            <div className={`directory-members-fill${full ? ' directory-members-fill--full' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <div>
          <div className="directory-members-row">
            <span><strong>{club.memberCount}</strong> {t('clubs.directory.members')}</span>
            <span>{t('clubs.directory.noCap')}</span>
          </div>
          <div className="directory-members-bar">
            <div className="directory-members-fill directory-members-fill--unlimited" />
          </div>
        </div>
      )}

      <button
        className={actionVariant}
        disabled={disabled}
        onClick={() => onJoin(club.id)}
      >
        {joining ? t('clubs.directory.joining') : actionLabel}
      </button>
      {note && <div className="directory-card__note">{note}</div>}
    </div>
  );
}

export default function ClubDirectory() {
  const { state, searchPublicClubs, joinPublicClub, showToast } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const [query, setQuery] = useState('');
  const [genreId, setGenreId] = useState(null);
  const [mood, setMood] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState('activity');
  const [clubs, setClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);

  const genres = state.genres || [];
  const activeFilterCount = (genreId ? 1 : 0) + (mood ? 1 : 0);

  const runSearch = useCallback(async () => {
    setLoading(true);
    const results = await searchPublicClubs({
      query: query.trim() || null,
      genreIds: genreId ? [genreId] : null,
      moods: mood ? [mood] : null,
      openOnly,
      sort,
    });
    setClubs(results);
    setLoading(false);
  }, [query, genreId, mood, openOnly, sort, searchPublicClubs]);

  // Debounce text search; filters/sort/toggle re-run immediately since
  // they're discrete clicks rather than keystrokes.
  useEffect(() => {
    const handle = setTimeout(runSearch, query ? 350 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreId, mood, openOnly, sort]);

  useEffect(() => {
    const handle = setTimeout(runSearch, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function handleJoin(clubId) {
    setJoiningId(clubId);
    const status = await joinPublicClub(clubId);
    setJoiningId(null);
    if (!status) {
      showToast(t('clubs.directory.joinError'), true);
      return;
    }
    if (status === 'joined') showToast(t('clubs.directory.toastJoined'));
    else if (status === 'pending_approval') showToast(t('clubs.directory.toastPending'));
    else if (status === 'waitlisted') showToast(t('clubs.directory.toastWaitlisted'));

    setClubs((cur) => cur.map((c) => c.id === clubId
      ? { ...c, callerStatus: status === 'joined' ? 'member' : status, memberCount: status === 'joined' ? c.memberCount + 1 : c.memberCount }
      : c));

    if (status === 'joined') go('book-club-detail', { clubId });
  }

  return (
    <div className="directory-page">
      <div className="breadcrumb"><a onClick={() => go('book-clubs')}>{t('clubs.createBreadcrumb')}</a> · {t('clubs.directory.breadcrumb')}</div>

      <div className="page-header">
        <div className="page-eyebrow">{t('clubs.directory.eyebrow')}</div>
        <h1 className="page-title">{tNode('clubs.directory.pageTitle')}</h1>
        <p className="clubs-empty-text">{t('clubs.directory.subtitle')}</p>
      </div>

      <div className="search">
        <span className="search__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </span>
        <input
          className="search__input"
          type="text"
          placeholder={t('clubs.directory.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="directory-toolbar">
        <div className="directory-toolbar__count">
          {loading ? t('clubs.directory.searching') : t('clubs.directory.resultCount', { count: clubs.length })}
        </div>
        <div className="directory-toolbar__controls">
          <button type="button" className="btn-secondary" onClick={() => setFiltersOpen(true)}>
            {t('clubs.directory.filtersButton')}
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
          <button type="button" className="directory-toggle" onClick={() => setOpenOnly((v) => !v)}>
            <span className={`directory-switch${openOnly ? ' directory-switch--on' : ''}`} />
            {t('clubs.directory.openOnlyToggle')}
          </button>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="activity">{t('clubs.directory.sortActivity')}</option>
            <option value="members">{t('clubs.directory.sortMembers')}</option>
            <option value="newest">{t('clubs.directory.sortNewest')}</option>
          </select>
        </div>
      </div>

      {filtersOpen && (
        <div className="overlay" onClick={() => setFiltersOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal__close" onClick={() => setFiltersOpen(false)}>×</button>
            <div className="modal__head">
              <h2 className="modal__title">{t('clubs.directory.filtersTitle')}</h2>
            </div>
            <div className="modal__body">
              {genres.length > 0 && (
                <>
                  <div className="directory-filter-label">{t('clubs.fieldGenres')}</div>
                  <div className="directory-chip-row">
                    <button className={`chip${!genreId ? ' chip--active' : ''}`} onClick={() => setGenreId(null)}>
                      {t('clubs.directory.allGenres')}
                    </button>
                    {genres.map((g) => (
                      <button
                        key={g.id}
                        className={`chip${genreId === g.id ? ' chip--active' : ''}`}
                        onClick={() => setGenreId(genreId === g.id ? null : g.id)}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="directory-filter-label">{t('clubs.directory.moodLabel')}</div>
              <div className="directory-chip-row">
                <button className={`chip${!mood ? ' chip--active' : ''}`} onClick={() => setMood(null)}>
                  {t('clubs.directory.allMoods')}
                </button>
                {MOODS.map((id) => (
                  <button
                    key={id}
                    className={`chip${mood === id ? ' chip--active' : ''}`}
                    onClick={() => setMood(mood === id ? null : id)}
                  >
                    {t(`onboarding.moods.${id}.title`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal__actions">
              <button
                className="btn-text"
                disabled={activeFilterCount === 0}
                onClick={() => { setGenreId(null); setMood(null); }}
              >
                {t('clubs.directory.clearFilters')}
              </button>
              <button className="btn-primary" onClick={() => setFiltersOpen(false)}>
                {t('clubs.directory.filtersDone')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && clubs.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('clubs.directory.emptyTitle')}</div>
          <div className="empty-state-text">{t('clubs.directory.emptyText')}</div>
        </div>
      ) : (
        <div className="directory-grid">
          {clubs.map((club) => (
            <DirectoryCard
              key={club.id}
              club={club}
              onJoin={handleJoin}
              joining={joiningId === club.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
