import CoverThumb from '../../components/CoverThumb';
import { relativeDay } from './feed';
import { IconBook, WidgetShell } from './WidgetShell';

// ─── Currently Reading ────────────────────────────────────────────────────────
export default function CurrentlyReadingWidget({ books, onOpenBook, t }) {
  if (!books?.length) return null;
  return (
    <WidgetShell icon={<IconBook />} label={t('dashboard.currentlyReading')}>
      <div className="db-cr-grid">
        {books.map((b, i) => (
          <div key={b.bookId || i} className="db-cr-card" onClick={() => onOpenBook?.(b)}>
            <CoverThumb book={b} width={60} />
            <div className="db-cr-body">
              <div className="db-cr-title">{b.t}</div>
              <div className="db-cr-author">{b.a}</div>
              {(b.startedAt || b.started_at) && (
                <div className="db-cr-since">
                  {t('dashboard.since')} {relativeDay(b.startedAt || b.started_at, t)}
                </div>
              )}
              <button className="db-cr-open">{t('dashboard.open')} →</button>
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
