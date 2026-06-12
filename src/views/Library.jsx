import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';
import OracleCategorizationButton from '../components/OracleCategorizationButton';
import RatingModal from '../components/RatingModal';

// v0.15 phase 2.5: two-dropdown filter (genres + categories) + Oracle genre grouping.
// Grouping uses Oracle genres; books without genres fall back to b.g then 'Imported'.

export default function Library({ onOpenBook }) {
  const { state, removeFromLibrary, updateReadBook, getCategoriesForBook } = useData();
  const { go } = useRouter();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [genreFilter, setGenreFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { genresByBookId } = state;
  const lib = state.library;

  // Helper: primary genre label for a book.
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

  // --- Filtering ---
  let filtered = lib;

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

  const hasFilters = genreFilter !== 'all' || categoryFilter !== 'all' || search;

  async function handleSaveRating({ rating, notes }) {
    if (!editing) return;
    await updateReadBook(editing, { rating, notes });
    setEditing(null);
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Library
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Library</div>
        <h1 className="page-title">Books I've <span className="accent">Read</span></h1>
        <p className="page-subtitle">{lib.length} books across {genreKeys.length} genre{genreKeys.length !== 1 ? 's' : ''}.</p>
      </div>

      {lib.length > 0 && (
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
            <button
              className="btn btn-ghost"
              onClick={() => setBulkOpen((v) => !v)}
            >
              ⇪ Bulk add
            </button>
          </div>
        </div>
      )}

      {bulkOpen && (
        <BulkImport
          target="library"
          onClose={() => setBulkOpen(false)}
        />
      )}

      <OracleCategorizationButton books={lib} />

      {lib.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">📚</div>
          <div className="empty-state-title">Empty library</div>
          <div className="empty-state-text">
            As you mark books as read, they'll appear here and fill your shelves on the dashboard.
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn" onClick={() => setBulkOpen(true)}>⇪ Bulk add read books</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">📚</div>
          <div className="empty-state-title">No books match</div>
          <div className="empty-state-text">Try clearing your filters.</div>
        </div>
      ) : (
        genreKeys.map((g) => (
          <div className="list-section" key={g}>
            <h2>{g} <span className="count">· {grouped[g].length}</span></h2>
            {grouped[g].map((b, i) => (
              <div className="list-item" key={`${bookKey(b)}-${i}`}>
                <div
                  className="li-num"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(b);
                  }}
                  title={b.rating ? 'Edit your rating' : 'Rate this book'}
                  style={{ cursor: 'pointer' }}
                >
                  {b.rating ? '★'.repeat(b.rating) : '❦'}
                </div>
                <div className="li-content" onClick={() => onOpenBook?.(b)} style={{ cursor: 'pointer' }}>
                  <div className="li-title">{b.t}</div>
                  <div className="li-author">
                    {b.a}
                    {b.fromGoodreads && <> · <span style={{ color: 'var(--gilt)', opacity: 0.7 }}>from Goodreads</span></>}
                    {b.notes && (
                      <> · <span style={{ color: 'var(--gilt)', opacity: 0.7 }} title={b.notes}>has notes</span></>
                    )}
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
                  <button
                    className="li-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(b);
                    }}
                  >
                    {b.rating ? 'Edit rating' : '+ Rate'}
                  </button>
                  <button
                    className="li-action danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove "${b.t}" from your library?`)) removeFromLibrary(b);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {editing && (
        <RatingModal
          book={editing}
          initialRating={editing.rating}
          initialNotes={editing.notes}
          mode="edit"
          onSave={handleSaveRating}
          onSkip={() => setEditing(null)}
        />
      )}
    </>
  );
}
