// src/components/AddToListModal.jsx — v0.27
// Reusable modal for adding one or many books to a list.
// Used by AddToListPicker (single book) and SelectionBar (bulk).

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

export default function AddToListModal({ books = [], onClose }) {
  // books can be a single book object or an array
  const bookList = Array.isArray(books) ? books : [books];
  const { state, addBookToList, createList } = useData();
  const { go } = useRouter();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState({}); // listId → 'adding' | 'done' | 'error'

  const lists = state.lists || [];
  const isSingle = bookList.length === 1;
  const singleBook = isSingle ? bookList[0] : null;

  function allInList(list) {
    if (!isSingle) return false;
    return (list.books || []).some(b => b.bookId === singleBook?.bookId);
  }

  async function handleAdd(list) {
    if (results[list.id] === 'done' || saving) return;
    setResults(r => ({ ...r, [list.id]: 'adding' }));
    for (const book of bookList) {
      const already = (list.books || []).some(b => b.bookId === book.bookId);
      if (!already) await addBookToList(list.id, book);
    }
    setResults(r => ({ ...r, [list.id]: 'done' }));
  }

  async function handleCreate() {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    const newList = await createList(newTitle.trim());
    if (newList) {
      setResults(r => ({ ...r, [newList.id]: 'adding' }));
      for (const book of bookList) await addBookToList(newList.id, book);
      setResults(r => ({ ...r, [newList.id]: 'done' }));
    }
    setNewTitle('');
    setCreating(false);
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="book-modal-close" onClick={onClose}
          className="modal__close">✕</button>

        <div className="bp-section__label">
          {isSingle
            ? (t('addToList.title'))
            : t('addToList.addMultiple', { count: bookList.length })}
        </div>

        {/* Book preview(s) */}
        {isSingle && singleBook && (
          <div className="atl-book-row">
            {singleBook.coverUrl && (
              <img src={singleBook.coverUrl} alt={singleBook.t}
                className="atl-cover" />
            )}
            <div>
              <div className="atl-book-title">
                {singleBook.t}
              </div>
              <div className="atl-book-author">
                {singleBook.a}
              </div>
            </div>
          </div>
        )}

        {!isSingle && (
          <div className="session-form__book-row">
            {bookList.slice(0, 3).map(b => b.t).join(', ')}
            {bookList.length > 3 && ` ${t('common.and')} ${bookList.length - 3} ${t('common.more')}…`}
          </div>
        )}

        {/* Lists */}
        {lists.length === 0 && !creating ? (
          <p className="fp-empty">
            {t('addToList.noLists')}
          </p>
        ) : (
          <div className="pf-series-list">
            {lists.map(list => {
              const already = allInList(list);
              const status = results[list.id];
              const done = status === 'done' || already;
              const adding = status === 'adding';
              return (
                <button key={list.id}
                  onClick={() => handleAdd(list)}
                  disabled={done || adding || saving}
                  className="atl-list-item" style={{ opacity: done ? 0.7 : 1 }}
                >
                  <span className="atl-list-name">
                    {list.title}
                  </span>
                  <span className="pf-overline" style={{ flexShrink: 0, marginLeft: "0.75rem", marginBottom: 0 }}>
                    {adding ? '…' : done ? t('addToList.addedDone') : t('addToList.bookCount', { count: list.books?.length || 0 })}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Create new list */}
        {creating ? (
          <div className="lists-modal-form">
            <input
              className="search-input"
              placeholder={t('addToList.listNamePlaceholder')}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <div className="lists-modal-actions">
              <button className="btn-primary" onClick={handleCreate} disabled={!newTitle.trim() || saving} style={{ flex: 1 }}>
                {saving ? '…' : (t('addToList.createAndAdd'))}
              </button>
              <button className="btn-tertiary" onClick={() => { setCreating(false); setNewTitle(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-foot">
            <button className="btn" onClick={() => setCreating(true)}>
              + {t('lists.newListBtn')}
            </button>
            <button className="btn btn-ghost" onClick={() => { onClose(); go('lists'); }}
              >
              {t('addToList.manageLists')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
