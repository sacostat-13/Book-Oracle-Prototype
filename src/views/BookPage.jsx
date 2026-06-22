// BookPage.jsx — v0.18
// Full book detail page. Reached from BookModal's "See more" link.
// Shares data-fetching logic with BookModal but renders as a full page
// with more room for description, series, and genre detail.

import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { bookKey, findBookByTitle, openBookTab } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import { hardcoverGetBook } from '../lib/hardcoverService';
import { fetchCoverURL } from '../lib/coverService';
import { lookupByTitle } from '../lib/bookLookup';
import { purchaseLinks } from '../lib/purchaseLinks';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import BookCover from '../components/BookCover';
import ReportBookForm from '../components/ReportBookForm';
import AddToListPicker from '../components/AddToListPicker';


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
      <div className="book-modal-section-title" style={{ marginBottom: '1.25rem' }}>
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
  useEffect(() => {
    if (!book) return;
    let cancelled = false;

    enrichBookFromOpenLibrary(book.t, book.a).then((d) => {
      if (!cancelled) setEnrichment(d);
    });

    async function run() {
      const patch = {};
      const isPreview = route.params?.preview === 'true';

      // Preview path: fetch full Hardcover record by ID for reliable description
      if (isPreview && book.hardcoverId && !book.d) {
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
      // Covers collection books added before descriptions were stored.
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
  }, [book, cacheBookFields, route.params]);

  // Series fetch
  useEffect(() => {
    const seriesName = book?.s?.name || enrichment?.series?.name;
    if (!seriesName) return;
    let cancelled = false;
    setSeriesLoading(true);
    setSeriesBooks([]); // reset on book change
    fetchSeriesBooks(seriesName).then((b) => {
      if (!cancelled) {
        setSeriesBooks(b);
        setSeriesLoading(false);
      }
    });
    fetchSeriesDescriptionFromWikipedia(seriesName, book?.a).then((d) => {
      if (!cancelled && d) setSeriesDescription(d);
    });
    return () => { cancelled = true; };
  }, [book, enrichment]);

  if (notFound) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="ornament">❦</div>
        <div className="empty-state-title">
          {t('bookPage.notFound')}
        </div>
        <div className="empty-state-text">
          {t('bookPage.notInCollection')}
        </div>
        <button className="btn" style={{ marginTop: '1.5rem' }} onClick={() => go(from)}>
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
            <div className="book-page-actions" style={{ marginTop: '1.5rem' }}>
              {authPending || (isAuthed && !dataReady) ? (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  {t('bookPage.loadingLibrary')}
                </span>
              ) : !isAuthed ? (
                <a href={window.location.pathname} className="btn btn-ghost" style={{ textDecoration: 'none' }}>
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
    for (const ob of seriesBooks) {
      if (!entries.some((e) => bookKey(e) === bookKey(ob))) entries.push(ob);
    }
    if (!entries.some((e) => bookKey(e) === bookKey(display))) entries.push({ ...display });
    entries.sort((a, b) => (a.s?.n || 999) - (b.s?.n || 999));

    const totalKnown = entries.length;
    const totalFromSeriesFetch = seriesBooks.length > 0
      ? (seriesBooks.find((b) => b.s?.total)?.s?.total || null)
      : null;
    const totalBooks = totalFromSeriesFetch || display.s.total || totalKnown || 1;
    const readCount = entries.filter((e) => state.library.some((l) => bookKey(l) === bookKey(e))).length;

    const dots = [];
    for (let i = 1; i <= totalBooks; i++) {
      const entry = entries.find((e) => e.s?.n === i);
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
            onClick={() => !isCurrent && go('book-page', { bookKey: bookKey(entry), from: 'book-page', fromLabel: display.t })}
            style={{ cursor: isCurrent ? 'default' : 'pointer' }}
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
    seriesBlock = { name: seriesName, dots, readCount, totalBooks };
  }

  const links = purchaseLinks(display);

  return (
    <div className="book-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => go(from)}>{fromLabel}</a>
        {' · '}
        <span style={{ opacity: 0.6 }}>{display.t}</span>
      </div>

      {/* Hero */}
      <div className="book-page-hero">
        <div className="book-page-cover">
          <BookCover title={display.t} author={display.a} coverUrl={display.coverUrl} eager />
        </div>

        <div className="book-page-info">
          {genres.length > 0 && (
            <div className="book-modal-genres" style={{ marginBottom: '0.75rem' }}>
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
          <div className="book-modal-meta" style={{ marginTop: '0.75rem' }}>
            {display.pp && <span className="level-pill">📄 {display.pp} {t('profile.statPages')}</span>}
            {display.c && <span className="level-pill">prose {'●'.repeat(display.c)}{'○'.repeat(5 - display.c)}</span>}
            {display.p && <span className="level-pill">depth {'●'.repeat(display.p)}{'○'.repeat(5 - display.p)}</span>}
            {(display.status === 'verified' || display.status === 'oracle_categorized') && (
              <span className="level-pill" style={{ background: 'rgba(176, 140, 63, 0.18)', borderColor: 'var(--gilt)', color: 'var(--gilt-bright)' }}
                title="Curated · verified by our editors">
                {t('bookPage.verified')}
              </span>
            )}
            {inLib && (
              <span className="level-pill" style={{ background: 'var(--moss)', color: 'var(--paper)', borderColor: 'var(--moss)' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', opacity: 0.4 }}>
              <div className="loading-spinner" style={{ width: 16, height: 16 }} />
              <span style={{ fontFamily: "'Special Elite',monospace", fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--paper-aged)' }}>
                {t('bookPage.loadingSeries')}
              </span>
            </div>
          )}
          {!seriesLoading && seriesBlock && (
            <div className="book-page-series">
              <div className="book-page-series-label">
                {t('bookPage.partOfSeries')}
              </div>
              <div className="series-name">{seriesBlock.name}</div>
              <div className="series-progress">
                {seriesBlock.dots}
                <span className="series-progress-text">
                  {t('bookPage.seriesRead', { read: seriesBlock.readCount, total: seriesBlock.totalBooks })}
                </span>
              </div>
              {seriesDescription && (
                <p className="book-page-series-desc">{seriesDescription.description}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="book-page-actions">
            {authPending ? (
              // Auth check in progress — don't flash sign-in prompt
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                {t('common.loading')}
              </span>
            ) : !isAuthed ? (
              // Confirmed not signed in — show sign-in prompt
              <a
                href={window.location.pathname}
                className="btn btn-ghost"
                style={{ textDecoration: 'none' }}
              >
                {t('bookPage.signInToAdd')}
              </a>
            ) : !dataReady ? (
              // Signed in but data still loading
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
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
                  <button className="btn btn-gilt" onClick={() => addToWishlist(display)}>
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
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem' }}
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
                  style={{ color: 'var(--paper-aged)', opacity: 0.7, fontSize: '0.65rem', textDecoration: 'none', borderBottom: '1px dotted rgba(176,140,63,0.3)' }}
                >
                  from wikipedia ↗
                </a>
              </>
            )}
          </div>
          <p className="book-page-description">{display.d}</p>
        </div>
      )}

      {/* Series plan CTA */}
      {seriesBlock && (
        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => go('series-page', { seriesName: seriesBlock.name, from: 'book-page', fromLabel: display.t })}
          >
            {t('bookPage.openSeries')}
          </button>
          <button
            className="li-action success"
            onClick={() => go('plan-create', { seriesName: seriesBlock.name })}
          >
            {t('bookModal.createPlan')}
          </button>
        </div>
      )}

      <SimilarBooks similar={similar} />

      <ReportBookForm book={display} />
    </div>
  );
}
