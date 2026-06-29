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
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <button className="book-modal-close" onClick={onClose}
          style={{ position: 'absolute', top: '1rem', right: '1rem' }}>✕</button>

        <div className="book-modal-section-title" style={{ marginBottom: '1.25rem', paddingRight: '2rem' }}>
          {isSingle
            ? (t('addToList.title'))
            : t('addToList.addMultiple', { count: bookList.length })}
        </div>

        {/* Book preview(s) */}
        {isSingle && singleBook && (
          <div style={{
            display: 'flex', gap: '0.85rem', alignItems: 'center',
            padding: '0.75rem 1rem', marginBottom: '1.25rem',
            background: 'var(--shadow)', border: '1px solid rgba(176,140,63,0.15)', borderRadius: 2,
          }}>
            {singleBook.coverUrl && (
              <img src={singleBook.coverUrl} alt={singleBook.t}
                style={{ width: 36, height: 54, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
            )}
            <div>
              <div style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.05rem', color: 'var(--paper)' }}>
                {singleBook.t}
              </div>
              <div style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-aged)', opacity: 0.7, marginTop: 3 }}>
                {singleBook.a}
              </div>
            </div>
          </div>
        )}

        {!isSingle && (
          <div style={{
            padding: '0.6rem 1rem', marginBottom: '1.25rem',
            background: 'var(--shadow)', border: '1px solid rgba(176,140,63,0.15)', borderRadius: 2,
            fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', color: 'var(--paper-aged)',
          }}>
            {bookList.slice(0, 3).map(b => b.t).join(', ')}
            {bookList.length > 3 && ` ${t('common.and')} ${bookList.length - 3} ${t('common.more')}…`}
          </div>
        )}

        {/* Lists */}
        {lists.length === 0 && !creating ? (
          <p style={{ color: 'var(--paper-aged)', fontStyle: 'italic', opacity: 0.6, marginBottom: '1rem' }}>
            {t('addToList.noLists')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
            {lists.map(list => {
              const already = allInList(list);
              const status = results[list.id];
              const done = status === 'done' || already;
              const adding = status === 'adding';
              return (
                <button key={list.id}
                  onClick={() => handleAdd(list)}
                  disabled={done || adding || saving}
                  className="btn btn-ghost"
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', textAlign: 'left',
                    opacity: done ? 0.7 : 1,
                    borderColor: done ? 'rgba(176,140,63,0.45)' : undefined,
                  }}
                >
                  <span style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: '1rem' }}>
                    {list.title}
                  </span>
                  <span style={{ fontFamily: 'var(--ro-font-mono)', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.5, marginLeft: '0.75rem', flexShrink: 0 }}>
                    {adding ? '…' : done ? t('addToList.addedDone') : t('addToList.bookCount', { count: list.books?.length || 0 })}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Create new list */}
        {creating ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input
              className="search-input"
              placeholder={t('addToList.listNamePlaceholder')}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" onClick={handleCreate} disabled={!newTitle.trim() || saving} style={{ flex: 1 }}>
                {saving ? '…' : (t('addToList.createAndAdd'))}
              </button>
              <button className="btn btn-ghost" onClick={() => { setCreating(false); setNewTitle(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', borderTop: '1px solid rgba(176,140,63,0.1)', paddingTop: '0.85rem' }}>
            <button className="btn" onClick={() => setCreating(true)}>
              + {t('lists.newListBtn')}
            </button>
            <button className="btn btn-ghost" onClick={() => { onClose(); go('lists'); }}
              style={{ fontSize: '0.8rem' }}>
              {t('addToList.manageLists')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
