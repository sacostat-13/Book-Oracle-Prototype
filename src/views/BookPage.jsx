// BookPage.jsx — v0.19
// Full book detail page. Reached from BookModal's "See more" link.
// Shares data-fetching logic with BookModal but renders as a full page
// with more room for description, series, and genre detail.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../lib/DataContext';
import { resolveGenres } from '../lib/genreDisplay';
import { supabase } from '../lib/supabase';
import { lookUpByShareKey } from '../lib/shareKey';
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useT, useI18n } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { bookKey, findBookByTitle, openBookTab, buildBookPageParams, displayAuthor } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import { hardcoverGetBook } from '../lib/hardcoverService';
import { fetchCoverURL } from '../lib/coverService';
import { lookupByTitle } from '../lib/bookLookup';
import { purchaseLinks } from '../lib/purchaseLinks';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import { fetchAuthorWorks, AUTHOR_WORKS_LIMIT } from '../lib/authorWorks';
import { collapseWorks } from '../lib/workGroups';
import { effectivePages, editionTitle, editionIsNotable } from '../lib/editions';
import BookCover from '../components/BookCover';
import { BookPageSkeleton } from '../components/Skeleton';
import ReportBookForm from '../components/ReportBookForm';
import AddToListPicker from '../components/AddToListPicker';
import RatingModal from '../components/RatingModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import CategoryAutocomplete from '../components/CategoryAutocomplete';
import CoachMark from '../components/CoachMark';
import ShareModal from '../components/ShareModal';
import { bookShareUrl } from '../lib/shareService';


// ─── Similar books ────────────────────────────────────────────────────────────

