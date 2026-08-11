import { useState, useMemo, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey, getPrimaryGenre } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';
import CurationNotice from '../components/CurationNotice';
import RatingModal from '../components/RatingModal';
import LibraryCoverGrid from '../components/LibraryCoverGrid';
import ScrollSentinel from '../components/ScrollSentinel';
import { useT, useTNode } from '../lib/I18nContext';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import { usePagedList } from '../lib/usePagedList';
import EmptyState from '../components/EmptyState';
import ShelfFilters from '../components/ShelfFilters';
import { useShelfFilters } from '../lib/useShelfFilters';

// v0.15 phase 2.5: two-dropdown filter (genres + categories) + Oracle genre grouping.
// v0.16 DS pass: migrated to .lv-* / .btn-* / .select tokens.
// v0.16 perf: chunked rendering via usePagedList + ScrollSentinel.
//   Pagination happens on the flat `filtered` array *before* grouping so that
//   groups and genreKeys grow naturally as more items load. Both list and cover
//   view modes share the same paged slice — the cover grid simply receives fewer
//   grouped items until the user scrolls further.

// v0.55.3: paginate by whole genre sections rather than a flat book slice, so
// each genre shelf renders all its titles (and a correct count) the moment it
// appears. Load this many genre sections per page.
const GENRE_PAGE_SIZE = 6;

