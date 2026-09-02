import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { RouteLink } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { bookKey } from '../lib/bookHelpers';
import { displayAuthor } from '../lib/bookHelpers';
import { resolveGenreNames } from '../lib/genreDisplay';
import BookCover from './BookCover';
import RatingModal from './RatingModal';

// The Oracle's recommendation card.
//
// v0.63.3 — the whole card used to be one big click target that opened the book
// page. Two problems with that. It was undiscoverable, because nothing said so;
// and it was hostile, because the card also holds buttons, so every near-miss
// on "Read next" navigated away from the results the reader had just spent an
// Oracle call on. A card with buttons on it should not itself be a button.
//
// The card is now inert and every action is explicit. "See more" is the
// navigation, stated rather than implied.
export default function BookCard({ book, reason, onClick }) {
  const { state, loading, addToReadNext, addToWishlist, markAsRead } = useData();
  const t = useT();
  const [rating, setRating] = useState(false);
  const [busy, setBusy] = useState(false);

  const k = bookKey(book);
  const inLib = state.library.some((b) => bookKey(b) === k);
  const inNext = state.readNext.some((b) => bookKey(b) === k);
  const inWish = state.wishlist.some((b) => bookKey(b) === k);

  // v0.15: show all Oracle genres as pills; fall back to b.g if not yet categorized.
  // v0.63: routed through resolveGenres so a card in a grid does not render the
  // legacy single genre for a beat before the real set arrives. Cards are dense
  // enough that a skeleton is noisier than a brief blank, so `pending` renders
  // nothing here rather than placeholders.
  const { names: genreLabels } = resolveGenreNames(state, loading, book);
  const isVerified = book.status === 'verified' || book.status === 'oracle_categorized';

  // Once a book is in the library the shelf questions are all answered — it is
  // read, so it cannot be queued and does not belong on a wishlist. Collapsing
  // to a single state label is more honest than three separately-disabled
  // buttons saying the same thing three ways.
  const settled = inLib;

  async function handleRead({ rating: stars, notes, readAt } = {}) {
    setBusy(true);
    try {
      await markAsRead(book, { rating: stars, notes, readAt });
    } finally {
      setBusy(false);
      setRating(false);
    }
  }

  return (
    <div className="book-card">
      <div className="book-card__row">
        <div className="book-card__cover">
          <BookCover title={book.t} author={book.a} coverUrl={book.coverUrl} />
        </div>
        <div className="book-card__body">
          <div className="book-card__head">
            <h3 className="book-card__title">{book.t}</h3>
            <div className="book-card__badges">
              {typeof book.match === 'number' && (
                <span className="match-badge">{book.match}% {t('bookPage.match')}</span>
              )}
              {isVerified && (
                <span className="bp-pill bp-pill--ro-gold" title="Curated · verified by our editors">
                  ☩ {t('bookPage.verified')}
                </span>
              )}
            </div>
          </div>
          <div className="book-card__author">{displayAuthor(book)}</div>

          {/* Actions up front — the whole point of a recommendation card is
              what you can do with it. Order is by how often it is the answer:
              queue it, want it later, already read it, tell me more. */}
          <div className="book-card__actions">
            {settled ? (
              <span className="book-card__state">{t('bookPage.inLibrary')}</span>
            ) : (
              <>
                <button
                  className={inNext ? 'btn-secondary' : 'btn-primary'}
                  disabled={inNext || busy}
                  onClick={() => addToReadNext(book)}
                >
                  {inNext ? t('bookPage.inNext') : t('bookPage.addToNext')}
                </button>
                <button
                  className="btn-secondary"
                  disabled={inWish || busy}
                  onClick={() => addToWishlist(book)}
                >
                  {inWish ? t('bookPage.inWishlist') : t('bookPage.addToWishlist')}
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setRating(true)}
                >
                  {t('bookPage.alreadyRead')}
                </button>
              </>
            )}
            {onClick && (
              // A real anchor, so cmd/middle-click opens the book in a new tab
              // instead of doing nothing. onClick still drives the in-app
              // navigation the parent view wants (breadcrumb + snapshot).
              <RouteLink
                className="btn-tertiary book-card__more"
                to="book-page"
                params={{ bookKey: k }}
                onClick={(e) => {
                  // Let cmd/ctrl/shift/alt/middle clicks through to the href.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onClick(e);
                }}
              >
                {t('bookPage.seeMore')}
              </RouteLink>
            )}
          </div>

          {genreLabels.length > 0 && (
            <div className="bp-meta">
              {genreLabels.map((label) => (
                <span key={label} className="chip">{label}</span>
              ))}
            </div>
          )}
          <div className="bp-meta">
            {book.c && <span className="bp-pill">prose {'●'.repeat(book.c)}{'○'.repeat(5 - book.c)}</span>}
            {book.p && <span className="bp-pill">depth {'●'.repeat(book.p)}{'○'.repeat(5 - book.p)}</span>}
          </div>
          {book.d && <p className="bp-description">{book.d}</p>}
          {/* "The Oracle speaks" — the personalised why, in italic display type. */}
          {reason && (
            <p className="book-card__quote">— {reason}</p>
          )}
        </div>
      </div>

      {/* v0.63.3. Marking a recommendation read goes through the same rating
          flow as finishing a book anywhere else, rather than filing it
          unrated. A book that lands in the library with no stars tells
          buildTasteProfile nothing — and a reader saying "I have read this"
          about an Oracle pick is the single most useful moment to ask, because
          it is the moment we find out whether the Oracle was right. Skipping
          still files the book; the stars are optional, as everywhere. */}
      {rating && (
        <RatingModal
          book={book}
          mode="create"
          onSave={handleRead}
          onSkip={() => { handleRead(); }}
        />
      )}
    </div>
  );
}
