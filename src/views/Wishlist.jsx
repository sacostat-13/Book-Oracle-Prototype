import { useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { GENRES, bookKey } from '../lib/bookHelpers';
import BulkImport from '../components/BulkImport';

// v0.12: the category filter dropdown unifies two sources:
//   1. The per-book `b.g` field (auto-detected single genre, legacy)
//   2. The user's categories on each book (from DataContext.getCategoriesForBook)
//
// Both contribute to a single dropdown so users see one mental model:
// "all the categorizations on my wishlist." Strict normalization is used to
// dedupe — "Horror" (b.g) and "horror" (user tag) merge into one entry. The
// display name uses the verified version's casing when available, falling
// back to whichever source we saw first.
//
// Verified entries sort to the top with a ☩ marker; everything else is
// alphabetical. Selecting a value filters books that match by EITHER source.
function normalizeFilterKey(s) {
  return (s || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

export default function Wishlist({ onOpenBook }) {
  const {
    state,
    addToReadNext,
    removeFromWishlist,
    addToWishlist,
    seedWishlistIfNeeded,
    showToast,
    getCategoriesForBook,
  } = useData();
  const { go } = useRouter();
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState({ t: '', a: '', g: '', d: '', amazonUrl: '' });

  const wl = state.wishlist;

  // v0.12: unified category index for the filter dropdown.
  //
  // Walks every book in the wishlist, collects:
  //   - the auto-genre `b.g`
  //   - every category attached to that book (verified + user-only)
  //
  // and merges them by normalized key. For each unique key, we keep the
  // best display name (prefer verified > first-seen) and a verified flag.
  // Books are tracked per-key so the filter step is O(1) lookup.
  const categoryIndex = useMemo(() => {
    // Map: normalized → { display, verified, bookKeys: Set }
    const map = new Map();

    function addEntry(rawName, verified, bk) {
      if (!rawName) return;
      const norm = normalizeFilterKey(rawName);
      if (!norm) return;
      let entry = map.get(norm);
      if (!entry) {
        entry = {
          display: rawName,
          verified: !!verified,
          bookKeys: new Set(),
        };
        map.set(norm, entry);
      } else {
        // Prefer a verified source's display name over an unverified one.
        // If neither is verified, keep what we had.
        if (verified && !entry.verified) {
          entry.display = rawName;
          entry.verified = true;
        }
        // Even if we're not promoting the display name, mark verified=true
        // if any source for this key is verified.
        if (verified) entry.verified = true;
      }
      if (bk) entry.bookKeys.add(bk);
    }

    for (const b of wl) {
      const bk = bookKey(b);

      // 1. Auto-genre. Treat as unverified — `b.g` is auto-detected, not
      //    editor-blessed. If the same name also exists as a verified
      //    category, the verified flag will win on the merge.
      if (b.g) addEntry(b.g, false, bk);

      // 2. The book's categories (mix of verified-global + user-only)
      const cats = getCategoriesForBook(b);
      for (const c of cats) {
        addEntry(c.name, c.verified, bk);
      }
    }
    return map;
  }, [wl, getCategoriesForBook]);

  // Build the dropdown option list, sorted verified-first then alphabetical.
  const categoryOptions = useMemo(() => {
    const opts = [];
    for (const [norm, entry] of categoryIndex.entries()) {
      opts.push({
        value: norm,         // used as filter value
        label: entry.display,
        verified: entry.verified,
      });
    }
    opts.sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return opts;
  }, [categoryIndex]);

  // The "form" dropdown (for manually adding a book) keeps using the curated
  // GENRES list + observed `b.g` values. Categories aren't surfaced here
  // because manual add only sets `b.g`, not user_book_categories. Users can
  // add categories from the BookModal after the book is in the wishlist.
  const formGenres = useMemo(
    () => [...new Set([...GENRES, ...wl.map((b) => b.g).filter(Boolean)])].sort(),
    [wl]
  );

  let filtered = wl;
  if (genreFilter !== 'all') {
    // The filter value is the normalized key. A book matches if it appears
    // in the entry's bookKeys set — which means either its b.g matched OR
    // it has a category that normalizes to the same key.
    const entry = categoryIndex.get(genreFilter);
    if (entry) {
      filtered = filtered.filter((b) => entry.bookKeys.has(bookKey(b)));
    } else {
      filtered = []; // unknown filter value; show empty rather than full
    }
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (b) => b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q)
    );
  }

  // Group the filtered list for display. The header for each group still
  // uses `b.g` as the grouping key — categories on a book don't change the
  // book's primary genre eyebrow, they only affect filterability. This
  // keeps the visual layout stable.
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
            style={{ maxWidth: '260px' }}
          >
            <option value="all">— All categories —</option>
            {categoryOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.verified ? `☩ ${o.label}` : o.label}
              </option>
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
            <span className="manual-add-note">Cover image will be fetched automatically from the title + author when possible. You can add more categories from the book's modal after adding.</span>
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
