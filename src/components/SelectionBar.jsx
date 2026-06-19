// src/components/SelectionBar.jsx — v0.27
// Floating action bar that appears when books are selected.
// Context-aware: different actions for Wishlist, Library, ListDetail.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useI18n } from '../lib/I18nContext';
import AddToListModal from './AddToListModal';

export default function SelectionBar({
  count,
  selectedBooks,  // fn → book[]
  onExit,
  onSelectAll,
  onClearAll,
  // Context flags
  context,        // 'wishlist' | 'library' | 'list'
  listId,         // only for context='list'
}) {
  const {
    removeFromWishlist,
    removeFromLibrary,
    markAsRead,
    removeBookFromList,
    showToast,
  } = useData();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [showListPicker, setShowListPicker] = useState(false);
  const [working, setWorking] = useState(false);

  if (count === 0 && !working) return null;

  async function runOnAll(fn, successMsg) {
    const books = selectedBooks();
    if (!books.length) return;
    setWorking(true);
    for (const b of books) await fn(b);
    showToast(successMsg);
    onExit();
    setWorking(false);
  }

  async function handleRemove() {
    const books = selectedBooks();
    const label = isSpanish ? 'libros' : 'books';
    if (!confirm(`${isSpanish ? 'Eliminar' : 'Remove'} ${books.length} ${label}?`)) return;
    if (context === 'wishlist') {
      await runOnAll(b => removeFromWishlist(b), `${books.length} ${isSpanish ? 'libros eliminados de la lista de deseos' : 'books removed from wishlist'}`);
    } else if (context === 'library') {
      await runOnAll(b => removeFromLibrary(b), `${books.length} ${isSpanish ? 'libros eliminados de la biblioteca' : 'books removed from library'}`);
    } else if (context === 'list' && listId) {
      setWorking(true);
      for (const b of books) await removeBookFromList(listId, b.bookId);
      showToast(`${books.length} ${isSpanish ? 'libros eliminados de la lista' : 'books removed from list'}`);
      onExit();
      setWorking(false);
    }
  }

  async function handleMarkRead() {
    const books = selectedBooks();
    await runOnAll(b => markAsRead(b), `${books.length} ${isSpanish ? 'libros marcados como leídos' : 'books marked as read'}`);
  }

  return (
    <>
      <div className="selection-bar">
        <div className="selection-bar__left">
          <button className="selection-bar__cancel" onClick={onExit} disabled={working}>
            ✕
          </button>
          <span className="selection-bar__count">
            <strong>{count}</strong> {isSpanish ? 'seleccionados' : 'selected'}
          </span>
          <button className="selection-bar__secondary" onClick={onSelectAll} disabled={working}>
            {isSpanish ? 'Todos' : 'All'}
          </button>
          {count > 0 && (
            <button className="selection-bar__secondary" onClick={onClearAll} disabled={working}>
              {isSpanish ? 'Ninguno' : 'None'}
            </button>
          )}
        </div>

        <div className="selection-bar__actions">
          {count > 0 && (
            <>
              {/* Add to list — all contexts */}
              <button
                className="selection-bar__btn"
                onClick={() => setShowListPicker(true)}
                disabled={working}
              >
                ❦ {isSpanish ? 'Agregar a lista' : 'Add to list'}
              </button>

              {/* Mark as read — wishlist only */}
              {context === 'wishlist' && (
                <button
                  className="selection-bar__btn"
                  onClick={handleMarkRead}
                  disabled={working}
                >
                  ✓ {isSpanish ? 'Marcar leídos' : 'Mark read'}
                </button>
              )}

              {/* Remove */}
              <button
                className="selection-bar__btn selection-bar__btn--danger"
                onClick={handleRemove}
                disabled={working}
              >
                {working ? '…' : (context === 'list'
                  ? (isSpanish ? 'Quitar de lista' : 'Remove from list')
                  : (isSpanish ? 'Eliminar' : 'Remove'))}
              </button>
            </>
          )}
        </div>
      </div>

      {showListPicker && (
        <AddToListModal
          books={selectedBooks()}
          onClose={() => { setShowListPicker(false); onExit(); }}
        />
      )}
    </>
  );
}
