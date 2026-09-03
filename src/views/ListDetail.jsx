// src/views/ListDetail.jsx — v0.27
// Single list — cover grid view matching Library/Wishlist aesthetic.

import { useMemo, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useT, useI18n } from '../lib/I18nContext';
import { openBookTab, bookKey, shelfStateOf, shelfKeySets } from '../lib/bookHelpers';
import { moodTitleKey } from '../lib/moods';
import CornerBrackets from '../components/CornerBrackets';
import { useSelection } from '../lib/useSelection';
import SelectionBar from '../components/SelectionBar';
import BookCover from '../components/BookCover';
import ShareModal from '../components/ShareModal';
import ListMetaEditor from '../components/ListMetaEditor';
import { listShareUrl } from '../lib/shareService';

function AddBookPicker({ list, onClose }) {
  const { state, addBookToList } = useData();
  const t = useT();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(null);

  // v0.46 — why this used to lag on every keystroke.
  //
  // `pool` was built inline in the render body, so all of this ran again on
  // every character typed:
  //
  //   [...wishlist, ...library, ...readNext]
  //     .filter((b, i, arr) => arr.findIndex(...) === i)   ← O(n²)
  //
  // findIndex inside filter is a linear scan per element. At ~1,200 books
  // across the three shelves that is over a million bookKey() calls — each of
  // which builds a string — before the search filter had even started, and
  // then the filter lowercased every title and author again from scratch.
  // React re-rendered the modal synchronously on each keystroke, so the typing
  // itself stalled.
  //
  // Three changes: dedupe with a Set instead of findIndex (O(n)), memoise the
  // pool so it survives keystrokes, and precompute the lowercase haystack once
  // per book rather than once per book per keystroke.
  const listBookIds = useMemo(
    () => new Set((list.books || []).map(b => b.bookId)),
    [list.books]
  );

  const pool = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const b of [...state.wishlist, ...state.library, ...state.readNext]) {
      const k = bookKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      if (listBookIds.has(b.bookId)) continue;
      out.push({ book: b, haystack: `${b.t || ''}\n${b.a || ''}`.toLowerCase() });
    }
    return out;
  }, [state.wishlist, state.library, state.readNext, listBookIds]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? pool.filter(p => p.haystack.includes(q)) : pool;
    return rows.slice(0, 24).map(p => p.book);
  }, [pool, query]);

  async function add(book) {
    setAdding(book.bookId);
    await addBookToList(list.id, book);
    setAdding(null);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <CornerBrackets />
        <button className="modal__close" onClick={onClose}>✕</button>
        <div className="bp-section__label">
          {t('listDetail.addBook')}
        </div>
        <input
          className="input"
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
              <span className="btn-text">
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
  const { state, updateList, removeBookFromList, setListGenres, setListMoods } = useData();
  const { route, go } = useRouter();
  const t = useT();
  const { lang } = useI18n();
  const [addingBook, setAddingBook] = useState(false);
  const [shareOpen, setShareOpen] = useState(false); // v0.43: replaces copy-link
  const [editingMeta, setEditingMeta] = useState(false);

  const listId = route.params?.listId;
  const list = (state.lists || []).find(l => l.id === listId);
  const { genresByBookId } = state;

  // Both of these must be computed BEFORE the `!list` early return, because
  // useSelection is a hook and React matches hooks by call order. Sitting below
  // the guard, it ran on some renders and not others: open a list, navigate to
  // one that is missing or not yet loaded, and the component throws "Rendered
  // fewer hooks than expected". Latent since the selection mode was added — the
  // lists array is usually already in state by the time this view mounts, which
  // is what kept it hidden.
  const books = list?.books || [];
  const sel = useSelection(books);

  // Shelf state for the badges below. Also above the guard, for the same
  // reason as useSelection.
  const { readKeys, wishKeys } = useMemo(() => shelfKeySets(state), [state]);

  if (!list) return (
    <div className="lv-empty">
      <div className="lv-empty-icon">❦</div>
      <div className="lv-empty-title">{t('listDetail.notFound')}</div>
      <button className="btn-primary" onClick={() => go('lists')}>
        {t('listDetail.backToLists')}
      </button>
    </div>
  );

  async function togglePublic() {
    await updateList(list.id, { is_public: !list.is_public });
  }

  return (
    <>
      

      <div className="ls-page-head">
        <div className="page-head__eyebrow">
          <span>{t('about.featureListsTitle')}</span> · {list.title}
        </div>
        <div className="ls-page-head__label">{t('lists.curated')}</div>
        <h1 className="ls-page-title">{list.title}</h1>
        {list.description && (
          <p className="ls-page-desc">{list.description}</p>
        )}
        <div className="ls-page-head__meta">
          <span className="plan-badge">▤ {t('lists.bookCount', { count: books.length })}</span>
          {list.is_public && (
            <span className="plan-badge">✦ {t('lists.publicBadge')}</span>
          )}
        </div>
      </div>

      <div className="plan-divider"><span className="plan-divider__glyph">✦</span></div>

      <div className="bp-actions">
        <button className="btn-primary" onClick={() => setAddingBook(true)}>
          {t('listDetail.addBook')}
        </button>
        <button className="btn-secondary" onClick={togglePublic}>
          {list.is_public
            ? (t('lists.makePrivate'))
            : (t('lists.makePublic'))}
        </button>
        {list.is_public && (
          <button className="btn-primary" onClick={() => setShareOpen(true)}>
            ↗ {t('share.shareList')}
          </button>
        )}
        {books.length > 0 && (
          <button
            className={`btn-secondary${sel.active ? ' active' : ''}`}
            onClick={() => sel.active ? sel.exit() : sel.enter()}
          >
            {sel.active ? (t('common.cancel')) : (t('lists.selectMode'))}
          </button>
        )}
        {list.is_public && (
          <button className="btn-secondary" onClick={() => setEditingMeta((v) => !v)}>
            {editingMeta ? t('common.done') : t('lists.editTags')}
          </button>
        )}
      </div>

      {/* Tags are only offered on a public list. They exist so Discover can
          filter, and a private list is not in Discover — showing the editor
          there would be asking for work that does nothing. When the list is
          made public the button appears, which is also the moment the reader
          has a reason to care. */}
      {list.is_public && editingMeta && (
        <ListMetaEditor
          genres={state.genres || []}
          genreIds={list.genreIds || []}
          moods={list.moods || []}
          onGenresChange={(ids) => setListGenres(list.id, ids)}
          onMoodsChange={(ms) => setListMoods(list.id, ms)}
          hint={t('lists.metaHint')}
        />
      )}

      {/* Read-only summary when not editing, so a tagged list shows its tags
          without a click and an untagged public list nudges toward adding
          some — Discover filters are the whole reason they exist. */}
      {list.is_public && !editingMeta && (
        <div className="list-meta__summary">
          {(list.genreIds || []).length === 0 && (list.moods || []).length === 0 ? (
            <span className="lv-hl-muted">{t('lists.noTagsYet')}</span>
          ) : (
            <>
              {(list.genreIds || []).map((id) => {
                const g = (state.genres || []).find((x) => x.id === id);
                return g ? <span key={id} className="directory-tag">{g.name}</span> : null;
              })}
              {(list.moods || []).map((m) => (
                <span key={m} className="directory-tag directory-tag--mood">{t(moodTitleKey(m))}</span>
              ))}
            </>
          )}
        </div>
      )}

      {books.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">{t('listDetail.emptyTitle')}</div>
          <div className="lv-empty-text">{t('listDetail.emptyText')}</div>
        </div>
      ) : (
        <div className="cover-grid-shelves">
          <div className="cover-shelf">
            <div className="cover-shelf-grid">
              {books.map((b, i) => {
                const shelf = shelfStateOf(b, readKeys, wishKeys);
                return (
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
                  <div className={`cover-grid-img${shelf ? ` is-${shelf}` : ''}`}>
                    <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                    {shelf && (
                      <span className={`shelf-badge shelf-badge--${shelf} cover-grid-shelf-badge`}>
                        {shelf === 'library' ? t('lists.badgeRead') : t('lists.badgeWishlist')}
                      </span>
                    )}
                  </div>
                  <div className="cover-grid-hover">
                    <div className="cover-grid-hover-title">{b.t}</div>
                    <div className="cover-grid-hover-author">{b.a}</div>
                    {(() => {
                      const genres = genresByBookId[b.bookId];
                      return genres && genres.length > 0 ? (
                        <div className="cover-grid-hover-genres">
                          {genres.slice(0, 3).map((g) => (
                            g.normalizedName ? (
                            <RouteLink key={g.genreId} to="genre-page" params={{ genreSlug: g.normalizedName }} className="li-genre-pill">{g.name}</RouteLink>
                          ) : (
                            <span key={g.genreId} className="li-genre-pill">{g.name}</span>
                          )
                          ))}
                        </div>
                      ) : null;
                    })()}
                    <button
                      className="btn-text cover-grid-hover__remove"
                      onClick={e => { e.stopPropagation(); removeBookFromList(list.id, b.bookId); }}
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                </div>
                );
              })}
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
      {/* v0.43: page-share modal (public lists only — button is gated above) */}
      {shareOpen && (
        <ShareModal
          title={list.title}
          text={t('share.text.list', { title: list.title, count: books.length })}
          url={`${listShareUrl(list.id)}?lang=${lang}`}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>
  );
}
