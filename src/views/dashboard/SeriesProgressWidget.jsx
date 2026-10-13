import { bookKey } from '../../lib/book/bookHelpers';
import { IconDiamond, WidgetShell } from './WidgetShell';

// ─── Series in Progress ────────────────────────────────────────────────────────
export default function SeriesProgressWidget({ library, wishlist, readNext, go, t }) {
  const allBooks = [...library, ...(wishlist || []), ...(readNext || [])];
  const seriesMap = {};
  for (const b of allBooks) {
    if (!b.s?.name) continue;
    const n = b.s.name;
    if (!seriesMap[n]) seriesMap[n] = { name: n, total: b.s.total || null, read: 0, coverUrl: null };
    if (library.some((l) => bookKey(l) === bookKey(b))) {
      seriesMap[n].read++;
      if (!seriesMap[n].coverUrl && b.coverUrl) seriesMap[n].coverUrl = b.coverUrl;
    }
  }
  const inProgress = Object.values(seriesMap)
    .filter((s) => s.read > 0 && s.total && s.read < s.total)
    .sort((a, b) => b.read - a.read).slice(0, 4);

  if (!inProgress.length) return null;

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.seriesWidgetTitle')}>
      <div className="db-series-list">
        {inProgress.map((s) => {
          const pct = Math.round((s.read / s.total) * 100);
          return (
            <div key={s.name} className="db-series-row"
              onClick={() => go('series-page', { seriesName: s.name, from: 'dashboard', fromLabel: t('dashboard.eyebrow') })}>
              {s.coverUrl && <img src={s.coverUrl} alt={s.name} className="db-series-cover" />}
              <div className="db-series-body">
                <div className="db-series-title">{s.name}</div>
                <div className="db-series-track">
                  <div className="db-series-fill" style={{ '--series-pct': `${pct}%` }} />
                </div>
                <div className="db-series-meta">
                  {t('dashboard.seriesWidgetRead', { read: s.read, total: s.total })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
