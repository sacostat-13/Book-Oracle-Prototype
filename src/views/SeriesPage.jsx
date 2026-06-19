// SeriesPage.jsx — v0.24
// Dedicated series page. Entry points:
//   - BookModal series section "View series" link
//   - BookPage series block
//   - Profile stats "Series in progress" cards
//   - Reading Plans after plan creation
//
// Data sources:
//   - User's collection (state) for read/wishlist/queue status
//   - fetchSeriesBooks (Hardcover → OL) for ordered book list
//   - fetchSeriesDescriptionFromWikipedia for description
//   - Hardcover featured_series for unreleased/upcoming books

import { useEffect, useState, useMemo } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { bookKey } from '../lib/bookHelpers';
import { fetchSeriesBooks } from '../lib/enrichmentService';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import BookCover from '../components/BookCover';
import { openBookTab } from '../lib/bookHelpers';

export default function SeriesPage() {
  const { state, addToWishlist, addToReadNext, markAsRead, removeFromLibrary } = useData();
  const { route, go } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';

  const seriesName = route.params?.seriesName;
  const from      = route.params?.from      || 'dashboard';
  const fromLabel = route.params?.fromLabel || (isSpanish ? 'Dashboard' : 'Dashboard');

  const [seriesBooks,    setSeriesBooks]    = useState([]);
  const [description,    setDescription]    = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [actionLoading,  setActionLoading]  = useState(null); // bookKey being actioned

  // ── Fetch series data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!seriesName) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    // Series books
    fetchSeriesBooks(seriesName).then((books) => {
      if (!cancelled) {
        setSeriesBooks(books);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });

    // Wikipedia description (author from first collection book with this series)
    const authorBook = [...state.library, ...state.wishlist, ...state.readNext]
      .find((b) => b.s?.name === seriesName);
    fetchSeriesDescriptionFromWikipedia(seriesName, authorBook?.a).then((d) => {
      if (!cancelled && d) setDescription(d);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [seriesName]);

  // ── Build merged ordered entry list ────────────────────────────────────────
  // Merge fetched books with collection books so every entry has status info.
  const entries = useMemo(() => {
    const collectionBooks = [...state.wishlist, ...state.library, ...state.readNext]
      .filter((b) => b.s?.name === seriesName);

    const seen = new Set();
    const merged = [];

    // Start from fetched (ordered) list
    for (const b of seriesBooks) {
      const k = bookKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      // Overlay collection data if present
      const coll = collectionBooks.find((c) => bookKey(c) === k);
      merged.push(coll ? { ...b, ...coll, s: b.s } : b);
    }
    // Add collection books not in fetched list
    for (const b of collectionBooks) {
      const k = bookKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(b);
    }

    return merged.sort((a, b) => (a.s?.n || 999) - (b.s?.n || 999));
  }, [seriesBooks, state.library, state.wishlist, state.readNext, seriesName]);

  // ── Series metadata ─────────────────────────────────────────────────────────
  const firstBook = entries[0];
  const author    = firstBook?.a || '';
  const total     = entries[0]?.s?.total || entries.length || null;
  const publicationStatus = [...state.library, ...state.wishlist]
    .find((b) => b.s?.name === seriesName)?.s?.publicationStatus || 'unknown';

  const readCount   = entries.filter((b) => state.library.some((l) => bookKey(l) === bookKey(b))).length;
  const queuedCount = entries.filter((b) => state.readNext.some((l) => bookKey(l) === bookKey(b))).length;

  const progressPct = total ? Math.round((readCount / total) * 100) : 0;

  // ── Status for a single book ─────────────────────────────────────────────────
  function bookStatus(b) {
    const k = bookKey(b);
    if (state.library.some((l)  => bookKey(l) === k)) return 'read';
    if (state.readNext.some((l) => bookKey(l) === k)) return 'queued';
    if (state.wishlist.some((l) => bookKey(l) === k)) return 'wishlisted';
    return 'none';
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function handleAction(b, action) {
    const k = bookKey(b);
    setActionLoading(k);
    try {
      if (action === 'wishlist') await addToWishlist(b);
      if (action === 'queue')    await addToReadNext(b);
      if (action === 'read')     await markAsRead(b);
      if (action === 'remove')   await removeFromLibrary(b);
    } finally {
      setActionLoading(null);
    }
  }

  // ── Guard ────────────────────────────────────────────────────────────────────
  if (!seriesName) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="ornament">❦</div>
        <div className="empty-state-title">{isSpanish ? 'Saga no encontrada' : 'Series not found'}</div>
        <button className="btn" style={{ marginTop: '1.5rem' }} onClick={() => go(from)}>{isSpanish ? '← Volver' : '← Back'}</button>
      </div>
    );
  }

  return (
    <div className="series-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => go(from)}>{fromLabel}</a>
        {' · '}
        <span style={{ opacity: 0.6 }}>{seriesName}</span>
      </div>

      {/* Hero */}
      <div className="series-page-hero">
        <div className="page-eyebrow">
          {isSpanish ? 'SAGA' : 'SERIES'}
          {publicationStatus === 'ongoing' && (
            <span className="series-page-status-pill series-page-status-ongoing">
              {isSpanish ? 'En curso' : 'Ongoing'}
            </span>
          )}
          {publicationStatus === 'complete' && (
            <span className="series-page-status-pill series-page-status-complete">
              {isSpanish ? 'Completa' : 'Complete'}
            </span>
          )}
        </div>

        <h1 className="series-page-title">{seriesName}</h1>
        {author && <div className="series-page-author">{author}</div>}

        {/* Progress bar */}
        {total && total > 0 && (
          <div className="series-page-progress">
            <div className="series-page-progress-bar">
              <div
                className="series-page-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="series-page-progress-label">
              {readCount} {isSpanish ? 'de' : 'of'} {total} {isSpanish ? 'leídos' : 'read'}
              {queuedCount > 0 && (
                <span style={{ opacity: 0.6, marginLeft: '0.6rem' }}>
                  · {queuedCount} {isSpanish ? 'en cola' : 'queued'}
                </span>
              )}
              {readCount === total && (
                <span style={{ color: 'var(--moss)', marginLeft: '0.6rem' }}>
                  ✓ {isSpanish ? '¡Completa!' : 'Finished!'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* CTAs */}
        <div className="series-page-ctas">
          <button
            className="btn"
            onClick={() => go('plan-create', { seriesName, from: 'series-page', fromLabel: seriesName })}
          >
            ✦ {isSpanish ? 'Crear plan de lectura' : 'Create reading plan'}
          </button>
          {readCount === 0 && entries.length > 0 && (
            <button
              className="btn btn-gilt"
              onClick={() => handleAction(entries[0], 'wishlist')}
              disabled={actionLoading === bookKey(entries[0])}
            >
              + {isSpanish ? 'Agregar libro 1 a la lista' : 'Add book 1 to wishlist'}
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      {description?.description && (
        <div className="series-page-description">
          <div className="book-modal-section-title">
            {isSpanish ? 'Sobre esta saga' : 'About this series'}
            {description.wikipediaUrl && (
              <>
                {' · '}
                <a
                  href={description.wikipediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--paper-aged)', opacity: 0.6, fontSize: '0.65rem', textDecoration: 'none', borderBottom: '1px dotted rgba(176,140,63,0.3)' }}
                >
                  wikipedia ↗
                </a>
              </>
            )}
          </div>
          <p style={{ color: 'var(--paper-aged)', lineHeight: 1.75, fontSize: '1.05rem', fontFamily: "'EB Garamond', serif", maxWidth: '680px' }}>
            {description.description}
          </p>
        </div>
      )}

      {/* Books */}
      <div className="series-page-books">
        <div className="book-modal-section-title">
          {isSpanish ? 'Libros de la saga' : 'Books in the series'}
          {total && <span style={{ opacity: 0.5, marginLeft: '0.4rem' }}>· {total}</span>}
        </div>

        {loading && (
          <div className="loading" style={{ padding: '2rem' }}>
            <div className="loading-spinner" />
            <div className="loading-text">{isSpanish ? 'Cargando…' : 'Loading…'}</div>
          </div>
        )}

        {!loading && entries.length === 0 && (
          <p style={{ color: 'var(--paper-aged)', opacity: 0.6, fontStyle: 'italic' }}>
            {isSpanish ? 'No se encontraron libros para esta saga.' : 'No books found for this series.'}
          </p>
        )}

        <div className="series-page-book-list">
          {entries.map((b) => {
            const k = bookKey(b);
            const status = bookStatus(b);
            const isActioning = actionLoading === k;
            const position = b.s?.n;

            return (
              <div key={k} className={`series-page-book ${status}`}>
                {/* Cover */}
                <div
                  className="series-page-book-cover"
                  onClick={() => openBookTab(b, 'series-page')}
                  style={{ cursor: 'pointer' }}
                >
                  <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                  {status === 'read' && (
                    <div className="series-page-book-read-badge">✓</div>
                  )}
                </div>

                {/* Info */}
                <div className="series-page-book-info">
                  <div className="series-page-book-position">
                    {position ? `${isSpanish ? 'Libro' : 'Book'} ${position}` : '—'}
                  </div>
                  <div
                    className="series-page-book-title"
                    onClick={() => go('book-page', { bookKey: k, from: 'series-page', fromLabel: seriesName })}
                    style={{ cursor: 'pointer' }}
                  >
                    {b.t}
                  </div>
                  {b.pp && (
                    <div className="series-page-book-pages">
                      {b.pp} {isSpanish ? 'páginas' : 'pages'}
                    </div>
                  )}

                  {/* Status badge + actions */}
                  <div className="series-page-book-actions">
                    {status === 'read' && (
                      <>
                        <span className="series-page-book-badge series-page-book-badge--read">
                          {b.dateRead
                            ? new Date(b.dateRead).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                            : (isSpanish ? 'Leído' : 'Read')}
                        </span>
                        <button
                          className="li-action danger"
                          onClick={() => handleAction(b, 'remove')}
                          disabled={isActioning}
                        >
                          {isSpanish ? 'Quitar' : 'Remove'}
                        </button>
                      </>
                    )}
                    {status === 'queued' && (
                      <>
                        <span className="series-page-book-badge series-page-book-badge--queued">
                          {isSpanish ? 'En cola' : 'Queued'}
                        </span>
                        <button
                          className="li-action success"
                          onClick={() => handleAction(b, 'read')}
                          disabled={isActioning}
                        >
                          ✓ {isSpanish ? 'Marcar como leído' : 'Mark as read'}
                        </button>
                      </>
                    )}
                    {status === 'wishlisted' && (
                      <>
                        <span className="series-page-book-badge series-page-book-badge--wishlist">
                          {isSpanish ? 'En lista' : 'Wishlisted'}
                        </span>
                        <button
                          className="li-action"
                          onClick={() => handleAction(b, 'queue')}
                          disabled={isActioning}
                        >
                          + {isSpanish ? 'Cola' : 'Queue'}
                        </button>
                      </>
                    )}
                    {status === 'none' && (
                      <>
                        <button
                          className="li-action"
                          onClick={() => handleAction(b, 'wishlist')}
                          disabled={isActioning}
                        >
                          + {isSpanish ? 'Lista' : 'Wishlist'}
                        </button>
                        <button
                          className="li-action success"
                          onClick={() => handleAction(b, 'read')}
                          disabled={isActioning}
                        >
                          ✓ {isSpanish ? 'Leído' : 'Read'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
