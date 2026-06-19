// src/components/AddToListPicker.jsx — v0.27

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';

function AddToListModal({ book, onClose }) {
  const { state, addBookToList, createList } = useData();
  const { go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState(new Set());

  const lists = state.lists || [];

  function isInList(list) {
    return justAdded.has(list.id) || (list.books || []).some(b => b.bookId === book.bookId);
  }

  async function handleAdd(list) {
    if (isInList(list) || saving) return;
    setSaving(true);
    await addBookToList(list.id, book);
    setJustAdded(prev => new Set([...prev, list.id]));
    setSaving(false);
  }

  async function handleCreate() {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    const newList = await createList(newTitle.trim());
    if (newList) {
      await addBookToList(newList.id, book);
      setJustAdded(prev => new Set([...prev, newList.id]));
    }
    setNewTitle('');
    setCreating(false);
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        {/* Close */}
        <button className="book-modal-close" onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem' }}>✕</button>

        {/* Header */}
        <div className="book-modal-section-title" style={{ marginBottom: '1.25rem', paddingRight: '2rem' }}>
          {isSpanish ? 'Agregar a una lista' : 'Add to a list'}
        </div>

        {/* Book preview */}
        <div style={{
          display: 'flex', gap: '0.85rem', alignItems: 'center',
          padding: '0.85rem 1rem', marginBottom: '1.25rem',
          background: 'var(--shadow)',
          border: '1px solid rgba(176,140,63,0.15)',
          borderRadius: 2,
        }}>
          {book.coverUrl && (
            <img src={book.coverUrl} alt={book.t}
              style={{ width: 38, height: 56, objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} />
          )}
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontWeight: 600, fontSize: '1.05rem', color: 'var(--paper)', lineHeight: 1.2 }}>
              {book.t}
            </div>
            <div style={{ fontFamily: "'Special Elite',monospace", fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-aged)', opacity: 0.7, marginTop: 3 }}>
              {book.a}
            </div>
          </div>
        </div>

        {/* Lists */}
        {lists.length === 0 && !creating ? (
          <p style={{ color: 'var(--paper-aged)', fontStyle: 'italic', opacity: 0.6, marginBottom: '1rem' }}>
            {isSpanish ? 'Todavía no tenés listas.' : "You don't have any lists yet."}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
            {lists.map(list => {
              const already = isInList(list);
              return (
                <button key={list.id} onClick={() => handleAdd(list)}
                  disabled={already || saving}
                  className={already ? 'btn btn-ghost' : 'btn btn-ghost'}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', textAlign: 'left',
                    opacity: already ? 0.7 : 1,
                    borderColor: already ? 'rgba(176,140,63,0.45)' : undefined,
                  }}
                >
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: '1rem' }}>
                    {list.title}
                  </span>
                  <span style={{ fontFamily: "'Special Elite',monospace", fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.5, marginLeft: '0.75rem', flexShrink: 0 }}>
                    {already ? '✓ Added' : `${list.books?.length || 0} books`}
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
              placeholder={isSpanish ? 'Nombre de la lista' : 'List name'}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" onClick={handleCreate} disabled={!newTitle.trim() || saving} style={{ flex: 1 }}>
                {saving ? '…' : (isSpanish ? 'Crear y agregar' : 'Create & add')}
              </button>
              <button className="btn btn-ghost" onClick={() => { setCreating(false); setNewTitle(''); }}>
                {isSpanish ? 'Cancelar' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', borderTop: '1px solid rgba(176,140,63,0.1)', paddingTop: '0.85rem' }}>
            <button className="btn" onClick={() => setCreating(true)}>
              + {isSpanish ? 'Nueva lista' : 'New list'}
            </button>
            <button className="btn btn-ghost" onClick={() => { onClose(); go('lists'); }}
              style={{ fontSize: '0.8rem' }}>
              {isSpanish ? 'Gestionar listas ↗' : 'Manage lists ↗'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AddToListPicker({ book }) {
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [open, setOpen] = useState(false);

  if (!book) return null;

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        ❦ {isSpanish ? 'Agregar a lista' : 'Add to list'}
      </button>
      {open && <AddToListModal book={book} onClose={() => setOpen(false)} />}
    </>
  );
}
