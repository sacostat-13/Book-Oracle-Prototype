// src/views/BookClubCreate.jsx — v0.31
// v0.40: visibility (private/public), join_mode, max_members, mood tags.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';

// v0.38 onboarding mood taxonomy — reused here so clubs can be tagged and
// later filtered in the directory by the same vibe chips as onboarding.
const MOODS = ['comfort', 'challenge', 'escapism', 'mind-bending', 'character-driven', 'atmospheric', 'fast-paced', 'short-read'];

export default function BookClubCreate() {
  const { createClub, state } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGenreIds, setSelectedGenreIds] = useState([]);
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [visibility, setVisibility] = useState('private');
  const [joinMode, setJoinMode] = useState('auto');
  const [maxMembers, setMaxMembers] = useState('');
  const [saving, setSaving] = useState(false);

  const genres = state.genres || [];
  const isPublic = visibility === 'public';

  function toggleGenre(id) {
    setSelectedGenreIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  function toggleMood(id) {
    setSelectedMoods((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    const parsedMax = maxMembers.trim() ? Math.max(1, parseInt(maxMembers, 10) || 0) || null : null;
    const club = await createClub({
      name: name.trim(),
      description: description.trim() || undefined,
      genreIds: selectedGenreIds,
      moods: isPublic ? selectedMoods : [],
      visibility,
      joinMode: isPublic ? joinMode : 'auto',
      maxMembers: isPublic ? parsedMax : null,
    });
    setSaving(false);
    if (club) go('book-club-detail', { clubId: club.id });
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>{t('clubs.createBreadcrumb')}</a> · {t('clubs.createNewBreadcrumb')}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{t('clubs.createEyebrow')}</div>
        <h1 className="page-title">{tNode('clubs.createPageTitle')}</h1>
        <p className="club-form__desc">
          {t('clubs.createSubtitle')}
        </p>
      </div>

      <div className="club-form">
        <div>
          <label className="field-label">{t('clubs.fieldName')}</label>
          <input
            className="input"
            placeholder={t('clubs.fieldNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus maxLength={120}
          />
        </div>

        <div>
          <label className="field-label">
            {t('clubs.fieldDescription')}{' '}
            <span className="club-form__optional">({t('clubs.fieldOptional')})</span>
          </label>
          <textarea
            className="textarea"
            placeholder={t('clubs.fieldDescPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        {genres.length > 0 && (
          <div>
            <label className="field-label">
              {t('clubs.fieldGenres')}{' '}
              <span className="club-form__optional">({t('clubs.fieldOptional')})</span>
            </label>
            <div className="club-form__genre-row">
              {genres.map((g) => {
                const selected = selectedGenreIds.includes(g.id);
                return (
                  <button
                    key={g.id} type="button" onClick={() => toggleGenre(g.id)}
                    className={`chip${selected ? ' chip--active' : ''}`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* v0.40: visibility — private (invite-only) vs public (discoverable) */}
        <div>
          <label className="field-label">{t('clubs.fieldVisibility')}</label>
          <div className="club-form__genre-row">
            <button
              type="button" onClick={() => setVisibility('private')}
              className={`chip${!isPublic ? ' chip--active' : ''}`}
            >
              {t('clubs.visibilityPrivate')}
            </button>
            <button
              type="button" onClick={() => setVisibility('public')}
              className={`chip${isPublic ? ' chip--active' : ''}`}
            >
              {t('clubs.visibilityPublic')}
            </button>
          </div>
          <p className="club-form__desc">
            {isPublic ? t('clubs.visibilityPublicHint') : t('clubs.visibilityPrivateHint')}
          </p>
        </div>

        {isPublic && (
          <>
            <div>
              <label className="field-label">{t('clubs.fieldJoinMode')}</label>
              <div className="club-form__genre-row">
                <button
                  type="button" onClick={() => setJoinMode('auto')}
                  className={`chip${joinMode === 'auto' ? ' chip--active' : ''}`}
                >
                  {t('clubs.joinModeAuto')}
                </button>
                <button
                  type="button" onClick={() => setJoinMode('approval')}
                  className={`chip${joinMode === 'approval' ? ' chip--active' : ''}`}
                >
                  {t('clubs.joinModeApproval')}
                </button>
              </div>
              <p className="club-form__desc">
                {joinMode === 'auto' ? t('clubs.joinModeAutoHint') : t('clubs.joinModeApprovalHint')}
              </p>
            </div>

            <div>
              <label className="field-label">
                {t('clubs.fieldMaxMembers')}{' '}
                <span className="club-form__optional">({t('clubs.fieldOptional')} — {t('clubs.maxMembersUnlimitedHint')})</span>
              </label>
              <input
                className="input"
                type="number" min="1" inputMode="numeric"
                placeholder={t('clubs.maxMembersPlaceholder')}
                value={maxMembers}
                onChange={(e) => setMaxMembers(e.target.value)}
              />
              <p className="club-form__desc">{t('clubs.maxMembersHint')}</p>
            </div>

            <div>
              <label className="field-label">
                {t('clubs.fieldMoods')}{' '}
                <span className="club-form__optional">({t('clubs.fieldOptional')})</span>
              </label>
              <div className="club-form__genre-row">
                {MOODS.map((id) => {
                  const selected = selectedMoods.includes(id);
                  return (
                    <button
                      key={id} type="button" onClick={() => toggleMood(id)}
                      className={`chip${selected ? ' chip--active' : ''}`}
                    >
                      {t(`onboarding.moods.${id}.title`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="club-form__actions">
          <button className="btn-secondary" onClick={() => go('book-clubs')}>{t('clubs.cancel')}</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? t('clubs.creating') : t('clubs.createButton')}
          </button>
        </div>
      </div>
    </>
  );
}
