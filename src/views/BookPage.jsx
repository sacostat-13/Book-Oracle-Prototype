// BookPage.jsx — v0.19
// Full book detail page. Reached from BookModal's "See more" link.
// Shares data-fetching logic with BookModal but renders as a full page
// with more room for description, series, and genre detail.

import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { bookKey, findBookByTitle, openBookTab, buildBookPageParams } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import { hardcoverGetBook } from '../lib/hardcoverService';
import { fetchCoverURL } from '../lib/coverService';
import { lookupByTitle } from '../lib/bookLookup';
import { purchaseLinks } from '../lib/purchaseLinks';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import BookCover from '../components/BookCover';
import ReportBookForm from '../components/ReportBookForm';
import AddToListPicker from '../components/AddToListPicker';
import RatingModal from '../components/RatingModal';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import CategoryAutocomplete from '../components/CategoryAutocomplete';
import CoachMark from '../components/CoachMark';
import ShareModal from '../components/ShareModal';
import { bookShareUrl } from '../lib/shareService';


// ─── Similar books ────────────────────────────────────────────────────────────

function computeSimilar(display, genresByBookId, pool, limit = 12) {
  // Build genre ID set for the current book
  const thisGenreIds = new Set(
    (genresByBookId?.[display.bookId] || []).map(g => g.genreId)
  );
  // Fallback to legacy single genre field if no Oracle genres
  const thisGenreLegacy = display.g || '';

  const thisKey = bookKey(display);

  const scored = pool
    .filter(b => bookKey(b) !== thisKey)
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
          <div
            key={bookKey(b) + i}
            className="bp-similar-item"
            onClick={() => openBookTab(b, 'book-page')}
            title={`${b.t}${b.a ? ' · ' + b.a : ''}`}
          >
            {b.coverUrl ? (
              <img
                src={b.coverUrl}
                alt={b.t}
                className="bp-similar-cover"
              />
            ) : (
              <div className="bp-similar-cover bp-similar-cover--placeholder">
                <span className="bp-similar-cover__title">{b.t?.slice(0, 22)}</span>
              </div>
            )}
            <div>
              <div className="bp-similar-title">{b.t?.length > 34 ? b.t.slice(0, 33) + '…' : b.t}</div>
              <div className="bp-similar-author">{b.a}</div>
            </div>
          </div>
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
  } = useData();
  const { route, go } = useRouter();
  const t = useT();

  // The book is passed via App-level state (route.params.bookKey) and resolved
  // from wishlist + library + readNext. This avoids encoding large objects in URLs.
  const bookKey_ = route.params?.bookKey;
  const from = route.params?.from || 'dashboard';
  const fromLabel = route.params?.fromLabel || 'Dashboard';

  const [book, setBook] = useState(null);

  // v0.39: SEO/share title+description once the book resolves. Deliberately
  // NOT set in App.jsx's generic route-title effect (see App.jsx) — this is
  // the only place this page's title/description gets set.
  useDocumentMeta({
    title: book ? `${book.t} by ${book.a} — The Books Oracle` : 'Book — The Books Oracle',
    description: book?.d ? book.d.slice(0, 200) : undefined,
    image: book?.coverUrl || undefined,
  });

  const [enrichment, setEnrichment] = useState(null);
  const [enrichedOverlay, setEnrichedOverlay] = useState({});
  const [seriesBooks, setSeriesBooks] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [ratingEditorOpen, setRatingEditorOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [updatingProgress, setUpdatingProgress] = useState(false);
  const [adderOpen, setAdderOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState(null);
  const [shareOpen, setShareOpen] = useState(false); // v0.43

  // Read snapshot from URL immediately — renders before DataContext loads
  const snapshotBook = (() => {
    try {
      const snap = route.params?.snap;
      if (!snap) return null;
      return JSON.parse(decodeURIComponent(atob(snap)));
    } catch (_) { return null; }
  })();

  // Resolve book: preview (from search) or collection lookup
  useEffect(() => {
    const isPreview = route.params?.preview === 'true';
    if (isPreview && previewBookRef?.current) {
      const previewBook = previewBookRef.current;
      setBook(previewBook);
      // Silently upsert as discovered status - enriches catalog without
      // adding to the user's collection (no wishlist_items row).
      upsertDiscoveredBook?.(previewBook);
      return;
    }
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
      setNotFound(true);
    }
  }, [bookKey_, route.params, previewBookRef, state.wishlist, state.library, state.readNext, snapshotBook]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesNameForEffect, authorForEffect]);

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
  }

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
  const totalPages = currentlyReadingRow?.userPageCount ?? currentlyReadingRow?.pp ?? display.pp;
  const progressPct = totalPages && pagesRead > 0 ? Math.min(100, Math.round((pagesRead / totalPages) * 100)) : null;

  const categories = getCategoriesForBook ? getCategoriesForBook(display) : [];
  const existingCategoryIds = new Set(categories.map((c) => c.categoryId));
  const atCategoryCap = categories.length >= 10;
  const canAddCategories = !!display.bookId || !state.profile?.displayName;

  async function handleSaveRating({ rating, notes, readAt }) {
    if (!libraryRow) return;
    await updateReadBook(libraryRow, { rating, notes, readAt });
    setRatingEditorOpen(false);
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

  const oracleGenres = state.genresByBookId?.[display.bookId];
  const genres = (oracleGenres && oracleGenres.length > 0)
    ? oracleGenres
    : (display.g ? [{ name: display.g, description: null }] : []);

  // Similar books — scored by Oracle genre overlap, author, complexity, length
  const allBooks = [...state.wishlist, ...state.library, ...state.readNext];
  const similar = computeSimilar(display, state.genresByBookId, allBooks);

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
        dots.push(
          <div
            key={i}
            className={`bp-series__dot${cls}`}
            title={`${entry.t}${read ? ' — read' : queued ? ' — queued' : ''}`}
            onClick={() => !isCurrent && go('book-page', buildBookPageParams(entry, 'book-page', display.t))}
          >
            {i}
          </div>
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
          {genres.length > 0 && (
            <div className="bp-meta">
              {genres.map((g) => (
                <span key={g.name} className="chip" title={g.description || undefined}>
                  {g.name}
                </span>
              ))}
            </div>
          )}

          <h1 className="bp-title">{display.t}</h1>
          <div className="bp-author">{display.a}</div>

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
            const goToSeries = () => go('series-page', { seriesName: name, from: 'book-page', fromLabel: display.t });
            return (
              <div className="bp-series">
                {/* Label row — eyebrow left, open-series pill right */}
                <div className="bp-series__head">
                  <div className="bp-section__label">
                    {t('bookPage.partOfSeries')}
                  </div>
                  <button
                    onClick={goToSeries}
                    title={t('bookPage.openSeries')}
                    className="bp-series__open"
                  >
                    {t('bookPage.openSeries')}
                  </button>
                </div>

                {/* Series name — clickable */}
                <div
                  className="bp-series__name"
                  onClick={goToSeries}
                >
                  {name}
                </div>

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
                    onClick={async () => { await markAsRead(display); setRatingEditorOpen(true); }}
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
          onSkip={() => setRatingEditorOpen(false)}
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
          title={display.a ? `${display.t} — ${display.a}` : display.t}
          text={t('share.text.bookPage', { title: display.t, author: display.a || '' })}
          url={bookShareUrl(display)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
