// FamilyPage.jsx — /genres/:familySlug
//
// The missing middle. A reader picks Gothic, sees its seven genres, and
// chooses. Three jobs, one page: browse entry point, the Ledger's drill-down
// target, and the canonical thing a family share card points at.
//
// v0.68 — AND A SHELF OF BOOKS. It shipped with the genre list alone, which
// made it a menu rather than an answer: a reader arriving on "what to read in
// horror" got ten links and no book.
//
// ── THE ORDER OF THIS PAGE ────────────────────────────────────────────────
//
// First pass put the books at the bottom, under ten genre rows each carrying a
// full description — roughly 900px of prose before the first cover, which is
// two screens on a phone. The layout said "read about horror"; the page is for
// finding a horror novel.
//
// The fix is NOT to demote the genres. Both Baymard and NN/g find that
// sub-category navigation belongs above the listing on a page like this, and
// that the common damaging mistake is pushing that navigation down. What eats
// the fold here is not the LINKS, it is the DESCRIPTIONS attached to them — and
// Baymard's guidance on category intro copy is explicit: put it at the bottom,
// because Google indexes it wherever it sits, so the placement costs nothing in
// search and buys the whole fold back.
//
// So: chips (navigation, compact) → books (the answer) → the full annotated
// genre list (the prose, still crawlable, still linked). Three sections, in the
// order a reader needs them rather than the order the data arrived in.
//
// The chips FILTER rather than navigate, because the rows for every genre on
// the shelf are already loaded — going to /genre/folkhorror for a subset of
// books already in memory would be a network round trip to show less. The link
// to the real genre page is offered next to the active filter, and the bottom
// list carries all of them, so nothing is lost from the link graph.
//
// Public and prerendered — see the note in GenresIndex.jsx.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { fetchFamily, fetchFamilyShelf, fetchBooksByIds, GENRE_PAGE_SIZE } from '../lib/genreService';
import BookShelfGrid, { ShelfMore, ShelfOracle } from '../components/BookShelfGrid';

