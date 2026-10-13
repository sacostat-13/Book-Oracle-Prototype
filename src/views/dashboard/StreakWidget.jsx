import { monthlyReadingStreak, streakTemperature } from '../../lib/scoring/readingStreak';
import { parseIsoDate } from '../../lib/util/dates';
import { IconBook, WidgetShell } from './WidgetShell';

// ─── Reading Streak ────────────────────────────────────────────────────────────
// Consecutive months with a finished book. The counting rule (including the
// current-month grace period) lives in lib/scoring/readingStreak.js — see docs/reference/MATH.md.
export default function StreakWidget({ library, t }) {
  const { months, includesCurrentMonth, lastFinishedOn } = monthlyReadingStreak(library);
  if (!lastFinishedOn) return null;

  const lastDate = parseIsoDate(lastFinishedOn);
  const statusKey = months === 0
    ? 'dashboard.streakWidgetNone'
    : includesCurrentMonth ? 'dashboard.streakWidgetActive' : 'dashboard.streakWidgetAtRisk';

  return (
    <WidgetShell icon={<IconBook />} label={t('dashboard.streakWidgetTitle')}>
      <div className="db-streak">
        <div className="db-streak__num-col">
          <div className={`db-streak__num db-streak__num--${streakTemperature(months)}`}>{months}</div>
          <div className="db-streak__unit">
            {t(months === 1 ? 'dashboard.streakUnitMonth' : 'dashboard.streakUnitMonthPlural')}
          </div>
        </div>
        <div>
          <div className="db-streak__label">{t(statusKey)}</div>
          {lastDate && (
            <div className="db-streak__sub">
              {t('dashboard.streakWidgetLastRead', {
                date: lastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetShell>
  );
}
