// CurationNotice.jsx
// v0.61 — replaces OracleCategorizationButton.
//
// The in-app "Let the Oracle categorize my books" button is gone. It billed
// Anthropic tokens against a reader's own quota to do catalog maintenance —
// work that benefits every user of the shared `books` table, not just the
// person who happened to press the button. The reader's 5 monthly calls now
// go entirely to what they came for: recommendations, plans, and asking.
//
// The work still happens; it moved to the nightly curation job
// (.github/workflows/nightly-curation.yml → batch-scripts/manual/oracleBatch.mjs).
// This component is what remains in the same slot: not a control, just an
// honest statement that the shelves are still being read.
//
// It renders only when the reader actually has books awaiting genres, so it
// disappears entirely once the backlog clears rather than sitting there as
// permanent furniture.

import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { getBooksNeedingGenres } from '../lib/oracleCategorizationService';

export default function CurationNotice({ books }) {
  const { state } = useData();
  const { genresByBookId } = state;
  const t = useT();

  const count = getBooksNeedingGenres(books, genresByBookId).length;
  if (count === 0) return null;

  return (
    <div className="curation-notice" role="status">
      <span className="curation-notice__ornament" aria-hidden="true">☩</span>
      <span className="curation-notice__text">
        {count === 1
          ? t('oracle.curationPending', { count })
          : t('oracle.curationPendingPlural', { count })}
      </span>
    </div>
  );
}
