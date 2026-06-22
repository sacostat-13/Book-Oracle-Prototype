// OracleCategorizationButton.jsx
// v0.31 — localized

import { useState, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import {
  getBooksNeedingGenres,
  runOracleCategorization,
} from '../lib/oracleCategorizationService';

export default function OracleCategorizationButton({ books }) {
  const { state, setBookGenres, showToast } = useData();
  const { genresByBookId } = state;
  const t = useT();

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
      onBatchResult: ({ assignments }) => { setBookGenres(assignments); },
      onError: (msg) => { setErrors((prev) => [...prev, msg]); },
    });

    setRunning(false);
    setProgress({ done: 0, total: 0 });

    const successCount = processed - failed;
    if (failed === 0) {
      showToast(successCount === 1
        ? t('oracle.categorizeSuccess', { count: successCount })
        : t('oracle.categorizeSuccessPlural', { count: successCount }));
    } else {
      showToast(t('oracle.categorizeFailed', { success: successCount, failed }), true);
    }
  }, [running, count, booksNeedingGenres, setBookGenres, showToast, t]);

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
          {t('oracle.categorizeBtnLabel')}
          <span className="oracle-btn-count">{count}</span>
        </button>
      ) : (
        <div className="oracle-progress">
          <div className="oracle-progress-label">
            {t('oracle.categorizeProgress', { done: progress.done, total: progress.total })}
          </div>
          <div className="oracle-progress-track">
            <div className="oracle-progress-fill" style={{ width: `${pct}%` }} />
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
