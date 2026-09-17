// src/components/AddBooksChooser.jsx — v0.71
//
// "How do I add books?" kept arriving from readers, while the app already had
// five answers scattered across the nav, Library, Wishlist, Profile and The
// Stacks. This is one door to all of them, worded by what the reader has in
// front of them rather than by the name of the mechanism: nobody knows what a
// "bulk import" is, but everybody knows whether they are holding a pile.
//
// Open by default while the shelves are nearly empty — that is when the
// question gets asked — and folded to a single button once they are not.
// Every option hands off to the existing flow; nothing here imports a book.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import ScanModal from './ScanModal';
import BulkImport from './BulkImport';

// Below this many books across all three shelves, the chooser starts open.
export const ADD_BOOKS_OPEN_BELOW = 5;

// Nav owns the search input (desktop bar or mobile menu), so the chooser asks
// for focus instead of reaching into Nav's DOM. Listened for in Nav.jsx.
export const FOCUS_SEARCH_EVENT = 'ro:focus-search';

export default function AddBooksChooser() {
  const { state, loading } = useData();
  const { go } = useRouter();
  const t = useT();

  const shelfCount =
    (state.library || []).length +
    (state.wishlist || []).length +
    (state.currentlyReading || []).length;
  const sparse = !loading && shelfCount < ADD_BOOKS_OPEN_BELOW;

  // Derived, not seeded: shelves arrive after first render (and a cached empty
  // shelf can flash first — see cached-empty-shelf postmortem), so the default
  // follows the data until the reader opens or closes it themselves.
  const [userOpen, setUserOpen] = useState(null);
  const open = userOpen ?? sparse;
  const [scanOpen, setScanOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const options = [
    { id: 'scan', glyph: '▥', onPick: () => setScanOpen(true) },
    { id: 'goodreads', glyph: '↻', onPick: () => go('profile', { tab: 'account', anchor: 'goodreads' }) },
    { id: 'bulk', glyph: '☰', onPick: () => setBulkOpen((v) => !v) },
    { id: 'search', glyph: '⌕', onPick: () => window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT)) },
    { id: 'stacks', glyph: '▦', onPick: () => go('stacks') },
  ];

  if (!open) {
    return (
      <div className="db-add db-add--folded">
        <button className="btn btn-tertiary" onClick={() => setUserOpen(true)} aria-expanded="false">
          <span className="btn btn__plus">+</span> {t('dashboard.addBooks.toggle')}
        </button>
      </div>
    );
  }

  return (
    <section className="db-add" aria-labelledby="db-add-title">
      <div className="db-add__head">
        <div>
          <h2 id="db-add-title" className="db-add__title">{t('dashboard.addBooks.title')}</h2>
          <p className="db-add__intro">
            {sparse ? t('dashboard.addBooks.introEmpty') : t('dashboard.addBooks.intro')}
          </p>
        </div>
        {!sparse && (
          <button
            className="btn-icon db-add__close"
            onClick={() => { setUserOpen(false); setBulkOpen(false); }}
            aria-label={t('dashboard.addBooks.close')}
            title={t('dashboard.addBooks.close')}
          >✕</button>
        )}
      </div>

      <div className="db-add__options">
        {options.map(({ id, glyph, onPick }) => (
          <button
            key={id}
            className={`db-add__option${id === 'bulk' && bulkOpen ? ' is-active' : ''}`}
            onClick={onPick}
            aria-expanded={id === 'bulk' ? bulkOpen : undefined}
          >
            <span className="db-add__glyph" aria-hidden="true">{glyph}</span>
            <span className="db-add__label">{t(`dashboard.addBooks.${id}`)}</span>
            <span className="db-add__sub">{t(`dashboard.addBooks.${id}Sub`)}</span>
          </button>
        ))}
      </div>

      {bulkOpen && (
        <div className="db-add__bulk">
          <BulkImport target="library" onClose={() => setBulkOpen(false)} />
        </div>
      )}

      {scanOpen && <ScanModal onClose={() => setScanOpen(false)} />}
    </section>
  );
}
