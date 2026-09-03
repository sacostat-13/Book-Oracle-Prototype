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
import BookShelfGrid, { ShelfMore, ShelfOracle } from '../components/BookShelfGrid';

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
          // MUST MATCH og-prerender.js's genre branch exactly — see the note on
          // the same hook in FamilyPage.jsx. This string used to be the short
          // form while the prerender emitted the long one, so the phrase written
          // to catch "what to read in X" was overwritten the moment Google ran
          // the page's JavaScript.
          title: `${genre.name} books | The Books Oracle`,
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

      {books.length > 0 && (
        <section className="lv-section">
          <h2 className="lv-section__head">On this shelf</h2>
          <BookShelfGrid books={books} />
          <ShelfMore hasMore={hasMore} loading={loadingMore} onMore={loadMore} />
        </section>
      )}

      {/* v0.68 — BELOW the wall, not above it. This block sat between the
          description and the first cover, so on a phone the page opened with a
          paragraph and a raft of chips leading AWAY from the genre the reader
          had just chosen. Sibling links are a next step, not an entry: they
          belong after the thing the reader came for. Same reasoning as the
          family page — see the order note at the top of FamilyPage.jsx. */}
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
      <ShelfOracle subject={genre.name} />

    </div>
  );
}
