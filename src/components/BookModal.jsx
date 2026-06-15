import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useI18n } from '../lib/I18nContext';
import { ALL_BOOKS, bookKey, findBookByTitle } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import { lookupByTitle } from '../lib/bookLookup';
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
  const { lang } = useI18n();
  const isSpanish = lang === 'es';

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

      if (needsPages || needsDescription) {
        const found = await lookupByTitle(book.t, book.a);
        if (cancelled) return;
        if (found) {
          if (needsPages && found.pp) patch.pp = found.pp;
          if (needsDescription && found.d) patch.d = found.d;
          if (!book.isbn && found.isbn) patch.isbn = found.isbn;
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
            style={{ cursor: isCurrent ? 'default' : 'pointer' }}
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

  async function handleSaveRating({ rating, notes }) {
    if (!libraryRow) return;
    await updateReadBook(libraryRow, { rating, notes });
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
                  style={{ background: 'rgba(176, 140, 63, 0.18)', borderColor: 'var(--gilt)', color: 'var(--gilt-bright)' }}
                  title="Curated · verified by our editors"
                >
                  ☩ Verified
                </span>
              )}
              {inLib && (
                <span className="level-pill" style={{ background: 'var(--moss)', color: 'var(--paper)', borderColor: 'var(--moss)' }}>
                  ✓ Read
                </span>
              )}
              {inNext && <span className="level-pill">In Read Next</span>}
            </div>
          </div>
        </div>

        <div className="book-modal-body">
          {display.d && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">
                {isSpanish ? 'Descripción' : 'Description'}
                {display.descriptionSource === 'wikipedia' && display.wikipediaUrl && (
                  <>
                    {' · '}
                    <a
                      href={display.wikipediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--paper-aged)',
                        opacity: 0.7,
                        fontSize: '0.65rem',
                        letterSpacing: '0.08em',
                        textDecoration: 'none',
                        borderBottom: '1px dotted rgba(176, 140, 63, 0.3)',
                      }}
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
              className="book-modal-section-title"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}
            >
              <span>
                {isSpanish ? 'Categorías' : 'Categories'}
                {categories.length > 0 && (
                  <span style={{ opacity: 0.5, marginLeft: '0.4rem', fontSize: '0.7rem' }}>
                    · {categories.length}/10
                  </span>
                )}
              </span>
              {canAddCategories && !atCategoryCap && (
                <button
                  className="li-action"
                  onClick={() => setAdderOpen((v) => !v)}
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem' }}
                >
                  {adderOpen
                    ? (isSpanish ? 'Listo' : 'Done')
                    : (isSpanish ? '+ Agregar' : '+ Add')}
                </button>
              )}
            </div>

            {categories.length === 0 && !adderOpen ? (
              <div
                style={{
                  color: 'var(--paper-aged)',
                  opacity: 0.6,
                  fontSize: '0.9rem',
                  fontStyle: 'italic',
                }}
              >
                {isSpanish
                  ? 'Aún no hay categorías.'
                  : 'No categories yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
              <div style={{ marginTop: categories.length > 0 ? '0.85rem' : '0.6rem' }}>
                <CategoryAutocomplete
                  book={display}
                  existingIds={existingCategoryIds}
                  onCapHit={() => setAdderOpen(false)}
                />
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.75rem',
                    color: 'var(--paper-aged)',
                    opacity: 0.55,
                    fontStyle: 'italic',
                  }}
                >
                  {isSpanish
                    ? 'Pulsá una pastilla con × para quitarla. Las verificadas (☩) no se pueden quitar — son globales.'
                    : 'Click × on a pill to remove it. Verified (☩) ones are global and can\'t be removed.'}
                </div>
              </div>
            )}
          </div>

          {inLib && (
            <div className="book-modal-section">
              <div
                className="book-modal-section-title"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}
              >
                <span>{isSpanish ? 'Tu calificación' : 'Your rating'}</span>
                <button
                  className="li-action"
                  onClick={() => setRatingEditorOpen(true)}
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem' }}
                >
                  {liveRating > 0 || liveNotes
                    ? (isSpanish ? 'Editar' : 'Edit')
                    : (isSpanish ? '+ Calificar' : '+ Add rating')}
                </button>
              </div>
              {liveRating > 0 ? (
                <div
                  style={{
                    color: 'var(--gilt-bright)',
                    fontSize: '1.4rem',
                    letterSpacing: '0.1em',
                    marginBottom: liveNotes ? '0.8rem' : 0,
                  }}
                >
                  {'★'.repeat(liveRating)}
                  <span style={{ color: 'rgba(176, 140, 63, 0.25)' }}>{'★'.repeat(5 - liveRating)}</span>
                </div>
              ) : (
                !liveNotes && (
                  <div
                    style={{
                      color: 'var(--paper-aged)',
                      opacity: 0.6,
                      fontSize: '0.9rem',
                      fontStyle: 'italic',
                    }}
                  >
                    {isSpanish ? 'Sin calificar aún.' : 'Not rated yet.'}
                  </div>
                )
              )}
              {liveNotes && (
                <div
                  style={{
                    color: 'var(--paper-aged)',
                    lineHeight: 1.55,
                    fontStyle: 'italic',
                    fontFamily: "'Cormorant Garamond', serif",
                    fontSize: '1rem',
                    borderLeft: '2px solid rgba(176, 140, 63, 0.25)',
                    paddingLeft: '0.9rem',
                    marginTop: '0.4rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {liveNotes}
                </div>
              )}
            </div>
          )}

          {seriesBlock && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">
                {isSpanish ? 'Parte de una serie' : 'Part of a series'} ·{' '}
                {seriesBlock.verified ? (
                  <span style={{ color: 'var(--gilt-bright)', fontSize: '0.65rem', letterSpacing: '0.08em' }}>
                    ☩ {isSpanish ? 'verificada' : 'verified'}
                  </span>
                ) : seriesBlock.needsReview ? (
                  <span
                    style={{ color: 'var(--blood-bright)', fontSize: '0.65rem', letterSpacing: '0.08em', opacity: 0.85 }}
                    title="This series is in our catalog but hasn't been editor-verified yet."
                  >
                    ⚠ {isSpanish ? 'requiere revisión' : 'needs review'}
                  </span>
                ) : (
                  <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>{seriesBlock.sourceLabel}</span>
                )}
              </div>
              <div className="series-name">{seriesBlock.name}</div>
              {/* v0.12: Wikipedia-sourced series description, when available */}
              {seriesDescription && (
                <div
                  style={{
                    color: 'var(--paper-aged)',
                    lineHeight: 1.55,
                    fontSize: '0.9rem',
                    marginTop: '0.6rem',
                    marginBottom: '0.8rem',
                    paddingLeft: '0.9rem',
                    borderLeft: '2px solid rgba(176, 140, 63, 0.18)',
                  }}
                >
                  {seriesDescription.description}
                  {seriesDescription.wikipediaUrl && (
                    <>
                      {' '}
                      <a
                        href={seriesDescription.wikipediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: 'var(--paper-aged)',
                          opacity: 0.6,
                          fontSize: '0.7rem',
                          letterSpacing: '0.06em',
                          textDecoration: 'none',
                          borderBottom: '1px dotted rgba(176, 140, 63, 0.3)',
                          marginLeft: '0.3rem',
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
              <div style={{ marginTop: '0.8rem' }}>
                <button className="li-action success" onClick={() => { onClose(); go('plan-create', { seriesName: seriesBlock.name }); }}>
                  ✦ {isSpanish ? 'Crear un plan para terminar esta serie' : 'Create a plan to finish this series'}
                </button>
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">{isSpanish ? 'Libros similares' : 'Similar books'}</div>
              <div className="similar-mini">
                {similar.map((s, i) => {
                  const sk = bookKey(s);
                  const sRead = state.library.some((l) => bookKey(l) === sk);
                  const sQueued = state.readNext.some((l) => bookKey(l) === sk);
                  return (
                    <div className="similar-mini-item" key={`${sk}-${i}`} onClick={() => onOpenBook?.(s)} style={{ cursor: 'pointer' }}>
                      <div>
                        <div className="similar-mini-title">{s.t}</div>
                        <div className="similar-mini-author">{s.a}{s.g ? ` · ${s.g}` : ''}</div>
                      </div>
                      {sRead ? (
                        <span style={{ color: 'var(--moss)', fontSize: '0.8rem', fontFamily: 'monospace' }}>✓ READ</span>
                      ) : sQueued ? (
                        <span style={{ color: 'var(--gilt)', fontSize: '0.8rem', fontFamily: 'monospace' }}>✓ QUEUED</span>
                      ) : (
                        <span style={{ color: 'var(--paper-aged)', opacity: 0.5, fontSize: '0.8rem', fontFamily: 'monospace' }}>→</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="book-modal-purchase">
          <div className="book-modal-purchase-label">Acquire this book</div>
          <div className="book-modal-purchase-buttons">
            {purchaseLinks(display).map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
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
      </div>

      {ratingEditorOpen && libraryRow && (
        <RatingModal
          book={libraryRow}
          initialRating={liveRating}
          initialNotes={liveNotes}
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
      style={{
        ...baseStyle,
        opacity: removing ? 0.4 : baseStyle.opacity || 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: showRemove ? '0.35rem' : 0,
        paddingRight: showRemove ? '0.5rem' : undefined,
      }}
      title={verified
        ? 'Verified by our editors — global to all readers'
        : 'Your private category — only you see this'}
    >
      {verified && <span style={{ flexShrink: 0 }}>☩</span>}
      <span>{name}</span>
      {showRemove && (
        <button
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${name}`}
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            opacity: 0.5,
            cursor: removing ? 'wait' : 'pointer',
            fontSize: '1rem',
            lineHeight: 1,
            padding: 0,
            marginLeft: '0.1rem',
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
