// src/components/BookThumb.jsx — a BookCover in a small fixed box.
//
// Used by the session pickers (SessionCreate, SessionDetail), which each had an
// identical local copy. Unlike CoverThumb this resolves a missing cover via
// BookCover: the picker is choosing a book, so seeing the right cover matters.
// Styles: .session-form__cover in pages/_clubs.scss.
import BookCover from './BookCover';

/**
 * @param {{ book: { t?: string, a?: string, title?: string, author?: string, coverUrl?: string, cover_url?: string }, size?: number }} props
 *        accepts both the client shape (t/a/coverUrl) and a raw row (title/author/cover_url)
 */
export default function BookThumb({ book, size = 28 }) {
  return (
    <div className="session-form__cover" style={{ '--sc-w': `${size}px`, '--sc-h': `${size * 1.5}px` }}>
      <BookCover title={book.t || book.title} author={book.a || book.author} coverUrl={book.coverUrl || book.cover_url} />
    </div>
  );
}
