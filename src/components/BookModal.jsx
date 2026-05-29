import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { ALL_BOOKS, bookKey, findBookByTitle } from '../lib/bookHelpers';
import { enrichBookFromOpenLibrary, fetchSeriesBooks } from '../lib/enrichmentService';
import BookCover from './BookCover';

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
  const { state, addToReadNext, removeFromReadNext, markAsRead, removeFromLibrary, addToWishlist } = useData();
  const { go } = useRouter();
  const [enrichment, setEnrichment] = useState(null);
  const [seriesBooks, setSeriesBooks] = useState([]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Fetch OL enrichment
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    enrichBookFromOpenLibrary(book.t, book.a).then((d) => {
      if (!cancelled) setEnrichment(d);
    });
    return () => {
      cancelled = true;
    };
  }, [book]);

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

  // Esc to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!book) return null;

  const enriched = findBookByTitle(book.t, state.wishlist) || book;
  const display = { ...enriched, ...book };
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
    seriesBlock = {
      name: seriesName,
      fromOL: display.s.fromOpenLibrary,
      dots,
      readCount,
      totalBooks,
      totalKnown,
    };
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="book-modal">
        <button className="book-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="book-modal-hero">
          <div className="book-modal-cover">
            <BookCover title={display.t} author={display.a} eager />
          </div>
          <div className="book-modal-info">
            {display.g && <div className="book-modal-genre">{display.g}</div>}
            <h2 className="book-modal-title">{display.t}</h2>
            <div className="book-modal-author">{display.a}</div>
            {display.rating && (
              <div className="book-modal-rating">
                {'★'.repeat(Math.max(1, Math.min(5, parseInt(display.rating, 10))))}
                <span className="empty-stars">{'★'.repeat(5 - Math.max(1, Math.min(5, parseInt(display.rating, 10))))}</span>
                <span className="rating-label">{display.fromGoodreads ? 'Goodreads rating' : 'Your rating'}</span>
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
              <div className="book-modal-section-title">Description</div>
              <div className="book-modal-description">{display.d}</div>
            </div>
          )}

          {seriesBlock && (
            <div className="book-modal-section">
              <div className="book-modal-section-title">
                Part of a series · <span style={{ opacity: 0.6, fontSize: '0.65rem' }}>
                  {seriesBlock.fromOL ? 'detected via Open Library' : 'curated'}
                </span>
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
                {similar.map((s) => {
                  const sk = bookKey(s);
                  const sRead = state.library.some((l) => bookKey(l) === sk);
                  const sQueued = state.readNext.some((l) => bookKey(l) === sk);
                  return (
                    <div className="similar-mini-item" key={sk} onClick={() => onOpenBook?.(s)} style={{ cursor: 'pointer' }}>
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

        <div className="book-modal-actions">
          {display.amazonUrl && (
            <a
              href={display.amazonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              ↗ View on Amazon
            </a>
          )}
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
    </div>
  );
}
