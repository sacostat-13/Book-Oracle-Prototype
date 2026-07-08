import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { bookKey } from '../lib/bookHelpers';
import BookCover from './BookCover';

export default function BookCard({ book, reason, onClick }) {
  const { state, addToReadNext } = useData();
  const t = useT();
  const k = bookKey(book);
  const inLib = state.library.some((b) => bookKey(b) === k);
  const inNext = state.readNext.some((b) => bookKey(b) === k);
  const disabled = inLib || inNext;
  const label = inLib ? t('bookPage.inLibrary') : inNext ? t('bookPage.inNext') : t('bookPage.addToNext');
  const btnClass = disabled ? 'btn-secondary' : 'btn-primary';

  // v0.15: show all Oracle genres as pills; fall back to b.g if not yet categorized.
  const oracleGenres = state.genresByBookId?.[book.bookId];
  const genreLabels = (oracleGenres && oracleGenres.length > 0)
    ? oracleGenres.map((g) => g.name)
    : (book.g ? [book.g] : []);
  const isVerified = book.status === 'verified' || book.status === 'oracle_categorized';

  return (
    <div className="book-card" onClick={onClick}>
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
          <div className="book-card__author">{book.a}</div>

          {/* Action up front — the whole point of a recommendation card is
              the one thing you can do with it. */}
          <div className="book-card__actions">
            <button
              className={btnClass}
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) addToReadNext(book);
              }}
            >
              {label}
            </button>
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
          {/* "The Oracle speaks" — the mysterious match blurb from the
              Recommendations pattern, in italic display type. */}
          {reason && (
            <p className="book-card__quote">— {reason}</p>
          )}
        </div>
      </div>
    </div>
  );
}
