// src/views/Lists.jsx — v0.27

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { openBookTab } from '../lib/bookHelpers';
import BookCover from '../components/BookCover';

function CreateListModal({ onSave, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const { lang } = useI18n();
  const isSpanish = lang === 'es';

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(title.trim(), description.trim());
    setSaving(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <button className="book-modal-close" onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem' }}>✕</button>
        <div className="book-modal-section-title" style={{ marginBottom: '1.25rem' }}>
          {isSpanish ? 'Nueva lista' : 'New list'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label">{isSpanish ? 'Título' : 'Title'}</label>
            <input
              className="search-input"
              placeholder={isSpanish ? 'p.ej. Mejor horror gótico' : 'e.g. Best Gothic Horror'}
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="form-label">
              {isSpanish ? 'Descripción' : 'Description'}{' '}
              <span style={{ opacity: 0.4 }}>({isSpanish ? 'opcional' : 'optional'})</span>
            </label>
            <textarea
              className="search-input"
              placeholder={isSpanish ? '¿De qué trata esta lista?' : "What's this list about?"}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>{isSpanish ? 'Cancelar' : 'Cancel'}</button>
            <button className="btn" onClick={handleSave} disabled={!title.trim() || saving}>
              {saving ? '…' : (isSpanish ? 'Crear lista' : 'Create list')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Lists() {
  const { state, createList, updateList, deleteList } = useData();
  const { go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [creating, setCreating] = useState(false);

  const lists = state.lists || [];

  async function handleCreate(title, description) {
    const newList = await createList(title, description);
    if (newList) go('list-detail', { listId: newList.id });
  }

  async function handleDelete(list, e) {
    e.stopPropagation();
    if (!confirm(`${isSpanish ? 'Eliminar' : 'Delete'} "${list.title}"?`)) return;
    await deleteList(list.id);
  }

  async function togglePublic(list, e) {
    e.stopPropagation();
    await updateList(list.id, { is_public: !list.is_public });
  }

  function copyLink(list, e) {
    e.stopPropagation();
    navigator.clipboard.writeText(
      `${window.location.origin}${window.location.pathname}?lang=${lang}#list-view?listId=${list.id}`
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow">{isSpanish ? 'Mis listas' : 'My Lists'}</div>
        <h1 className="page-title">
          {isSpanish ? 'Listas' : 'Curated'} <span className="accent">{isSpanish ? 'Curadas' : 'Lists'}</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
          {isSpanish
            ? 'Creá listas temáticas y compartilas con quien quieras.'
            : 'Create themed reading lists and share them with anyone.'}
        </p>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <button className="btn" onClick={() => setCreating(true)}>
          + {isSpanish ? 'Nueva lista' : 'New list'}
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{isSpanish ? 'Sin listas aún' : 'No lists yet'}</div>
          <div className="empty-state-text">
            {isSpanish
              ? 'Creá tu primera lista y empezá a curar libros para compartir.'
              : 'Create your first list and start curating books to share.'}
          </div>
        </div>
      ) : (
        <div className="cover-grid-shelves">
          {lists.map(list => {
            const books = list.books || [];
            return (
              <div key={list.id} className="cover-shelf">
                {/* Shelf header */}
                <div className="cover-shelf-label" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={() => go('list-detail', { listId: list.id })}
                  >
                    {list.title}
                    <span className="count"> · {books.length} {isSpanish ? 'libros' : 'books'}</span>
                    {list.is_public && (
                      <span style={{ marginLeft: '0.5rem', fontFamily: "'Special Elite',monospace", fontSize: '0.6rem', letterSpacing: '0.1em', color: 'rgba(201,162,75,0.7)' }}>
                        ✦ {isSpanish ? 'Pública' : 'Public'}
                      </span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button className="li-action" onClick={e => togglePublic(list, e)}>
                      {list.is_public
                        ? (isSpanish ? 'Hacer privada' : 'Make private')
                        : (isSpanish ? 'Hacer pública' : 'Make public')}
                    </button>
                    {list.is_public && (
                      <button className="li-action" onClick={e => copyLink(list, e)}>
                        {isSpanish ? 'Copiar enlace' : 'Copy link'}
                      </button>
                    )}
                    <button className="li-action" style={{ color: 'var(--blood-bright)' }}
                      onClick={e => handleDelete(list, e)}>
                      {isSpanish ? 'Eliminar' : 'Delete'}
                    </button>
                  </div>
                </div>

                {books.length === 0 ? (
                  <div
                    style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-dim)', fontStyle: 'italic', cursor: 'pointer', border: '1px dashed rgba(176,140,63,0.15)', borderRadius: 2 }}
                    onClick={() => go('list-detail', { listId: list.id })}
                  >
                    {isSpanish ? 'Lista vacía — hacer clic para agregar libros' : 'Empty list — click to add books'}
                  </div>
                ) : (
                  <div className="cover-shelf-grid">
                    {books.map((b, i) => (
                      <div
                        key={b.bookId || i}
                        className="cover-grid-item"
                        onClick={() => openBookTab(b, 'lists')}
                        title={`${b.t}${b.a ? ' · ' + b.a : ''}`}
                      >
                        <div className="cover-grid-img">
                          <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                        </div>
                        <div className="cover-grid-hover">
                          <div className="cover-grid-hover-title">{b.t}</div>
                          <div className="cover-grid-hover-author">{b.a}</div>
                        </div>
                      </div>
                    ))}
                    {/* Manage shelf button */}
                    
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && <CreateListModal onSave={handleCreate} onClose={() => setCreating(false)} />}
    </>
  );
}
