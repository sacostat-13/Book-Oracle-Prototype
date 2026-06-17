import BookCover from './BookCover';

/**
 * LibraryCoverGrid
 * Renders the library as a visual cover grid, with each Oracle genre group
 * acting as a named shelf. Clicking a cover opens the BookModal via onOpenBook.
 */
export default function LibraryCoverGrid({ grouped, genreKeys, genresByBookId, onOpenBook }) {
  if (genreKeys.length === 0) return null;

  return (
    <div className="cover-grid-shelves">
      {genreKeys.map((genre) => (
        <div className="cover-shelf" key={genre}>
          <h2 className="cover-shelf-label">
            {genre} <span className="count">· {grouped[genre].length}</span>
          </h2>
          <div className="cover-shelf-grid">
            {grouped[genre].map((b, i) => (
              <div
                className="cover-grid-item"
                key={`${b.bookId || b.t}-${i}`}
                onClick={() => onOpenBook?.(b)}
                title={`${b.t}${b.a ? ` · ${b.a}` : ''}${b.rating ? ` · ${'★'.repeat(b.rating)}` : ''}`}
              >
                <div className="cover-grid-img">
                  <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                </div>
                {b.rating && (
                  <div className="cover-grid-rating">{'★'.repeat(b.rating)}</div>
                )}
                <div className="cover-grid-hover">
                  <div className="cover-grid-hover-title">{b.t}</div>
                  <div className="cover-grid-hover-author">{b.a}</div>
                  {(() => {
                    const genres = genresByBookId[b.bookId];
                    return genres && genres.length > 0 ? (
                      <div className="cover-grid-hover-genres">
                        {genres.map((g) => (
                          <span key={g.genreId} className="li-genre-pill">{g.name}</span>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
