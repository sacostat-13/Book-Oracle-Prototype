import { effectivePages, effectiveMinutes, isAudioEdition, formatMinutes } from '../../lib/book/editions';
import { IconDiamond, WidgetShell } from './WidgetShell';

// ─── Reading Stats ─────────────────────────────────────────────────────────────
// `editions` is the reader's reader_editions map, passed in rather than read
// from context because this widget already takes its data as props and a second
// source of truth inside it would be the thing that drifts.
export default function ReadingStatsWidget({ library, editions, currentlyReading, go, t }) {
  const now = new Date();
  const year = now.getFullYear();
  const total = library.length;
  const thisYearCount = library.filter(
    (b) => b.dateRead && new Date(b.dateRead).getFullYear() === year
  ).length;
  const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const recent = library.filter((b) => b.dateRead && new Date(b.dateRead) >= twelveAgo);
  const pace = recent.length > 0 ? (recent.length / 12).toFixed(1) : null;
  // v0.65: count the pages the reader actually read, not the pages the
  // catalog's edition has. A reader working through Spanish translations was
  // credited with English page counts — the same mismatch the progress bar
  // had, in the one number the Dashboard presents as an achievement.
  const pages = library.reduce(
    (sum, b) => (isAudioEdition(editions?.[b.bookId]) ? sum : sum + (effectivePages(b, editions?.[b.bookId]) || 0)),
    0
  );

  // v0.65.1 — hours listened, and the reason it is a SEPARATE number.
  //
  // Until now this widget summed effectivePages over the whole library. An
  // audiobook has no page count, contributed zero, and a reader who finished
  // forty of them was shown a pages total that said they had read nothing.
  // That is the bug; the tile is the fix.
  //
  // It is not fixed by giving audiobooks a page count. There is no honest
  // pages-per-hour rate, and a fabricated one would be indistinguishable here
  // from a counted page — see docs/specs/audiobook-progress-v1-spec.md. Two units,
  // two tiles, and `pages` now explicitly SKIPS audio editions rather than
  // relying on them happening to be null.
  //
  // Finished books count their full duration; a book in progress counts how far
  // the reader has got. The first is an approximation (abandoned at 80% and
  // marked read counts 100%) and is documented as one in the spec.
  const finishedMinutes = library.reduce(
    (sum, b) => sum + (effectiveMinutes(editions?.[b.bookId]) || 0),
    0
  );
  const inProgressMinutes = (currentlyReading || []).reduce(
    (sum, b) => (isAudioEdition(editions?.[b.bookId]) ? sum + (Number(b.progressMinutes) || 0) : sum),
    0
  );
  const listened = finishedMinutes + inProgressMinutes;

  const cards = [
    { value: total, label: thisYearCount > 0 ? t('dashboard.statsWidgetThisYear', { count: thisYearCount }) : t('dashboard.statsWidgetBooks', { count: total }) },
    { value: pace ?? '—', label: 'avg per month' },
    { value: pages > 0 ? pages.toLocaleString() : '—', label: 'pages total' },
    // Rendered only when there is something to show. A reader who listens to
    // nothing should not be told they have listened to nothing — an empty tile
    // is a worse answer than no tile.
    ...(listened > 0 ? [{ value: formatMinutes(listened), label: 'listened' }] : []),
  ];

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.statsWidgetTitle')}>
      <div className="db-stats-grid">
        {cards.map((c, i) => (
          <div key={i} className="db-stat-card">
            <div className="db-stat-value">{c.value}</div>
            <div className="db-stat-label">{c.label}</div>
          </div>
        ))}
      </div>
      <button className="btn-text" onClick={() => go('profile')}>
        {t('dashboard.statsWidgetSeeAll')}
      </button>
    </WidgetShell>
  );
}
