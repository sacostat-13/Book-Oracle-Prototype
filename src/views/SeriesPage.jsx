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
import { useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { bookKey, buildBookPageParams } from '../lib/bookHelpers';
import { fetchSeriesBooks } from '../lib/enrichmentService';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import BookCover from '../components/BookCover';
import { openBookTab } from '../lib/bookHelpers';

export default function SeriesPage() {
  const { state, addToWishlist, addToReadNext, markAsRead, removeFromLibrary } = useData();
  const { route, go } = useRouter();
  const t = useT();

  const seriesName = route.params?.seriesName;
  const from      = route.params?.from      || 'dashboard';
  const fromLabel = route.params?.fromLabel || (t('about.featureDashboardTitle'));

  const [seriesBooks,    setSeriesBooks]    = useState([]);
  const [description,    setDescription]    = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [actionLoading,  setActionLoading]  = useState(null); // bookKey being actioned

  // v0.39: SEO/share title+description for this series. Not set in App.jsx's
  // generic route-title effect — this is the only place this page's title
  // /description gets set.
  useDocumentMeta({
    title: seriesName ? `${seriesName} series — The Books Oracle` : 'Series — The Books Oracle',
    description: description ? description.slice(0, 200) : undefined,
  });

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

    // Validate fetched books actually belong to this series.
    // Hardcover search can match a different series with a similar name.
    const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fetchedSeriesName = seriesBooks[0]?.s?.name;
    const validSeriesBooks = fetchedSeriesName &&
      normalize(fetchedSeriesName) === normalize(seriesName)
      ? seriesBooks
      : [];

    // Start from fetched (ordered) list
    for (const b of validSeriesBooks) {
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
      <div className="empty-state lv-empty">
        <div className="ornament">❦</div>
        <div className="empty-state-title">{t('seriesPage.notFound')}</div>
        <button className="btn-primary" onClick={() => go(from)}>{t('onboarding.back')}</button>
      </div>
    );
  }

  return (
    <div className="series-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <a onClick={() => go(from)}>{fromLabel}</a>
        {' · '}
        <span className="lv-hl-muted">{seriesName}</span>
      </div>

      {/* Hero */}
      <div className="series-page-hero">
        <div className="page-head__eyebrow">
          {t('seriesPage.seriesLabel')}
          {publicationStatus === 'ongoing' && (
            <span className="series-page-status-pill series-page-status-ongoing">
              {t('seriesPage.statusOngoing')}
            </span>
          )}
          {publicationStatus === 'complete' && (
            <span className="series-page-status-pill series-page-status-complete">
              {t('seriesPage.statusComplete')}
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
                style={{ '--sp-pct': `${progressPct}%` }}
              />
            </div>
            <div className="series-page-progress-label">
              {t('seriesPage.readCount', { read: readCount, total })}
              {queuedCount > 0 && (
                <span className="lv-hl-muted">
                  · {t('seriesPage.queued', { count: queuedCount })}
                </span>
              )}
              {readCount === total && (
                <span className="sp-read-label">
                  {t('seriesPage.finished')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* CTAs */}
        <div className="series-page-ctas">
          <button
            className="btn-primary"
            onClick={() => go('plan-create', { seriesName, from: 'series-page', fromLabel: seriesName })}
          >
            {t('seriesPage.createPlan')}
          </button>
          {readCount === 0 && entries.length > 0 && (
            <button
              className="btn-primary"
              onClick={() => handleAction(entries[0], 'wishlist')}
              disabled={actionLoading === bookKey(entries[0])}
            >
              {t('seriesPage.addFirstBook')}
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      {description?.description && (
        <div className="series-page-description">
          <div className="bp-section__label">
            {t('seriesPage.about')}
            {description.wikipediaUrl && (
              <>
                {' · '}
                <a
                  href={description.wikipediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sp-purchase-link"
                >
                  wikipedia ↗
                </a>
              </>
            )}
          </div>
          <p >
            {description.description}
          </p>
        </div>
      )}

      {/* Books */}
      <div className="series-page-books">
        <div className="bp-section__label">
          {t('seriesPage.booksInSeries')}
          {total && <span className="lv-hl-muted">· {total}</span>}
        </div>

        {loading && (
          <div className="loading">
            <div className="loading-spinner" />
            <div className="loading-text">{t('common.loading')}</div>
          </div>
        )}

        {!loading && entries.length === 0 && (
          <p >
            {t('seriesPage.noBooks')}
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
                  
                >
                  <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                  {status === 'read' && (
                    <div className="series-page-book-read-badge">✓</div>
                  )}
                </div>

                {/* Info */}
                <div className="series-page-book-info">
                  <div className="series-page-book-position">
                    {position ? t('seriesPage.bookN', { n: position }) : '—'}
                  </div>
                  <div
                    className="series-page-book-title"
                    onClick={() => go('book-page', buildBookPageParams(b, 'series-page', seriesName))}
                    
                  >
                    {b.t}
                  </div>
                  {b.pp && (
                    <div className="series-page-book-pages">
                      {b.pp} {t('profile.statPages')}
                    </div>
                  )}

                  {/* Status badge + actions */}
                  <div className="series-page-book-actions">
                    {status === 'read' && (
                      <>
                        <span className="series-page-book-badge series-page-book-badge--read">
                          {b.dateRead
                            ? new Date(b.dateRead).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                            : (t('navSearch.statusRead'))}
                        </span>
                        <button
                          className="li-action danger"
                          onClick={() => handleAction(b, 'remove')}
                          disabled={isActioning}
                        >
                          {t('common.remove')}
                        </button>
                      </>
                    )}
                    {status === 'queued' && (
                      <>
                        <span className="series-page-book-badge series-page-book-badge--queued">
                          {t('navSearch.statusQueued')}
                        </span>
                        <button
                          className="li-action success"
                          onClick={() => handleAction(b, 'read')}
                          disabled={isActioning}
                        >
                          {t('bookPage.markAsRead')}
                        </button>
                      </>
                    )}
                    {status === 'wishlisted' && (
                      <>
                        <span className="series-page-book-badge series-page-book-badge--wishlist">
                          {t('seriesPage.wishlisted')}
                        </span>
                        <button
                          className="li-action"
                          onClick={() => handleAction(b, 'queue')}
                          disabled={isActioning}
                        >
                          + {t('readNext.eyebrow')}
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
                          + {t('navSearch.statusWishlist')}
                        </button>
                        <button
                          className="li-action success"
                          onClick={() => handleAction(b, 'read')}
                          disabled={isActioning}
                        >
                          ✓ {t('navSearch.statusRead')}
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
