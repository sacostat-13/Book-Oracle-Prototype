// src/views/Lists.jsx — List Dashboard (DS Patterns / Lists)

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode, useI18n } from '../lib/I18nContext';
import { openBookTab } from '../lib/bookHelpers';
import BookCover from '../components/BookCover';
import CornerBrackets from '../components/CornerBrackets';

// How many covers to show per list before collapsing into a "+N more" box.
const COVER_PREVIEW = 6;

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
    <div className="overlay" onClick={onClose}>
      <div className="modal modal--narrow" onClick={e => e.stopPropagation()}>
        <CornerBrackets />
        <button className="modal__close" onClick={onClose}>✕</button>
        <div className="bp-section__label">
          {t('lists.newListBtn')}
        </div>
        <div className="lists-modal-form">
          <div>
            <label className="field-label">{t('report.fieldTitle')}</label>
            <input
              className="input"
              placeholder={t('lists.newListPlaceholder')}
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
          <div>
            <label className="field-label">
              {t('bookModal.description')}{' '}
              <span className="lists-optional-label">({t('lists.optional')})</span>
            </label>
            <textarea
              className="textarea"
              placeholder={t('lists.descPlaceholder')}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="lists-modal-actions">
            <button className="btn-tertiary" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={handleSave} disabled={!title.trim() || saving}>
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
  const tNode = useTNode();
  const { lang } = useI18n();
  const [creating, setCreating] = useState(false);

  const lists = state.lists || [];
  const { genresByBookId } = state;

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
      `${window.location.origin}/l/${list.id}?lang=${lang}`
    );
  }

  return (
    <>
      <div className="ls-dash-head">
        <div className="page-head__eyebrow"><span>{t('lists.myListsEyebrow')}</span></div>
        <h1 className="page-head__title">{tNode('lists.pageTitle')}</h1>
        <p className="page-head__lead">{t('lists.listsSubtitle')}</p>
      </div>

      <div className="plan-divider"><span className="plan-divider__glyph">✦</span></div>

      <div className="bp-actions">
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + {t('lists.newListBtn')}
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">{t('lists.emptyTitle')}</div>
          <div className="lv-empty-text">{t('lists.emptyText')}</div>
        </div>
      ) : (
        <div className="ls-dash-lists">
          {lists.map(list => {
            const books = list.books || [];
            const preview = books.slice(0, COVER_PREVIEW);
            const overflow = books.length - preview.length;
            return (
              <div key={list.id} className="ls-dash-list">
                {/* Shelf header — name · count, spacer, actions */}
                <div className="ls-dash-list__head">
                  <button
                    className="ls-dash-list__name"
                    onClick={() => go('list-detail', { listId: list.id })}
                  >
                    {list.title}
                    <span className="ls-dash-list__count"> · {t('lists.bookCount', { count: books.length })}</span>
                    {list.is_public && (
                      <span className="lists-shelf-badge">✦ {t('lists.publicBadge')}</span>
                    )}
                  </button>
                  <span className="ls-dash-list__spacer" />
                  <button className="ls-dash-list__action" onClick={e => togglePublic(list, e)}>
                    {list.is_public ? t('lists.makePrivate') : t('lists.makePublic')}
                  </button>
                  {list.is_public && (
                    <button className="ls-dash-list__action" onClick={e => copyLink(list, e)}>
                      {t('lists.copyLink')}
                    </button>
                  )}
                  <button className="ls-dash-list__action ls-dash-list__action--danger" onClick={e => handleDelete(list, e)}>
                    {t('common.delete')}
                  </button>
                </div>

                {books.length === 0 ? (
                  <button
                    className="ls-dash-list__empty"
                    onClick={() => go('list-detail', { listId: list.id })}
                  >
                    {t('lists.emptyList')}
                  </button>
                ) : (
                  <div className="cover-shelf-grid">
                    {preview.map((b, i) => (
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
                          {(() => {
                            const genres = genresByBookId[b.bookId];
                            return genres && genres.length > 0 ? (
                              <div className="cover-grid-hover-genres">
                                {genres.slice(0, 3).map((g) => (
                                  <span key={g.genreId} className="li-genre-pill">{g.name}</span>
                                ))}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    ))}
                    {overflow > 0 && (
                      <button
                        className="cover-grid-more"
                        onClick={() => go('list-detail', { listId: list.id })}
                        title={t('lists.openList')}
                      >
                        {t('lists.moreBooks', { count: overflow })}
                      </button>
                    )}
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
