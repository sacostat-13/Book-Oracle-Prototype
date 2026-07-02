import { useState, useMemo, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { GENRES, bookKey } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';
import OracleCategorizationButton from '../components/OracleCategorizationButton';
import LibraryCoverGrid from '../components/LibraryCoverGrid';
import ScrollSentinel from '../components/ScrollSentinel';
import { useT, useTNode } from '../lib/I18nContext';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import { usePagedList } from '../lib/usePagedList';

// v0.15 phase 2.5: two-dropdown filter (genres + categories).
// v0.16 DS pass: migrated to .lv-* / .btn-* / .select tokens.
// v0.16 perf: chunked rendering via usePagedList + ScrollSentinel.

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
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
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

  function getPrimaryGenre(b) {
    const genres = genresByBookId[b.bookId];
    if (genres && genres.length > 0) return genres[0].name;
    return b.g || 'Uncategorized';
  }

  // --- Genre dropdown options ---
  const genreOptions = useMemo(() => {
    const map = new Map();
    for (const b of wl) {
      const genres = genresByBookId[b.bookId] || [];
      for (const g of genres) {
        const existing = map.get(g.normalizedName);
        if (existing) existing.count++;
        else map.set(g.normalizedName, { name: g.name, normalizedName: g.normalizedName, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [wl, genresByBookId]);

  // --- Category dropdown options ---
  const categoryOptions = useMemo(() => {
    const map = new Map();
    for (const b of wl) {
      for (const c of getCategoriesForBook(b)) {
        if (!map.has(c.name)) map.set(c.name, { name: c.name, verified: c.verified });
        else if (c.verified) map.get(c.name).verified = true;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [wl, getCategoriesForBook]);

  const hasCategoryFilter = categoryOptions.length > 0;

  // formGenres is kept for any child that needs it (manual-add form etc.)
  const formGenres = useMemo(
    () => [...new Set([...GENRES, ...wl.map((b) => b.g).filter(Boolean)])].sort(),
    [wl]
  );
  void formGenres; // consumed by child components, not directly in this JSX

  // --- Filtering ---
  const sel = useSelection(wl);

  const filtered = useMemo(() => {
    let result = wl;
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
  }, [wl, genreFilter, categoryFilter, search, genresByBookId, getCategoriesForBook]);

  // Stable reset key — changes whenever the user adjusts any filter.
  const resetKey = `${genreFilter}|${categoryFilter}|${search}`;

  const { visible: pagedItems, hasMore, loadMore } = usePagedList(filtered, resetKey);

  // Grouping happens on the paged slice — genres grow as more pages load.
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

  const handleLoadMore = useCallback(() => loadMore(), [loadMore]);

  return (
    <>

      <div className="page-head">
        <div className="page-head__eyebrow"><span>Dashboard</span> · Wishlist</div>
        <h1 className="page-head__title">{tNode('wishlist.pageTitle')}</h1>
        <p className="page-head__lead">{wl.length} {t('wishlist.subtitle')}</p>
      </div>

      <div className="lv-toolbar">
        <div className="lv-toolbar__filters">
          <div className="lv-search">
            <svg className="lv-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              className="lv-search__input"
              placeholder={t('wishlist.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="select" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            <option value="all"> {t('wishlist.allGenres')} </option>
            {genreOptions.map((o) => (
              <option key={o.normalizedName} value={o.normalizedName}>☩ {o.name}</option>
            ))}
          </select>
          {hasCategoryFilter && (
            <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">{t('wishlist.allCategories')}</option>
              {categoryOptions.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.verified ? `☩ ${o.name}` : o.name}
                </option>
              ))}
            </select>
          )}
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

      <OracleCategorizationButton books={wl} />
      <SelectionBar
        count={sel.count}
        selectedBooks={sel.selectedBooks}
        onExit={sel.exit}
        onSelectAll={sel.selectAll}
        onClearAll={sel.clearAll}
        context="wishlist"
      />

      {wl.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">{t('wishlist.subtitleEmpty')}</div>
          <div className="lv-empty-text">
            {t('wishlist.emptyText')}
          </div>
          <div className="lv-load-more">
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
        </div>
      ) : filtered.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">No books match</div>
          <div className="lv-empty-text">Try clearing your filters.</div>
        </div>
      ) : viewMode === 'covers' ? (
        <>
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
              Showing {pagedItems.length} of {filtered.length} books — scroll to load more
            </p>
          )}
        </>
      )}
    </>
  );
}
