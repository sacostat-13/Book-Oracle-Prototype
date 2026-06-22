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
  const btnClass = inLib ? 'in-library' : inNext ? 'picked' : '';

  // v0.15: show all Oracle genres as pills; fall back to b.g if not yet categorized.
  const oracleGenres = state.genresByBookId?.[book.bookId];
  const genreLabels = (oracleGenres && oracleGenres.length > 0)
    ? oracleGenres.map((g) => g.name)
    : (book.g ? [book.g] : []);

  return (
    <div className="card" onClick={onClick}>
      <div className="cover">
        <BookCover title={book.t} author={book.a} coverUrl={book.coverUrl} />
      </div>
      {genreLabels.length > 0 && (
        <div className="card-tags">
          {genreLabels.map((label) => (
            <span key={label} className="card-tag">{label}</span>
          ))}
        </div>
      )}
      {(book.status === 'verified' || book.status === 'oracle_categorized') && (
        <div
          className="card-verified"
          title="Curated · verified by our editors"
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'rgba(176, 140, 63, 0.9)',
            color: 'var(--ink)',
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.6rem',
            letterSpacing: '0.1em',
            padding: '0.2rem 0.4rem',
            borderRadius: '1px',
            textTransform: 'uppercase',
            zIndex: 2,
          }}
        >
          ☩ Verified
        </div>
      )}
      <div className="card-meta">
        {book.c && <span>prose {'●'.repeat(book.c)}{'○'.repeat(5 - book.c)}</span>}
        {book.p && <span>depth {'●'.repeat(book.p)}{'○'.repeat(5 - book.p)}</span>}
      </div>
      <div className="card-title">{book.t}</div>
      <div className="card-author">{book.a}</div>
      <div className="card-desc">
        {book.d || ''}
        {reason && (
          <>
            <br /><br />
            <em style={{ color: 'var(--gilt)', fontSize: '0.85rem' }}>— {reason}</em>
          </>
        )}
      </div>
      <button
        className={`pick-btn ${btnClass}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) addToReadNext(book);
        }}
      >
        {label}
      </button>
    </div>
  );
}
