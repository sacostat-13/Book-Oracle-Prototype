import { useState, useMemo, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { GENRES, bookKey, getPrimaryGenre } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';
import CurationNotice from '../components/CurationNotice';
import LibraryCoverGrid from '../components/LibraryCoverGrid';
import ScrollSentinel from '../components/ScrollSentinel';
import { useT, useTNode } from '../lib/I18nContext';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import { usePagedList } from '../lib/usePagedList';
import EmptyState from '../components/EmptyState';
import ShelfFilters from '../components/ShelfFilters';
import { useShelfFilters } from '../lib/useShelfFilters';
import { useShelfGrouping } from '../lib/useShelfGrouping';

// v0.15 phase 2.5: two-dropdown filter (genres + categories).
// v0.16 DS pass: migrated to .lv-* / .btn-* / .select tokens.
// v0.16 perf: chunked rendering via usePagedList + ScrollSentinel.

// v0.55.3: paginate by whole genre sections (see Library.jsx) so each genre
// shelf shows all its titles and a correct count immediately.
const GENRE_PAGE_SIZE = 6;

export default function Wishlist({ onOpenBook }) {
  const {
    state,
    addToReadNext,
    removeFromWishlist,
    seedWishlistIfNeeded,
    showToast,
    getCategoriesForBook,
    startReading,
  } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('wishlist_view_mode') || 'list'; } catch { return 'list'; }
  });

  function switchViewMode(mode) {
    setViewMode(mode);
    try { localStorage.setItem('wishlist_view_mode', mode); } catch { }
  }

  const wl = state.wishlist;
  const { genresByBookId } = state;

  // useCallback so the grouping memo below can depend on it honestly rather
  // than on `genresByBookId` as a stand-in for it.
  const primaryGenreOf = useCallback(
    (b) => getPrimaryGenre(b, genresByBookId[b.bookId], 'Uncategorized'),
    [genresByBookId]
  );

  // v0.62: filter state, options and the filtered result all live in
  // useShelfFilters now — Library.jsx held an identical copy of what used to be
  // here. See docs/shelf-filters-v1-spec.md.
  const filters = useShelfFilters(wl, { genresByBookId, getCategoriesForBook, storageKey: 'wishlist_filters' });
  const { filtered, resetKey } = filters;

  // formGenres is kept for any child that needs it (manual-add form etc.)
  const formGenres = useMemo(
    () => [...new Set([...GENRES, ...wl.map((b) => b.g).filter(Boolean)])].sort(),
    [wl]
  );
  void formGenres; // consumed by child components, not directly in this JSX

  const sel = useSelection(wl);

  // v0.67 — sectioning moved to useShelfGrouping. Each level of filtering
  // reveals the next level of grouping: unfiltered groups by family, a family
  // filter groups by genre, a genre filter shows a flat list. Sections were
  // keyed on the PRIMARY genre before, so filtering to Science Fiction still
  // produced an "Adventure" heading — the reader had already said what they
  // wanted and we regrouped their answer by a different axis.
  const { mode: groupMode, keys: allGenreKeys, grouped, labels: groupLabels } =
    useShelfGrouping(filtered, { genresByBookId, genre: filters.values.genre, primaryGenreOf });

  // Paginate over whole genre sections — each loaded section is complete.
  const { visible: genreKeys, hasMore, loadMore } = usePagedList(
    allGenreKeys, resetKey, { pageSize: GENRE_PAGE_SIZE }
  );

  const shownCount = useMemo(
    () => genreKeys.reduce((n, g) => n + grouped[g].length, 0),
    [genreKeys, grouped]
  );

  const handleLoadMore = useCallback(() => loadMore(), [loadMore]);

  // Human-readable list of what is currently narrowing the shelf, for the
  // empty state. Built here rather than in the hook because it needs t().
  const activeFilterSummary = useMemo(() => {
    const v = filters.values;
    const parts = [];
    if (v.pages !== 'all') {
      parts.push(Number(v.pages) === 501
        ? t('shelfFilters.pagesOver').replace('{n}', 500)
        : t('shelfFilters.pagesUnder').replace('{n}', v.pages));
    }
    if (v.complexity.length) parts.push(`${t('shelfFilters.complexity')} ${[...v.complexity].sort().join(', ')}`);
    if (v.depth.length) parts.push(`${t('shelfFilters.depth')} ${[...v.depth].sort().join(', ')}`);
    if (v.gender !== 'all') parts.push(t(`shelfFilters.author_${v.gender}`));
    return parts.join(' · ');
  }, [filters.values, t]);


  return (
    <>

      <div className="page-head">
        <div className="page-head__eyebrow"><span>Dashboard</span> · Wishlist</div>
        <h1 className="page-head__title">{tNode('wishlist.pageTitle')}</h1>
        <p className="page-head__lead">{wl.length} {t('wishlist.subtitle')}</p>
      </div>

      <div className="lv-toolbar lv-toolbar--split">
        <div className="lv-toolbar__group lv-toolbar__group--filter">
        <span className="lv-toolbar__label">{t('common.filterLabel')}</span>
        <ShelfFilters state={filters} context="wishlist" />
        </div>
        <div className="lv-chips">
          <div className="lv-view-toggle">
            <button
              className={`lv-view-toggle__btn${viewMode === 'list' ? ' is-active' : ''}`}
              onClick={() => switchViewMode('list')}
              title="List view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
              {t('wishlist.viewList')}
            </button>
            <button
              className={`lv-view-toggle__btn${viewMode === 'covers' ? ' is-active' : ''}`}
              onClick={() => switchViewMode('covers')}
              title="Cover grid view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              {t('wishlist.viewCovers')}
            </button>
          </div>
          <button className="btn btn-tertiary" onClick={() => setBulkOpen((v) => !v)}>
            <span className="btn btn__plus">+</span> {t('wishlist.bulkImport')}
          </button>
          <button
            className={`btn btn-tertiary${sel.active ? ' is-active' : ''}`}
            onClick={() => sel.active ? sel.exit() : sel.enter()}
          >
            {sel.active ? t('common.cancel') : t('lists.selectMode')}
          </button>
        </div>
      </div>

      {bulkOpen && <BulkImport target="wishlist" onClose={() => setBulkOpen(false)} />}

      <CurationNotice books={wl} />
      <SelectionBar
        count={sel.count}
        selectedBooks={sel.selectedBooks}
        onExit={sel.exit}
        onSelectAll={sel.selectAll}
        onClearAll={sel.clearAll}
        context="wishlist"
      />

      {wl.length === 0 ? (
        <EmptyState
          ornament="❦"
          title={t('wishlist.subtitleEmpty')}
          body={t('wishlist.emptyText')}
        >
          <div className="empty-state-action">
            <button className="btn btn-secondary" onClick={() => setBulkOpen(true)}>+ {t('wishlist.bulkImport')}</button>
            <button
              className="btn btn-tertiary"
              onClick={() => {
                if (confirm('Add ~280 curated books to your wishlist? You can remove any you don\'t want afterwards.')) {
                  seedWishlistIfNeeded();
                  showToast('Curated catalog added to your wishlist');
                }
              }}
            >
              Browse curated catalog
            </button>
          </div>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">No books match</div>
          {/* v0.62: naming the active filters is the fix. "Try clearing your
              filters" makes the reader hunt for which of seven controls did
              this; listing them makes the culprit obvious in one glance. */}
          {filters.activeCount > 0 ? (
            <>
              <div className="lv-empty-text">
                {t('shelfFilters.noMatchFilters').replace('{list}', activeFilterSummary)}
              </div>
              <div className="empty-state-action">
                <button className="btn btn-secondary" onClick={filters.clearAdvanced}>
                  {t('shelfFilters.clear')}
                </button>
              </div>
            </>
          ) : (
            <div className="lv-empty-text">Try clearing your filters.</div>
          )}
        </div>
      ) : viewMode === 'covers' ? (
        <>
          <LibraryCoverGrid
            grouped={grouped}
            genreKeys={genreKeys}
            labels={groupLabels}
            showHeads={groupMode !== 'flat'}
            genresByBookId={genresByBookId}
            onOpenBook={onOpenBook}
            selectionMode={sel.active}
            selected={sel.selected}
            onToggle={sel.toggle}
          />
          <ScrollSentinel onVisible={handleLoadMore} enabled={hasMore} />
          {hasMore && (
            <p className="lv-load-hint">
              Showing {shownCount} of {filtered.length} books — scroll to load more
            </p>
          )}
        </>
      ) : (
        <>
          {genreKeys.map((g) => (
            <div className="lv-section" key={g}>
              {groupMode !== 'flat' && (
                <div className="lv-section__head">
                  {groupLabels[g]}<span className="count">· {grouped[g].length}</span>
                </div>
              )}
              <div className="lv-list">
                {grouped[g].map((b, i) => {
                  const k = bookKey(b);
                  const inNext = state.readNext.some((r) => bookKey(r) === k);
                  const inReading = (state.currentlyReading || []).some((r) => bookKey(r) === k);
                  const isSelected = sel.active && b.bookId && sel.selected.has(b.bookId);
                  return (
                    <div
                      className={`lv-row${sel.active ? ' lv-row--clickable' : ''}${isSelected ? ' lv-row--selected' : ''}`}
                      key={`${k}-${i}`}
                      onClick={() => sel.active ? sel.toggle(b.bookId) : null}
                    >
                      <div className="lv-row__num">
                        {sel.active
                          ? <span className="lv-row__checkbox">{isSelected ? '✓' : ''}</span>
                          : (b.manuallyAdded ? '✎' : '❦')}
                      </div>
                      <div className="lv-row__content" onClick={() => !sel.active && onOpenBook?.(b)}>
                        <div className="lv-row__title">{b.t}</div>
                        <div className="lv-row__author">
                          {b.a}
                          {b.manuallyAdded && <> · <span className="lv-hl-dim">added by you</span></>}
                          {inReading && <> · <span className="lv-hl">reading</span></>}
                          {!inReading && inNext && <> · <span className="lv-hl">in Read Next</span></>}
                        </div>
                        {(() => {
                          const genres = genresByBookId[b.bookId];
                          return genres && genres.length > 0 ? (
                            <div className="lv-row__genres">
                              {genres.map((g) => (
                                <span key={g.genreId} className="status" title={g.description || undefined}>{g.name}</span>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {!sel.active && (
                        <div className="lv-row__actions">
                          {inReading ? (
                            <span className="status li-action--disabled">▶ Reading</span>
                          ) : inNext ? (
                            <span className="status li-action--disabled">✓ Queued</span>
                          ) : (
                            <button className="btn btn-primary btn--sm" onClick={() => addToReadNext(b)}>+ Read Next</button>
                          )}
                          {!inReading && (
                            <button className="btn btn-tertiary btn--sm" onClick={() => startReading(b)}>▶ Start</button>
                          )}
                          <button
                            className="btn btn-danger btn--sm"
                            onClick={() => {
                              if (confirm(`Remove "${b.t}" from your wishlist?`)) removeFromWishlist(b);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <ScrollSentinel onVisible={handleLoadMore} enabled={hasMore} />
          {hasMore && (
            <p className="lv-load-hint">
              Showing {shownCount} of {filtered.length} books — scroll to load more
            </p>
          )}
        </>
      )}
    </>
  );
}
