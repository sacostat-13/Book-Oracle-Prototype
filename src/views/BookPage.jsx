// BookPage.jsx — v0.18
// Full book detail page. Reached from BookModal's "See more" link.
// Shares data-fetching logic with BookModal but renders as a full page
// with more room for description, series, and genre detail.

import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { bookKey, findBookByTitle } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary } from '../lib/enrichmentService';
import { fetchSeriesBooks } from '../lib/enrichmentService';
import { fetchCoverURL } from '../lib/coverService';
import { lookupByTitle } from '../lib/bookLookup';
import { purchaseLinks } from '../lib/purchaseLinks';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import BookCover from '../components/BookCover';

export default function BookPage() {
  const {
    state,
    addToWishlist,
    addToReadNext,
    removeFromReadNext,
    markAsRead,
    removeFromLibrary,
    cacheBookFields,
  } = useData();
  const { route, go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';

  // The book is passed via App-level state (route.params.bookKey) and resolved
  // from wishlist + library + readNext. This avoids encoding large objects in URLs.
  const bookKey_ = route.params?.bookKey;
  const from = route.params?.from || 'dashboard';
  const fromLabel = route.params?.fromLabel || 'Dashboard';

  const [book, setBook] = useState(null);
  const [enrichment, setEnrichment] = useState(null);
  const [enrichedOverlay, setEnrichedOverlay] = useState({});
  const [seriesBooks, setSeriesBooks] = useState([]);
  const [seriesDescription, setSeriesDescription] = useState(null);
  const [notFound, setNotFound] = useState(false);

  // Resolve book from all known sources
  useEffect(() => {
    if (!bookKey_) { setNotFound(true); return; }
    const sources = [...state.wishlist, ...state.library, ...state.readNext];
    const found = sources.find((b) => bookKey(b) === bookKey_);
    if (found) {
      setBook(found);
    } else {
      setNotFound(true);
    }
  }, [bookKey_, state.wishlist, state.library, state.readNext]);

  // Enrichment — same logic as BookModal
  useEffect(() => {
    if (!book) return;
    let cancelled = false;

    enrichBookFromOpenLibrary(book.t, book.a).then((d) => {
      if (!cancelled) setEnrichment(d);
    });

    const needsCover = !book.coverUrl;
    const needsPages = !book.pp;
    const needsDescription = !book.d;

    if (!needsCover && !needsPages && !needsDescription) return;

    async function run() {
      const patch = {};
      if (needsCover) {
        const coverUrl = await fetchCoverURL(book.t, book.a);
        if (cancelled) return;
        if (coverUrl) patch.coverUrl = coverUrl;
      }
      if (needsPages || needsDescription) {
        const found = await lookupByTitle(book.t, book.a);
        if (cancelled) return;
        if (found) {
          if (needsPages && found.pp) patch.pp = found.pp;
          if (needsDescription && found.d) patch.d = found.d;
          if (!book.isbn && found.isbn) patch.isbn = found.isbn;
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
  }, [book, cacheBookFields]);

  // Series fetch
  useEffect(() => {
    const seriesName = book?.s?.name || enrichment?.series?.name;
    if (!seriesName) return;
    let cancelled = false;
    fetchSeriesBooks(seriesName).then((b) => {
      if (!cancelled) setSeriesBooks(b);
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
          {isSpanish ? 'Libro no encontrado' : 'Book not found'}
        </div>
        <div className="empty-state-text">
          {isSpanish
            ? 'Este libro no está en tu lista, biblioteca o cola de lectura.'
            : 'This book isn\'t in your wishlist, library, or read queue.'}
        </div>
        <button className="btn" style={{ marginTop: '1.5rem' }} onClick={() => go(from)}>
          {isSpanish ? '← Volver' : '← Back'}
        </button>
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
            {display.pp && <span className="level-pill">📄 {display.pp} {isSpanish ? 'páginas' : 'pages'}</span>}
            {display.c && <span className="level-pill">prose {'●'.repeat(display.c)}{'○'.repeat(5 - display.c)}</span>}
            {display.p && <span className="level-pill">depth {'●'.repeat(display.p)}{'○'.repeat(5 - display.p)}</span>}
            {(display.status === 'verified' || display.status === 'oracle_categorized') && (
              <span className="level-pill" style={{ background: 'rgba(176, 140, 63, 0.18)', borderColor: 'var(--gilt)', color: 'var(--gilt-bright)' }}
                title="Curated · verified by our editors">
                ☩ {isSpanish ? 'Verificado' : 'Verified'}
              </span>
            )}
            {inLib && (
              <span className="level-pill" style={{ background: 'var(--moss)', color: 'var(--paper)', borderColor: 'var(--moss)' }}>
                ✓ {isSpanish ? 'Leído' : 'Read'}
              </span>
            )}
            {inWish && !inLib && (
              <span className="level-pill">
                {isSpanish ? 'En tu lista' : 'In wishlist'}
              </span>
            )}
            {inNext && (
              <span className="level-pill">
                {isSpanish ? 'En tu cola' : 'In Read Next'}
              </span>
            )}
          </div>

          {/* Series */}
          {seriesBlock && (
            <div className="book-page-series">
              <div className="book-page-series-label">
                {isSpanish ? 'PARTE DE UNA SERIE' : 'PART OF A SERIES'}
              </div>
              <div className="series-name">{seriesBlock.name}</div>
              <div className="series-progress">
                {seriesBlock.dots}
                <span className="series-progress-text">
                  {seriesBlock.readCount}/{seriesBlock.totalBooks} {isSpanish ? 'leídos' : 'read'}
                </span>
              </div>
              {seriesDescription && (
                <p className="book-page-series-desc">{seriesDescription.description}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="book-page-actions">
            {inLib ? (
              <button className="btn btn-ghost" onClick={() => removeFromLibrary(display)}>
                {isSpanish ? 'Quitar de la biblioteca' : 'Remove from library'}
              </button>
            ) : inNext ? (
              <>
                <button className="btn" onClick={() => markAsRead(display)}>
                  ✓ {isSpanish ? 'Marcar como leído' : 'Mark as read'}
                </button>
                <button className="btn btn-ghost" onClick={() => removeFromReadNext(display)}>
                  {isSpanish ? 'Quitar de la cola' : 'Remove from queue'}
                </button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => addToReadNext(display)}>
                  + {isSpanish ? 'Agregar a la cola' : 'Add to Read Next'}
                </button>
                {!inWish && (
                  <button className="btn btn-gilt" onClick={() => addToWishlist(display)}>
                    + {isSpanish ? 'Agregar a la lista' : 'Add to Wishlist'}
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => markAsRead(display)}>
                  ✓ {isSpanish ? 'Marcar como leído' : 'Mark as read'}
                </button>
              </>
            )}
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
            {isSpanish ? 'Descripción' : 'Description'}
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
        <div style={{ marginTop: '2rem' }}>
          <button
            className="li-action success"
            onClick={() => go('plan-create', { seriesName: seriesBlock.name })}
          >
            ✦ {isSpanish ? 'Crear un plan para terminar esta serie' : 'Create a plan to finish this series'}
          </button>
        </div>
      )}
    </div>
  );
}
