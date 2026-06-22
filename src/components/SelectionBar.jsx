// src/components/SelectionBar.jsx — v0.27
// Floating action bar that appears when books are selected.
// Context-aware: different actions for Wishlist, Library, ListDetail.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
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
  const t = useT();
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
    const label = t('common.books');
    if (!confirm(`${t('common.remove')} ${books.length} ${label}?`)) return;
    if (context === 'wishlist') {
      await runOnAll(b => removeFromWishlist(b), `${books.length} ${t('selection.removedWishlist')}`);
    } else if (context === 'library') {
      await runOnAll(b => removeFromLibrary(b), `${books.length} ${t('selection.removedLibrary')}`);
    } else if (context === 'list' && listId) {
      setWorking(true);
      for (const b of books) await removeBookFromList(listId, b.bookId);
      showToast(`${books.length} ${t('selection.removedList')}`);
      onExit();
      setWorking(false);
    }
  }

  async function handleMarkRead() {
    const books = selectedBooks();
    await runOnAll(b => markAsRead(b), `${books.length} ${t('selection.markedRead')}`);
  }

  return (
    <>
      <div className="selection-bar">
        <div className="selection-bar__left">
          <button className="selection-bar__cancel" onClick={onExit} disabled={working}>
            ✕
          </button>
          <span className="selection-bar__count">
            <strong>{count}</strong> {t('selection.selected')}
          </span>
          <button className="selection-bar__secondary" onClick={onSelectAll} disabled={working}>
            {t('selection.all')}
          </button>
          {count > 0 && (
            <button className="selection-bar__secondary" onClick={onClearAll} disabled={working}>
              {t('selection.none')}
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
                {t('selectionBar.addToListBtn')}
              </button>

              {/* Mark as read — wishlist only */}
              {context === 'wishlist' && (
                <button
                  className="selection-bar__btn"
                  onClick={handleMarkRead}
                  disabled={working}
                >
                  {t('selectionBar.markReadBtn')}
                </button>
              )}

              {/* Remove */}
              <button
                className="selection-bar__btn selection-bar__btn--danger"
                onClick={handleRemove}
                disabled={working}
              >
                {working ? '…' : (context === 'list'
                  ? (t('bulkImport.removeRow'))
                  : (t('common.remove')))}
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
