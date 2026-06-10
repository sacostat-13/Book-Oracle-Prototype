import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey, findBookByTitle } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import { lookupByTitle } from '../lib/bookLookup';
import { fetchCoverURL } from '../lib/coverService';
import { purchaseLinks } from '../lib/purchaseLinks';
import BookCover from './BookCover';
import RatingModal from './RatingModal';

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
    updateReadBook, // v0.9 — used by the rating editor in v0.11
  } = useData();
  const { go } = useRouter();
  const [enrichment, setEnrichment] = useState(null);
  const [seriesBooks, setSeriesBooks] = useState([]);
  // Live overlay of newly-enriched fields so the modal shows them immediately
  // even if the parent state hasn't refreshed yet.
  const [enrichedOverlay, setEnrichedOverlay] = useState({});
  // v0.11: track the rating editor open state. When non-null, the RatingModal
  // is shown on top of the BookModal — z-index handled by RatingModal itself.
  const [ratingEditorOpen, setRatingEditorOpen] = useState(false);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // On-demand enrichment: when the modal opens, identify which canonical fields
  // are missing on this book and fetch them. Anything fetched is persisted to
  // the shared `books` row via cacheBookFields so future opens are instant.
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

      // Pages + description: use the v0.10 four-source lookup (PRH, Hardcover,
      // OL, Wikipedia). Wikipedia is the reason we now see good descriptions
      // for books where Hardcover and OL came up short.
      if (needsPages || needsDescription) {
        const found = await lookupByTitle(book.t, book.a);
        if (cancelled) return;
        if (found) {
          if (needsPages && found.pp) patch.pp = found.pp;
          if (needsDescription && found.d) patch.d = found.d;
          if (!book.isbn && found.isbn) patch.isbn = found.isbn;
          if (!book.hardcoverId && found.hardcoverId) patch.hardcoverId = found.hardcoverId;
          // v0.10 fields: capture Wikipedia attribution so the modal can show
          // a "From Wikipedia" link next to the description.
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

  // Fetch series books if this book is in a series
  useEffect(() => {
    const seriesName = book?.s?.name || enrichment?.series?.name;
    if (!seriesName) return;
    let cancelled = false;
    fetchSeriesBooks(seriesName).then((b) => {
      if (!cancelled) setSeriesBooks(b);
    });
    return () => {
      cancelled = true;
    };
  }, [book, enrichment]);

  // Esc to close — but only when the rating editor isn't taking the Esc key
  // for itself. The rating editor handles its own keyboard close, so we just
  // need to not double-fire when both are open.
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

  // v0.11: pull the live library row when the book is in library so rating
  // and notes are sourced from the up-to-date local state, not from whatever
  // stale snapshot the caller passed in. This matters when the user edits
  // a rating, closes/reopens the modal, etc.
  const libraryRow = inLib
    ? state.library.find((b) => bookKey(b) === k)
    : null;
  const liveRating = libraryRow?.rating ?? display.rating ?? null;
  const liveNotes = libraryRow?.notes ?? null;

  // Build series block data
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
    const totalBooks = display.s.total || Math.max(totalKnown, display.s.n || totalKnown);
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

    let sourceLabel;
    if (display.s.verified) sourceLabel = 'verified';
    else if (display.s.seriesId) sourceLabel = 'needs review';
    else if (display.s.fromHardcover) sourceLabel = 'from Hardcover · unsaved';
    else if (display.s.fromOpenLibrary) sourceLabel = 'from Open Library · unsaved';
    else sourceLabel = 'unverified';

    seriesBlock = {
      name: seriesName,
      sourceLabel,
      verified: !!display.s.verified,
      needsReview: !display.s.verified && !!display.s.seriesId,
      dots,
      readCount,
      totalBooks,
      totalKnown,
    };
  }

  // v0.11: build the categories list for the read-only pill row.
  //
  // For now this only includes the existing `g` field — single auto-detected
  // genre on each book. The verified/unverified styling uses `book.verified`
  // (same flag we use elsewhere — see seriesBlock.verified above). When v0.12
  // ships the user-tag system, this same section will gain user pills and an
  // "Add category" affordance.
  const categories = [];
  if (display.g) {
    categories.push({
      name: display.g,
      verified: !!display.verified,
      source: display.verified ? 'verified' : 'auto-detected',
    });
  }

  async function handleSaveRating({ rating, notes }) {
    // updateReadBook is a no-op for books not in library; we only render
    // the rating editor when libraryRow exists.
    if (!libraryRow) return;
    await updateReadBook(libraryRow, { rating, notes });
    setRatingEditorOpen(false);
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
            {display.g && <div className="book-modal-genre">{display.g}</div>}
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
              {display.verified && (
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
                Description
                {/* v0.10: attribution when Wikipedia provided the description */}
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

          {/* v0.11: Categories section — read-only for now. Surfaces the
              `g` field (and the verified flag) as pills. Empty state when
              the book has no categories. The autocomplete-add input lands
              in v0.12 along with the user_book_categories schema. */}
          <div className="book-modal-section">
            <div className="book-modal-section-title">Categories</div>
            {categories.length === 0 ? (
              <div
                style={{
                  color: 'var(--paper-aged)',
                  opacity: 0.6,
                  fontSize: '0.9rem',
                  fontStyle: 'italic',
                }}
              >
                No categories yet.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {categories.map((c, i) => (
                  <CategoryPill key={`${c.name}-${i}`} {...c} />
                ))}
              </div>
            )}
          </div>

          {/* v0.11: Your rating section — only shown when the book is in
              library. Displays the current rating + notes (if any) with an
              Edit button that opens the RatingModal in 'edit' mode. */}
          {inLib && (
            <div className="book-modal-section">
              <div
                className="book-modal-section-title"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}
              >
                <span>Your rating</span>
                <button
                  className="li-action"
                  onClick={() => setRatingEditorOpen(true)}
                  style={{ fontSize: '0.7rem', padding: '0.3rem 0.7rem' }}
                >
                  {liveRating > 0 || liveNotes ? 'Edit' : '+ Add rating'}
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
                    Not rated yet.
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
                Part of a series ·{' '}
                {seriesBlock.verified ? (
                  <span style={{ color: 'var(--gilt-bright)', fontSize: '0.65rem', letterSpacing: '0.08em' }}>
                    ☩ verified
                  </span>
                ) : seriesBlock.needsReview ? (
                  <span
                    style={{ color: 'var(--blood-bright)', fontSize: '0.65rem', letterSpacing: '0.08em', opacity: 0.85 }}
                    title="This series is in our catalog but hasn't been editor-verified yet."
                  >
                    ⚠ needs review
                  </span>
                ) : (
                  <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>{seriesBlock.sourceLabel}</span>
                )}
              </div>
              <div className="series-name">{seriesBlock.name}</div>
              <div className="series-progress">
                {seriesBlock.dots}
                <span className="series-progress-text">{seriesBlock.readCount}/{seriesBlock.totalBooks} read</span>
              </div>
              <div style={{ marginTop: '0.8rem' }}>
                <button className="li-action success" onClick={() => { onClose(); go('plan-create', { seriesName: seriesBlock.name }); }}>
                  ✦ Create a plan to finish this series
                </button>
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">Similar books</div>
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

      {/* v0.11: rating editor overlays the book modal when open */}
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

// v0.11: small visual primitive for the categories row. Two states for now:
// 'verified' (gilt, matches the existing ☩ Verified badge in BookCard and
// the series-verified treatment) and 'unverified' (dimmer, with a soft
// border, signaling "this came from an API or a user, not curated").
// When v0.12 lands the user-suggested → admin-promoted flow, we'll add a
// third 'user' state for tags only the current user has applied.
function CategoryPill({ name, verified, source }) {
  if (verified) {
    return (
      <span
        className="level-pill"
        title={`${source} — verified by our editors`}
        style={{
          background: 'rgba(176, 140, 63, 0.18)',
          borderColor: 'var(--gilt)',
          color: 'var(--gilt-bright)',
        }}
      >
        ☩ {name}
      </span>
    );
  }
  return (
    <span
      className="level-pill"
      title={`${source} — not yet editor-verified`}
      style={{
        background: 'rgba(176, 140, 63, 0.04)',
        borderColor: 'rgba(176, 140, 63, 0.3)',
        color: 'var(--paper-aged)',
        opacity: 0.85,
      }}
    >
      {name}
    </span>
  );
}
