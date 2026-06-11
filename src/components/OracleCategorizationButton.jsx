// OracleCategorizationButton.jsx
// v0.15 phase 2.4 — "Let the Oracle categorize my books" button.
//
// Renders on Library and Wishlist views. Shows only when there are books
// that need genres (unreviewed/incomplete AND no genres assigned yet).
// While running: shows a progress bar and per-batch status updates.
// After completion: shows a summary toast and resets.

import { useState, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import {
  getBooksNeedingGenres,
  runOracleCategorization,
} from '../lib/oracleCategorizationService';

export default function OracleCategorizationButton({ books }) {
  const { state, setBookGenres, showToast } = useData();
  const { genresByBookId } = state;

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState([]);

  const booksNeedingGenres = getBooksNeedingGenres(books, genresByBookId);
  const count = booksNeedingGenres.length;

  const handleRun = useCallback(async () => {
    if (running || count === 0) return;
    setRunning(true);
    setErrors([]);
    setProgress({ done: 0, total: count });

    const { processed, failed } = await runOracleCategorization({
      books: booksNeedingGenres,
      onProgress: (done, total) => setProgress({ done, total }),
      onBatchResult: ({ assignments }) => {
        setBookGenres(assignments);
      },
      onError: (msg) => {
        setErrors((prev) => [...prev, msg]);
      },
    });

    setRunning(false);
    setProgress({ done: 0, total: 0 });

    const successCount = processed - failed;
    if (failed === 0) {
      showToast(`☩ The Oracle has categorized ${successCount} book${successCount !== 1 ? 's' : ''}.`);
    } else {
      showToast(
        `☩ Categorized ${successCount} book${successCount !== 1 ? 's' : ''}. ${failed} could not be processed.`,
        true
      );
    }
  }, [running, count, booksNeedingGenres, setBookGenres, showToast]);

  // Don't render if there's nothing to categorize
  if (count === 0) return null;

  const pct = progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className="oracle-categorization-button">
      {!running ? (
        <button
          className="btn btn-ghost oracle-btn"
          onClick={handleRun}
          title={`${count} book${count !== 1 ? 's' : ''} without genre assignments`}
        >
          ☩ Let the Oracle categorize my books
          <span className="oracle-btn-count">{count}</span>
        </button>
      ) : (
        <div className="oracle-progress">
          <div className="oracle-progress-label">
            ☩ Oracle is reading… {progress.done} / {progress.total}
          </div>
          <div className="oracle-progress-track">
            <div
              className="oracle-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          {errors.length > 0 && (
            <div className="oracle-progress-errors">
              {errors.map((e, i) => (
                <div key={i} className="oracle-progress-error">{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
