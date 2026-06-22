import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { bookKey } from '../lib/bookHelpers';

export default function ReadNext({ onOpenBook }) {
  const { state, markAsRead, removeFromReadNext, startReading } = useData();
  const { go } = useRouter();
  const t = useT();

  // Books actively being read are shown in Currently Reading, not here.
  const readingKeys = new Set((state.currentlyReading || []).map(bookKey));
  const queue = state.readNext.filter((b) => !readingKeys.has(bookKey(b)));

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>{t('readNext.breadcrumb')}</a> · {t('readNext.title')}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{t('readNext.eyebrow')}</div>
        <h1 className="page-title">{t('readNext.title')} <span className="accent">{t('readNext.titleAccent')}</span></h1>
        <p className="page-subtitle">{queue.length === 1 ? t('readNext.subtitleOne') : t('readNext.subtitle', { count: queue.length })}</p>
      </div>

      {queue.length === 0 ? (
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('readNext.emptyTitle')}</div>
          <div className="empty-state-text">{t('readNext.emptyText')}</div>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn" onClick={() => go('oracle')}>{t('readNext.openOracle')}</button>
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
              <button className="li-action" onClick={() => startReading(b)}>{t('readNext.start')}</button>
              <button className="li-action success" onClick={() => markAsRead(b)}>{t('readNext.markRead')}</button>
              <button className="li-action danger" onClick={() => removeFromReadNext(b)}>{t('readNext.remove')}</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
