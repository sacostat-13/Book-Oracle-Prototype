import { useState } from 'react';

// ── Reading Challenge ─────────────────────────────────────────────────────────
// Full-featured annual reading goal: set target, track progress, show pace.
export default function ReadingChallenge({ library, readingGoalCount, setReadingGoalCount, t }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const target = readingGoalCount;

  // Books finished this calendar year
  const done = library.filter((b) => {
    if (!b.dateRead) return false;
    return new Date(b.dateRead).getFullYear() === year;
  }).length;

  // Pace calculation: days elapsed / days in year × target = expected by now
  const dayOfYear = Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const yearFraction = dayOfYear / daysInYear;
  const expected = target ? Math.round(target * yearFraction) : 0;
  const projected = target ? Math.round(done / Math.max(yearFraction, 0.01)) : 0;
  const delta = target ? done - expected : 0; // positive = ahead, negative = behind
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const reached = target && done >= target;

  function save() {
    const n = parseInt(inputVal, 10);
    if (n > 0 && n <= 9999) setReadingGoalCount(n);
    setEditing(false);
  }

  function remove() {
    setReadingGoalCount(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="pf-section">
        <p className="pf-prompt">
          {t('profile.challengeSubtitle')}
        </p>
        <div className="pf-edit-row pf-edit-row--wrap">
          <input
            type="number" min="1" max="9999"
            placeholder={t('profile.challengePlaceholder')}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
            className="input pf-input--narrow"
          />
          <button className="btn-tertiary btn--sm" onClick={save}>{t('profile.challengeSave')}</button>
          <button className="btn-text" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          {target && (
            <button
              onClick={remove}
              className="pf-btn-link"
            >
              {t('profile.challengeRemove')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="pf-section">
        <p className="pf-prompt">
          {t('profile.challengeSubtitle')}
        </p>
        <button className="btn-tertiary btn--sm" onClick={() => { setInputVal(''); setEditing(true); }}>
          {t('profile.challengeSet')}
        </button>
      </div>
    );
  }

  return (
    <div className="pf-section">
      {/* Year label */}
      <div className="pf-challenge__year">
        {t('profile.challengeYear', { year })}
      </div>

      {/* Progress bar */}
      <div className="pf-challenge__bar">
        <div
          className={`pf-challenge__bar-fill${reached ? ' pf-challenge__bar-fill--reached' : ''}`}
          style={{ '--pf-challenge-w': `${pct}%` }}
        />
        {/* Pace marker — where you should be */}
        {!reached && (
          <div
            className="pf-challenge__marker"
            style={{ '--pf-marker-x': `${Math.min(100, Math.round(yearFraction * 100))}%` }}
          />
        )}
      </div>

      {/* Counts row */}
      <div className="pf-challenge__counts">
        <span className={`pf-challenge__done${reached ? ' pf-challenge__done--reached' : ''}`}>
          {done} <span className="pf-challenge__target">/ {target}</span>
        </span>
        <span className="pf-challenge__pct">
          {pct}%
        </span>
      </div>

      {/* Status line */}
      <div className="pf-challenge__status">
        {reached ? (
          <span className="pf-hl-success">
            {t('profile.challengeComplete', { done })}
          </span>
        ) : delta === 0 ? (
          <span className="lv-hl-muted">
            {t('profile.challengePace', { projected })}
          </span>
        ) : delta > 0 ? (
          <span className="pf-hl-success">
            {t('profile.challengeAhead', { ahead: delta })} · {t('profile.challengePace', { projected })}
          </span>
        ) : (
          <span className="pf-hl-warn">
            {t('profile.challengeBehind', { behind: Math.abs(delta) })} · {t('profile.challengePace', { projected })}
          </span>
        )}
      </div>

      <button
        className="btn-tertiary btn--sm"
        onClick={() => { setInputVal(String(target)); setEditing(true); }}
      >
        {t('profile.challengeEdit')}
      </button>
    </div>
  );
}
