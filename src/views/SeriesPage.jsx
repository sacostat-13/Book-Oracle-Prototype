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
import { useRouter, RouteLink } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useDocumentMeta } from '../lib/useDocumentMeta';
import { bookKey, buildBookPageParams } from '../lib/bookHelpers';
import { fetchSeriesBooks } from '../lib/enrichmentService';
import { fetchSeriesDescriptionFromWikipedia, fetchBooksInSeriesByName, normalizeSeriesName } from '../lib/seriesService';
import BookCover from '../components/BookCover';
import { openBookTab } from '../lib/bookHelpers';

// isAuthed/authPending/dataReady mirror BookPage and ListView. This route is
// in App.jsx's PUBLIC_ROUTES as of 2026-08-24 — before that every /series/ URL
// in the sitemap led a visitor from Google straight into the sign-in gate.
export default function SeriesPage({ isAuthed = true, authPending = false, dataReady = true }) {
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
  // Whether the list came from our own catalog. A catalog list is authoritative
  // — it was reached through series_id, not a name match — so it skips the
  // name-corroboration guard below that exists to catch upstream mismatches.
  const [fromCatalog,    setFromCatalog]    = useState(false);

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

    // CATALOG FIRST, upstream only as a top-up.
    //
    // Until 2026-08-24 this called fetchSeriesBooks() — Hardcover, then
    // OpenLibrary — and never touched the catalog, while og-prerender.js served
    // crawlers a list built from books.position_in_series. Two sources behind
    // one URL is a cloaking exposure, and it is also just wrong: the ordering
    // Google indexed was not the ordering a reader saw.
    //
    // Upstream still runs when the catalog holds 0 or 1 book for the series, so
    // a thin series is still padded rather than looking broken. It cannot
    // OVERWRITE a real catalog list.
    (async () => {
      let catalogBooks = [];
      try {
        const res = await fetchBooksInSeriesByName(seriesName);
        catalogBooks = res.books || [];
      } catch { /* fall through to upstream */ }
      if (cancelled) return;

      if (catalogBooks.length > 1) {
        setSeriesBooks(catalogBooks);
        setFromCatalog(true);
        setLoading(false);
      } else {
        let upstream = [];
        try { upstream = await fetchSeriesBooks(seriesName) || []; } catch { /* keep catalog */ }
        if (cancelled) return;
        const useUpstream = upstream.length > catalogBooks.length;
        setSeriesBooks(useUpstream ? upstream : catalogBooks);
        setFromCatalog(!useUpstream && catalogBooks.length > 0);
        setLoading(false);
      }

      // Wikipedia description. The author used to come only from the reader's
      // own shelves, which are EMPTY for a signed-out visitor — so the one
      // visitor this page now exists for got the least corroborated lookup.
      // Prefer the catalog's own author and fall back to the shelves.
      const shelfAuthor = [...state.library, ...state.wishlist, ...state.readNext]
        .find((b) => b.s?.name === seriesName)?.a;
      const author = catalogBooks[0]?.a || shelfAuthor;
      try {
        const d = await fetchSeriesDescriptionFromWikipedia(seriesName, author);
        if (!cancelled && d) setDescription(d);
      } catch { /* description is optional */ }
    })();

    return () => { cancelled = true; };
    // The three shelves are read once, only to find an author to hand to
    // Wikipedia. Listing them would re-fetch the series and its description
    // every time any book anywhere in the collection changed — a network call
    // per shelf mutation, to arrive at the same answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    //
    // Two fixes, 2026-08-24:
    //  1. A CATALOG list is exempt. It was reached via series_id, so a name
    //     comparison can only lose — the canonical series.name may legitimately
    //     differ from the name in the URL.
    //  2. The local normalize() is gone in favour of normalizeSeriesName(),
    //     which is the one the SQL side uses. The local copy did NOT strip a
    //     leading "the ", so "The Godfather" failed a check "Godfather" passed
    //     — and a failed check discards the ENTIRE list, leaving only the
    //     reader's own shelf books. Signed out, that is an empty page.
    const fetchedSeriesName = seriesBooks[0]?.s?.name;
    const validSeriesBooks = fromCatalog
      ? seriesBooks
      : (fetchedSeriesName &&
         normalizeSeriesName(fetchedSeriesName) === normalizeSeriesName(seriesName)
          ? seriesBooks
          : []);

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

    // `??`, not `||`. Position 0 is the prequel numbering convention (book 0
    // of a series), and `0 || 999` sends it to the BOTTOM of a list whose
    // entire purpose is reading order -- the one ordering error a reader
    // reads as the page being broken.
    return merged.sort((a, b) => (a.s?.n ?? 999) - (b.s?.n ?? 999));
  }, [seriesBooks, fromCatalog, state.library, state.wishlist, state.readNext, seriesName]);

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

        {/* Progress bar — personal, so only for a signed-in reader. "0 of 7"
            read is not a fact about the series. */}
        {isAuthed && total && total > 0 && (
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
          {authPending ? null : !isAuthed ? (
            // Same shape as BookPage's action block: the page is fully readable
            // signed out, and the only thing behind the wall is DOING something
            // with it.
            <a href={window.location.pathname} className="btn-primary">
              {t('bookPage.signInToAdd')}
            </a>
          ) : (
          <button
            className="btn-primary"
            onClick={() => go('plan-create', { seriesName, from: 'series-page', fromLabel: seriesName })}
          >
            {t('seriesPage.createPlan')}
          </button>
          )}
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
                  <RouteLink
                    className="series-page-book-title"
                    to="book-page"
                    params={{ bookKey: bookKey(b) }}
                    navParams={buildBookPageParams(b, 'series-page', seriesName)}
                  >
                    {b.t}
                  </RouteLink>
                  {b.pp && (
                    <div className="series-page-book-pages">
                      {b.pp} {t('profile.statPages')}
                    </div>
                  )}

                  {/* Status badge + actions */}
                  <div className="series-page-book-actions">
                    {isAuthed && dataReady && status === 'read' && (
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
                    {isAuthed && dataReady && status === 'queued' && (
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
                    {isAuthed && dataReady && status === 'wishlisted' && (
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
                    {isAuthed && dataReady && status === 'none' && (
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
