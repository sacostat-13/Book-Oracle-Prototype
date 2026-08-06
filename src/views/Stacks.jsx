// Stacks — "Wander the stacks".
//
// An endless wall of covers the reader can browse and add from without
// importing anything. Serves the shared `books` catalog directly, so a long
// browse costs nothing: no Oracle quota, no external API per page.
//
// v0.59

import { useState, useMemo, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { useStacks, searchStacks } from '../lib/useStacks';
import StackCard from '../components/StackCard';

export default function Stacks() {
  const {
    state,
    bulkAddToLibrary,
    bulkAddToWishlist,
    removeFromLibrary,
    removeFromWishlist,
    showToast,
  } = useData();
  const t = useT();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);
  // bookId → 'library' | 'wishlist'. Optimistic, so a card responds instantly
  // and the reader can keep clicking without waiting on a round trip.
  const [decided, setDecided] = useState({});
  // bookIds with a write in flight, so a fast double-tap can't fire twice.
  const [busy, setBusy] = useState({});

  // v0.59.1: currentlyReading was missing here, which is why a book being read
  // right now still appeared on the wall.
  const owned = useMemo(
    () => [
      ...state.library,
      ...state.wishlist,
      ...(state.readNext || []),
      ...(state.currentlyReading || []),
    ],
    [state.library, state.wishlist, state.readNext, state.currentlyReading]
  );

  const favoriteGenres = state.profile?.favoriteGenres || [];
  const { books, loading, exhausted, loadMore, hide } = useStacks({ favoriteGenres, owned });

  const addedCount = Object.keys(decided).length;

  // One handler for add, switch and undo.
  //
  // Clicking the active choice clears it; clicking the other switches. Writes
  // go through the bulk helpers rather than addToWishlist because the card
  // already carries a `bookId` — the bulk path reuses it instead of running
  // another upsert_book, which is one fewer request and removes the conflict
  // that was surfacing as a 409 on wishlist_items.
  const handleAdd = useCallback(async (book, target) => {
    const id = book.bookId;
    if (busy[id]) return;

    const current = decided[id];
    const next = current === target ? null : target;

    setBusy((b) => ({ ...b, [id]: true }));
    setDecided((d) => {
      const copy = { ...d };
      if (next) copy[id] = next; else delete copy[id];
      return copy;
    });

    try {
      // Leaving the previous shelf first, so switching never leaves the book
      // on both.
      if (current === 'library' && next !== 'library') await removeFromLibrary(book);
      if (current === 'wishlist' && next !== 'wishlist') await removeFromWishlist(book, true);

      if (next === 'library') await bulkAddToLibrary([book]);
      if (next === 'wishlist') await bulkAddToWishlist([book]);

      if (next === 'library') showToast(t('stacks.addedRead', { title: book.t }));
      else if (next === 'wishlist') showToast(t('stacks.addedWant', { title: book.t }));
      else showToast(t('stacks.removed', { title: book.t }));
    } catch (e) {
      console.error('stacks write failed', e);
      // Put the card back the way it was so the reader can retry, rather than
      // leaving it showing a state that never reached the server.
      setDecided((d) => {
        const copy = { ...d };
        if (current) copy[id] = current; else delete copy[id];
        return copy;
      });
      showToast(t('stacks.addFailed'), true);
    } finally {
      setBusy((b) => {
        const copy = { ...b };
        delete copy[id];
        return copy;
      });
    }
  }, [busy, decided, bulkAddToLibrary, bulkAddToWishlist, removeFromLibrary, removeFromWishlist, showToast, t]);

  async function runSearch(e) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    const found = await searchStacks(q);
    setResults(found);
    setSearching(false);
  }

  function clearSearch() {
    setQuery('');
    setResults(null);
  }

  const shown = results ?? books;

  return (
    <div className="stacks">
      <div className="stacks__head">
        <div className="stacks__eyebrow">{t('stacks.eyebrow')}</div>
        <h1 className="stacks__title">{t('stacks.title')}</h1>
        <p className="stacks__desc">{t('stacks.desc')}</p>

        <form className="stacks__search" onSubmit={runSearch} role="search">
          <input
            type="search"
            className="stacks__search-input"
            placeholder={t('stacks.searchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) setResults(null);
            }}
            aria-label={t('stacks.searchPlaceholder')}
          />
          <button className="btn-secondary" type="submit" disabled={query.trim().length < 2}>
            {t('stacks.searchBtn')}
          </button>
        </form>

        {addedCount > 0 && (
          <div className="stacks__progress" role="status" aria-live="polite">
            {t('stacks.progress', { count: addedCount })}
          </div>
        )}
      </div>

      {results !== null && (
        <div className="stacks__search-note">
          {results.length > 0
            ? t('stacks.searchResults', { count: results.length, query })
            : t('stacks.searchEmpty', { query })}
          {' '}
          <button className="stacks__link" onClick={clearSearch}>{t('stacks.backToBrowse')}</button>
        </div>
      )}

      <div className="stacks__grid">
        {shown.map((b) => (
          <StackCard
            key={b.bookId}
            book={b}
            state={decided[b.bookId]}
            busy={!!busy[b.bookId]}
            onAdd={handleAdd}
            onHide={hide}
          />
        ))}
      </div>

      {shown.length === 0 && !loading && !searching && (
        <div className="stacks__empty">{t('stacks.empty')}</div>
      )}

      {results === null && (
        <div className="stacks__more">
          {exhausted ? (
            <div className="stacks__exhausted">{t('stacks.exhausted')}</div>
          ) : (
            <button className="btn-primary" onClick={loadMore} disabled={loading}>
              {loading ? t('stacks.loading') : t('stacks.showMore')}
            </button>
          )}
        </div>
      )}

      {searching && <div className="stacks__more">{t('stacks.loading')}</div>}
    </div>
  );
}
