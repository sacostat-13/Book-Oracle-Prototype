// StackCard — one book in The Stacks.
//
// Front: cover, title, author — a clean wall to scan.
// Back:  description and the actions, like turning a book over to read the back.
//
// ── The click bug this rewrite fixes ────────────────────────────────────────
// The first version laid a full-card <button> over the whole tile to catch taps
// for flipping, and relied on `z-index: 2` on the action buttons to sit above
// it. That can't work: `.stack-card__inner` has a `transform`, which creates a
// stacking context, so its children's z-index only competes *inside* it. The
// overlay — a sibling, outside that context — painted above everything. Result:
// the Read/Want buttons did nothing, "Full details" did nothing, and the
// description couldn't be scrolled, because every click landed on the overlay.
//
// There is no overlay now. The front face carries the flip affordance; the back
// face is plain content with real buttons and nothing on top of them.
//
// v0.59

import { useState } from 'react';
import { useT } from '../lib/I18nContext';
import { openBookTab } from '../lib/bookHelpers';

export default function StackCard({ book, onAdd, onHide, state, busy }) {
  const t = useT();
  const [flipped, setFlipped] = useState(false);

  const decided = state === 'library' || state === 'wishlist';

  return (
    <div
      className={`stack-card${flipped ? ' is-flipped' : ''}${decided ? ` is-${state}` : ''}`}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      <div className="stack-card__inner">
        {/* ── Front ── */}
        <div className="stack-card__face stack-card__front">
          {/* The cover itself is the flip target on touch. Scoped to the cover
              rather than the whole tile so it can never overlap the back. */}
          <button
            className="stack-card__cover"
            onClick={() => setFlipped(true)}
            aria-label={`${book.t}${book.a ? ` — ${book.a}` : ''}. ${t('stacks.flipHint')}`}
          >
            {book.coverUrl ? (
              <img src={book.coverUrl} alt="" loading="lazy" decoding="async" className="stack-card__img" />
            ) : (
              <div className="stack-card__img stack-card__img--placeholder" aria-hidden="true">
                {(book.t || '?').slice(0, 1)}
              </div>
            )}
            {decided && (
              <span className={`stack-card__stamp stack-card__stamp--${state}`}>
                {state === 'library' ? t('stacks.markedRead') : t('stacks.markedWant')}
              </span>
            )}
          </button>

          <div className="stack-card__meta">
            <div className="stack-card__title" title={book.t}>{book.t}</div>
            <div className="stack-card__author" title={book.a}>{book.a}</div>
          </div>
        </div>

        {/* ── Back ── */}
        <div className="stack-card__face stack-card__back">
          <div className="stack-card__back-head">
            <div className="stack-card__title">{book.t}</div>
            <div className="stack-card__author">{book.a}</div>
          </div>

          {/* Own scroll container. Nothing is layered over it now, so the
              wheel and the scrollbar both work. */}
          <div className="stack-card__desc">
            {book.d || t('stacks.noDescription')}
          </div>

          {/* v0.59.1: these are toggles, not one-way doors. Clicking the
              active choice clears it; clicking the other switches shelf. They
              are never `disabled` on account of being chosen — that was what
              made a decision impossible to undo. Only an in-flight write
              disables them. */}
          <div className="stack-card__actions">
            <button
              className={`stack-card__btn stack-card__btn--read${state === 'library' ? ' is-on' : ''}`}
              onClick={() => onAdd?.(book, 'library')}
              disabled={busy}
              aria-pressed={state === 'library'}
              title={state === 'library' ? t('stacks.undoHint') : undefined}
            >
              {state === 'library' ? `✓ ${t('stacks.markedRead')}` : t('stacks.actionRead')}
            </button>
            <button
              className={`stack-card__btn stack-card__btn--want${state === 'wishlist' ? ' is-on' : ''}`}
              onClick={() => onAdd?.(book, 'wishlist')}
              disabled={busy}
              aria-pressed={state === 'wishlist'}
              title={state === 'wishlist' ? t('stacks.undoHint') : undefined}
            >
              {state === 'wishlist' ? `✓ ${t('stacks.markedWant')}` : t('stacks.actionWant')}
            </button>
          </div>

          <div className="stack-card__back-foot">
            <button className="stack-card__more" onClick={() => openBookTab(book, 'stacks')}>
              {t('stacks.viewBook')}
            </button>
            {!decided && (
              <button
                className="stack-card__hide"
                onClick={() => onHide?.(book.bookId)}
                title={t('stacks.notForMe')}
              >
                {t('stacks.notForMe')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
