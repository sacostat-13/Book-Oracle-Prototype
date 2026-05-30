import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey } from '../lib/bookHelpers';

export default function ReadNext() {
  const { state, markAsRead, removeFromReadNext } = useData();
  const { go } = useRouter();

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Read Next
      </div>
      <div className="page-header">
        <div className="page-eyebrow">Queue</div>
        <h1 className="page-title">To Read <span className="accent">Next</span></h1>
        <p className="page-subtitle">{state.readNext.length} books waiting.</p>
      </div>

      {state.readNext.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Nothing queued yet</div>
          <div className="empty-state-text">Use the Oracle to draw books from the vault.</div>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn" onClick={() => go('oracle')}>Open the Oracle</button>
          </div>
        </div>
      ) : (
        state.readNext.map((b, i) => (
          <div className="list-item" key={`${bookKey(b)}-${i}`}>
            <div className="li-num">{String(i + 1).padStart(2, '0')}.</div>
            <div className="li-content">
              <div className="li-title">{b.t}</div>
              <div className="li-author">
                {b.a}{b.g && <> · <span style={{ color: 'var(--gilt)' }}>{b.g}</span></>}
              </div>
            </div>
            <div className="li-actions">
              <button className="li-action success" onClick={() => markAsRead(b)}>✓ Read</button>
              <button className="li-action danger" onClick={() => removeFromReadNext(b)}>Remove</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
