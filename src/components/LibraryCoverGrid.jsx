import BookCover from './BookCover';
import { RouteLink } from '../lib/RouterContext';

/**
 * LibraryCoverGrid
 * Renders the library as a visual cover grid, with each Oracle genre group
 * acting as a named shelf. Clicking a cover opens the BookModal via onOpenBook.
 */
// v0.67 — `labels` maps section key → heading text (the key is no longer the
// label: it is a family slug or a normalized genre name). `showHeads` is false
// when the shelf is filtered to a single genre, where a heading would only
// repeat the filter back at the reader.
export default function LibraryCoverGrid({ grouped, genreKeys, genresByBookId, onOpenBook, selectionMode = false, selected = new Set(), onToggle, labels = null, showHeads = true }) {
  if (genreKeys.length === 0) return null;

  return (
    <div className="cover-grid-shelves">
      {genreKeys.map((genre) => (
        <div className="lv-section" key={genre}>
          {showHeads && (
            <h2 className="lv-section__head">
              {labels ? labels[genre] : genre} <span className="count">· {grouped[genre].length}</span>
            </h2>
          )}
          <div className="cover-shelf-grid">
            {grouped[genre].map((b, i) => (
              <div
                className={`cover-grid-item${selectionMode && b.bookId && selected.has(b.bookId) ? ' cover-grid-item--selected' : ''}`}
                key={`${b.bookId || b.t}-${i}`}
                onClick={() => selectionMode ? onToggle?.(b.bookId) : onOpenBook?.(b)}
                title={`${b.t}${b.a ? ` · ${b.a}` : ''}${b.rating ? ` · ${'★'.repeat(b.rating)}` : ''}`}
              >
                {selectionMode && (
                  <div className="cover-grid-checkbox">
                    {b.bookId && selected.has(b.bookId) ? '✓' : ''}
                  </div>
                )}
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
                          g.normalizedName ? (
                            <RouteLink key={g.genreId} to="genre-page" params={{ genreSlug: g.normalizedName }} className="li-genre-pill">{g.name}</RouteLink>
                          ) : (
                            <span key={g.genreId} className="li-genre-pill">{g.name}</span>
                          )
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
