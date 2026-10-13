// src/views/profile/sections/ReaderPrefsSection.jsx — favourite genres, mood, reading level, goal.

import { useState } from 'react';
import { MOODS, moodTitleKey } from '../../../data/moods';
import ChipToggleGroup from '../../../components/primitives/ChipToggleGroup';

// ── Favorite genres + current mood (v0.38, editable from Profile) ────────────
// MOODS imported from data/moods.js — this was one of four hand-kept copies.
export const GENRE_MAX = 5;

export const MOOD_MAX = 3;

export const GOALS = ['level-up', 'explore', 'random'];

export const LEVELS = [1, 2, 3, 4, 5];

export default function ReaderPrefsSection({ state, setProfile, t }) {
  const [editingGenres, setEditingGenres] = useState(false);
  const [editingMood, setEditingMood] = useState(false);
  const [editingLevel, setEditingLevel] = useState(false); // v0.50
  const [editingGoal, setEditingGoal] = useState(false);   // v0.50
  const favoriteGenres = state.profile.favoriteGenres || [];
  const currentMood = state.profile.currentMood || [];
  const readingLevel = state.profile.readingLevel || null;
  const goal = state.profile.goal || null;
  const genreOptions = (state.genres || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="pf-section">
      <div className="pf-pref">
        <h2 className="pf-section__title">{t('profile.labelFavoriteGenres')}</h2>
        {!editingGenres ? (
            <>
              <p className="pf-pref__value">
              {favoriteGenres.length > 0 ? favoriteGenres.join(', ') : t('profile.genresNotSet')}
              </p>
              <button className="btn-secondary" onClick={() => setEditingGenres(true)}>{t('common.edit')}</button>
            </>
        ) : (
          <>
            <ChipToggleGroup
              className="chip-grid"
              selectedClassName="selected"
              label={t('profile.labelFavoriteGenres')}
              options={genreOptions.map((g) => ({ value: g.name, label: g.name }))}
              value={favoriteGenres}
              onChange={(next) => setProfile({ favoriteGenres: next })}
              max={GENRE_MAX}
            />
            <p className="onb-hint">{t('profile.genreMaxHint', { max: GENRE_MAX })}</p>
            <button className="btn-secondary" onClick={() => setEditingGenres(false)}>{t('common.done')}</button>
          </>
        )}
      </div>

      <div className="pf-pref">
        <h2 className="pf-section__title">{t('profile.labelCurrentMood')}</h2>
        {!editingMood ? (
            <>
              <p className="pf-pref__value">
              {currentMood.length > 0 ? currentMood.map((id) => t(moodTitleKey(id))).join(', ') : t('profile.moodNotSet')}
              </p>
              <button className="btn-secondary" onClick={() => setEditingMood(true)}>{t('common.edit')}</button>
            </>
        ) : (
          <>
            <ChipToggleGroup
              className="chip-grid"
              selectedClassName="selected"
              label={t('profile.labelCurrentMood')}
              options={MOODS.map((id) => ({ value: id, label: t(moodTitleKey(id)) }))}
              value={currentMood}
              onChange={(next) => setProfile({ currentMood: next })}
              max={MOOD_MAX}
            />
            <p className="onb-hint">{t('profile.moodMaxHint', { max: MOOD_MAX })}</p>
            <button className="btn-secondary" onClick={() => setEditingMood(false)}>{t('common.done')}</button>
          </>
        )}
      </div>

      {/* v0.50: reading level, finally editable after onboarding */}
      <div className="pf-pref">
        <h2 className="pf-section__title">{t('profile.labelReadingLevel')}</h2>
        {!editingLevel ? (
            <>
              <p className="pf-pref__value">
              {readingLevel != null
                ? `${t(`onboarding.levels.${readingLevel}.title`)} (${readingLevel}/5)`
                : t('profile.notSet')}
              </p>
              <button className="btn-secondary" onClick={() => setEditingLevel(true)}>{t('common.edit')}</button>
            </>
        ) : (
          <>
            <div className="chip-grid">
              {LEVELS.map((v) => (
                <button
                  key={v}
                  className={`chip ${readingLevel === v ? 'selected' : ''}`}
                  title={t(`onboarding.levels.${v}.sub`)}
                  onClick={() => setProfile({ readingLevel: v })}
                >
                  {t(`onboarding.levels.${v}.title`)}
                </button>
              ))}
            </div>
            <p className="onb-hint">{t('profile.levelEditHint')}</p>
            <button className="btn-secondary" onClick={() => setEditingLevel(false)}>{t('common.done')}</button>
          </>
        )}
      </div>

      {/* v0.50: reading goal (intent), finally editable after onboarding */}
      <div className="pf-pref">
        <h2 className="pf-section__title">{t('profile.labelGoal')}</h2>
        {!editingGoal ? (
            <>
              <p className="pf-pref__value">
              {goal ? t(`onboarding.goals.${goal}.title`) : t('profile.notSet')}
              </p>
              <button className="btn-secondary" onClick={() => setEditingGoal(true)}>{t('common.edit')}</button>
            </>
        ) : (
          <>
            <div className="chip-grid">
              {GOALS.map((g) => (
                <button
                  key={g}
                  className={`chip ${goal === g ? 'selected' : ''}`}
                  title={t(`onboarding.goals.${g}.sub`)}
                  onClick={() => setProfile({ goal: g })}
                >
                  {t(`onboarding.goals.${g}.title`)}
                </button>
              ))}
            </div>
            <p className="onb-hint">{t('profile.goalEditHint')}</p>
            <button className="btn-secondary" onClick={() => setEditingGoal(false)}>{t('common.done')}</button>
          </>
        )}
      </div>
    </div>
  );
}
