import { useMemo, useState } from 'react';
import { IconSparkle, WidgetShell } from './WidgetShell';

// ─── Reading Goal ─────────────────────────────────────────────────────────────
export default function ReadingGoalWidget({ library, genresByBookId, readingGoalCount, setReadingGoalCount, t }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const target = readingGoalCount;
  const done = library.filter((b) => b.dateRead && new Date(b.dateRead).getFullYear() === year).length;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const yearFrac = (Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1) / daysInYear;
  const expected = target ? Math.round(target * yearFrac) : 0;
  const delta = target ? done - expected : 0;
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const reached = target && done >= target;

  // v0.59: books imported from Goodreads usually carry no finish date —
  // Goodreads only records one when the reader dated the shelving themselves.
  // Undated books are correctly excluded from the year count, but a reader who
  // just imported 500 books and sees "0 of 30" has no way to tell that apart
  // from a broken import. Say so, but only when it's actually relevant.
  const undatedCount = library.filter((b) => !b.dateRead).length;
  const showUndatedNote = undatedCount > 0 && done < target;

  // v0.42-ish: yearly genre breakdown — same source of truth as Profile's
  // all-time "Top genres" (state.genresByBookId), but scoped to books read
  // this year and capped to 3, to sit compactly under the goal bar.
  const topGenres = useMemo(() => {
    const counts = {};
    for (const b of library) {
      if (!b.dateRead || new Date(b.dateRead).getFullYear() !== year) continue;
      for (const g of (genresByBookId?.[b.bookId] || [])) {
        counts[g.name] = (counts[g.name] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
  }, [library, genresByBookId, year]);
  const genreBarColors = ['--ro-burgundy', '--ro-forest', '--ro-gold'];

  function save() {
    const n = parseInt(input, 10);
    if (n > 0 && n <= 9999) setReadingGoalCount(n);
    setEditing(false);
  }

  return (
    <WidgetShell icon={<IconSparkle />} label={t('dashboard.goalWidgetTitle')}>
      <div className="db-goal">
        {editing ? (
          <div className="db-goal__edit-form">
            <input
              className="input"
              type="number" min="1" max="9999"
              placeholder={t('dashboard.goalWidgetPlaceholder')}
              defaultValue={target || ''}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus
              style={{ width: 120 }}
            />
            <button className="btn-primary btn--sm" onClick={save}>{t('dashboard.goalWidgetSave')}</button>
            <button className="btn-tertiary btn--sm" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        ) : !target ? (
          <button className="btn-tertiary" onClick={() => { setInput(''); setEditing(true); }}>
            {t('dashboard.goalWidgetSet')}
          </button>
        ) : (
          <>
            <div className="db-goal__head">
              <div className="db-goal__count">
                <em>{done}</em> <span>/ {target}</span>
              </div>
              <button className="db-goal__edit"
                onClick={() => { setInput(String(target)); setEditing(true); }}>
                {t('dashboard.goalWidgetEdit')}
              </button>
            </div>
            <div className="db-goal__track">
              <div
                className={`db-goal__fill${reached ? ' db-goal__fill--reached' : ''}`}
                style={{ '--goal-pct': `${pct}%` }}
              />
              {!reached && (
                <div className="db-goal__tick"
                  style={{ '--goal-tick': `${Math.min(100, Math.round(yearFrac * 100))}%` }}
                />
              )}
            </div>
            <div className={`db-goal__status${reached || delta > 0 ? ' db-goal__status--ahead' : delta === 0 ? ' db-goal__status--neutral' : ''}`}>
              {reached
                ? t('dashboard.goalWidgetDone')
                : delta > 0
                  ? `${t('dashboard.goalWidgetAhead', { n: delta })} · ${year}`
                  : delta < 0
                    ? `${t('dashboard.goalWidgetBehind', { n: Math.abs(delta) })} · ${year}`
                    : t('dashboard.goalWidgetProgress', { done, target })}
            </div>
            {showUndatedNote && (
              <div className="db-goal__undated">
                {t('dashboard.goalWidgetUndated', { count: undatedCount })}
              </div>
            )}
          </>
        )}

        {topGenres.length > 0 && (
          <div className="db-goal__genres">
            <div className="db-goal__genres-label">{t('dashboard.goalWidgetGenresTitle')}</div>
            {topGenres.map((g, i) => (
              <div key={g.name} className="db-goal__genre-row">
                <div className="db-goal__genre-head">
                  <span className="db-goal__genre-name">{g.name}</span>
                  <span className="db-goal__genre-count">{g.count}</span>
                </div>
                <div className="db-goal__genre-track">
                  <div
                    className="db-goal__genre-fill"
                    style={{
                      '--genre-pct': `${Math.round((g.count / topGenres[0].count) * 100)}%`,
                      '--genre-color': `var(${genreBarColors[i % genreBarColors.length]})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
