// src/views/profile/sections/TitlesSection.jsx — choose which earned Reader Title to wear.

import { TITLE_TIERS, isTierEarned, sanitizeTitleKey } from '../../../lib/achievements/readerRanks';

// ── v0.51: Reader Titles — the app-granted rank ladder ───────────────────────
// Titles cannot be typed in; they are earned by reading (thresholds in
// titles.js) and the reader chooses which earned one to wear. The chosen key
// rides preferences.displayTitle and renders wherever other readers see this
// reader's name.
export default function TitlesSection({ state, setProfile, t }) {
  const booksRead = state.library.length;
  const worn = sanitizeTitleKey(state.profile.displayTitle);

  function wear(key) {
    // Guard at the door: only earned tiers are selectable (the UI disables
    // locked rows, but this keeps a stale click honest too).
    if (key !== null && !isTierEarned(key, booksRead)) return;
    setProfile({ displayTitle: key });
  }

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">
        {t('profile.sectionTitles')}
      </h2>
      <p className="pf-section__hint">
        {t('profile.titlesHint')}
      </p>
      <div className="pf-titles">
        {TITLE_TIERS.map((tier) => {
          const earned = isTierEarned(tier.key, booksRead);
          const active = worn === tier.key;
          return (
            <button
              key={tier.key}
              className={`pf-title-row${active ? ' pf-title-row--active' : ''}${earned ? '' : ' pf-title-row--locked'}`}
              disabled={!earned}
              onClick={() => wear(active ? null : tier.key)}
              title={earned ? (active ? t('profile.titleRemove') : t('profile.titleWear')) : undefined}
            >
              <span className="pf-title-row__glyph">{earned ? (active ? '\u2726' : '\u2727') : '\u25C7'}</span>
              <span className="pf-title-row__name">{t(`titles.${tier.key}`)}</span>
              <span className="pf-title-row__meta">
                {earned
                  ? (active ? t('profile.titleWearing') : t('profile.titleEarned'))
                  : t('profile.titleLockedAt', { count: tier.threshold })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