export default function FamilyPage() {
  const { route } = useRouter();
  const slug = route.params?.familySlug;
  const [family, setFamily] = useState(null);
  const [shelf, setShelf] = useState({ all: [], byGenre: {} });
  const [books, setBooks] = useState([]);      // the rows loaded so far
  const [active, setActive] = useState(null);  // genre id, or null for the whole shelf
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(false);
  const [chipsOverflow, setChipsOverflow] = useState(false);
  const chipsRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setBooks([]);
    setActive(null);
    setShelf({ all: [], byGenre: {} });
    fetchFamily(slug).then(async (f) => {
      if (!alive) return;
      setFamily(f);
      setLoading(false);
      if (!f) return;
      const s = await fetchFamilyShelf((f.genres || []).map((g) => g.id), f.slug);
      if (alive) setShelf(s);
    });
    return () => { alive = false; };
  }, [slug]);

  // The ids currently on the wall. Filtering the SHUFFLED list rather than
  // re-shuffling the subset keeps a book in the same relative place whether or
  // not a chip is pressed — pressing Folk Horror should hide books, not
  // rearrange the ones that stay.
  const visibleIds = useMemo(() => {
    if (!active) return shelf.all;
    const inGenre = shelf.byGenre[active];
    return inGenre ? shelf.all.filter((id) => inGenre.has(id)) : [];
  }, [shelf, active]);

  // One effect loads the first page, for the initial render and for every
  // filter change alike. Two code paths for "show the first page of something"
  // is how they drift.
  useEffect(() => {
    let alive = true;
    setBooks([]);
    if (!visibleIds.length) return;
    fetchBooksByIds(visibleIds.slice(0, GENRE_PAGE_SIZE)).then((rows) => {
      if (alive) setBooks(rows);
    });
    return () => { alive = false; };
  }, [visibleIds]);

  // Does the chip row need a toggle at all?
  //
  // MEASURED, not inferred from the number of genres. Fantasy's 21 chips take
  // three rows on a desktop and eleven on a 390px phone, so any threshold on
  // genre count is wrong at one of the two breakpoints — and being wrong the
  // permissive way means the biggest families push the covers off the fold
  // again, which is the thing this layout exists to prevent.
  //
  // useLayoutEffect, not useEffect: this runs before paint, so the toggle does
  // not appear a frame after the chips and shift the wall down under the
  // reader's eye.
  useLayoutEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    // Measure against the CLAMPED height, so the answer does not flip to false
    // the moment the row is expanded (scrollHeight === clientHeight once open).
    const measure = () => {
      const wasOpen = el.classList.contains('is-collapsed');
      if (!wasOpen) el.classList.add('is-collapsed');
      setChipsOverflow(el.scrollHeight > el.clientHeight + 1);
      if (!wasOpen) el.classList.remove('is-collapsed');
    };
    measure();
    // A chip row that fits in portrait can overflow in landscape, and the whole
    // point of measuring is that the answer is viewport-dependent.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    else window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [family]);

  // The id order was fixed when the shelf loaded, so a later page can never
  // repeat a book from an earlier one.
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const next = await fetchBooksByIds(visibleIds.slice(books.length, books.length + GENRE_PAGE_SIZE));
    setBooks((prev) => [...prev, ...next]);
    setLoadingMore(false);
  }

  // MUST MATCH og-prerender.js's family branch exactly. The prerendered head is
  // what a bot fetches; this hook then overwrites it when the JS runs, and
  // Google does run the JS. Two different titles for one URL means the one you
  // wrote for the query is not necessarily the one that gets indexed — so the
  // string lives in two files and has to be changed in both.
  useDocumentMeta(
    family
      ? {
          // The FAMILY owns the intent phrase, the genre page owns the plain
          // noun — see the collision note in og-prerender.js. "Horror & the
          // Uncanny books" was the first draft and reads badly across all
          // sixteen ("The Literary Shelf books"); dropping the word keeps the
          // head term and stays under the ~60 characters Google shows.
          title: `${family.name} — what to read | The Books Oracle`,
          description: family.description
            ? `${family.description} Every genre on the ${family.name} shelf.`.slice(0, 200)
            : `Every genre on the ${family.name} shelf.`,
        }
      : { title: 'Browse by Genre — The Books Oracle' }
  );

  if (loading) return <div className="container"><div className="fp-empty">Reading the shelf…</div></div>;
  if (!family) {
    return (
      <div className="container">
        <div className="fp-empty">
          No such shelf. <RouteLink to="genres-index">See all sixteen</RouteLink>.
        </div>
      </div>
    );
  }

  const hasMore = books.length < visibleIds.length;
  const activeGenre = active ? family.genres.find((g) => g.id === active) : null;
  const shelfLoading = !shelf.all.length;

  return (
    <div className="container family-page">
      <div className="page-head">
        <div className="page-head__eyebrow">
          <RouteLink to="genres-index">Browse</RouteLink>
        </div>
        <h1 className="page-head__title">{family.name}</h1>
        {/* Clamped, not cut. The full description is the first thing in the
            annotated list at the foot of the page, so nothing is hidden — this
            copy just stops being the reason the covers start a screen down. */}
        {family.description && (
          <p className="page-head__sub page-head__sub--clamp">{family.description}</p>
        )}
      </div>

      {/* Sub-category navigation, above the listing where it belongs — but as a
          chip row, which is the compact form of the same thing. Wraps, clamped
          to two rows; see the shape comparison in _book-pages.scss. */}
      <div
        ref={chipsRef}
        id="shelf-filter"
        className={`shelf-filter${chipsOverflow && !chipsOpen ? ' is-collapsed' : ''}`}
        role="group"
        aria-label={`Filter ${family.name} by genre`}
      >
        <button
          type="button"
          className={`genre-chip${active === null ? ' is-active' : ''}`}
          aria-pressed={active === null}
          onClick={() => setActive(null)}
        >
          Everything
        </button>
        {family.genres.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`genre-chip${active === g.id ? ' is-active' : ''}`}
            aria-pressed={active === g.id}
            onClick={() => setActive(active === g.id ? null : g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>

      {chipsOverflow && (
        <button
          type="button"
          className="shelf-filter__toggle"
          aria-expanded={chipsOpen}
          aria-controls="shelf-filter"
          onClick={() => setChipsOpen((v) => !v)}
        >
          {chipsOpen ? 'Show fewer genres' : `Show all ${family.genres.length} genres`}
        </button>
      )}

      <section className="lv-section shelf-wall">
        <div className="shelf-wall__head">
          <h2 className="lv-section__head">
            {activeGenre ? activeGenre.name : `Books across every ${family.name} genre`}
          </h2>
          {/* The filtered view is a subset of this page; the genre's own page is
              a different, fuller thing (its own description, its sibling links,
              its whole shelf rather than this family's slice). Offering the way
              through is what keeps the chips from being a dead end. */}
          {activeGenre && (
            <RouteLink
              to="genre-page"
              params={{ genreSlug: activeGenre.normalized_name }}
              className="shelf-wall__through"
            >
              Open the {activeGenre.name} page →
            </RouteLink>
          )}
        </div>

        {activeGenre?.description && (
          <p className="shelf-wall__note">{activeGenre.description}</p>
        )}

        {books.length > 0 && <BookShelfGrid books={books} />}
        {books.length === 0 && shelfLoading && (
          <div className="fp-empty">Pulling books off the shelf…</div>
        )}
        {/* Distinct from the loading line above on purpose: "nothing here" and
            "not here yet" are different answers, and showing the first for the
            second is how a slow page gets read as an empty one. */}
        {books.length === 0 && !shelfLoading && (
          <div className="fp-empty">No books on this one yet.</div>
        )}

        <ShelfMore hasMore={hasMore} loading={loadingMore} onMore={loadMore} />
      </section>

      <ShelfOracle subject={activeGenre ? activeGenre.name : family.name} />

      {/* The prose, at the foot. Every genre with its full description and a
          real link to its page — the internal link graph and the indexable copy
          both live here, out of the fold's way. */}
      <section className="lv-section">
        <h2 className="lv-section__head">Every genre on this shelf</h2>
        {family.description && <p className="shelf-wall__note">{family.description}</p>}
        <div className="genre-list">
          {family.genres.map((g) => (
            <RouteLink
              key={g.normalized_name}
              to="genre-page"
              params={{ genreSlug: g.normalized_name }}
              className="genre-list__row"
            >
              <span className="genre-list__name">☩ {g.name}</span>
              {g.description && <span className="genre-list__desc">{g.description}</span>}
            </RouteLink>
          ))}
        </div>
      </section>
    </div>
  );
}