export default function Library({ onOpenBook }) {
  const { state, removeFromLibrary, updateReadBook, getCategoriesForBook } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('library_view_mode') || 'list'; } catch { return 'list'; }
  });

  const { genresByBookId } = state;
  const lib = state.library;

  // v0.59.1: was 'Imported', which named where the book came from rather than
  // what it is — and disagreed with the Wishlist, which already used
  // 'Uncategorized'. Same fallback on both shelves now.
  const primaryGenreOf = (b) => getPrimaryGenre(b, genresByBookId[b.bookId], 'Uncategorized');

  // v0.62: filter state, options and the filtered result all live in
  // useShelfFilters now — Wishlist.jsx held an identical copy of what used to be
  // here. See docs/shelf-filters-v1-spec.md.
  const filters = useShelfFilters(lib, { genresByBookId, getCategoriesForBook, storageKey: 'library_filters' });
  const { filtered, resetKey } = filters;

  const sel = useSelection(lib);

  // Group the FULL filtered set first, so every genre section carries all its
  // titles and an accurate count — independent of how far the user has scrolled.
  const grouped = useMemo(() => {
    const g = {};
    for (const b of filtered) {
      const genre = primaryGenreOf(b);
      if (!g[genre]) g[genre] = [];
      g[genre].push(b);
    }
    return g;
  }, [filtered, genresByBookId]);

  const allGenreKeys = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  // Paginate over whole genre sections. Each loaded section is complete, so a
  // shelf never shows a partial "· 3" that later becomes "· 48".
  const { visible: genreKeys, hasMore, loadMore } = usePagedList(
    allGenreKeys, resetKey, { pageSize: GENRE_PAGE_SIZE }
  );

  // Books rendered so far (sum across visible genre sections) — for the hint.
  const shownCount = useMemo(
    () => genreKeys.reduce((n, g) => n + grouped[g].length, 0),
    [genreKeys, grouped]
  );

  // Stable loadMore reference for the sentinel
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


  function switchViewMode(mode) {
    setViewMode(mode);
    try { localStorage.setItem('library_view_mode', mode); } catch { }
  }

  async function handleSaveRating({ rating, notes, readAt }) {
    if (!editing) return;
    await updateReadBook(editing, { rating, notes, readAt });
    setEditing(null);
  }

  return (
    <>

      <div className="page-head">
        <div className="page-head__eyebrow"><span>Dashboard</span> · Library</div>
        <h1 className="page-head__title">{tNode('library.pageTitle')}</h1>
        <p className="page-head__lead">
          {lib.length} books across {allGenreKeys.length} genre{allGenreKeys.length !== 1 ? 's' : ''}.
        </p>
      </div>

      {lib.length > 0 && (
        <div className="lv-toolbar lv-toolbar--split">
          <div className="lv-toolbar__group lv-toolbar__group--filter">
          <span className="lv-toolbar__label">{t('common.filterLabel')}</span>
          <ShelfFilters state={filters} context="library" />
          </div>
          <div className="lv-chips">
            <button
              className={`btn btn-tertiary${sel.active ? ' is-active' : ''}`}
              onClick={() => sel.active ? sel.exit() : sel.enter()}
            >
              {sel.active ? t('common.cancel') : t('lists.selectMode')}
            </button>
            <div className="lv-view-toggle">
              <button
                className={`lv-view-toggle__btn${viewMode === 'list' ? ' is-active' : ''}`}
                onClick={() => switchViewMode('list')}
                title="List view"
                aria-pressed={viewMode === 'list'}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                {t('library.viewList')}
              </button>
              <button
                className={`lv-view-toggle__btn${viewMode === 'covers' ? ' is-active' : ''}`}
                onClick={() => switchViewMode('covers')}
                title="Cover grid view"
                aria-pressed={viewMode === 'covers'}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                {t('library.viewCovers')}
              </button>
            </div>
            <button className="btn btn-tertiary" onClick={() => setBulkOpen((v) => !v)}>
              <span className="btn btn__plus">+</span> {t('library.bulkImport')}
            </button>
          </div>
        </div>
      )}

      {bulkOpen && <BulkImport target="library" onClose={() => setBulkOpen(false)} />}

      <CurationNotice books={lib} />
      <SelectionBar
        count={sel.count}
        selectedBooks={sel.selectedBooks}
        onExit={sel.exit}
        onSelectAll={sel.selectAll}
        onClearAll={sel.clearAll}
        context="library"
      />

      {lib.length === 0 ? (
        <EmptyState
          ornament="📚"
          title={t('library.emptyTitle')}
          body={t('library.emptyText')}
          action={{ label: t('library.emptyCta'), onClick: () => setBulkOpen(true) }}
        />
      ) : filtered.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">📚</div>
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
          {/*
            LibraryCoverGrid receives only the paged slice via `grouped`.
            As the sentinel fires and more pages load, `grouped` grows and
            the grid re-renders with the new items appended — no full remount.
          */}
          <LibraryCoverGrid
            grouped={grouped}
            genreKeys={genreKeys}
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
              <div className="lv-section__head">{g}<span className="count">· {grouped[g].length}</span></div>
              <div className="lv-list">
                {grouped[g].map((b, i) => {
                  const isSelected = sel.active && b.bookId && sel.selected.has(b.bookId);
                  return (
                    <div
                      className={`lv-row${sel.active ? ' lv-row--clickable' : ''}${isSelected ? ' lv-row--selected' : ''}`}
                      key={`${bookKey(b)}-${i}`}
                      onClick={() => sel.active ? sel.toggle(b.bookId) : null}
                    >
                      <div
                        className="lv-row__num"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (sel.active) sel.toggle(b.bookId);
                          else setEditing(b);
                        }}
                        title={sel.active ? '' : (b.rating ? 'Edit your rating' : 'Rate this book')}
                      >
                        {sel.active
                          ? <span className="lv-row__checkbox">{isSelected ? '✓' : ''}</span>
                          : (b.rating ? '★'.repeat(b.rating) : '❦')}
                      </div>
                      <div className="lv-row__content" onClick={() => !sel.active && onOpenBook?.(b)}>
                        <div className="lv-row__title">{b.t}</div>
                        <div className="lv-row__author">
                          {b.a}
                          {b.dateRead && (
                            <> · <span className="lv-hl-muted">
                              {new Date(b.dateRead).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                            </span></>
                          )}
                          {b.fromGoodreads && <> · <span className="lv-hl-dim">from Goodreads</span></>}
                          {b.notes && <> · <span className="lv-hl-dim" title={b.notes}>has notes</span></>}
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
                          <button
                            className="btn btn-tertiary btn--sm"
                            onClick={(e) => { e.stopPropagation(); setEditing(b); }}
                          >
                            {b.rating ? t('library.editRating') : t('library.editRating')}
                          </button>
                          <button
                            className="btn btn-danger btn--sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove "${b.t}" from your library?`)) removeFromLibrary(b);
                            }}
                          >
                            {t('library.remove')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/*
            Sentinel sits below the rendered genre groups.
            400px rootMargin means the next 100 items mount before
            the user reaches the bottom of the last visible group.
          */}
          <ScrollSentinel onVisible={handleLoadMore} enabled={hasMore} />
          {hasMore && (
            <p className="lv-load-hint">
              Showing {shownCount} of {filtered.length} books — scroll to load more
            </p>
          )}
        </>
      )}

      {editing && (
        <RatingModal
          book={editing}
          initialRating={editing.rating}
          initialNotes={editing.notes}
          initialReadAt={editing.dateRead}
          mode="edit"
          onSave={handleSaveRating}
          onSkip={() => setEditing(null)}
        />
      )}
    </>
  );
}
