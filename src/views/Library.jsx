import { useState, useMemo, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';
import OracleCategorizationButton from '../components/OracleCategorizationButton';
import RatingModal from '../components/RatingModal';
import LibraryCoverGrid from '../components/LibraryCoverGrid';
import ScrollSentinel from '../components/ScrollSentinel';
import { useT, useTNode } from '../lib/I18nContext';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import { usePagedList } from '../lib/usePagedList';
import EmptyState from '../components/EmptyState';

// v0.15 phase 2.5: two-dropdown filter (genres + categories) + Oracle genre grouping.
// v0.16 DS pass: migrated to .lv-* / .btn-* / .select tokens.
// v0.16 perf: chunked rendering via usePagedList + ScrollSentinel.
//   Pagination happens on the flat `filtered` array *before* grouping so that
//   groups and genreKeys grow naturally as more items load. Both list and cover
//   view modes share the same paged slice — the cover grid simply receives fewer
//   grouped items until the user scrolls further.

export default function Library({ onOpenBook }) {
  const { state, removeFromLibrary, updateReadBook, getCategoriesForBook } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [genreFilter, setGenreFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('library_view_mode') || 'list'; } catch { return 'list'; }
  });

  const { genresByBookId } = state;
  const lib = state.library;

  function getPrimaryGenre(b) {
    const genres = genresByBookId[b.bookId];
    if (genres && genres.length > 0) return genres[0].name;
    return b.g || 'Imported';
  }

  // --- Genre dropdown options ---
  const genreOptions = useMemo(() => {
    const map = new Map();
    for (const b of lib) {
      const genres = genresByBookId[b.bookId] || [];
      for (const g of genres) {
        const existing = map.get(g.normalizedName);
        if (existing) existing.count++;
        else map.set(g.normalizedName, { name: g.name, normalizedName: g.normalizedName, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [lib, genresByBookId]);

  // --- Category dropdown options ---
  const categoryOptions = useMemo(() => {
    const map = new Map();
    for (const b of lib) {
      for (const c of getCategoriesForBook(b)) {
        if (!map.has(c.name)) map.set(c.name, { name: c.name, verified: c.verified });
        else if (c.verified) map.get(c.name).verified = true;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [lib, getCategoriesForBook]);

  const hasCategoryFilter = categoryOptions.length > 0;

  // --- Filtering (runs on the full library) ---
  const sel = useSelection(lib);

  const filtered = useMemo(() => {
    let result = lib;
    if (genreFilter !== 'all') {
      result = result.filter((b) => {
        const genres = genresByBookId[b.bookId] || [];
        return genres.some((g) => g.normalizedName === genreFilter);
      });
    }
    if (categoryFilter !== 'all') {
      result = result.filter((b) => {
        const cats = getCategoriesForBook(b);
        return cats.some((c) => c.name === categoryFilter);
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) => b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [lib, genreFilter, categoryFilter, search, genresByBookId, getCategoriesForBook]);

  // resetKey: a stable string that changes when any filter changes.
  // usePagedList watches this to snap the page count back to 1 on filter change,
  // so the user doesn't see a half-loaded page from a prior filter state.
  const resetKey = `${genreFilter}|${categoryFilter}|${search}`;

  const { visible: pagedItems, hasMore, loadMore } = usePagedList(filtered, resetKey);

  // Grouping is performed on the *paged* slice — groups grow as more pages load.
  const grouped = useMemo(() => {
    const g = {};
    for (const b of pagedItems) {
      const genre = getPrimaryGenre(b);
      if (!g[genre]) g[genre] = [];
      g[genre].push(b);
    }
    return g;
  }, [pagedItems, genresByBookId]);

  const genreKeys = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  // Stable loadMore reference for the sentinel
  const handleLoadMore = useCallback(() => loadMore(), [loadMore]);

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
          {lib.length} books across {genreKeys.length} genre{genreKeys.length !== 1 ? 's' : ''}.
        </p>
      </div>

      {lib.length > 0 && (
        <div className="lv-toolbar">
          <div className="lv-toolbar__filters">
            <div className="lv-search">
              <svg className="lv-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="text"
                className="lv-search__input"
                placeholder={t('library.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="select" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
              <option value="all">{t('library.allGenres')}</option>
              {genreOptions.map((o) => (
                <option key={o.normalizedName} value={o.normalizedName}>☩ {o.name}</option>
              ))}
            </select>
            {hasCategoryFilter && (
              <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">{t('library.allCategories')}</option>
                {categoryOptions.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.verified ? `☩ ${o.name}` : o.name}
                  </option>
                ))}
              </select>
            )}
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

      <OracleCategorizationButton books={lib} />
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
          <div className="lv-empty-text">Try clearing your filters.</div>
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
              Showing {pagedItems.length} of {filtered.length} books — scroll to load more
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
              Showing {pagedItems.length} of {filtered.length} books — scroll to load more
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
