// src/views/dashboard/LevelNudge.jsx — suggests raising the stated reading level (MATH §5).

import { useMemo } from 'react';
import { useData } from '../../contexts/DataContext';
import { buildTasteProfile } from '../../lib/scoring/tasteProfile';
import { suggestLevelFromTaste } from '../../lib/scoring/levelNudge';

// ─── Main Dashboard ───────────────────────────────────────────────────────────
// ── Level growth nudge (v0.50) ────────────────────────────────────────────────
// Compares the earned complexity signal (avg complexity of 4-5★ rated books,
// min 5 samples) against the stated reading level. One step up at a time,
// always opt-in, dismissible per suggested level so it never nags.
export default function LevelNudge({ state, t }) {
  const { setProfile } = useData();
  const suggested = useMemo(() => {
    const tp = buildTasteProfile(state.library, state.genresByBookId, state.profile);
    return suggestLevelFromTaste(tp);
  }, [state.library, state.genresByBookId, state.profile]);

  if (!suggested) return null;
  if ((state.profile.levelNudgeDismissed || 0) >= suggested) return null;

  const currentName = t(`onboarding.levels.${state.profile.readingLevel}.title`);
  const nextName = t(`onboarding.levels.${suggested}.title`);

  return (
    <div className="db-level-nudge">
      <div className="db-level-nudge__glyph">☩</div>
      <div className="db-level-nudge__body">
        <div className="db-level-nudge__title">{t('dashboard.levelNudgeTitle')}</div>
        <p className="db-level-nudge__text">
          {t('dashboard.levelNudgeBody', { current: currentName, next: nextName })}
        </p>
      </div>
      <div className="db-level-nudge__actions">
        <button
          className="btn-primary btn--sm"
          onClick={() => setProfile({ readingLevel: suggested, levelNudgeDismissed: suggested })}
        >
          {t('dashboard.levelNudgeAccept', { next: nextName })}
        </button>
        <button
          className="btn-tertiary btn--sm"
          onClick={() => setProfile({ levelNudgeDismissed: suggested })}
        >
          {t('dashboard.levelNudgeDismiss')}
        </button>
      </div>
    </div>
  );
}
