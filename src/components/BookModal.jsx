import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import ReportBookForm from './ReportBookForm';
import { useT } from '../lib/I18nContext';
import { ALL_BOOKS, bookKey, findBookByTitle } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import { lookupByTitle } from '../lib/bookLookup';
import { hardcoverGetBook } from '../lib/hardcoverService';
import { fetchCoverURL } from '../lib/coverService';
import { purchaseLinks } from '../lib/purchaseLinks';
import { fetchSeriesDescriptionFromWikipedia } from '../lib/seriesService';
import BookCover from './BookCover';
import RatingModal from './RatingModal';
import CategoryAutocomplete from './CategoryAutocomplete';

function computeSimilarBooks(book, limit = 4) {
  const candidates = ALL_BOOKS.filter((c) => bookKey(c) !== bookKey(book));
  const scored = candidates
    .map((c) => {
      let score = 0;
      if (book.g && c.g === book.g) score += 3;
      if (book.c && c.c && Math.abs(c.c - book.c) <= 1) score += 2;
      if (book.p && c.p && Math.abs(c.p - book.p) <= 1) score += 1;
      if (book.a && c.a && c.a === book.a) score += 1;
      return { book: c, score };
    })
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.book);
}

export default function BookModal({ book, onClose, onOpenBook }) {
  const {
    state,
    addToReadNext,
    removeFromReadNext,
    markAsRead,
    removeFromLibrary,
    addToWishlist,
    cacheBookFields,
    updateReadBook,
    // v0.12
    getCategoriesForBook,
    removeCategoryFromBook
  } = useData();
  const { go } = useRouter();
  const t = useT();

  const [enrichment, setEnrichment] = useState(null);
  const [seriesBooks, setSeriesBooks] = useState([]);
  // v0.12: Wikipedia-sourced series description, when available
  const [seriesDescription, setSeriesDescription] = useState(null);
  const [enrichedOverlay, setEnrichedOverlay] = useState({});
  const [ratingEditorOpen, setRatingEditorOpen] = useState(false);
  // v0.12: track which category is being removed for an inline confirm/spinner
  const [pendingRemoveId, setPendingRemoveId] = useState(null);
  // Toggle the add-category input visibility (off by default so the section
  // doesn't feel cluttered).
  const [adderOpen, setAdderOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;

    async function runEnrichment() {
      const needsCover = !book.coverUrl;
      const needsPages = !book.pp;
      const needsDescription = !book.d;
      const needsSeries = !book.s;

      enrichBookFromOpenLibrary(book.t, book.a).then((d) => {
        if (!cancelled) setEnrichment(d);
      });

      if (!needsCover && !needsPages && !needsDescription && !needsSeries) return;

      const patch = {};

      if (needsCover) {
        const coverUrl = await fetchCoverURL(book.t, book.a);
        if (cancelled) return;
        if (coverUrl) patch.coverUrl = coverUrl;
      }

      // Fast path: if we have a hardcoverId and need a description,
      // fetch the full record directly -- reliable for books added before
      // descriptions were being stored.
      if (needsDescription && book.hardcoverId) {
        const full = await hardcoverGetBook(book.hardcoverId);
        if (cancelled) return;
        if (full?.d) patch.d = full.d;
        if (needsPages && full?.pp) patch.pp = full.pp;
        if (!book.isbn && full?.isbn) patch.isbn = full.isbn;
      }

      // Fall back to full lookup chain for anything still missing
      const stillNeedsPages = needsPages && !patch.pp;
      const stillNeedsDescription = needsDescription && !patch.d;
      if (stillNeedsPages || stillNeedsDescription) {
        const found = await lookupByTitle(book.t, book.a);
        if (cancelled) return;
        if (found) {
          if (stillNeedsPages && found.pp) patch.pp = found.pp;
          if (stillNeedsDescription && found.d) patch.d = found.d;
          if (!book.isbn && !patch.isbn && found.isbn) patch.isbn = found.isbn;
          if (!book.hardcoverId && found.hardcoverId) patch.hardcoverId = found.hardcoverId;
          if (found.wikipediaUrl) patch.wikipediaUrl = found.wikipediaUrl;
          if (found.wikipediaLang) patch.wikipediaLang = found.wikipediaLang;
          if (found.descriptionSource) patch.descriptionSource = found.descriptionSource;
        }
      }

      if (Object.keys(patch).length === 0) return;
      setEnrichedOverlay((cur) => ({ ...cur, ...patch }));
      cacheBookFields?.(book, patch);
    }

    runEnrichment();
    return () => {
      cancelled = true;
    };
  }, [book, cacheBookFields]);

  useEffect(() => {
    const seriesName = book?.s?.name || enrichment?.series?.name;
    if (!seriesName) return;
    let cancelled = false;
    fetchSeriesBooks(seriesName).then((b) => {
      if (!cancelled) setSeriesBooks(b);
    });
    // v0.12: parallel Wikipedia series description fetch. Author hint
    // improves disambiguation a lot — if the book has an author and the
    // series article mentions them, the score boost is significant.
    fetchSeriesDescriptionFromWikipedia(seriesName, book?.a).then((d) => {
      if (!cancelled && d) setSeriesDescription(d);
    });
    return () => {
      cancelled = true;
    };
  }, [book, enrichment]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !ratingEditorOpen) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, ratingEditorOpen]);

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
  const similar = computeSimilarBooks(display, 4);

  const libraryRow = inLib
    ? state.library.find((b) => bookKey(b) === k)
    : null;
  const liveRating = libraryRow?.rating ?? display.rating ?? null;
  const liveNotes = libraryRow?.notes ?? null;

  // v0.12: live categories from DataContext. The list is already sorted
  // verified-first then alphabetical (see rollupCategories in DataContext).
  // Pass the book object so the lookup works for both bookId (server) and
  // synthetic guest keys.
  const categories = getCategoriesForBook(display);
  const existingCategoryIds = new Set(categories.map((c) => c.categoryId));
  const atCategoryCap = categories.length >= 10;
  const canAddCategories = !!display.bookId || !state.profile.displayName;
  // For guest mode we still allow tagging (it lives locally). The check
  // above is true when there's a bookId OR when no user is signed in (guest).
  // Future: tighten this if we change guest behavior.

  // Series block (unchanged from v0.11)
  let seriesBlock = null;
  if (display.s && display.s.name) {
    const seriesName = display.s.name;
    const sources = [...ALL_BOOKS, ...state.wishlist, ...state.library, ...state.readNext];
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
    // Read primary_books_count from the fetched series entries (always set by
    // hardcoverFetchSeriesBooks). Fall back to display.s.total (DB stored value).
    // Never derive the total from entry counts or position numbers: Hardcover
    // numbers novellas and short stories too, so those are always inflated.
    const totalFromSeriesFetch = seriesBooks.length > 0
      ? (seriesBooks.find((b) => b.s?.total)?.s?.total || null)
      : null;
    const totalBooks =
      totalFromSeriesFetch ||
      display.s.total ||
      totalKnown ||
      1;
    const readCount = entries.filter((e) => state.library.some((l) => bookKey(l) === bookKey(e))).length;

    const dots = [];
    for (let i = 1; i <= totalBooks; i++) {
      const entry = entries.find((e) => e.s?.n === i);
      if (entry) {
        const isCurrent = bookKey(entry) === bookKey(display);
        const read = state.library.some((l) => bookKey(l) === bookKey(entry));
        const queued = state.readNext.some((l) => bookKey(l) === bookKey(entry));
        const cls = isCurrent ? 'current' : read ? 'read' : queued ? 'queued' : '';
        dots.push(
          <div
            key={i}
            className={`series-dot ${cls}`}
            title={`${entry.t}${read ? ' — read' : queued ? ' — queued' : ''}`}
            onClick={() => isCurrent ? null : onOpenBook?.(entry)}
            
          >
            {i}
          </div>
        );
      } else {
        dots.push(
          <div key={i} className="series-dot" title={`Book ${i} (not in your wishlist)`}>
            {i}
          </div>
        );
      }
    }

    // v0.15: derive UI verified-ness from status. Both 'verified' and
    // 'oracle_categorized' count as verified for display.
    const seriesIsVerified = display.s.status === 'verified' || display.s.status === 'oracle_categorized';
    const seriesNeedsReview = display.s.status === 'incomplete' ||
                               (display.s.status === 'unreviewed' && !!display.s.seriesId);

    let sourceLabel;
    if (seriesIsVerified) sourceLabel = 'verified';
    else if (seriesNeedsReview) sourceLabel = 'needs review';
    else if (display.s.fromHardcover) sourceLabel = 'from Hardcover · unsaved';
    else if (display.s.fromOpenLibrary) sourceLabel = 'from Open Library · unsaved';
    else sourceLabel = 'unverified';

    seriesBlock = {
      name: seriesName,
      sourceLabel,
      verified: seriesIsVerified,
      needsReview: seriesNeedsReview,
      dots,
      readCount,
      totalBooks,
      totalKnown,
    };
  }

  async function handleSaveRating({ rating, notes, readAt }) {
    if (!libraryRow) return;
    await updateReadBook(libraryRow, { rating, notes, readAt });
    setRatingEditorOpen(false);
  }

  async function handleRemoveCategory(categoryId) {
    setPendingRemoveId(categoryId);
    await removeCategoryFromBook(display, categoryId);
    setPendingRemoveId(null);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="book-modal">
        <button className="book-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="book-modal-hero">
          <div className="book-modal-cover">
            <BookCover title={display.t} author={display.a} coverUrl={display.coverUrl} eager />
          </div>
          <div className="book-modal-info">
            {(() => {
              const oracleGenres = state.genresByBookId?.[display.bookId];
              const genres = (oracleGenres && oracleGenres.length > 0)
                ? oracleGenres
                : (display.g ? [{ name: display.g, description: null }] : []);
              if (genres.length === 0) return null;
              return (
                <div className="book-modal-genres">
                  {genres.map((g) => (
                    <span key={g.name} className="book-modal-genre" title={g.description || undefined}>
                      {g.name}
                    </span>
                  ))}
                </div>
              );
            })()}
            <h2 className="book-modal-title">{display.t}</h2>
            <div className="book-modal-author">{display.a}</div>
            <button
              className="book-modal-see-more"
              onClick={() => { onClose(); go('book-page', { bookKey: k, from: 'wishlist', fromLabel: t('bookModal.fromWishlist') }); }}
            >
              {t('bookModal.seeMore')}
            </button>
            {liveRating > 0 && (
              <div className="book-modal-rating">
                {'★'.repeat(Math.max(1, Math.min(5, parseInt(liveRating, 10))))}
                <span className="empty-stars">{'★'.repeat(5 - Math.max(1, Math.min(5, parseInt(liveRating, 10))))}</span>
                <span className="rating-label">
                  {display.fromGoodreads && !libraryRow?.rating ? 'Goodreads rating' : 'Your rating'}
                </span>
              </div>
            )}
            <div className="book-modal-meta">
              {display.c && (
                <span className="level-pill">prose {'●'.repeat(display.c)}{'○'.repeat(5 - display.c)}</span>
              )}
              {display.p && (
                <span className="level-pill">depth {'●'.repeat(display.p)}{'○'.repeat(5 - display.p)}</span>
              )}
              {display.pp && <span className="level-pill">📄 {display.pp} pages</span>}
              {(display.status === 'verified' || display.status === 'oracle_categorized') && (
                <span
                  className="level-pill"
                  className="bp-pill bp-pill--ro-gold"
                  title="Curated · verified by our editors"
                >
                  ☩ Verified
                </span>
              )}
              {inLib && (
                <span className="level-pill" className="bp-pill bp-pill--moss">
                  ✓ Read
                </span>
              )}
              {inNext && <span className="level-pill">{t('bookPage.inNext')}</span>}
            </div>
          </div>
        </div>

        <div className="book-modal-body">
          {display.d && (
            <div className="book-modal-section">
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
                      title="Description sourced from Wikipedia"
                    >
                      from wikipedia ↗
                    </a>
                  </>
                )}
              </div>
              <div className="book-modal-description">{display.d}</div>
            </div>
          )}

          {/* v0.12: Categories — live pills with add/remove */}
          <div className="book-modal-section">
            <div
              className="bp-section__head"
            >
              <span>
                {t('bookModal.categories')}
                {categories.length > 0 && (
                  <span className="bp-section__count">
                    · {categories.length}/10
                  </span>
                )}
              </span>
              {canAddCategories && !atCategoryCap && (
                <button
                  className="li-action"
                  onClick={() => setAdderOpen((v) => !v)}
                  
                >
                  {adderOpen
                    ? t('bookModal.done')
                    : t('bookModal.addCategory')}
                </button>
              )}
            </div>

            {categories.length === 0 && !adderOpen ? (
              <div
                className="bp-no-rating"
              >
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
                <div
                  className="bp-cat-help"
                >
                  {t('categories.removeHelp')}
                </div>
              </div>
            )}
          </div>

          {inLib && (
            <div className="book-modal-section">
              <div
                className="book-modal-section-title"
                className="bp-section__head"
              >
                <span>{t('rating.eyebrowEdit')}</span>
                <button
                  className="li-action"
                  onClick={() => setRatingEditorOpen(true)}
                  
                >
                  {liveRating > 0 || liveNotes
                    ? (t('common.edit'))
                    : (t('bookModal.addRating'))}
                </button>
              </div>
              {liveRating > 0 ? (
                <div
                  className="bp-stars"
                >
                  {'★'.repeat(liveRating)}
                  <span className="bp-stars__empty">{'★'.repeat(5 - liveRating)}</span>
                </div>
              ) : (
                !liveNotes && (
                  <div
                    className="bp-no-rating"
                  >
                    {t('bookModal.notRatedYet')}
                  </div>
                )
              )}
              {liveNotes && (
                <div
                  className="bp-notes bp-notes--quote"
                >
                  {liveNotes}
                </div>
              )}
            </div>
          )}

          {seriesBlock && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">
                {t('bookModal.partOfSeries')} ·{' '}
                {seriesBlock.verified ? (
                  <span className="bp-pill bp-pill--ro-gold" style={{ fontSize: "0.65rem" }}>
                    {t('bookModal.seriesVerifiedBadge')}
                  </span>
                ) : seriesBlock.needsReview ? (
                  <span
                    className="t-accent" style={{ fontSize: "0.65rem" }}
                    title="This series is in our catalog but hasn't been editor-verified yet."
                  >
                    {t('bookModal.seriesNeedsReviewBadge')}
                  </span>
                ) : (
                  <span className="lv-hl-muted" style={{ fontSize: "0.65rem" }}>{seriesBlock.sourceLabel}</span>
                )}
              </div>
              <div className="series-name">{seriesBlock.name}</div>
              {/* v0.12: Wikipedia-sourced series description, when available */}
              {seriesDescription && (
                <div
                  className="bp-notes bp-notes--quote"
                >
                  {seriesDescription.description}
                  {seriesDescription.wikipediaUrl && (
                    <>
                      {' '}
                      <a
                        href={seriesDescription.wikipediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bp-wiki-link" style={{ marginLeft: "0.3rem",
                        }}
                        title="From Wikipedia"
                      >
                        wikipedia ↗
                      </a>
                    </>
                  )}
                </div>
              )}
              <div className="series-progress">
                {seriesBlock.dots}
                <span className="series-progress-text">{seriesBlock.readCount}/{seriesBlock.totalBooks} read</span>
              </div>
              <div >
                <button className="li-action success" onClick={() => { onClose(); go('plan-create', { seriesName: seriesBlock.name }); }}>
                  {t('bookModal.createSeriesPlan')}
                </button>
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">{t('bookModal.similarBooks')}</div>
              <div className="similar-mini">
                {similar.map((s, i) => {
                  const sk = bookKey(s);
                  const sRead = state.library.some((l) => bookKey(l) === sk);
                  const sQueued = state.readNext.some((l) => bookKey(l) === sk);
                  return (
                    <div className="similar-mini-item" key={`${sk}-${i}`} onClick={() => onOpenBook?.(s)}>
                      <div>
                        <div className="similar-mini-title">{s.t}</div>
                        <div className="similar-mini-author">{s.a}{s.g ? ` · ${s.g}` : ''}</div>
                      </div>
                      {sRead ? (
                        <span className="sp-read-label" style={{ fontSize: "0.8rem" }}>✓ READ</span>
                      ) : sQueued ? (
                        <span className="lv-hl" style={{ fontSize: "0.8rem" }}>✓ QUEUED</span>
                      ) : (
                        <span className="lv-hl-muted" style={{ fontSize: "0.8rem" }}>→</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="book-modal-purchase">
          <div className="book-modal-purchase-label">{t('bookModal.acquireLabel')}</div>
          <div className="book-modal-purchase-buttons">
            {purchaseLinks(display).map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
                className="bp-link"
                title={link.kind === 'search' ? 'Opens a search — no direct product link available' : null}
              >
                ↗ {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="book-modal-actions">
          {inLib ? (
            <button className="btn btn-ghost" onClick={() => { removeFromLibrary(display); onClose(); }}>
              Remove from library
            </button>
          ) : inNext ? (
            <>
              <button className="btn" onClick={() => { markAsRead(display); onClose(); }}>✓ Mark as read</button>
              <button className="btn btn-ghost" onClick={() => { removeFromReadNext(display); onClose(); }}>
                Remove from queue
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => { addToReadNext(display); onClose(); }}>+ Add to Read Next</button>
              {!inWish && (
                <button className="btn btn-gilt" onClick={() => { addToWishlist(display); onClose(); }}>
                  + Add to Wishlist
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => { markAsRead(display); onClose(); }}>✓ Mark as read</button>
            </>
          )}
        </div>

        <ReportBookForm book={display} />
      </div>

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

// v0.12: pill with three states + optional remove affordance.
//   verified=true  → gilt ☩ pill, never removable (it's a global tag)
//   verified=false → dim "unverified" pill, removable by the owning user
//                    (the source is 'user' since only the user has it)
//
// `canRemove` is set when the user is in edit mode (clicked "Add" to open
// the input). Verified pills ignore canRemove — they can never be removed
// from the client.
function CategoryPill({ category, removing, canRemove, onRemove }) {
  const { name, verified } = category;
  const baseStyle = verified
    ? {
        background: 'rgba(176, 140, 63, 0.18)',
        borderColor: 'var(--gilt)',
        color: 'var(--gilt-bright)',
      }
    : {
        background: 'rgba(176, 140, 63, 0.04)',
        borderColor: 'rgba(176, 140, 63, 0.3)',
        color: 'var(--paper-aged)',
        opacity: 0.9,
      };

  const showRemove = canRemove && !verified;

  return (
    <span
      className="level-pill"
      className="bp-cat" style={{ ...baseStyle, opacity: removing ? 0.4 : 1 }}
      title={verified
        ? 'Verified by our editors — global to all readers'
        : 'Your private category — only you see this'}
    >
      {verified && <span>☩</span>}
      <span>{name}</span>
      {showRemove && (
        <button
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${name}`}
          className="bp-cat__remove"
        >
          ×
        </button>
      )}
    </span>
  );
}
