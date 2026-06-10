import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { GENRES, bookKey } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';

export default function Wishlist({ onOpenBook }) {
  const { state, addToReadNext, removeFromWishlist, addToWishlist, seedWishlistIfNeeded, showToast } = useData();
  const { go } = useRouter();
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState({ t: '', a: '', g: '', d: '', amazonUrl: '' });

  const wl = state.wishlist;
  const allGenres = useMemo(
    () => [...new Set(wl.map((b) => b.g).filter(Boolean))].sort(),
    [wl]
  );
  const formGenres = useMemo(
    () => [...new Set([...GENRES, ...wl.map((b) => b.g).filter(Boolean)])].sort(),
    [wl]
  );

  let filtered = wl;
  if (genreFilter !== 'all') filtered = filtered.filter((b) => b.g === genreFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (b) => b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q)
    );
  }

  const grouped = {};
  for (const b of filtered) {
    const g = b.g || 'Uncategorized';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(b);
  }
  const genreKeys = Object.keys(grouped).sort();

  async function submitForm() {
    const t = form.t.trim(), a = form.a.trim();
    if (!t || !a) {
      showToast('Title and author are required', true);
      return;
    }
    const book = {
      t,
      a,
      g: form.g || 'Uncategorized',
      d: form.d.trim() || null,
      amazonUrl: form.amazonUrl.trim() || null,
      manuallyAdded: true,
      addedAt: new Date().toISOString(),
    };
    const added = await addToWishlist(book);
    if (!added) {
      showToast(`"${t}" is already in your wishlist or library`, true);
      return;
    }
    setForm({ t: '', a: '', g: '', d: '', amazonUrl: '' });
    setFormOpen(false);
  }

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
            style={{ maxWidth: '240px' }}
          >
            <option value="all">— All categories —</option>
            {allGenres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => { setBulkOpen((v) => !v); setFormOpen(false); }}>
            ⇪ Bulk import
          </button>
          <button className="btn btn-gilt" onClick={() => { setFormOpen((v) => !v); setBulkOpen(false); }}>
            + Add a book
          </button>
        </div>
      </div>

      {bulkOpen && <BulkImport target="wishlist" onClose={() => setBulkOpen(false)} />}

      {formOpen && (
        <div className="manual-add-form">
          <div className="manual-add-header">
            <h3>Add a book to your wishlist</h3>
            <button className="manual-add-close" onClick={() => setFormOpen(false)}>×</button>
          </div>
          <div className="manual-add-grid">
            <div className="field">
              <label>Title *</label>
              <input className="search-input" placeholder="The book's title" value={form.t} onChange={(e) => setForm({ ...form, t: e.target.value })} />
            </div>
            <div className="field">
              <label>Author *</label>
              <input className="search-input" placeholder="Author name" value={form.a} onChange={(e) => setForm({ ...form, a: e.target.value })} />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={form.g} onChange={(e) => setForm({ ...form, g: e.target.value })}>
                <option value="">— Choose a category —</option>
                {formGenres.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amazon URL <span className="field-optional">(optional)</span></label>
              <input className="search-input" placeholder="https://www.amazon.com/…" value={form.amazonUrl} onChange={(e) => setForm({ ...form, amazonUrl: e.target.value })} />
            </div>
            <div className="field field-full">
              <label>Description <span className="field-optional">(optional)</span></label>
              <textarea placeholder="A line or two about the book…" value={form.d} onChange={(e) => setForm({ ...form, d: e.target.value })}></textarea>
            </div>
          </div>
          <div className="manual-add-actions">
            <span className="manual-add-note">Cover image will be fetched automatically from the title + author when possible.</span>
            <button className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
            <button className="btn" onClick={submitForm}>Add to wishlist ❦</button>
          </div>
        </div>
      )}

      {wl.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Your wishlist is empty</div>
          <div className="empty-state-text">
            Start building it your way. You can add books one at a time, import in bulk from Goodreads or Amazon, or browse our curated library of horror, gothic, and literary fiction.
          </div>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-gilt" onClick={() => setFormOpen(true)}>+ Add a book</button>
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
      ) : (
        genreKeys.map((g) => (
          <div className="list-section" key={g}>
            <h2>{g} <span className="count">· {grouped[g].length}</span></h2>
            {grouped[g].map((b, i) => {
              const k = bookKey(b);
              const inNext = state.readNext.some((r) => bookKey(r) === k);
              return (
                <div className="list-item" key={`${k}-${i}`}>
                  <div className="li-num">{b.manuallyAdded ? '✎' : '❦'}</div>
                  <div className="li-content" onClick={() => onOpenBook?.(b)} style={{ cursor: 'pointer' }}>
                    <div className="li-title">{b.t}</div>
                    <div className="li-author">
                      {b.a}
                      {b.manuallyAdded && <> · <span style={{ color: 'var(--gilt)', opacity: 0.7 }}>added by you</span></>}
                      {inNext && <> · <span style={{ color: 'var(--gilt-bright)' }}>in Read Next</span></>}
                    </div>
                  </div>
                  <div className="li-actions">
                    {inNext ? (
                      <span className="li-action" style={{ opacity: 0.5, cursor: 'default' }}>✓ Queued</span>
                    ) : (
                      <button className="li-action success" onClick={() => addToReadNext(b)}>+ Read Next</button>
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