// `exclude` is a Set of bookKeys that must never be offered — in practice the
// reader's finished books.
//
// The pool used to be wishlist + library + readNext, and `library` IS the read
// shelf, so a reader with a large library got a "You might also like" made
// almost entirely of books they had already read. The section reads as a
// discovery surface; recommending a finished book is not a weak recommendation,
// it is the wrong kind of answer, and it makes the Oracle look like it has not
// been paying attention.
//
// Filtered rather than removed from the pool at the call site so the reason
// travels with the code, and so read books stay available to any future scoring
// signal that wants them as evidence without becoming candidates themselves.
function computeSimilar(display, genresByBookId, pool, limit = 12, exclude) {
  // Build genre ID set for the current book
  const thisGenreIds = new Set(
    (genresByBookId?.[display.bookId] || []).map(g => g.genreId)
  );
  // Fallback to legacy single genre field if no Oracle genres
  const thisGenreLegacy = display.g || '';

  const thisKey = bookKey(display);

  const scored = pool
    .filter(b => bookKey(b) !== thisKey)
    .filter(b => !exclude || !exclude.has(bookKey(b)))
    .map(b => {
      let score = 0;

      // Oracle genre overlap — most powerful signal
      const bGenreIds = (genresByBookId?.[b.bookId] || []).map(g => g.genreId);
      const overlap = bGenreIds.filter(id => thisGenreIds.has(id)).length;
      score += overlap * 4;

      // Legacy single genre fallback
      if (!thisGenreIds.size && b.g && b.g === thisGenreLegacy) score += 3;

      // Same author — strong signal
      if (display.a && b.a && b.a === display.a) score += 3;

      // Similar complexity (±1 step)
      if (display.c && b.c && Math.abs(b.c - display.c) <= 1) score += 1;

      // Similar length (within 30%)
      if (display.pp && b.pp) {
        const ratio = display.pp > 0 ? Math.abs(b.pp - display.pp) / display.pp : 1;
        if (ratio < 0.3) score += 1;
      }

      return { book: b, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.book);
}

// One cover + title + author, clickable through to its own page.
//
// Extracted from SimilarBooks in v0.64 because "More by this author" is the
// same object rendered the same way, and two copies of this markup would drift
// the first time either grid changed. The class names keep the bp-similar-*
// prefix they were born with: renaming them would mean touching a 56kB
// stylesheet to express nothing the reader can see. They are a LAYOUT — a
// small cover over two lines of text — not a claim about similarity.
//
// `showAuthor` is off in the author section, where repeating the same name
// under all twelve covers is noise, and on everywhere else, where it is the
// main thing distinguishing one suggestion from another.
function BookStripItem({ book, showAuthor = true }) {
  return (
    <div
      className="bp-similar-item"
      onClick={() => openBookTab(book, 'book-page')}
      title={`${book.t}${book.a ? ' · ' + book.a : ''}`}
    >
      {book.coverUrl ? (
        <img
          src={book.coverUrl}
          alt={book.t}
          className="bp-similar-cover"
          loading="lazy"
        />
      ) : (
        <div className="bp-similar-cover bp-similar-cover--placeholder">
          <span className="bp-similar-cover__title">{book.t?.slice(0, 22)}</span>
        </div>
      )}
      <div>
        <div className="bp-similar-title">{book.t?.length > 34 ? book.t.slice(0, 33) + '…' : book.t}</div>
        {showAuthor && <div className="bp-similar-author">{displayAuthor(book)}</div>}
      </div>
    </div>
  );
}

function SimilarBooks({ similar }) {
  const t = useT();

  if (!similar.length) return null;

  return (
    <div className="bp-section">
      <div className="bp-section__label">
        {t('bookPage.youMightAlsoLike')}
      </div>
      <div className="bp-similar-grid">
        {similar.map((b, i) => (
          <BookStripItem key={bookKey(b) + i} book={b} />
        ))}
      </div>
    </div>
  );
}

// ─── More by this author ──────────────────────────────────────────────────────

// The hop from one book to the next by the same writer, which is otherwise a
// trip to Goodreads and back. Deliberately a section and not an author page:
// an author page is a bio, a photo, a canonical bibliography and the problem of
// two writers sharing a name, and Goodreads maintains one already. What is
// missing here is only the jump.
//
// Renders NOTHING while loading and nothing when empty, rather than a heading
// over a skeleton. This section sits below the fold on a page that is already
// fully useful without it, so a placeholder buys the reader no information and
// costs a layout shift — and for an author we hold one book by, the honest
// outcome is that the section never appears at all.
function AuthorWorks({ books, author }) {
  const t = useT();

  if (!books?.length || !author) return null;

  return (
    <div className="bp-section">
      <div className="bp-section__label">
        {t('bookPage.moreByAuthor', { author })}
      </div>
      <div className="bp-similar-grid">
        {books.map((b, i) => (
          <BookStripItem key={bookKey(b) + i} book={b} showAuthor={false} />
        ))}
      </div>
    </div>
  );
}

// ─── Category pill ────────────────────────────────────────────────────────────
// Previously this had a duplicate `className` prop (invalid JSX — only the
// second, "bp-cat", was ever applied, silently dropping "level-pill", which
// doesn't exist in the design system anyway) plus inline styles referencing
// --gilt/--paper-aged, tokens that no longer exist in _themes.scss (the theme
// was renamed to the --ro- namespace). Verified vs. unverified is now a real
// modifier class instead of inline styles.
function CategoryPill({ category, removing, canRemove, onRemove }) {
  const { name, verified } = category;
  const showRemove = canRemove && !verified;
  return (
    <span
      className={`bp-cat${verified ? '' : ' bp-cat--unverified'}${removing ? ' bp-cat--removing' : ''}`}
      title={verified ? 'Verified by our editors' : 'Your private category'}
    >
      {verified && <span>☩</span>}
      <span>{name}</span>
      {showRemove && (
        <button onClick={onRemove} className="bp-cat__remove">×</button>
      )}
    </span>
  );
}

export default function BookPage({ previewBookRef, isAuthed = true, authPending = false, dataReady = true }) {
  const {
    state,
    addToWishlist,
    addToReadNext,
    markAsRead,
    showShareMoment,
    removeFromLibrary,
    cacheBookFields,
    upsertDiscoveredBook,
    updateReadBook,
    getCategoriesForBook,
    removeCategoryFromBook,
    finishReading,
    updateReadingProgress,
    removeFromCurrentlyReading,
    startReading,
    memoriesForBook,
    deleteReadingMemory,
    dismissCoachmark,
    loading,
  } = useData();
  const { route, go } = useRouter();
  const t = useT();
  const { lang } = useI18n();

  // The book is passed via App-level state (route.params.bookKey) and resolved
  // from wishlist + library + readNext. This avoids encoding large objects in URLs.
  const bookKey_ = route.params?.bookKey;
  const from = route.params?.from || 'dashboard';
  const fromLabel = route.params?.fromLabel || 'Dashboard';

  const [book, setBook] = useState(null);
  // v0.63.2b: genre links for a book that is on NO shelf. See the effect below.
  const [pageGenres, setPageGenres] = useState(null);
  const [pageGenresLoading, setPageGenresLoading] = useState(false);

  // v0.39: SEO/share title+description once the book resolves. Deliberately
  // NOT set in App.jsx's generic route-title effect (see App.jsx) — this is
  // the only place this page's title/description gets set.
  useDocumentMeta({
    title: book ? `${book.t} by ${displayAuthor(book)} — The Books Oracle` : 'Book — The Books Oracle',
    description: book?.d ? book.d.slice(0, 200) : undefined,
    image: book?.coverUrl || undefined,
  });

  const [enrichment, setEnrichment] = useState(null);
  const [enrichedOverlay, setEnrichedOverlay] = useState({});
  const [seriesBooks, setSeriesBooks] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState(null);
  // v0.64 — "More by this author".
  //
  // No loading flag on purpose. The section renders nothing until it has
  // something to show (see the AuthorWorks component), so a pending state has
  // nothing to drive: an empty array covers "still looking", "nothing found"
  // and "the lookup failed" identically, and all three render the same absence.
  const [authorWorks, setAuthorWorks] = useState([]);
  const [notFound, setNotFound] = useState(false);
  // v0.63.3: a shared link's database lookup is in flight. Distinct from
  // notFound — showing "not found" while still looking is how the previous
  // version behaved, and it was wrong.
  const [lookingUp, setLookingUp] = useState(false);
  const [ratingEditorOpen, setRatingEditorOpen] = useState(false);
  const [pendingMoment, setPendingMoment] = useState(null); // share moment queued behind the rating step
  const [finishing, setFinishing] = useState(false);
  const [updatingProgress, setUpdatingProgress] = useState(false);
  const [adderOpen, setAdderOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState(null);
  const [shareOpen, setShareOpen] = useState(false); // v0.43

  // Read snapshot from URL immediately — renders before DataContext loads.
  //
  // v0.63.3c — useMemo, AND IT IS LOad-BEARING. This was a plain IIFE, so it
  // produced a NEW OBJECT on every render, and it sits in the dependency array
  // of the resolution effect below. That effect therefore re-ran on every
  // render. Harmless while the effect only ever called `setBook(previewBook)`
  // with a stable reference — React bails out of a state update that is Object.is
  // equal, so the loop closed itself.
  //
  // v0.63.3b broke that. The preview branch began writing a NEWLY BUILT object
  // (`setBook(prev => ({ ...prev, bookId, g }))`), so every run changed state,
  // every state change re-rendered, every render rebuilt this object, and the
  // effect ran again — calling upsert_book and book_genres_view each time. An
  // unbounded write loop against production, from a one-line change to a
  // dependency that had been unstable for a year without anyone noticing.
  //
  // Keyed on the raw param string, which is a primitive and actually stable.
  const snapParam = route.params?.snap;
  const snapshotBook = useMemo(() => {
    try {
      if (!snapParam) return null;
      return JSON.parse(decodeURIComponent(atob(snapParam)));
    } catch (_) { return null; }
  }, [snapParam]);

  // Resolve book: preview (from search) or collection lookup
  useEffect(() => {
    const isPreview = route.params?.preview === 'true';
    const previewBook = previewBookRef?.current;

    // v0.62.2: the ref must be checked against the URL, not just for presence.
    //
    // previewBookRef is a single slot on App that holds the LAST book chosen
    // from search, and nothing ever clears it. `preview === 'true'` therefore
    // said "render whatever was searched most recently" rather than "render
    // this book" — so any preview URL rendered the wrong book as soon as a
    // second search had happened.
    //
    // Latent until v0.62.2. Before then, preview navigations passed no bookKey,
    // buildPath() returned null and no history entry was ever written, so there
    // was no way to arrive at a preview URL except by making it. Giving those
    // URLs real addresses made them reachable by Back, Forward and paste — and
    // the symptom was precise: the address bar changed to book A and the page
    // went on showing book B until a refresh threw the ref away.
    //
    // bookKey_ is optional in the test so an older in-session preview URL with
    // no key still resolves from the ref rather than falling through to 404.
    const previewIsThisBook =
      !!previewBook && (!bookKey_ || bookKey(previewBook) === bookKey_);

    if (isPreview && previewIsThisBook) {
      // Paint immediately from the search result — it has the title, author and
      // cover, and waiting on a round trip to show those would be a regression.
      //
      // `previewBook` is a stable ref object, so a repeat call here is a no-op:
      // React bails out of a state update that is Object.is equal. That is what
      // kept this effect harmless for a year despite its unstable dependencies,
      // and it is why enriching the book MUST NOT happen here — see the
      // dedicated effect below.
      setBook(previewBook);
      return;
    }
    // Falls through on a stale ref: the collection lookup below, then the URL
    // snapshot. Both key off bookKey_, which preview URLs now always carry.
    if (!bookKey_) { setNotFound(true); return; }
    const sources = [...state.wishlist, ...state.library, ...state.readNext];
    const found = sources.find((b) => bookKey(b) === bookKey_);
    if (found) {
      setBook(found);
      // If the current URL has no snap, silently patch it in so the browser
      // back button can restore this book even if the collection isn't loaded
      // yet when the user navigates back (race between popstate and DataContext).
      if (!route.params?.snap) {
        const params = buildBookPageParams(found, route.params?.from || 'app', route.params?.fromLabel || '');
        const qs = Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&');
        // v0.39: patch the real path in place (was a hash rewrite pre-path-routing).
        const next = '/book/' + encodeURIComponent(bookKey_) + '?' + qs;
        if (window.location.pathname + window.location.search !== next) {
          history.replaceState(null, '', next);
        }
      }
    } else if (snapshotBook) {
      // Collection not loaded yet or book not in collection — use snapshot.
      // Once collection loads this effect re-runs and upgrades to the full record.
      setBook(snapshotBook);
    } else {
      // v0.63.3 — SHARED LINKS.
      //
      // Previously this was `setNotFound(true)`, and that was the whole of the
      // bug: resolution consulted the reader's own shelves and the `?snap=`
      // snapshot the app embeds in URLs it builds itself, and nothing else. A
      // shared link is bare and its recipient does not own the book, so both
      // missed and every shared link 404'd for exactly the audience it was
      // shared with. It was invisible to whoever shared it, because their copy
      // always resolves from their shelf.
      //
      // The share card rendered the whole time — og-prerender.js finds the book
      // server-side — which made the page look broken rather than the link.
      //
      // The database is the third place to look, and now the SPA looks there.
      setLookingUp(true);
      lookUpByShareKey(bookKey_).then((row) => {
        setLookingUp(false);
        if (row) setBook(row); else setNotFound(true);
      });
    }
    // `upsertDiscoveredBook` is intentionally absent. It comes from
    // DataContext and is rebuilt on every provider render, so listing it here
    // would re-run this resolution effect continuously — and the effect writes
    // a discovered book back to the catalog, so the loop would be a write loop,
    // not just a wasted render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey_, route.params, previewBookRef, state.wishlist, state.library, state.readNext, snapshotBook]);

  // v0.63.3d — ENRICHING A SEARCH RESULT, IN ITS OWN EFFECT.
  //
  // Three attempts at this, and the shape is the lesson.
  //
  //   b) put the upsert + lookup inside the resolution effect. That effect has
  //      object-identity-unstable dependencies, so it re-ran constantly; writing
  //      newly-built state from inside it turned that into an unbounded write
  //      loop against production.
  //   c) guard it with a once-per-book ref. That stopped the loop and broke the
  //      feature: the effect still re-ran, React ran the previous run's CLEANUP
  //      first (`cancelled = true`, discarding the in-flight lookup), and the
  //      guard then refused to start another. The request went out, its result
  //      was thrown away, and nothing retried. No error, no genres — which is
  //      exactly what "nothing is loading and no console errors" looks like.
  //
  // The actual fix is not a guard, it is a dependency. This effect depends on
  // ONE PRIMITIVE: the key of a book that still needs enriching, or null. It is
  // stable across unrelated re-renders, so nothing cancels it mid-flight; and it
  // becomes null the moment `bookId` lands, so it cannot re-fire. The loop is
  // closed by the data flow rather than by a flag defending against it.
  const needsEnrichKey = (
    route.params?.preview === 'true' && book && !book.bookId && book.t
  ) ? bookKey(book) : null;

  useEffect(() => {
    if (!needsEnrichKey) return;

    let cancelled = false;
    (async () => {
      // Best-effort: creates the catalogue row if this book is new. Guests skip
      // it entirely, and the lookup below still finds anything already there.
      try {
        await upsertDiscoveredBook?.(previewBookRef?.current || book);
      } catch (_) { /* the lookup is the part that matters */ }
      if (cancelled) return;

      const row = await lookUpByShareKey(needsEnrichKey);
      if (cancelled || !row) return;

      // The catalogue wins for the two fields only it can know — bookId, and
      // `g`, which is OUR taxonomy and which Hardcover has never heard of. The
      // search result keeps everything else: it is usually richer on covers and
      // descriptions than a sparsely-populated `books` row.
      setBook((prev) => (prev ? {
        ...prev,
        bookId: row.bookId,
        g: row.g ?? prev.g,
        c: prev.c ?? row.c,
        p: prev.p ?? row.p,
        pp: prev.pp ?? row.pp,
        d: prev.d ?? row.d,
        isbn: prev.isbn ?? row.isbn,
        status: row.status ?? prev.status,
      } : prev));
    })();

    return () => { cancelled = true; };
    // `book` and `upsertDiscoveredBook` are deliberately absent. `book` changes
    // identity on every enrichment — listing it would restore the loop — and
    // needsEnrichKey already encodes the only thing about it that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsEnrichKey]);

  // Depend on the boolean, not on state.genresByBookId — that object is rebuilt
  // on every shelf load, and depending on its identity would re-run the fetch
  // (and the query) every time anything on any shelf changed.
  const hasShelfGenres = !!(book?.bookId && state.genresByBookId?.[book.bookId]?.length);

  // v0.63.2b — GENRES FOR A BOOK YOU DO NOT OWN.
  //
  // `state.genresByBookId` is hydrated from book_genres_view for the ids on the
  // wishlist, library and read-next shelves, and nothing else. That is correct
  // for the shelves, and it means a Book Page for a book on NO shelf has no
  // link data at all — it falls back to the legacy `books.genre` scalar carried
  // in the URL snapshot.
  //
  // Which works from a Stacks card, because that card was built from a `books`
  // row and the snapshot carries `g`. It does NOT work from search: those
  // results come from Hardcover / Google Books, which know nothing about this
  // catalogue's taxonomy, so `g` is absent and the page renders no genres at
  // all — even when the book has a full set of links in the database. That is
  // the reported "Cleat Cute shows no genres".
  //
  // One query, only when the shelves cannot answer. `pageGenresLoading` is
  // tracked so the chips are held rather than flashing the scalar and then
  // being replaced — the exact swap this release set out to remove.
  useEffect(() => {
    const id = book?.bookId;
    if (!id || hasShelfGenres) { setPageGenres(null); return; }

    let cancelled = false;
    setPageGenresLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('book_genres_view')
        .select('genre_id, genre_name, genre_description, usage_count, normalized_name')
        .eq('book_id', id);
      if (cancelled) return;
      if (error) {
        // A failed lookup must not blank the page: fall through to whatever the
        // snapshot carried, which is what happened before this effect existed.
        console.warn('[BookPage] genre lookup failed', error.message);
        setPageGenres(null);
      } else {
        setPageGenres((data || []).map((r) => ({
          genreId: r.genre_id,
          name: r.genre_name,
          description: r.genre_description || null,
          usageCount: r.usage_count,
          normalizedName: r.normalized_name,
        })));
      }
      setPageGenresLoading(false);
    })();

    return () => { cancelled = true; };
  }, [book?.bookId, hasShelfGenres]);

  // Enrichment:
  // For preview books (from search), fetch the full Hardcover record by
  // hardcoverId first. Typesense hits often lack descriptions entirely.
  // For collection books, only fetch what is missing.
  // Enrichment — keyed on stable identifiers to avoid re-firing when DataContext
  // produces a new book object reference after cacheBookFields writes back.
  // Using [book] would loop: cacheBookFields → state update → new book ref → re-fire.
  const bookTitle = book?.t || null;
  const bookAuthor = book?.a || null;
  const bookHardcoverId = book?.hardcoverId || null;
  // v0.64 — the current book's identity, as primitives, for the author-section
  // effect below. Primitives and not the object itself for the reason recorded
  // on the series effect: `book` gets a new reference every time
  // cacheBookFields writes back to DataContext, so depending on it re-runs the
  // effect forever.
  const bookIsbn = book?.isbn || null;
  const bookGoodreadsId = book?.goodreadsId || null;
  const bookLanguage = book?.language || null;
  const bookSeriesId = book?.s?.seriesId || book?.seriesId || null;
  const bookSeriesPos = book?.s?.n ?? book?.seriesPosition ?? null;
  const isPreviewParam = route.params?.preview === 'true';
  const hasCover = !!(book?.coverUrl);
  const hasPages = !!(book?.pp);
  const hasDesc = !!(book?.d);
  useEffect(() => {
    if (!book) return;
    let cancelled = false;

    enrichBookFromOpenLibrary(book.t, book.a).then((d) => {
      if (!cancelled) setEnrichment(d);
    });

    async function run() {
      const patch = {};

      // Preview path: fetch full Hardcover record by ID for reliable description
      if (isPreviewParam && book.hardcoverId && !book.d) {
        const full = await hardcoverGetBook(book.hardcoverId);
        if (cancelled) return;
        if (full) {
          if (full.d) patch.d = full.d;
          if (!book.pp && full.pp) patch.pp = full.pp;
          if (!book.coverUrl && full.coverUrl) patch.coverUrl = full.coverUrl;
          if (!book.s && full.s) patch.s = full.s;
          if (!book.isbn && full.isbn) patch.isbn = full.isbn;
        }
      }

      const needsCover = !book.coverUrl && !patch.coverUrl;
      const needsPages = !book.pp && !patch.pp;
      const needsDescription = !book.d && !patch.d;

      if (!needsCover && !needsPages && !needsDescription) {
        if (Object.keys(patch).length > 0) {
          setEnrichedOverlay((cur) => ({ ...cur, ...patch }));
          cacheBookFields?.(book, patch);
        }
        return;
      }
      if (needsCover) {
        const coverUrl = await fetchCoverURL(book.t, book.a);
        if (cancelled) return;
        if (coverUrl) patch.coverUrl = coverUrl;
      }
      // Fast path for missing descriptions: fetch full Hardcover record by ID.
      if (needsDescription && book.hardcoverId) {
        const full = await hardcoverGetBook(book.hardcoverId);
        if (cancelled) return;
        if (full?.d) patch.d = full.d;
        if (needsPages && full?.pp) patch.pp = full.pp;
        if (!book.isbn && full?.isbn) patch.isbn = full.isbn;
      }
      const stillNeedsPages = needsPages && !patch.pp;
      const stillNeedsDescription = needsDescription && !patch.d;
      if (stillNeedsPages || stillNeedsDescription) {
        const found = await lookupByTitle(book.t, book.a);
        if (cancelled) return;
        if (found) {
          if (stillNeedsPages && found.pp) patch.pp = found.pp;
          if (stillNeedsDescription && found.d) patch.d = found.d;
          if (!book.isbn && !patch.isbn && found.isbn) patch.isbn = found.isbn;
          if (found.wikipediaUrl) patch.wikipediaUrl = found.wikipediaUrl;
          if (found.wikipediaLang) patch.wikipediaLang = found.wikipediaLang;
          if (found.descriptionSource) patch.descriptionSource = found.descriptionSource;
        }
      }
      if (Object.keys(patch).length > 0) {
        setEnrichedOverlay((cur) => ({ ...cur, ...patch }));
        cacheBookFields?.(book, patch);
      }
    }
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookTitle, bookAuthor, bookHardcoverId, isPreviewParam, hasCover, hasPages, hasDesc]);

  // Series fetch — keyed on stable string values, NOT object references.
  // Depending on [book, enrichment] caused an infinite loop: cacheBookFields
  // updates DataContext → book gets a new object ref → effect fires again → Wikipedia again.
  const seriesNameForEffect = book?.s?.name || enrichment?.series?.name || null;
  const authorForEffect = book?.a || null;
  useEffect(() => {
    if (!seriesNameForEffect) return;
    let cancelled = false;
    setSeriesLoading(true);
    setSeriesBooks([]);
    fetchSeriesBooks(seriesNameForEffect).then((b) => {
      if (!cancelled) {
        setSeriesBooks(b);
        setSeriesLoading(false);
      }
    });
    fetchSeriesDescriptionFromWikipedia(seriesNameForEffect, authorForEffect).then((d) => {
      if (!cancelled && d) setSeriesDescription(d);
    });
    return () => { cancelled = true; };
  }, [seriesNameForEffect, authorForEffect]);

  // "More by this author" — v0.64.
  //
  // Keyed on the two stable STRINGS, for the same reason the series effect
  // above is: depending on `book` re-fires the effect every time
  // cacheBookFields writes back to DataContext and hands this component a new
  // object reference, which is how the series lookup once managed to call
  // Wikipedia in a loop.
  //
  // authorForEffect is `book?.a` — the author as the reader's own row holds
  // it. Deliberately NOT enrichment?.author: the enrichment pass can rewrite an
  // author string mid-render, and a section that quietly re-queries under a
  // different name while the reader is looking at it is worse than one that
  // uses the name on the page.
  useEffect(() => {
    if (!authorForEffect || !bookTitle) {
      setAuthorWorks([]);
      return;
    }
    let cancelled = false;
    setAuthorWorks([]);
    fetchAuthorWorks(authorForEffect, {
      // Reassembled from primitives rather than passed as `book` — see the
      // declarations above. These are exactly the fields collapseWorks groups
      // on, which is what lets fetchAuthorWorks drop this book's OWN
      // translations: viewing *The River Has Roots* was returning *El río
      // tiene raíces* as another book by the same author.
      currentBook: {
        t: bookTitle,
        a: authorForEffect,
        isbn: bookIsbn || undefined,
        hardcoverId: bookHardcoverId || undefined,
        goodreadsId: bookGoodreadsId || undefined,
        seriesId: bookSeriesId || undefined,
        seriesPosition: bookSeriesPos ?? undefined,
        language: bookLanguage || undefined,
      },
      excludeTitle: bookTitle,
      limit: AUTHOR_WORKS_LIMIT,
      // Anchor the top-up to the language of the book being read, not the
      // interface. A reader on an English book page wants that author's other
      // books in English; the UI language is only the fallback when the row
      // does not say.
      lang: bookLanguage || lang,
    })
      .then((works) => {
        if (!cancelled) setAuthorWorks(works);
      })
      // fetchAuthorWorks swallows its own failures and resolves to [], so this
      // only fires on a programming error inside it. Caught anyway so an
      // unhandled rejection cannot take the page down over a decoration.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [
    authorForEffect, bookTitle, lang,
    bookIsbn, bookHardcoverId, bookGoodreadsId,
    bookSeriesId, bookSeriesPos, bookLanguage,
  ]);

  // Keys of every book already read, used to keep finished books out of
  // "You might also like" further down.
  //
  // MUST STAY ABOVE THE EARLY RETURNS BELOW. This component bails out three
  // times before it renders — `notFound`, the snapshot-only path, and `!book` —
  // so a hook placed after them runs on some renders and not others, and React
  // matches hooks positionally. Put it down beside the code that uses it and
  // the page throws "Rendered more hooks than during the previous render" the
  // moment a book resolves after an early return.
  const readKeys = useMemo(
    () => new Set((state.library || []).map(bookKey)),
    [state.library]
  );

  // v0.63.3: the database lookup for a shared link is still running. Rendering
  // "not found" here — which is what happened before the lookup existed — tells
  // the reader the book does not exist while we are in the middle of finding it.
  if (lookingUp && !book) {
    // v0.63.3c: a skeleton rather than a line of text. This is the shared-link
    // landing case — the reader arrived from outside with no context at all, so
    // showing the SHAPE of a book page is the difference between "loading" and
    // "this site is broken".
    return <BookPageSkeleton />;
  }

  if (notFound) {
    return (
      <div className="lv-empty">
        <div className="lv-empty-icon">❦</div>
        <div className="lv-empty-title">
          {t('bookPage.notFound')}
        </div>
        <div className="lv-empty-text">
          {t('bookPage.notInCollection')}
        </div>
        <button className="btn-primary" onClick={() => go(from)}>
          {t('onboarding.back')}
        </button>
      </div>
    );
  }

  // While DataContext is loading, render from the URL snapshot if available
  if (!book && snapshotBook) {
    return (
      <div className="bp-page">
        <div className="bp-hero">
          <div className="bp-cover-col">
            <BookCover title={snapshotBook.t || ''} author={snapshotBook.a || ''} coverUrl={snapshotBook.coverUrl} />
          </div>
          <div className="bp-info">
            {snapshotBook.g && (
              <div className="bp-meta">
                <span className="chip">{snapshotBook.g}</span>
              </div>
            )}
            <h2 className="bp-title">{snapshotBook.t}</h2>
            <div className="bp-author">{snapshotBook.a}</div>
            <div className="bp-actions">
              {authPending || (isAuthed && !dataReady) ? (
                <span className="bp-loading-note">
                  {t('bookPage.loadingBook')}
                </span>
              ) : !isAuthed ? (
                <a href={window.location.pathname} className="btn-secondary">
                  {t('bookPage.signInToAdd')}
                </a>
              ) : null}
            </div>
          </div>
        </div>
        {snapshotBook.d && (
          <div className="bp-section">
            <div className="bp-section__label">
              {t('bookModal.description')}
            </div>
            <p className="bp-description">{snapshotBook.d}</p>
          </div>
        )}
      </div>
    );
  }

  if (!book) return null;

  const enriched = findBookByTitle(book.t, state.wishlist) || book;
  const display = { ...enriched, ...book, ...enrichedOverlay };
  if (enrichment) {
    if (!display.s && enrichment.series?.name) {
      display.s = { ...enrichment.series, fromOpenLibrary: true };
    }
    if (!display.pp && enrichment.pages) display.pp = enrichment.pages;
    // v0.56: ISBN drives the direct Amazon/Bookshop product links, so pull it from
    // enrichment if it ever carries one. Note enrichBookFromOpenLibrary currently
    // returns only { series, pages } — this is defensive, NOT a working repopulation
    // path. Books with a null ISBN are filled by batch-scripts/isbnBackfill.mjs.
    if (!display.isbn && enrichment.isbn) display.isbn = enrichment.isbn;
  }
  if (!display.isbn && enriched?.isbn) display.isbn = enriched.isbn;

  const k = bookKey(display);
  const inLib = state.library.some((b) => bookKey(b) === k);
  const inNext = state.readNext.some((b) => bookKey(b) === k);
  const inWish = state.wishlist.some((b) => bookKey(b) === k);
  const inCurrentlyReading = state.currentlyReading.some((b) => bookKey(b) === k);

  const libraryRow = inLib ? state.library.find((b) => bookKey(b) === k) : null;
  const currentlyReadingRow = inCurrentlyReading ? state.currentlyReading.find((b) => bookKey(b) === k) : null;
  const liveRating = libraryRow?.rating ?? display.rating ?? null;
  const liveNotes = libraryRow?.notes ?? null;
  // v0.44: memory thread — prefer the state rows (they carry bookId when the
  // book exists on the server) so the lookup key matches the capture key.
  const bookMemories = memoriesForBook(currentlyReadingRow || libraryRow || display);

  // v0.39: reading-progress fields, same derivation as CurrentlyReading.jsx
  const pagesRead = currentlyReadingRow?.pagesRead ?? 0;
  // v0.65: the reader's own edition decides what progress is measured against.
  // effectivePages checks reader_editions, then the legacy
  // currently_reading.user_page_count, then the catalog — see src/lib/editions.js.
  const readerEdition = state.editionsByBookId?.[display.bookId] || null;
  const totalPages = readerEdition?.format === 'audio'
    ? null
    : effectivePages(currentlyReadingRow || display, readerEdition);
  const progressPct = totalPages && pagesRead > 0 ? Math.min(100, Math.round((pagesRead / totalPages) * 100)) : null;

  const categories = getCategoriesForBook ? getCategoriesForBook(display) : [];
  const existingCategoryIds = new Set(categories.map((c) => c.categoryId));
  const atCategoryCap = categories.length >= 10;
  const canAddCategories = !!display.bookId || !state.profile?.displayName;

  async function handleSaveRating({ rating, notes, readAt }) {
    if (!libraryRow) return;
    await updateReadBook(libraryRow, { rating, notes, readAt });
    setRatingEditorOpen(false);
    if (pendingMoment) { showShareMoment(pendingMoment); setPendingMoment(null); }
  }

  async function handleFinishReading({ rating, notes, readAt }) {
    if (!currentlyReadingRow) return;
    await finishReading(currentlyReadingRow, { rating, notes, readAt });
    setFinishing(false);
  }

  async function handleProgressSave(newPagesRead, userPageCount) {
    if (!currentlyReadingRow) return;
    await updateReadingProgress(currentlyReadingRow, newPagesRead, userPageCount);
    setUpdatingProgress(false);
  }

  async function handleRemoveCategory(categoryId) {
    setPendingRemoveId(categoryId);
    try { await removeCategoryFromBook(display, categoryId); }
    finally { setPendingRemoveId(null); }
  }

  // v0.63: was `oracleGenres?.length ? oracleGenres : [{name: display.g}]`,
  // which rendered the single legacy scalar on every first paint because
  // genresByBookId starts empty — one chip, then the rest arriving visibly
  // later. resolveGenres tells us whether the blank is "loading" or "settled".
  //
  // v0.63.2b: shelves first, then the direct lookup above for books on none of
  // them, then the scalar. `pageGenres` is [] for a book that genuinely has no
  // links, which is a real answer and must not be mistaken for "not fetched" —
  // hence the null check rather than a length check.
  // Order matters, and the naive version gets it backwards: resolveGenres
  // already folds the scalar in as its last resort, so testing its result first
  // would let ONE legacy chip beat a full set of real links fetched above.
  // Shelf links, then the direct lookup, then whatever resolveGenres decides.
  const shelfLinks = display.bookId ? state.genresByBookId?.[display.bookId] : null;
  const shelfResolved = resolveGenres(state, loading, display);

  let genres;
  let genresPending;
  if (shelfLinks && shelfLinks.length) {
    genres = shelfLinks;
    genresPending = false;
  } else if (pageGenresLoading) {
    // Hold the row rather than paint the scalar and swap it a moment later.
    genres = [];
    genresPending = true;
  } else if (pageGenres && pageGenres.length) {
    genres = pageGenres;
    genresPending = false;
  } else {
    genres = shelfResolved.genres;
    genresPending = shelfResolved.pending;
  }

  // Similar books — scored by Oracle genre overlap, author, complexity, length.
  // `state.library` is the read shelf; it stays in the pool so nothing else
  // changes, but every key in it is excluded from the results.
  //
  // `readKeys` is memoised further up, above the early returns — see the note
  // there. It cannot live here.
  const allBooks = [...state.wishlist, ...state.library, ...state.readNext];
  // v0.64: score more than we show, collapse same-work rows, then cut to twelve.
  //
  // A reader who shelved *Cien años de soledad* and *One Hundred Years of
  // Solitude* has two rows for one novel, and every signal computeSimilar
  // scores on — genre overlap, author, complexity, length — is near-identical
  // between them, so they land next to each other at the top of the strip. The
  // collapse has to happen AFTER scoring (the score is what orders the strip)
  // and BEFORE the slice, or the duplicates simply eat two of the twelve slots.
  const similar = collapseWorks(
    computeSimilar(display, state.genresByBookId, allBooks, 24, readKeys),
    { uiLang: lang }
  ).slice(0, 12);

  // Series block — same logic as BookModal
  let seriesBlock = null;
  if (display.s?.name) {
    const seriesName = display.s.name;
    const sources = [...state.wishlist, ...state.library, ...state.readNext];
    const seen = new Set();
    let entries = [];
    for (const b of sources) {
      if (!b.s || b.s.name !== seriesName) continue;
      const kk = bookKey(b);
      if (seen.has(kk)) continue;
      seen.add(kk);
      entries.push(b);
    }
    // Only merge fetched series books if they actually belong to this series.
    // Hardcover search can return a wrong series (e.g. searching "Bride" returns
    // "Scared Sexy"). Validate by checking the fetched books' s.name.
    const fetchedSeriesName = seriesBooks[0]?.s?.name;
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fetchedMatchesSeries = fetchedSeriesName &&
      normalize(fetchedSeriesName) === normalize(seriesName);
    const validSeriesBooks = fetchedMatchesSeries ? seriesBooks : [];
    for (const ob of validSeriesBooks) {
      if (!entries.some((e) => bookKey(e) === bookKey(ob))) entries.push(ob);
    }
    if (!entries.some((e) => bookKey(e) === bookKey(display))) entries.push({ ...display });
    entries.sort((a, b) => (a.s?.n || 999) - (b.s?.n || 999));

    const totalKnown = entries.length;
    const totalFromSeriesFetch = validSeriesBooks.length > 0
      ? (validSeriesBooks.find((b) => b.s?.total)?.s?.total || null)
      : null;
    const totalBooks = totalFromSeriesFetch || display.s.total || totalKnown || 1;
    const readCount = entries.filter((e) => state.library.some((l) => bookKey(l) === bookKey(e))).length;

    const dots = [];
    // Separate entries with explicit positions from those without
    const positionedEntries = entries.filter((e) => e.s?.n != null);
    const unpositionedEntries = entries.filter((e) => e.s?.n == null);
    for (let i = 1; i <= totalBooks; i++) {
      // First try explicit position match, then fall back to unpositioned entries
      // assigned by array order (for Hardcover data that occasionally has null positions)
      const entry = positionedEntries.find((e) => e.s?.n === i)
        || (unpositionedEntries[i - 1 - positionedEntries.filter(e => e.s?.n < i).length] ?? null);
      if (entry) {
        const isCurrent = bookKey(entry) === k;
        const read = state.library.some((l) => bookKey(l) === bookKey(entry));
        const queued = state.readNext.some((l) => bookKey(l) === bookKey(entry));
        const cls = isCurrent ? ' bp-series__dot--current' : read ? ' bp-series__dot--read' : queued ? ' bp-series__dot--queued' : '';
        const dotTitle = `${entry.t}${read ? ' — read' : queued ? ' — queued' : ''}`;
        // The current volume is not a link to itself; every other dot is a real
        // <a href="/book/:key">, which is the only crawlable path from one book
        // page to its siblings.
        dots.push(
          isCurrent ? (
            <div key={i} className={`bp-series__dot${cls}`} title={dotTitle}>{i}</div>
          ) : (
            <RouteLink
              key={i}
              className={`bp-series__dot${cls}`}
              title={dotTitle}
              to="book-page"
              params={{ bookKey: bookKey(entry) }}
              navParams={buildBookPageParams(entry, 'book-page', display.t)}
            >
              {i}
            </RouteLink>
          )
        );
      } else {
        dots.push(
          <div key={i} className="bp-series__dot" title={`Book ${i}`}>{i}</div>
        );
      }
    }
    seriesBlock = { name: seriesName, dots, readCount, totalBooks, entries, currentKey: k };
  }

  const links = purchaseLinks(display);

  return (
    <div className="bp-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => go(from)}>{fromLabel}</a>
        {' · '}
        <span className="lv-hl-muted">{display.t}</span>
      </div>

      {/* Hero */}
      <div className="bp-hero">
        <div className="bp-cover-col">
          <BookCover title={display.t} author={display.a} coverUrl={display.coverUrl} eager />
        </div>

        <div className="bp-info">
          {/* Reserve the row while links are in flight rather than filling it
              with the legacy scalar we are about to replace. Same height, so
              the title below does not jump when the chips land. */}
          {genresPending ? (
            <div className="bp-meta bp-meta--pending" aria-hidden="true">
              <span className="chip chip--skeleton" />
              <span className="chip chip--skeleton" />
            </div>
          ) : genres.length > 0 && (
            <div className="bp-meta">
              {/* v0.67 — the chip is a LINK now. It had a cursor and no href
                  since genres shipped, which meant the catalogue's richest
                  internal link surface — every book page, 2-5 genres each —
                  pointed nowhere. This one change is most of the link graph the
                  2026-08-24 postmortem found missing.
                  normalizedName can be absent on guest/unenriched rows; those
                  stay plain spans rather than linking to a route that 404s. */}
              {genres.map((g) => (
                g.normalizedName ? (
                  <RouteLink
                    key={g.name}
                    to="genre-page"
                    params={{ genreSlug: g.normalizedName }}
                    className="chip"
                    title={g.description || undefined}
                  >
                    {g.name}
                  </RouteLink>
                ) : (
                  <span key={g.name} className="chip" title={g.description || undefined}>
                    {g.name}
                  </span>
                )
              ))}
            </div>
          )}

          <h1 className="bp-title">{display.t}</h1>
          <div className="bp-author">{displayAuthor(display)}</div>

          {/* v0.65 — the reader's own edition.
              Owner-only by construction rather than by a check: editionsByBookId
              is loaded from reader_editions, whose RLS returns only this
              reader's rows, so there is nothing here another reader could see.

              The heading above stays the CANONICAL title. This page is about
              the work, and swapping the title per reader would break the one
              thing shared links depend on being stable — two people discussing
              the same URL must see the same book named the same way.

              Rendered only when the edition differs in something visible
              (editionIsNotable): telling a reader their English copy of an
              English book is English is noise wearing the clothes of a
              feature. */}
          {editionIsNotable(display, readerEdition) && (
            <div className="bp-edition">
              {editionTitle(display, readerEdition) && (
                <span className="bp-edition__title">{editionTitle(display, readerEdition)}</span>
              )}
              {readerEdition.language && (
                <span className="bp-edition__bit">{t(`language.${readerEdition.language}`)}</span>
              )}
              {readerEdition.format && readerEdition.format !== 'print' && (
                <span className="bp-edition__bit">{t(`progress.editionFormat_${readerEdition.format}`)}</span>
              )}
              {readerEdition.page_count && (
                <span className="bp-edition__bit">{readerEdition.page_count} {t('profile.statPages')}</span>
              )}
              {readerEdition.translator && (
                <span className="bp-edition__bit">{t('bookPage.translatedBy', { name: readerEdition.translator })}</span>
              )}
            </div>
          )}

          {/* Meta pills — .level-pill doesn't exist in the DS; the correct
              class is .bp-pill, with modifiers matching what's actually
              defined: --read / --ro-gold / --moss (not "--gold", which was
              the bug silently dropping the verified-pill styling below). */}
          <div className="bp-meta">
            {display.pp && <span className="bp-pill">📄 {display.pp} {t('profile.statPages')}</span>}
            {display.c && <span className="bp-pill">prose {'●'.repeat(display.c)}{'○'.repeat(5 - display.c)}</span>}
            {display.p && <span className="bp-pill">depth {'●'.repeat(display.p)}{'○'.repeat(5 - display.p)}</span>}
            {(display.status === 'verified' || display.status === 'oracle_categorized') && (
              <span
                className="bp-pill bp-pill--ro-gold"
                title="Curated · verified by our editors"
              >
                {t('bookPage.verified')}
              </span>
            )}
            {inLib && (
              <span className="bp-pill bp-pill--moss">
                ✓ {t('navSearch.statusRead')}
              </span>
            )}
            {inWish && !inLib && (
              <span className="bp-pill">
                {t('bookPage.inWishlistShort')}
              </span>
            )}
            {inNext && (
              <span className="bp-pill">
                {t('bookPage.inReadNextShort')}
              </span>
            )}
          </div>

          {/* Series */}
          {seriesLoading && display.s?.name && (
            <div className="bp-loading-note">
              {t('bookPage.loadingSeries')}
            </div>
          )}
          {!seriesLoading && seriesBlock && (() => {
            const { name, dots, readCount, totalBooks, entries, currentKey } = seriesBlock;
            const useTrack = totalBooks > 6;
            const currentEntry = entries.find((e) => bookKey(e) === currentKey);
            const currentPos = currentEntry?.s?.n || entries.findIndex((e) => bookKey(e) === currentKey) + 1;
            const trackReadPct = totalBooks > 0 ? (readCount / totalBooks) * 100 : 0;
            const trackCursorPct = totalBooks > 1 ? ((currentPos - 1) / (totalBooks - 1)) * 100 : 0;
            const seriesLinkProps = {
              to: 'series-page',
              params: { seriesName: name },
              navParams: { seriesName: name, from: 'book-page', fromLabel: display.t },
            };
            return (
              <div className="bp-series">
                {/* Label row — eyebrow left, open-series pill right */}
                <div className="bp-series__head">
                  <div className="bp-section__label">
                    {t('bookPage.partOfSeries')}
                  </div>
                  <RouteLink
                    {...seriesLinkProps}
                    title={t('bookPage.openSeries')}
                    className="bp-series__open"
                  >
                    {t('bookPage.openSeries')}
                  </RouteLink>
                </div>

                {/* Series name — a real link, same target as the pill above */}
                <RouteLink {...seriesLinkProps} className="bp-series__name">
                  {name}
                </RouteLink>

                {useTrack ? (
                  <div className="bp-series__track">
                    <div className="bp-series__track-fill" style={{ '--sp-pct': `${trackReadPct}%` }} />
                    <div className="bp-series__track-cursor" style={{ left: `${Math.max(0, Math.min(100, trackCursorPct))}%` }} />
                  </div>
                ) : (
                  <div className="bp-series__dots">
                    {dots}
                  </div>
                )}
                <span className="bp-series__progress-text">
                  {t('bookPage.seriesRead', { read: readCount, total: totalBooks })}
                </span>
                {seriesDescription && (
                  <p className="bp-series__desc">{seriesDescription.description}</p>
                )}
              </div>
            );
          })()}

          {/* Actions — v0.40: replaces the old flat 6-button row with the
              state-driven, grouped block from the Book Page Actions Redesign
              DS spec. One primary action per reading state (want to read /
              currently reading / finished), a demoted "remove" once the book
              has been started, and buying pulled into its own "Find a copy"
              zone below. Renamed container (.bp-action-block, not .bp-actions)
              because .bp-actions is a shared flat-row class used by several
              other views (BookModal, Lists, PlanView, etc.) — reusing it here
              with a column layout would have reflowed all of those too. */}
          <div className="bp-action-block">
            {authPending ? (
              // Auth check in progress — don't flash sign-in prompt
              <span className="bp-loading-note">
                {t('common.loading')}
              </span>
            ) : !isAuthed ? (
              // Confirmed not signed in — show sign-in prompt
              <a
                href={window.location.pathname}
                className="btn-secondary"
              >
                {t('bookPage.signInToAdd')}
              </a>
            ) : !dataReady ? (
              // Signed in but data still loading
              <span className="bp-loading-note">
                    {t('bookPage.loadingBook')}
              </span>
            ) : (inLib && !inCurrentlyReading) ? (
              // ── Finished — rating panel is the primary zone. A book that is
              // ALSO being re-read falls through to the currently-reading
              // branch below so progress stays visible/editable. ────────────
              <>
                <div className="bp-panel">
                  <div className="bp-panel__head">
                    <span className="bp-panel__label">{t('rating.eyebrowEdit')}</span>
                  </div>
                  {liveRating > 0 ? (
                    <div className="bp-stars bp-panel__stars">
                      {'★'.repeat(liveRating)}
                      <span className="bp-stars__empty">{'★'.repeat(5 - liveRating)}</span>
                    </div>
                  ) : (
                    <div className="bp-no-rating bp-panel__stars">
                      {t('bookModal.notRatedYet')}
                    </div>
                  )}
                  <div className="bp-panel__actions">
                    <button className="btn-secondary" onClick={() => setRatingEditorOpen(true)}>
                      {t('bookPage.writeReview')}
                    </button>
                    <button className="btn-secondary" onClick={() => startReading(display)}>
                      {t('bookPage.readAgain')}
                    </button>
                  </div>
                </div>
                <div className="bp-shelf-secondary">
                  <button className="btn-text bp-remove-link" onClick={() => removeFromLibrary(display)}>
                    {t('bookPage.removeFromLibrary')}
                  </button>
                </div>
              </>
            ) : inCurrentlyReading ? (
              // ── Currently reading — progress panel is the primary zone ───
              <>
                <div className="bp-panel">
                  <div className="bp-panel__head">
                    <span className="bp-panel__label">{t('bookPage.yourProgress')}</span>
                    {progressPct != null && (
                      <span className="bp-panel__pct">{progressPct}%</span>
                    )}
                  </div>
                  {totalPages ? (
                    <>
                      <div className="bp-panel__value">
                        {pagesRead}
                        <span className="bp-panel__value-muted"> / {totalPages} {t('profile.statPages')}</span>
                      </div>
                      <div className="bp-panel__bar-track">
                        <div className="bp-panel__bar-fill" style={{ width: `${progressPct ?? 0}%` }} />
                      </div>
                    </>
                  ) : pagesRead > 0 ? (
                    <div className="bp-panel__value">
                      {t('currentlyReading.pagesReadOnly', { count: pagesRead })}
                    </div>
                  ) : null}
                  <div className="bp-panel__actions">
                    <button className="btn-primary" onClick={() => setUpdatingProgress(true)}>
                      {t('currentlyReading.updateProgress')}
                    </button>
                    <button className="btn-secondary" onClick={() => setFinishing(true)}>
                      {t('currentlyReading.markFinished')}
                    </button>
                  </div>
                </div>
                <div className="bp-shelf-secondary">
                  <button className="btn-text bp-remove-link" onClick={() => removeFromCurrentlyReading(currentlyReadingRow)}>
                    {t('currentlyReading.remove')}
                  </button>
                </div>
              </>
            ) : (
              // ── Want to read — one primary CTA, then shelf actions ranked
              // by how often they're reached for: Wishlist/Read Next (real
              // collections) outrank the custom Lists feature, and marking a
              // book read outright is the least common path here since bulk
              // adds already cover that. ─────────────────────────────────────
              <div className="bp-primary-zone">
                <button className="btn-accent btn--block" onClick={() => startReading(display)}>
                  {t('bookPage.startReading')}
                </button>
                {(!inWish || !inNext) && (
                  <div className="bp-actions-row">
                    {!inWish && (
                      <button className="btn-secondary" onClick={() => addToWishlist(display)}>
                        {t('bookPage.addToWishlist')}
                      </button>
                    )}
                    {!inNext && (
                      <button className="btn-secondary" onClick={() => addToReadNext(display)}>
                        {t('bookPage.addToNext')}
                      </button>
                    )}
                  </div>
                )}
                <div className="bp-actions-row bp-actions-row--tertiary">
                  <AddToListPicker book={display} className="btn-tertiary btn--sm" />
                  <button
                    className="btn-tertiary btn--sm"
                    onClick={async () => { const m = await markAsRead(display, {}, { defer: true }); setPendingMoment(m); setRatingEditorOpen(true); }}
                  >
                    {t('bookPage.markAsRead')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* v0.43: Share — public page, so shown regardless of auth state.
              Link previews are rendered by og-prerender. */}
          <div className="bp-actions-row bp-actions-row--tertiary">
            <button className="btn-tertiary btn--sm" onClick={() => setShareOpen(true)}>
              ↗ {t('share.shareBook')}
            </button>
          </div>

          {/* Buy zone — separated from the shelf/reading actions above and
              shown regardless of auth state (external links, nothing to
              gate), same as the old .bp-links row it replaces. */}
          {links.length > 0 && (
            <div className="bp-buy">
              <div className="bp-section__label bp-buy__label">{t('bookPage.findACopy')}</div>
              <div className="bp-buy__links">
                {links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bp-buy__link"
                  >
                    {link.label} <span className="bp-buy__icon">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {display.d && (
        <div className="bp-section">
          <div className="bp-section__label">
            {t('bookModal.description')}
            {display.descriptionSource === 'wikipedia' && display.wikipediaUrl && (
              <>
                {' · '}
                <a
                  href={display.wikipediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bp-wiki-link"
                >
                  from wikipedia ↗
                </a>
              </>
            )}
          </div>
          <p className="bp-description">{display.d}</p>
        </div>
      )}

      {/* Series plan CTA — open series now lives in the series block above */}
      {/* {seriesBlock && (
        <div className="bp-actions">
          <button
            className="btn-primary"
            onClick={() => go('plan-create', { seriesName: seriesBlock.name })}
          >
            {t('bookModal.createPlan')}
          </button>
        </div>
      )} */}

      {/* Notes — v0.40: the star display + edit trigger that used to live
          here moved into the new "Your rating" panel in the actions block
          above (finished state). This section now only surfaces the note
          text itself, when there is one, so it isn't lost. */}
      {inLib && liveNotes && (
        <div className="bp-section">
          <div className="bp-section__label">{t('bookPage.yourNotes')}</div>
          <div className="bp-notes">
            {liveNotes}
          </div>
        </div>
      )}

      {/* v0.44: Reading Memory — the private thread of moments captured while
          reading (progress notes) and at the finish (RatingModal notes). Only
          renders for collected books with at least one memory; owner-only by
          construction since memories live on per-user state. */}
      {(inLib || inCurrentlyReading) && bookMemories.length > 0 && (
        <div className="bp-section">
          <div className="bp-section__label">
            {t('memory.sectionTitle')}
            <span className="memory-private-chip">{t('memory.privateChip')}</span>
          </div>
          <div className="memory-thread">
            {bookMemories.map((m) => (
              <div key={m.id} className="memory-entry">
                <div className="memory-entry__meta">
                  {new Date(m.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  {m.pagesAt != null && <> · {t('memory.pageAt', { page: m.pagesAt })}</>}
                  {m.kind === 'finished' && <> · {t('memory.finishedTag')}</>}
                  <button
                    className="memory-entry__delete"
                    title={t('memory.delete')}
                    onClick={() => {
                      if (window.confirm(t('memory.deleteConfirm'))) {
                        deleteReadingMemory(currentlyReadingRow || libraryRow || display, m.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="memory-entry__body">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Categories */}
      <div className="bp-section">
        <div className="bp-section__head" style={{ position: 'relative' }}>
          <span className="bp-section__label">
            {t('bookModal.categories')}
            {categories.length > 0 && (
              <span className="bp-section__count">· {categories.length}/10</span>
            )}
          </span>
          {canAddCategories && !atCategoryCap && (
            <button
              className="btn-text"
              onClick={() => { dismissCoachmark('bookpage-categories'); setAdderOpen((v) => !v); }}
            >
              {adderOpen ? t('bookModal.done') : t('bookModal.addCategory')}
            </button>
          )}
          {/* v0.46: one-time hint — user categories are easy to miss */}
          {canAddCategories && !atCategoryCap && categories.length === 0 && !adderOpen && (
            <CoachMark
              id="bookpage-categories"
              placement="bottom"
              title={t('coachmark.categoriesTitle')}
              body={t('coachmark.categoriesBody')}
            />
          )}
        </div>

        {categories.length === 0 && !adderOpen ? (
          <div className="bp-no-rating">
            {t('categories.noCategories')}
          </div>
        ) : (
          <div className="bp-cats">
            {categories.map((c) => (
              <CategoryPill
                key={c.categoryId}
                category={c}
                removing={pendingRemoveId === c.categoryId}
                canRemove={adderOpen}
                onRemove={() => handleRemoveCategory(c.categoryId)}
              />
            ))}
          </div>
        )}
        {adderOpen && canAddCategories && (
          <div>
            <CategoryAutocomplete
              book={display}
              existingIds={existingCategoryIds}
              onCapHit={() => setAdderOpen(false)}
            />
            <div className="bp-cat-help">
              {t('categories.removeHelp')}
            </div>
          </div>
        )}
      </div>

      <AuthorWorks books={authorWorks} author={displayAuthor(display)} />

      <SimilarBooks similar={similar} />

      <ReportBookForm book={display} />

      {/* Rating editor modal */}
      {ratingEditorOpen && libraryRow && (
        <RatingModal
          book={libraryRow}
          initialRating={liveRating}
          initialNotes={liveNotes}
          initialReadAt={libraryRow?.dateRead}
          mode={liveRating > 0 ? 'edit' : 'create'}
          onSave={handleSaveRating}
          onSkip={() => { setRatingEditorOpen(false); if (pendingMoment) { showShareMoment(pendingMoment); setPendingMoment(null); } }}
        />
      )}

      {/* v0.39: finish-reading modal, for books currently in progress */}
      {finishing && currentlyReadingRow && (
        <RatingModal
          book={currentlyReadingRow}
          mode="finish"
          onSave={handleFinishReading}
          onSkip={() => {
            finishReading(currentlyReadingRow);
            setFinishing(false);
          }}
        />
      )}

      {/* v0.39: reading-progress modal, for books currently in progress */}
      {updatingProgress && currentlyReadingRow && (
        <ProgressUpdateModal
          book={currentlyReadingRow}
          onSave={handleProgressSave}
          onClose={() => setUpdatingProgress(false)}
        />
      )}

      {/* v0.43: page-share modal */}
      {shareOpen && (
        <ShareModal
          title={display.a ? `${display.t} — ${display.a}` : display.t} /* intentionally bare: a share title should not advertise a gap */
          text={t('share.text.bookPage', { title: display.t, author: display.a || '' })}
          url={bookShareUrl(display)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
