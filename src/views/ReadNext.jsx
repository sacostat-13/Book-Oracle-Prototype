import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';

export default function ReadNext({ onOpenBook }) {
  const { state, markAsRead, removeFromReadNext, startReading } = useData();
  const { go } = useRouter();

  // Books actively being read are shown in Currently Reading, not here.
  const readingKeys = new Set((state.currentlyReading || []).map(bookKey));
  const queue = state.readNext.filter((b) => !readingKeys.has(bookKey(b)));

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Read Next
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Queue</div>
        <h1 className="page-title">To Read <span className="accent">Next</span></h1>
        <p className="page-subtitle">{queue.length} books waiting.</p>
      </div>

      {queue.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Nothing queued yet</div>
          <div className="empty-state-text">Use the Oracle to draw books from the vault.</div>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn" onClick={() => go('oracle')}>Open the Oracle</button>
          </div>
        </div>
      ) : (
        queue.map((b, i) => (
          <div className="list-item" key={`${bookKey(b)}-${i}`}>
            <div className="li-num">{String(i + 1).padStart(2, '0')}.</div>
            <div className="li-content" onClick={() => onOpenBook?.(b)} style={{ cursor: 'pointer' }}>
              <div className="li-title">{b.t}</div>
              <div className="li-author">
                {b.a}{b.g && <> · <span style={{ color: 'var(--gilt)' }}>{b.g}</span></>}
              </div>
            </div>
            <div className="li-actions">
              <button className="li-action" onClick={() => startReading(b)}>▶ Start</button>
              <button className="li-action success" onClick={() => markAsRead(b)}>✓ Read</button>
              <button className="li-action danger" onClick={() => removeFromReadNext(b)}>Remove</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
