// BookShelfGrid.jsx — the cover wall shared by /genre/:slug and /genres/:family.
//
// Extracted at the point of the SECOND caller, deliberately. The genre page's
// grid was written first and the family page needs the same one; a hand-rolled
// copy is the moment two identical things start drifting, which is how this
// codebase ended up with three implementations of bookKey() and a truncation
// length that disagreed with itself in production.
//
// Same shape as The Stacks — cover, title, author — because a reader who has
// scrolled that wall already knows how to read this one. Deliberately WITHOUT
// the stack card's flip, back face and shelf actions: this is a browse surface,
// and the only thing to do with a book here is open it.

import { RouteLink } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';
import BookCover from './BookCover';

export default function BookShelfGrid({ books }) {
  if (!books || !books.length) return null;

  return (
    <div className="genre-book-grid">
      {books.map((b) => (
        <RouteLink
          key={b.id}
          to="book-page"
          /* Only the key. buildBookPageParams() also returns from, fromLabel and
             a base64 `snap` of the book, and go() writes every param it did not
             consume into the query string — so an in-app click produced
             /book/x?from=genre&fromLabel=...&snap=eyJib29rSWQi... which is what
             a reader copies when they want to share a book. A browse surface
             does not need the snapshot: BookPage resolves the book from the key
             on its own, and the URL stays clean enough to paste. */
          params={{ bookKey: bookKey({ t: b.title, a: b.author }) }}
          className="genre-book"
          title={`${b.title}${b.author ? ` — ${b.author}` : ''}`}
        >
          <div className="genre-book__cover">
            {/* BookCover takes FLAT props (title / author / coverUrl), not a
                book object. Passing `book={{...}}` is why every tile first
                rendered as the ornament placeholder — every prop arrived
                undefined, so it fell through to its "no cover" branch and drew
                the fallback at the wrong aspect ratio. */}
            <BookCover
              title={b.title}
              author={b.author}
              coverUrl={b.cover_url}
              className="genre-book__img"
            />
          </div>
          <div className="genre-book__meta">
            <div className="genre-book__title">{b.title}</div>
            {b.author && <div className="genre-book__author">{b.author}</div>}
          </div>
        </RouteLink>
      ))}
    </div>
  );
}

/** The "More books" control. Same button The Stacks uses — .btn-ghost does not
 *  exist in the design system. */
export function ShelfMore({ hasMore, loading, onMore }) {
  if (!hasMore) return null;
  return (
    <div className="genre-page__more">
      <button type="button" className="btn-primary" onClick={onMore} disabled={loading}>
        {loading ? 'Reading on…' : 'More books'}
      </button>
    </div>
  );
}

/** The Oracle hand-off, not a recommendation block. .btn-accent is the wine
 *  fill the design system reserves for the Oracle's own voice — a .btn-primary
 *  here read as an ordinary page action.
 *
 *  The subject name lives in the LABEL, never in the button: it was in the
 *  button once and made it as wide as the longest name in the catalogue —
 *  "Japanese & East Asian Literary Fiction" ran off a phone screen. */
export function ShelfOracle({ subject }) {
  return (
    <section className="genre-page__oracle">
      <p className="genre-page__oracle-label">Not sure where to start in {subject}?</p>
      <RouteLink to="oracle-categories" className="btn-accent">
        Ask the Oracle
      </RouteLink>
    </section>
  );
}
