import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';
import BookCover from '../components/BookCover';
import RatingModal from '../components/RatingModal';

export default function CurrentlyReading({ onOpenBook }) {
  const { state, removeFromCurrentlyReading, finishReading } = useData();
  const { go } = useRouter();
  const [finishing, setFinishing] = useState(null);
  const { currentlyReading } = state;

  function daysReading(startedAt) {
    if (!startedAt) return null;
    const start = new Date(startedAt);
    const now = new Date();
    const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Started today';
    if (diff === 1) return '1 day';
    return `${diff} days`;
  }

  async function handleFinish({ rating, notes, readAt }) {
    if (!finishing) return;
    await finishReading(finishing, { rating, notes, readAt });
    setFinishing(null);
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Currently Reading
      </div>
      <div className="page-header">
        <div className="page-eyebrow">In Progress</div>
        <h1 className="page-title">Currently <span className="accent">Reading</span></h1>
        <p className="page-subtitle">
          {currentlyReading.length === 0
            ? 'No books in progress.'
            : `${currentlyReading.length} book${currentlyReading.length !== 1 ? 's' : ''} in progress.`}
        </p>
      </div>

      {currentlyReading.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Nothing in progress</div>
          <div className="empty-state-text">
            Mark a book as currently reading from your Wishlist or Read Next queue.
          </div>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => go('read-next')}>Read Next</button>
            <button className="btn btn-ghost" onClick={() => go('wishlist')}>Wishlist</button>
          </div>
        </div>
      ) : (
        <div className="cr-grid">
          {currentlyReading.map((b) => {
            const days = daysReading(b.startedAt);
            const genres = state.genresByBookId?.[b.bookId];
            return (
              <div className="cr-card" key={bookKey(b)}>
                <div
                  className="cr-cover"
                  onClick={() => onOpenBook?.(b)}
                  style={{ cursor: 'pointer' }}
                >
                  <BookCover title={b.t} author={b.a} coverUrl={b.coverUrl} />
                </div>
                <div className="cr-info">
                  <div
                    className="cr-title"
                    onClick={() => onOpenBook?.(b)}
                    style={{ cursor: 'pointer' }}
                  >
                    {b.t}
                  </div>
                  <div className="cr-author">{b.a}</div>
                  {genres && genres.length > 0 && (
                    <div className="li-genres" style={{ marginTop: '0.4rem' }}>
                      {genres.map((g) => (
                        <span key={g.genreId} className="li-genre-pill" title={g.description || undefined}>
                          {g.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="cr-meta">
                    {b.startedAt && (
                      <span className="cr-started">
                        Started {new Date(b.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {days && <> · <span style={{ color: 'var(--gilt)' }}>{days}</span></>}
                      </span>
                    )}
                    {b.pp && <span className="cr-pages">{b.pp} pages</span>}
                  </div>
                  <div className="cr-actions">
                    <button
                      className="li-action success"
                      onClick={() => setFinishing(b)}
                    >
                      ✓ Finished
                    </button>
                    <button
                      className="li-action danger"
                      onClick={() => {
                        if (confirm(`Remove "${b.t}" from currently reading?`)) {
                          removeFromCurrentlyReading(b);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {finishing && (
        <RatingModal
          book={finishing}
          mode="finish"
          onSave={handleFinish}
          onSkip={() => {
            finishReading(finishing);
            setFinishing(null);
          }}
        />
      )}
    </>
  );
}
