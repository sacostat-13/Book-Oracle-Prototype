// src/views/ListDirectory.jsx — Discover Curated Lists (v0.63)
//
// Deliberately a near-copy of ClubDirectory: same search field, same filters
// button with an active count, same chip rows, same debounce. A reader who has
// filtered the club directory by "atmospheric" should not have to learn a
// second control to filter lists by the same thing. Where this differs from
// clubs, it is for a stated reason, and there are three.
//
// 1. IT RENDERS SIGNED OUT.
//    `search_public_clubs` raises when auth.uid() is null; `search_public_lists`
//    does not. The entire premise of curated lists is that they get posted on
//    social media, so this page is a landing surface as much as an internal
//    one. Everything caller-specific degrades: `callerFollows` comes back false
//    and the Follow button becomes a prompt to sign in.
//
// 2. SORTS ARE followers | newest | books.
//    Clubs offer activity | members | newest. `followers` is the direct
//    analogue of `members`; `activity` has no meaning for a list, so it is
//    dropped rather than faked with some proxy.
//
// 3. NO "open only" TOGGLE.
//    That answers "can I still join", which has no equivalent here — a list
//    cannot be full.

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { MOODS, moodTitleKey } from '../lib/moods';
import CoverStrip from '../components/CoverStrip';
import FollowListButton from '../components/FollowListButton';

function ListCard({ list, onOpen, onFollowChange }) {
  const t = useT();

  return (
    <div className="directory-card">
      <div className="directory-card__top">
        <div className="directory-card__emblem">
          {(list.title || '?').charAt(0).toUpperCase()}
        </div>
        <div className="directory-card__head">
          <button type="button" className="directory-card__name ld-card__name" onClick={onOpen}>
            {list.title}
          </button>
          {/* Who made it, always. A curated list is one person's taste — that
              is the whole value of it, and the Oracle never takes the credit. */}
          <div className="directory-card__meta">
            {t('lists.byCurator', { name: list.ownerDisplay || list.ownerUsername || t('nav.someone') })}
            {' · '}
            {t('lists.bookCount', { count: list.bookCount })}
            {list.followerCount > 0 && <> · {t('lists.followerCount', { count: list.followerCount })}</>}
          </div>
        </div>
      </div>

      {list.description && (
        <p className="directory-card__desc">{list.description}</p>
      )}

      {list.coverUrls.length > 0 && (
        <CoverStrip urls={list.coverUrls} onClick={onOpen} />
      )}

      {(list.genreNames.length > 0 || list.moods.length > 0) && (
        <div className="directory-card__tags">
          {list.genreNames.map((g) => (
            <span key={g} className="directory-tag">{g}</span>
          ))}
          {list.moods.map((m) => (
            <span key={m} className="directory-tag directory-tag--mood">
              {t(moodTitleKey(m))}
            </span>
          ))}
        </div>
      )}

      <div className="ld-card__actions">
        <button type="button" className="btn-secondary" onClick={onOpen}>
          {t('lists.viewList')}
        </button>
        <FollowListButton
          listId={list.id}
          following={list.callerFollows}
          onChange={(next) => onFollowChange(list.id, next)}
        />
      </div>
    </div>
  );
}

export default function ListDirectory() {
  const { state, searchPublicLists } = useData();
  const { user } = useAuth();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const [query, setQuery] = useState('');
  const [genreId, setGenreId] = useState(null);
  const [mood, setMood] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState('followers');
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);

  const genres = state.genres || [];
  const activeFilterCount = (genreId ? 1 : 0) + (mood ? 1 : 0);

  const runSearch = useCallback(async () => {
    setLoading(true);
    const results = await searchPublicLists({
      query: query.trim() || null,
      genreIds: genreId ? [genreId] : null,
      moods: mood ? [mood] : null,
      sort,
    });
    setLists(results);
    setLoading(false);
  }, [query, genreId, mood, sort, searchPublicLists]);

  // Two effects rather than one, same as ClubDirectory: filter and sort changes
  // are discrete clicks and should feel instant, keystrokes need the debounce.
  useEffect(() => {
    const handle = setTimeout(runSearch, query ? 350 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreId, mood, sort]);

  useEffect(() => {
    const handle = setTimeout(runSearch, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Optimistic, and it also moves the follower count — the card would otherwise
  // say "3 following" immediately after you became the fourth.
  function handleFollowChange(listId, following) {
    setLists((cur) => cur.map((l) => l.id === listId
      ? { ...l, callerFollows: following, followerCount: Math.max(0, l.followerCount + (following ? 1 : -1)) }
      : l));
  }

  return (
    <div className="directory-page">
      <div className="breadcrumb">
        <a onClick={() => go('lists')}>{t('lists.curatedTitle')}</a> · {t('lists.discoverBreadcrumb')}
      </div>

      <div className="page-head">
        <div className="page-head__eyebrow">{t('lists.discoverEyebrow')}</div>
        <h1 className="page-head__title">{tNode('lists.discoverPageTitle')}</h1>
        <p className="clubs-empty-text">{t('lists.discoverSubtitle')}</p>
      </div>

      <div className="search">
        <span className="search__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </span>
        <input
          className="search__input"
          type="text"
          placeholder={t('lists.discoverSearchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="directory-toolbar">
        <div className="directory-toolbar__count">
          {loading ? t('clubs.directory.searching') : t('lists.resultCount', { count: lists.length })}
        </div>
        <div className="directory-toolbar__controls">
          <button type="button" className="btn-secondary" onClick={() => setFiltersOpen(true)}>
            {t('clubs.directory.filtersButton')}
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </button>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="followers">{t('lists.sortFollowers')}</option>
            <option value="books">{t('lists.sortBooks')}</option>
            <option value="newest">{t('clubs.directory.sortNewest')}</option>
          </select>
        </div>
      </div>

      {filtersOpen && (
        <div className="overlay" onClick={() => setFiltersOpen(false)}>
          {/* modal--scroll: the genre filter lists the whole taxonomy, which is
              far taller than a phone. Without it the chips scroll the entire
              modal and Done goes off-screen. */}
          <div className="modal modal--scroll" onClick={(e) => e.stopPropagation()}>
            <button className="modal__close" onClick={() => setFiltersOpen(false)}>×</button>
            <div className="modal__head">
              <h2 className="modal__title">{t('clubs.directory.filtersTitle')}</h2>
            </div>
            <div className="modal__body">
              {genres.length > 0 && (
                <>
                  <div className="directory-filter-label">{t('lists.fieldGenres')}</div>
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
                    {t(moodTitleKey(id))}
                  </button>
                ))}
              </div>
            </div>
            {/* `modal__actions`, matching ClubDirectory — `modal__foot` was
                my invention and resolves to nothing. */}
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

      {!loading && lists.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">{t('lists.discoverEmptyTitle')}</div>
          <div className="lv-empty-text">
            {activeFilterCount > 0 || query
              ? t('lists.discoverEmptyFiltered')
              : t('lists.discoverEmptyText')}
          </div>
          {user && (
            <button className="btn-primary" onClick={() => go('lists-mine')}>
              {t('lists.makeYourOwn')}
            </button>
          )}
        </div>
      ) : (
        <div className="directory-grid">
          {lists.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              onOpen={() => go('list-view', { listId: l.id })}
              onFollowChange={handleFollowChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
