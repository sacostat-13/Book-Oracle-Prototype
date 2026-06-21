// src/views/ListDetail.jsx — v0.27
// Single list — cover grid view matching Library/Wishlist aesthetic.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { openBookTab, bookKey } from '../lib/bookHelpers';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import BookCover from '../components/BookCover';

function AddBookPicker({ list, onClose }) {
  const { state, addBookToList } = useData();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(null);

  const listBookIds = new Set((list.books || []).map(b => b.bookId));

  const pool = [...state.wishlist, ...state.library, ...state.readNext]
    .filter((b, i, arr) => arr.findIndex(x => bookKey(x) === bookKey(b)) === i)
    .filter(b => !listBookIds.has(b.bookId));

  const candidates = query.trim()
    ? pool.filter(b => b.t?.toLowerCase().includes(query.toLowerCase()) || b.a?.toLowerCase().includes(query.toLowerCase())).slice(0, 24)
    : pool.slice(0, 24);

  async function add(book) {
    setAdding(book.bookId);
    await addBookToList(list.id, book);
    setAdding(null);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <button className="book-modal-close" onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem' }}>✕</button>
        <div className="book-modal-section-title" style={{ marginBottom: '1rem' }}>
          {isSpanish ? 'Agregar libro a la lista' : 'Add book to list'}
        </div>
        <input
          className="search-input"
          placeholder={isSpanish ? 'Buscar en tu colección…' : 'Search your collection…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          style={{ marginBottom: '1rem' }}
        />
        <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {candidates.length === 0 && (
            <div style={{ padding: '1rem 0', color: 'var(--text-dim)', fontStyle: 'italic' }}>
              {isSpanish ? 'Sin resultados.' : 'No books found.'}
            </div>
          )}
          {candidates.map((b, i) => (
            <div key={bookKey(b) + i}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.5rem', borderRadius: 2, cursor: 'pointer', transition: 'background 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(176,140,63,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              onClick={() => add(b)}
            >
              <div style={{ width: 32, height: 48, flexShrink: 0 }}>
                <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{b.t}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.a}</div>
              </div>
              <span className="li-action" style={{ flexShrink: 0, opacity: adding === b.bookId ? 0.5 : 1 }}>
                {adding === b.bookId ? '…' : '+ Add'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ListDetail() {
  const { state, updateList, removeBookFromList } = useData();
  const { route, go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';
  const [addingBook, setAddingBook] = useState(false);
  const [copied, setCopied] = useState(false);

  const listId = route.params?.listId;
  const list = (state.lists || []).find(l => l.id === listId);

  if (!list) return (
    <div className="empty-state">
      <div className="ornament">❦</div>
      <div className="empty-state-title">{isSpanish ? 'Lista no encontrada' : 'List not found'}</div>
      <button className="btn" onClick={() => go('lists')} style={{ marginTop: '1.5rem' }}>
        ← {isSpanish ? 'Volver' : 'Back to lists'}
      </button>
    </div>
  );

  const books = list.books || [];
  const sel = useSelection(books);

  async function togglePublic() {
    await updateList(list.id, { is_public: !list.is_public });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(
      `${window.location.origin}${window.location.pathname}?lang=${lang}#list-view?listId=${list.id}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('lists')}>{isSpanish ? 'Listas' : 'Lists'}</a>
        {' · '}{list.title}
      </div>

      <div className="page-header">
        <div className="page-eyebrow">{isSpanish ? 'Lista curada' : 'Curated List'}</div>
        <h1 className="page-title">{list.title}</h1>
        {list.description && (
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>{list.description}</p>
        )}
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="level-pill">▤ {books.length} {isSpanish ? 'libros' : 'books'}</span>
          {list.is_public && (
            <span className="level-pill" style={{ borderColor: 'rgba(201,162,75,.5)', color: '#d8b66a' }}>
              ✦ {isSpanish ? 'Pública' : 'Public'}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <button className="btn" onClick={() => setAddingBook(true)}>
          + {isSpanish ? 'Agregar libro' : 'Add book'}
        </button>
        <button className="btn btn-ghost" onClick={togglePublic}>
          {list.is_public
            ? (isSpanish ? 'Hacer privada' : 'Make private')
            : (isSpanish ? 'Hacer pública' : 'Make public')}
        </button>
        {list.is_public && (
          <button className="btn btn-gilt" onClick={copyLink}>
            {copied ? '✓ Copied!' : (isSpanish ? 'Copiar enlace' : 'Copy share link')}
          </button>
        )}
        {books.length > 0 && (
          <button
            className={`btn btn-ghost${sel.active ? ' active' : ''}`}
            onClick={() => sel.active ? sel.exit() : sel.enter()}
          >
            {sel.active ? (isSpanish ? 'Cancelar' : 'Cancel') : (isSpanish ? 'Seleccionar' : 'Select')}
          </button>
        )}
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{isSpanish ? 'Lista vacía' : 'Empty list'}</div>
          <div className="empty-state-text">
            {isSpanish ? 'Agregá libros de tu colección.' : 'Add books from your collection.'}
          </div>
        </div>
      ) : (
        <div className="cover-grid-shelves">
          <div className="cover-shelf">
            <div className="cover-shelf-grid">
              {books.map((b, i) => (
                <div
                  key={b.bookId || i}
                  className={`cover-grid-item${sel.active && b.bookId && sel.selected.has(b.bookId) ? ' cover-grid-item--selected' : ''}`}
                  title={`${b.t}${b.a ? ' · ' + b.a : ''}`}
                  onClick={() => sel.active ? sel.toggle(b.bookId) : openBookTab(b, 'list-detail')}
                >
                  {sel.active && (
                    <div className="cover-grid-checkbox">
                      {b.bookId && sel.selected.has(b.bookId) ? '✓' : ''}
                    </div>
                  )}
                  <div className="cover-grid-img">
                    <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                  </div>
                  <div className="cover-grid-hover">
                    <div className="cover-grid-hover-title">{b.t}</div>
                    <div className="cover-grid-hover-author">{b.a}</div>
                    <button
                      className="li-action"
                      style={{ marginTop: '0.5rem', color: 'var(--blood-bright)' }}
                      onClick={e => { e.stopPropagation(); removeBookFromList(list.id, b.bookId); }}
                    >
                      {isSpanish ? 'Quitar' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <SelectionBar
        count={sel.count}
        selectedBooks={sel.selectedBooks}
        onExit={sel.exit}
        onSelectAll={sel.selectAll}
        onClearAll={sel.clearAll}
        context="list"
        listId={list.id}
      />
      {addingBook && <AddBookPicker list={list} onClose={() => setAddingBook(false)} />}
    </>
  );
}
