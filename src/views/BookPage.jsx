// BookPage.jsx — v0.19
// Full book detail page. Reached from BookModal's "See more" link.
// Shares data-fetching logic with BookModal but renders as a full page
// with more room for description, series, and genre detail.

import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
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
import CategoryAutocomplete from '../components/CategoryAutocomplete';


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
    removeFromReadNext,
    markAsRead,
    removeFromLibrary,
    cacheBookFields,
    upsertDiscoveredBook,
    updateReadBook,
    getCategoriesForBook,
    removeCategoryFromBook,
  } = useData();
  const { route, go } = useRouter();
  const t = useT();

  // The book is passed via App-level state (route.params.bookKey) and resolved
  // from wishlist + library + readNext. This avoids encoding large objects in URLs.
  const bookKey_ = route.params?.bookKey;
  const from = route.params?.from || 'dashboard';
  const fromLabel = route.params?.fromLabel || 'Dashboard';

  const [book, setBook] = useState(null);
  const [enrichment, setEnrichment] = useState(null);
  const [enrichedOverlay, setEnrichedOverlay] = useState({});
  const [seriesBooks, setSeriesBooks] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [ratingEditorOpen, setRatingEditorOpen] = useState(false);
  const [adderOpen, setAdderOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState(null);

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
        const next = '#book-page?' + qs;
        if (window.location.hash !== next) {
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
                  {t('bookPage.loadingLibrary')}
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

  const libraryRow = inLib ? state.library.find((b) => bookKey(b) === k) : null;
  const liveRating = libraryRow?.rating ?? display.rating ?? null;
  const liveNotes = libraryRow?.notes ?? null;

  const categories = getCategoriesForBook ? getCategoriesForBook(display) : [];
  const existingCategoryIds = new Set(categories.map((c) => c.categoryId));
  const atCategoryCap = categories.length >= 10;
  const canAddCategories = !!display.bookId || !state.profile?.displayName;

  async function handleSaveRating({ rating, notes, readAt }) {
    if (!libraryRow) return;
    await updateReadBook(libraryRow, { rating, notes, readAt });
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

          {/* Actions — .btn/.btn-secondary don't exist in the DS; mapped to the
              actual six-variant button system (.btn-primary/-secondary/
              -tertiary). Each duplicate `className` below (two attributes on
              one element, invalid JSX) has been collapsed to one class,
              since only the last of a duplicate pair was ever applied. */}
          <div className="bp-actions">
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
                {t('bookPage.loadingLibrary')}
              </span>
            ) : inLib ? (
              <button className="btn-secondary" onClick={() => removeFromLibrary(display)}>
                {t('bookPage.removeFromLibrary')}
              </button>
            ) : inNext ? (
              <>
                <button className="btn-primary" onClick={() => markAsRead(display)}>
                  {t('bookPage.markAsRead')}
                </button>
                <button className="btn-secondary" onClick={() => removeFromReadNext(display)}>
                  {t('wishlist.remove')}
                </button>
              </>
            ) : (
              <>
                <button className="btn-primary" onClick={() => addToReadNext(display)}>
                  {t('bookPage.addToNext')}
                </button>
                {!inWish && (
                  <button className="btn-tertiary" onClick={() => addToWishlist(display)}>
                    {t('bookPage.addToWishlist')}
                  </button>
                )}
                <button className="btn-secondary" onClick={() => markAsRead(display)}>
                  {t('bookPage.markAsRead')}
                </button>
              </>
            )}
            {isAuthed && !authPending && dataReady && <AddToListPicker book={display} />}
          </div>

          {/* Purchase — .bp-link is the exact existing class for this row;
              the previous duplicate className also carried a dead
              "btn btn-secondary" pair that was never applied. */}
          {links.length > 0 && (
            <div className="bp-links">
              {links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bp-link"
                >
                  ↗ {link.label}
                </a>
              ))}
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

      {/* Rating & notes — only shown for books in library.
          (The section head previously carried two `className` attributes —
          invalid JSX — silently dropping "book-modal-section-title", which
          doesn't exist in the DS anyway; ".bp-section__head" is correct.
          "li-action" has no base rule in the DS, only a "--disabled"
          modifier, so it's replaced with the equivalent ".btn-text".) */}
      {inLib && (
        <div className="bp-section">
          <div className="bp-section__head">
            <span className="bp-section__label">{t('rating.eyebrowEdit')}</span>
            <button
              className="btn-text"
              onClick={() => setRatingEditorOpen(true)}
            >
              {liveRating > 0 || liveNotes ? t('common.edit') : t('bookModal.addRating')}
            </button>
          </div>
          {liveRating > 0 ? (
            <div className="bp-stars">
              {'★'.repeat(liveRating)}
              <span className="bp-stars__empty">{'★'.repeat(5 - liveRating)}</span>
            </div>
          ) : (
            !liveNotes && (
              <div className="bp-no-rating">
                {t('bookModal.notRatedYet')}
              </div>
            )
          )}
          {liveNotes && (
            <div className="bp-notes">
              {liveNotes}
            </div>
          )}
        </div>
      )}

      {/* Categories */}
      <div className="bp-section">
        <div className="bp-section__head">
          <span className="bp-section__label">
            {t('bookModal.categories')}
            {categories.length > 0 && (
              <span className="bp-section__count">· {categories.length}/10</span>
            )}
          </span>
          {canAddCategories && !atCategoryCap && (
            <button
              className="btn-text"
              onClick={() => setAdderOpen((v) => !v)}
            >
              {adderOpen ? t('bookModal.done') : t('bookModal.addCategory')}
            </button>
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
          mode="edit"
          onSave={handleSaveRating}
          onSkip={() => setRatingEditorOpen(false)}
        />
      )}
    </div>
  );
}
