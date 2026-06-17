import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { GENRES, bookKey } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';
import OracleCategorizationButton from '../components/OracleCategorizationButton';
import LibraryCoverGrid from '../components/LibraryCoverGrid';

// v0.15 phase 2.5: two-dropdown filter (genres + categories).
// Genres are canonical Oracle-curated taxonomy from genresByBookId.
// Categories are user folksonomy from getCategoriesForBook.
// Grouping uses Oracle genres; books without genres fall back to b.g then 'Uncategorized'.

export default function Wishlist({ onOpenBook }) {
  const {
    state,
    addToReadNext,
    removeFromWishlist,
    addToWishlist,
    seedWishlistIfNeeded,
    showToast,
    getCategoriesForBook,
    startReading,
  } = useData();
  const { go } = useRouter();
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('wishlist_view_mode') || 'list'; } catch { return 'list'; }
  });

  function switchViewMode(mode) {
    setViewMode(mode);
    try { localStorage.setItem('wishlist_view_mode', mode); } catch {}
  }

  const wl = state.wishlist;
  const { genresByBookId } = state;

  // Helper: get primary genre label for a book (Oracle first, then b.g fallback).
  function getPrimaryGenre(b) {
    const genres = genresByBookId[b.bookId];
    if (genres && genres.length > 0) return genres[0].name;
    return b.g || 'Uncategorized';
  }

  // --- Genre dropdown options ---
  // Collect all unique genres across the wishlist from genresByBookId.
  const genreOptions = useMemo(() => {
    const map = new Map(); // normalizedName → { name, count }
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
  // Collect user categories; only show dropdown if at least one book has one.
  const categoryOptions = useMemo(() => {
    const map = new Map(); // normalizedName → { name, verified }
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

  // --- The form genre list (manual add) ---
  const formGenres = useMemo(
    () => [...new Set([...GENRES, ...wl.map((b) => b.g).filter(Boolean)])].sort(),
    [wl]
  );

  // --- Filtering ---
  let filtered = wl;

  if (genreFilter !== 'all') {
    filtered = filtered.filter((b) => {
      const genres = genresByBookId[b.bookId] || [];
      return genres.some((g) => g.normalizedName === genreFilter);
    });
  }

  if (categoryFilter !== 'all') {
    filtered = filtered.filter((b) => {
      const cats = getCategoriesForBook(b);
      return cats.some((c) => c.name === categoryFilter);
    });
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (b) => b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q)
    );
  }

  // --- Grouping by Oracle genre ---
  const grouped = {};
  for (const b of filtered) {
    const g = getPrimaryGenre(b);
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(b);
  }
  const genreKeys = Object.keys(grouped).sort();


  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Wishlist
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Wishlist</div>
        <h1 className="page-title">
          Books I <span className="accent">want to read</span>
        </h1>
        <p className="page-subtitle">{wl.length} books on the shelf.</p>
      </div>

      <div className="wishlist-toolbar">
        <div className="wishlist-filters">
          <input
            type="text"
            className="search-input"
            placeholder="Search title or author…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: '280px' }}
          />
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            style={{ maxWidth: '220px' }}
          >
            <option value="all">— All genres —</option>
            {genreOptions.map((o) => (
              <option key={o.normalizedName} value={o.normalizedName}>
                ☩ {o.name}
              </option>
            ))}
          </select>
          {hasCategoryFilter && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ maxWidth: '220px' }}
            >
              <option value="all">— All categories —</option>
              {categoryOptions.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.verified ? `☩ ${o.name}` : o.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => switchViewMode('list')}
              title="List view"
            >
              ☰ List
            </button>
            <button
              className={`view-toggle-btn${viewMode === 'covers' ? ' active' : ''}`}
              onClick={() => switchViewMode('covers')}
              title="Cover grid view"
            >
              ⊞ Covers
            </button>
          </div>
          <button className="btn btn-ghost" onClick={() => setBulkOpen((v) => !v)}>
            ⇪ Bulk import
          </button>
        </div>
      </div>

      {bulkOpen && <BulkImport target="wishlist" onClose={() => setBulkOpen(false)} />}

      <OracleCategorizationButton books={wl} />



      {wl.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Your wishlist is empty</div>
          <div className="empty-state-text">
            Start building it your way. You can add books one at a time, import in bulk from Goodreads or Amazon, or browse our curated library of horror, gothic, and literary fiction.
          </div>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn" onClick={() => setBulkOpen(true)}>⇪ Bulk import</button>
            <button
              className="btn btn-ghost"
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
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">No books match</div>
          <div className="empty-state-text">Try clearing your filters.</div>
        </div>
      ) : viewMode === 'covers' ? (
        <LibraryCoverGrid
          grouped={grouped}
          genreKeys={genreKeys}
          genresByBookId={genresByBookId}
          onOpenBook={onOpenBook}
        />
      ) : (
        genreKeys.map((g) => (
          <div className="list-section" key={g}>
            <h2>{g} <span className="count">· {grouped[g].length}</span></h2>
            {grouped[g].map((b, i) => {
              const k = bookKey(b);
              const inNext = state.readNext.some((r) => bookKey(r) === k);
              const inReading = (state.currentlyReading || []).some((r) => bookKey(r) === k);
              return (
                <div className="list-item" key={`${k}-${i}`}>
                  <div className="li-num">{b.manuallyAdded ? '✎' : '❦'}</div>
                  <div className="li-content" onClick={() => onOpenBook?.(b)} style={{ cursor: 'pointer' }}>
                    <div className="li-title">{b.t}</div>
                    <div className="li-author">
                      {b.a}
                      {b.manuallyAdded && <> · <span style={{ color: 'var(--gilt)', opacity: 0.7 }}>added by you</span></>}
                      {inReading && <> · <span style={{ color: 'var(--gilt)' }}>reading</span></>}
                      {!inReading && inNext && <> · <span style={{ color: 'var(--gilt-bright)' }}>in Read Next</span></>}
                    </div>
                    {(() => {
                      const genres = genresByBookId[b.bookId];
                      return genres && genres.length > 0 ? (
                        <div className="li-genres">
                          {genres.map((g) => <span key={g.genreId} className="li-genre-pill" title={g.description || undefined}>{g.name}</span>)}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div className="li-actions">
                    {inReading ? (
                      <span className="li-action" style={{ opacity: 0.5, cursor: 'default' }}>▶ Reading</span>
                    ) : inNext ? (
                      <span className="li-action" style={{ opacity: 0.5, cursor: 'default' }}>✓ Queued</span>
                    ) : (
                      <button className="li-action success" onClick={() => addToReadNext(b)}>+ Read Next</button>
                    )}
                    {!inReading && (
                      <button className="li-action" onClick={() => startReading(b)}>▶ Start</button>
                    )}
                    <button
                      className="li-action danger"
                      onClick={() => {
                        if (confirm(`Remove "${b.t}" from your wishlist?`)) removeFromWishlist(b);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
