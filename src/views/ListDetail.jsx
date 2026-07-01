// src/views/ListDetail.jsx — v0.27
// Single list — cover grid view matching Library/Wishlist aesthetic.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { openBookTab, bookKey } from '../lib/bookHelpers';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import BookCover from '../components/BookCover';

function AddBookPicker({ list, onClose }) {
  const { state, addBookToList } = useData();
  const t = useT();
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
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose}>✕</button>
        <div className="bp-section__label">
          {t('listDetail.addBook')}
        </div>
        <input
          className="search-input"
          placeholder={t('listDetail.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus

        />
        <div className="ldetail-scroll">
          {candidates.length === 0 && (
            <div className="ldetail-empty">
              {t('listDetail.noResults')}
            </div>
          )}
          {candidates.map((b, i) => (
            <div key={bookKey(b) + i}
              className="ldetail-pick-row"
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(176,140,63,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              onClick={() => add(b)}
            >
              <div className="ldetail-pick-cover--placeholder">
                <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
              </div>
              <div className="ldetail-pick-body">
                <div className="ldetail-pick-title">{b.t}</div>
                <div className="ldetail-pick-author">{b.a}</div>
              </div>
              <span className="li-action">
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
  const t = useT();
  const [addingBook, setAddingBook] = useState(false);
  const [copied, setCopied] = useState(false);

  const listId = route.params?.listId;
  const list = (state.lists || []).find(l => l.id === listId);

  if (!list) return (
    <div className="empty-state">
      <div className="ornament">❦</div>
      <div className="empty-state-title">{t('listDetail.notFound')}</div>
      <button className="btn-primary">
        {t('listDetail.backToLists')}
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
        <a onClick={() => go('lists')}>{t('about.featureListsTitle')}</a>
        {' · '}{list.title}
      </div>

      <div className="page-header">
        <div className="page-eyebrow">{t('listDetail.eyebrow')}</div>
        <h1 className="page-title">{list.title}</h1>
        {list.description && (
          <p className="lv-description">{list.description}</p>
        )}
        <div className="lv-action-row">
          <span className="level-pill">▤ {books.length} {t('common.books')}</span>
          {list.is_public && (
            <span className="level-pill bp-pill--ro-gold">
              ✦ {t('lists.publicBadge')}
            </span>
          )}
        </div>
      </div>

      <div className="lv-chips">
        <button className="btn" onClick={() => setAddingBook(true)}>
          {t('listDetail.addBook')}
        </button>
        <button className="btn btn-secondary" onClick={togglePublic}>
          {list.is_public
            ? (t('lists.makePrivate'))
            : (t('lists.makePublic'))}
        </button>
        {list.is_public && (
          <button className="btn btn-gilt" onClick={copyLink}>
            {copied ? '✓ Copied!' : (t('listDetail.copyLink'))}
          </button>
        )}
        {books.length > 0 && (
          <button
            className={`btn btn-secondary${sel.active ? ' active' : ''}`}
            onClick={() => sel.active ? sel.exit() : sel.enter()}
          >
            {sel.active ? (t('common.cancel')) : (t('lists.selectMode'))}
          </button>
        )}
      </div>

      {books.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('listDetail.emptyTitle')}</div>
          <div className="empty-state-text">
            {t('listDetail.emptyText')}
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
                      className="pf-error"
                      onClick={e => { e.stopPropagation(); removeBookFromList(list.id, b.bookId); }}
                    >
                      {t('common.remove')}
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
