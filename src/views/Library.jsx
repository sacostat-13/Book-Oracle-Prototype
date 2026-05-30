import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';

export default function Library({ onOpenBook }) {
  const { state, removeFromLibrary } = useData();
  const { go } = useRouter();

  const grouped = {};
  for (const b of state.library) {
    const g = b.g || 'Imported';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(b);
  }
  const genreKeys = Object.keys(grouped).sort();

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Library
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Library</div>
        <h1 className="page-title">Books I've <span className="accent">Read</span></h1>
        <p className="page-subtitle">{state.library.length} books across {genreKeys.length} categories.</p>
      </div>

      {state.library.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">📚</div>
          <div className="empty-state-title">Empty library</div>
          <div className="empty-state-text">As you mark books as read, they'll appear here and fill your shelves on the dashboard.</div>
        </div>
      ) : (
        genreKeys.map((g) => (
          <div className="list-section" key={g}>
            <h2>{g} <span className="count">· {grouped[g].length}</span></h2>
            {grouped[g].map((b, i) => (
              <div className="list-item" key={`${bookKey(b)}-${i}`}>
                <div className="li-num">{b.rating ? '★'.repeat(b.rating) : '❦'}</div>
                <div className="li-content" onClick={() => onOpenBook?.(b)} style={{ cursor: 'pointer' }}>
                  <div className="li-title">{b.t}</div>
                  <div className="li-author">
                    {b.a}
                    {b.fromGoodreads && <> · <span style={{ color: 'var(--gilt)', opacity: 0.7 }}>from Goodreads</span></>}
                  </div>
                </div>
                <div className="li-actions">
                  <button
                    className="li-action danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove "${b.t}" from your library?`)) removeFromLibrary(b);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </>
  );
}
