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
    <div className="book-page-similar">
      <div className="book-modal-section-title">
        {t('bookPage.youMightAlsoLike')}
      </div>
      <div className="similar-grid">
        {similar.map((b, i) => (
          <div
            key={bookKey(b) + i}
            className="similar-card"
            onClick={() => openBookTab(b, 'book-page')}
            title={`${b.t}${b.a ? ' · ' + b.a : ''}`}
          >
            {b.coverUrl ? (
              <img
                src={b.coverUrl}
                alt={b.t}
                className="similar-card__cover"
              />
            ) : (
              <div className="similar-card__cover similar-card__cover--fallback"
                style={{ background: `linear-gradient(155deg,#3a2a1c,#1a100a)` }}>
                <span className="similar-card__fallback-title">{b.t?.slice(0, 22)}</span>
              </div>
            )}
            <div className="similar-card__info">
              <div className="similar-card__title">{b.t?.length > 34 ? b.t.slice(0, 33) + '…' : b.t}</div>
              <div className="similar-card__author">{b.a}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Category pill ────────────────────────────────────────────────────────────

function CategoryPill({ category, removing, canRemove, onRemove }) {
  const { name, verified } = category;
  const baseStyle = verified
    ? { background: 'rgba(176,140,63,0.18)', borderColor: 'var(--gilt)', color: 'var(--gilt-bright)' }
    : { background: 'rgba(176,140,63,0.04)', borderColor: 'rgba(176,140,63,0.3)', color: 'var(--paper-aged)', opacity: 0.9 };
  const showRemove = canRemove && !verified;
  return (
    <span
      className="level-pill"
      className="bp-cat" style={{ ...baseStyle, opacity: removing ? 0.4 : 1 }}
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
  const bookTitle      = book?.t || null;
  const bookAuthor     = book?.a || null;
  const bookHardcoverId = book?.hardcoverId || null;
  const isPreviewParam = route.params?.preview === 'true';
  const hasCover       = !!(book?.coverUrl);
  const hasPages       = !!(book?.pp);
  const hasDesc        = !!(book?.d);
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
      <div className="empty-state lv-empty">
        <div className="ornament">❦</div>
        <div className="empty-state-title">
          {t('bookPage.notFound')}
        </div>
        <div className="empty-state-text">
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
      <div className="book-page">
        <div className="book-page-hero">
          <div className="book-page-cover-col">
            <BookCover title={snapshotBook.t || ''} author={snapshotBook.a || ''} coverUrl={snapshotBook.coverUrl} />
          </div>
          <div className="book-page-info-col">
            {snapshotBook.g && (
              <div className="book-modal-genres">
                <span className="book-modal-genre">{snapshotBook.g}</span>
              </div>
            )}
            <h2 className="book-modal-title">{snapshotBook.t}</h2>
            <div className="book-modal-author">{snapshotBook.a}</div>
            <div className="book-page-actions bp-actions">
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
          <div className="book-page-body">
            <div className="book-modal-section-title">
              {t('bookModal.description')}
            </div>
            <p className="book-page-description">{snapshotBook.d}</p>
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
  const liveNotes  = libraryRow?.notes ?? null;

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
        const cls = isCurrent ? 'current' : read ? 'read' : queued ? 'queued' : '';
        dots.push(
          <div
            key={i}
            className={`series-dot ${cls}`}
            title={`${entry.t}${read ? ' — read' : queued ? ' — queued' : ''}`}
            onClick={() => !isCurrent && go('book-page', buildBookPageParams(entry, 'book-page', display.t))}
            
          >
            {i}
          </div>
        );
      } else {
        dots.push(
          <div key={i} className="series-dot" title={`Book ${i}`}>{i}</div>
        );
      }
    }
    seriesBlock = { name: seriesName, dots, readCount, totalBooks, entries, currentKey: k };
  }

  const links = purchaseLinks(display);

  return (
    <div className="book-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => go(from)}>{fromLabel}</a>
        {' · '}
        <span className="lv-hl-muted">{display.t}</span>
      </div>

      {/* Hero */}
      <div className="book-page-hero">
        <div className="book-page-cover">
          <BookCover title={display.t} author={display.a} coverUrl={display.coverUrl} eager />
        </div>

        <div className="book-page-info">
          {genres.length > 0 && (
            <div className="book-modal-genres">
              {genres.map((g) => (
                <span key={g.name} className="book-modal-genre" title={g.description || undefined}>
                  {g.name}
                </span>
              ))}
            </div>
          )}

          <h1 className="book-page-title">{display.t}</h1>
          <div className="book-page-author">{display.a}</div>

          {/* Meta pills */}
          <div className="book-modal-meta bp-meta">
            {display.pp && <span className="level-pill">📄 {display.pp} {t('profile.statPages')}</span>}
            {display.c && <span className="level-pill">prose {'●'.repeat(display.c)}{'○'.repeat(5 - display.c)}</span>}
            {display.p && <span className="level-pill">depth {'●'.repeat(display.p)}{'○'.repeat(5 - display.p)}</span>}
            {(display.status === 'verified' || display.status === 'oracle_categorized') && (
              <span className="level-pill" className="bp-pill bp-pill--gold"
                title="Curated · verified by our editors">
                {t('bookPage.verified')}
              </span>
            )}
            {inLib && (
              <span className="level-pill" className="bp-pill bp-pill--moss">
                ✓ {t('navSearch.statusRead')}
              </span>
            )}
            {inWish && !inLib && (
              <span className="level-pill">
                {t('bookPage.inWishlistShort')}
              </span>
            )}
            {inNext && (
              <span className="level-pill">
                {t('bookPage.inReadNextShort')}
              </span>
            )}
          </div>

          {/* Series */}
          {seriesLoading && display.s?.name && (
            <div className="bp-loading-note">
              <div className="loading-spinner" />
              <span className="t-overline">
                {t('bookPage.loadingSeries')}
              </span>
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
              <div className="book-page-series">
                {/* Label row — eyebrow left, open-series pill right */}
                <div className="bp-series__head">
                  <div className="book-page-series-label">
                    {t('bookPage.partOfSeries')}
                  </div>
                  <button
                    onClick={goToSeries}
                    title={t('bookPage.openSeries')}
                    className="series-open-btn"
                  >
                    {t('bookPage.openSeries')}
                  </button>
                </div>

                {/* Series name — clickable */}
                <div
                  className="series-name"
                  onClick={goToSeries}
                  
                >
                  {name}
                </div>

                {useTrack ? (
                  <div className="series-track">
                    <div className="series-track__fill" style={{ '--sp-pct': `${trackReadPct}%` }} />
                    <div className="series-track__cursor" style={{ left: `${Math.max(0, Math.min(100, trackCursorPct))}%` }} />
                  </div>
                ) : (
                  <div className="series-progress">
                    {dots}
                  </div>
                )}
                <span className="series-progress-text">
                  {t('bookPage.seriesRead', { read: readCount, total: totalBooks })}
                </span>
                {seriesDescription && (
                  <p className="book-page-series-desc">{seriesDescription.description}</p>
                )}
              </div>
            );
          })()}

          {/* Actions */}
          <div className="book-page-actions">
            {authPending ? (
              // Auth check in progress — don't flash sign-in prompt
              <span className="bp-loading-note">
                {t('common.loading')}
              </span>
            ) : !isAuthed ? (
              // Confirmed not signed in — show sign-in prompt
              <a
                href={window.location.pathname}
                className="btn btn-ghost"
                className="bp-link"
              >
                {t('bookPage.signInToAdd')}
              </a>
            ) : !dataReady ? (
              // Signed in but data still loading
              <span className="bp-loading-note">
                {t('bookPage.loadingLibrary')}
              </span>
            ) : inLib ? (
              <button className="btn btn-ghost" onClick={() => removeFromLibrary(display)}>
                {t('bookPage.removeFromLibrary')}
              </button>
            ) : inNext ? (
              <>
                <button className="btn" onClick={() => markAsRead(display)}>
                  {t('bookPage.markAsRead')}
                </button>
                <button className="btn btn-ghost" onClick={() => removeFromReadNext(display)}>
                  {t('wishlist.remove')}
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => addToReadNext(display)}>
                  {t('bookPage.addToNext')}
                </button>
                {!inWish && (
                  <button className="btn-tertiary" onClick={() => addToWishlist(display)}>
                    {t('bookPage.addToWishlist')}
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => markAsRead(display)}>
                  {t('bookPage.markAsRead')}
                </button>
              </>
            )}
            {isAuthed && !authPending && dataReady && <AddToListPicker book={display} />}
          </div>

          {/* Purchase */}
          {links.length > 0 && (
            <div className="book-page-purchase">
              {links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
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
        <div className="book-page-body">
          <div className="book-modal-section-title">
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
          <p className="book-page-description">{display.d}</p>
        </div>
      )}

      {/* Series plan CTA — open series now lives in the series block above */}
      {/* {seriesBlock && (
        <div className="bp-actions">
          <button
            className="li-action success"
            onClick={() => go('plan-create', { seriesName: seriesBlock.name })}
          >
            {t('bookModal.createPlan')}
          </button>
        </div>
      )} */}

      {/* Rating & notes — only shown for books in library */}
      {inLib && (
        <div className="book-page-body bp-section">
          <div
            className="book-modal-section-title"
            className="bp-section__head"
          >
            <span>{t('rating.eyebrowEdit')}</span>
            <button
              className="li-action"
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
      <div className="book-page-body bp-section">
        <div
          className="book-modal-section-title"
          className="bp-section__head"
        >
          <span>
            {t('bookModal.categories')}
            {categories.length > 0 && (
              <span className="bp-section__count">· {categories.length}/10</span>
            )}
          </span>
          {canAddCategories && !atCategoryCap && (
            <button
              className="li-action"
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
          <div >
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
