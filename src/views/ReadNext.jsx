import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { bookKey } from '../lib/bookHelpers';
import EmptyState from '../components/EmptyState';

export default function ReadNext({ onOpenBook }) {
  const { state, markAsRead, removeFromReadNext, startReading } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  // Books actively being read are shown in Currently Reading, not here.
  const readingKeys = new Set((state.currentlyReading || []).map(bookKey));
  const queue = state.readNext.filter((b) => !readingKeys.has(bookKey(b)));

  return (
    <>
      <div className='page-head'>
        <div className="page-head__eyebrow">
          <a onClick={() => go('dashboard')}>{t('readNext.breadcrumb')}</a> · {t('readNext.eyebrow')}
        </div>
        <div className="page-header">
          <h1 className="page-head__title">{tNode('readNext.pageTitle')}</h1>
          <p className="page-head__lead">{queue.length === 1 ? t('readNext.subtitleOne') : t('readNext.subtitle', { count: queue.length })}</p>
        </div>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          ornament="❦"
          title={t('readNext.emptyTitle')}
          body={t('readNext.emptyText')}
          action={{ label: t('readNext.openOracle'), onClick: () => go('oracle') }}
        />
      ) : (
        queue.map((b, i) => (
          <div className="rn-item" key={`${bookKey(b)}-${i}`}>
            <div className="rn-num">{String(i + 1).padStart(2, '0')}.</div>
            <div className="rn" onClick={() => onOpenBook?.(b)}>
              <div className="rn-title">{b.t}</div>
              <div className="rn-author">
                {b.a}{b.g && <> · <span className="lv-hl">{b.g}</span></>}
              </div>
            </div>
            <div className="rn-actions">
              <button className="btn btn-primary" onClick={() => startReading(b)}>{t('readNext.start')}</button>
              <button className="btn btn-primary" onClick={() => markAsRead(b)}>{t('readNext.markRead')}</button>
              <button className="btn btn-danger" onClick={() => removeFromReadNext(b)}>{t('readNext.remove')}</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
