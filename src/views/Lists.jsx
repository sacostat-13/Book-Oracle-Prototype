// src/views/Lists.jsx — v0.27

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { openBookTab } from '../lib/bookHelpers';
import BookCover from '../components/BookCover';

function CreateListModal({ onSave, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const t = useT();

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(title.trim(), description.trim());
    setSaving(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--narrow" onClick={e => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose}>✕</button>
        <div className="bp-section__label">
          {t('lists.newListBtn')}
        </div>
        <div className="lists-modal-form">
          <div>
            <label className="form-label">{t('report.fieldTitle')}</label>
            <input
              className="search-input"
              placeholder={t('lists.newListPlaceholder')}
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="form-label">
              {t('bookModal.description')}{' '}
              <span className="lists-optional-label">({t('lists.optional')})</span>
            </label>
            <textarea
              className="search-input"
              placeholder={t('lists.descPlaceholder')}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}

            />
          </div>
          <div className="lists-modal-actions">
            <button className="btn btn-danger" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!title.trim() || saving}>
              {saving ? '…' : (t('lists.createList'))}
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
  const t = useT();
  const [creating, setCreating] = useState(false);

  const lists = state.lists || [];

  async function handleCreate(title, description) {
    const newList = await createList(title, description);
    if (newList) go('list-detail', { listId: newList.id });
  }

  async function handleDelete(list, e) {
    e.stopPropagation();
    if (!confirm(`${t('common.delete')} "${list.title}"?`)) return;
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
      <div className="page-page-head">
        <div className="page-head__eyebrow"><span>Dashboard</span> · Lists</div>
        <h1 className="page-head__title-title">
          <span className="accent">{t('about.featureListsTitle')}</span>
        </h1>
        <p className="lists-empty-text">
          {t('lists')}
        </p>
      </div>

      <div className="lists-grid">
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + {t('lists.newListBtn')}
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('lists.emptyTitle')}</div>
          <div className="empty-state-text">
            {t('emptyText')}
          </div>
        </div>
      ) : (
        <div className="cover-grid-shelves">
          {lists.map(list => {
            const books = list.books || [];
            return (
              <div key={list.id} className="cover-shelf">
                {/* Shelf header */}
                <div className="cover-shelf-label lists-shelf-label">
                  <span

                    onClick={() => go('list-detail', { listId: list.id })}
                  >
                    {list.title}
                    <span className="count"> · {books.length} {t('common.books')}</span>
                    {list.is_public && (
                      <span className="lists-shelf-badge">
                        ✦ {t('lists.publicBadge')}
                      </span>
                    )}
                  </span>
                  <div className="bp-actions">
                    <button className="btn btn-secondary" onClick={e => togglePublic(list, e)}>
                      {list.is_public
                        ? (t('lists.makePrivate'))
                        : (t('lists.makePublic'))}
                    </button>
                    {list.is_public && (
                      <button className="btn btn-secondary" onClick={e => copyLink(list, e)}>
                        {t('lists.copyLink')}
                      </button>
                    )}
                    <button className="btn btn-secondary"
                      onClick={e => handleDelete(list, e)}>
                      {t('common.delete')}
                    </button>
                  </div>
                </div>

                {books.length === 0 ? (
                  <div
                    className="lv-empty" style={{ cursor: "pointer", border: "1px dashed var(--ro-border)" }}
                    onClick={() => go('list-detail', { listId: list.id })}
                  >
                    {t('lists.emptyList')}
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
