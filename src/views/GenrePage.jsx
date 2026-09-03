// GenrePage.jsx — /genre/:genreSlug
//
// Catalogue-first, personal as a thin overlay. The prerendered half — name,
// description, family breadcrumb, cover wall, sibling genres — is identical for
// everyone and is the whole page for a crawler. Anything user-specific is
// deliberately absent: per-reader recommendations cannot be prerendered, are
// expensive per view, and duplicate what the Oracle already does better, so
// this page links to the Oracle instead of imitating it.
//
// The cover wall rotates DAILY, not per request — see dailyShuffle() in
// genreService.js for why that is the only shape that satisfies both a
// returning reader and a crawler.

import { useEffect, useState } from 'react';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { fetchGenre, fetchGenreShelf, fetchBooksByIds, GENRE_PAGE_SIZE, INDEX_FLOOR } from '../lib/genreService';
import { bookKey } from '../lib/bookHelpers';
import BookCover from '../components/BookCover';

export default function GenrePage() {
  const { route } = useRouter();
  const slug = route.params?.genreSlug;
  const [genre, setGenre] = useState(null);
  const [shelf, setShelf] = useState([]);      // every book id, shuffled for today
  const [books, setBooks] = useState([]);      // the rows loaded so far
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setBooks([]);
    setShelf([]);
    fetchGenre(slug).then(async (g) => {
      if (!alive) return;
      setGenre(g);
      setLoading(false);
      if (!g) return;
      const ids = await fetchGenreShelf(g.id, g.normalized_name);
      if (!alive) return;
      setShelf(ids);
      const first = await fetchBooksByIds(ids.slice(0, GENRE_PAGE_SIZE));
      if (alive) setBooks(first);
    });
    return () => { alive = false; };
  }, [slug]);

  // More, the way The Stacks does it. The id order was fixed when the shelf
  // loaded, so a later page can never repeat a book from an earlier one.
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const next = await fetchBooksByIds(shelf.slice(books.length, books.length + GENRE_PAGE_SIZE));
    setBooks((prev) => [...prev, ...next]);
    setLoadingMore(false);
  }

  const hasMore = books.length < shelf.length;

  useDocumentMeta(
    genre
      ? {
          title: `${genre.name} books — The Books Oracle`,
          description: genre.description || `Books shelved as ${genre.name}.`,
          // Below the floor the page is reachable and linked but not
          // advertised: a page with one book on it is exactly the thin page
          // Search Console fetched and declined in August.
          noindex: (genre.usage_count || 0) < INDEX_FLOOR,
        }
      : { title: 'Genre — The Books Oracle', noindex: true }
  );

  if (loading) return <div className="container"><div className="fp-empty">Consulting the shelf…</div></div>;
  if (!genre) {
    return (
      <div className="container">
        <div className="fp-empty">
          No such genre. <RouteLink to="genres-index">Browse the shelves</RouteLink>.
        </div>
      </div>
    );
  }

  return (
    <div className="container genre-page">
      <div className="page-head">
        <div className="page-head__eyebrow">
          <RouteLink to="genres-index">Browse</RouteLink>
          {genre.family && (
            <>
              {' · '}
              <RouteLink to="family-page" params={{ familySlug: genre.family.slug }}>
                {genre.family.name}
              </RouteLink>
            </>
          )}
        </div>
        <h1 className="page-head__title">{genre.name}</h1>
        {genre.description && <p className="page-head__sub">{genre.description}</p>}
      </div>

      {genre.siblings.length > 0 && genre.family && (
        <section className="lv-section">
          <h2 className="lv-section__head">Also on the {genre.family.name} shelf</h2>
          {/* .li-genre-pill is a LABEL style — no border, no affordance — so
              these read as decoration rather than as the twelve other shelves
              they open. Their own class, styled as a chip you can press. */}
          <div className="genre-siblings">
            {genre.siblings.map((s) => (
              <RouteLink
                key={s.normalized_name}
                to="genre-page"
                params={{ genreSlug: s.normalized_name }}
                className="genre-chip"
              >
                ☩ {s.name}
              </RouteLink>
            ))}
          </div>
        </section>
      )}
      {books.length > 0 && (
        <section className="lv-section">
          <h2 className="lv-section__head">On this shelf</h2>
          {/* Same shape as The Stacks — cover, title, author — because a reader
              who has scrolled that wall already knows how to read this one.
              Deliberately WITHOUT the stack card's flip, back face and shelf
              actions: this is a browse surface, and the only thing to do with a
              book here is open it.

              BookCover takes FLAT props (title / author / coverUrl), not a book
              object. Passing `book={{...}}` is why every tile first rendered as
              the ornament placeholder — every prop arrived undefined, so it
              fell through to its "no cover" branch and drew the fallback at the
              wrong aspect ratio. */}
          <div className="genre-book-grid">
            {books.map((b) => (
              <RouteLink
                key={b.id}
                to="book-page"
                /* Only the key. buildBookPageParams() also returns from,
                   fromLabel and a base64 `snap` of the book, and go() writes
                   every param it did not consume into the query string — so an
                   in-app click produced
                   /book/x?from=genre&fromLabel=...&snap=eyJib29rSWQi...
                   which is what a reader copies when they want to share a book.
                   A browse surface does not need the snapshot: BookPage resolves
                   the book from the key on its own, and the URL stays clean
                   enough to paste. */
                params={{ bookKey: bookKey({ t: b.title, a: b.author }) }}
                className="genre-book"
                title={`${b.title}${b.author ? ` — ${b.author}` : ''}`}
              >
                <div className="genre-book__cover">
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

          {hasMore && (
            <div className="genre-page__more">
              {/* Same control The Stacks uses for the same job — .btn-ghost
                  does not exist in the design system. */}
              <button type="button" className="btn-primary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Reading on…' : 'More books'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* The Oracle, not a recommendation block. .btn-accent is the wine fill
          the design system reserves for the Oracle's own voice — a .btn-primary
          here read as an ordinary page action. */}
      <section className="genre-page__oracle">
        {/* The genre name was in the button, which made it as wide as the longest
            genre name in the catalogue — "Japanese & East Asian Literary
            Fiction" ran off a phone screen. The context belongs in the label;
            the button says what it does. */}
        <p className="genre-page__oracle-label">
          Not sure where to start in {genre.name}?
        </p>
        <RouteLink to="oracle-categories" className="btn-accent">
          Ask the Oracle
        </RouteLink>
      </section>

    </div>
  );
}
