// OnboardingStacks — the compact Stacks grid used as the final onboarding step.
//
// Deliberately NOT the full StackCard. Onboarding is the wrong place to teach a
// flip interaction, and a reader mid-setup shouldn't have to discover that the
// actions live on the back of a card. Here each cover has two visible buttons
// and nothing hidden.
//
// Writes go straight through, unlike the Goodreads import on the previous step:
// picking a dozen books is a handful of rows, not hundreds, so there's nothing
// to defer or show progress for.
//
// v0.59

import { useState, useCallback, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { useStacks } from '../lib/useStacks';

// A soft target. The Oracle needs roughly this many books to give a suggestion
// that isn't generic — but it is never enforced, and the step is skippable.
const SOFT_TARGET = 10;

export default function OnboardingStacks({ favoriteGenres = [], onCountChange }) {
  const { state, bulkAddToLibrary, bulkAddToWishlist, removeFromLibrary, removeFromWishlist } = useData();
  const t = useT();

  const owned = [
    ...(state.library || []),
    ...(state.wishlist || []),
    ...(state.readNext || []),
    ...(state.currentlyReading || []),
  ];

  const { books, loading, loadMore } = useStacks({ favoriteGenres, owned });
  const [decided, setDecided] = useState({});
  const [busy, setBusy] = useState({});

  const count = Object.keys(decided).length;
  useEffect(() => { onCountChange?.(count); }, [count, onCountChange]);

  const pick = useCallback(async (book, target) => {
    const id = book.bookId;
    if (busy[id]) return;

    const current = decided[id];
    const next = current === target ? null : target;

    setBusy((b) => ({ ...b, [id]: true }));
    setDecided((d) => {
      const copy = { ...d };
      if (next) copy[id] = next; else delete copy[id];
      return copy;
    });

    try {
      if (current === 'library' && next !== 'library') await removeFromLibrary(book);
      if (current === 'wishlist' && next !== 'wishlist') await removeFromWishlist(book, true);
      if (next === 'library') await bulkAddToLibrary([book]);
      if (next === 'wishlist') await bulkAddToWishlist([book]);
    } catch (e) {
      console.error('onboarding stacks pick failed', e);
      setDecided((d) => {
        const copy = { ...d };
        if (current) copy[id] = current; else delete copy[id];
        return copy;
      });
    } finally {
      setBusy((b) => {
        const copy = { ...b };
        delete copy[id];
        return copy;
      });
    }
  }, [busy, decided, bulkAddToLibrary, bulkAddToWishlist, removeFromLibrary, removeFromWishlist]);

  return (
    <div className="onb-stacks">
      <div className="onb-stacks__progress" role="status" aria-live="polite">
        {count === 0
          ? t('onboarding.stacksPickHint', { target: SOFT_TARGET })
          : t('onboarding.stacksPicked', { count })}
      </div>

      <div className="onb-stacks__grid">
        {books.map((b) => {
          const st = decided[b.bookId];
          return (
            <div
              key={b.bookId}
              className={`onb-stacks__card${st ? ` is-${st}` : ''}`}
            >
              <div className="onb-stacks__cover">
                {b.coverUrl ? (
                  <img src={b.coverUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <div className="onb-stacks__placeholder" aria-hidden="true">
                    {(b.t || '?').slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="onb-stacks__title" title={b.t}>{b.t}</div>
              <div className="onb-stacks__author" title={b.a}>{b.a}</div>
              <div className="onb-stacks__actions">
                {/* Short labels here, not the full "I've read this" used on
                    the main Stacks. At ~110px a tile can hold "I want this" on
                    one line but not "I've read this", so the two buttons wrapped
                    to different heights. The full sentences stay on the big
                    cards where there's room.

                    aria-label carries the long form, so the shorter visible
                    text costs nothing to a screen reader. */}
                <button
                  className={`onb-stacks__btn onb-stacks__btn--read${st === 'library' ? ' is-on' : ''}`}
                  onClick={() => pick(b, 'library')}
                  disabled={!!busy[b.bookId]}
                  aria-pressed={st === 'library'}
                  aria-label={`${t('stacks.actionRead')} — ${b.t}`}
                >
                  {t('stacks.shortRead')}
                </button>
                <button
                  className={`onb-stacks__btn onb-stacks__btn--want${st === 'wishlist' ? ' is-on' : ''}`}
                  onClick={() => pick(b, 'wishlist')}
                  disabled={!!busy[b.bookId]}
                  aria-pressed={st === 'wishlist'}
                  aria-label={`${t('stacks.actionWant')} — ${b.t}`}
                >
                  {t('stacks.shortWant')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {books.length === 0 && loading && (
        <div className="onb-stacks__empty">{t('stacks.loading')}</div>
      )}

      <div className="onb-stacks__more">
        <button className="btn-secondary btn--sm" onClick={loadMore} disabled={loading}>
          {loading ? t('stacks.loading') : t('stacks.showMore')}
        </button>
      </div>
    </div>
  );
}
