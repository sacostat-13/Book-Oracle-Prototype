import { useData } from '../lib/DataContext';
import { bookKey } from '../lib/bookHelpers';
import BookCover from './BookCover';

export default function BookCard({ book, reason, onClick }) {
  const { state, addToReadNext } = useData();
  const k = bookKey(book);
  const inLib = state.library.some((b) => bookKey(b) === k);
  const inNext = state.readNext.some((b) => bookKey(b) === k);
  const disabled = inLib || inNext;
  const label = inLib ? '✓ In Library' : inNext ? '✓ Claimed' : 'Read this one next';
  const btnClass = inLib ? 'in-library' : inNext ? 'picked' : '';

  return (
    <div className="card" onClick={onClick}>
      <div className="cover">
        <BookCover title={book.t} author={book.a} />
      </div>
      {book.g && <div className="card-tag">{book.g}</div>}
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
