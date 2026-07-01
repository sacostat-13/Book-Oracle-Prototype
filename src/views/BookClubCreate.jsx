// src/views/BookClubCreate.jsx — v0.31

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(176, 140, 63, 0.04)',
  border: '1px solid rgba(176, 140, 63, 0.25)',
  borderRadius: 'var(--ro-radius-sm)', padding: '0.6rem 0.85rem',
  color: 'var(--paper)', fontFamily: 'var(--ro-font-display)',
  fontSize: '1.05rem', lineHeight: 1.5,
};

const labelStyle = {
  display: 'block', fontFamily: 'var(--ro-font-mono)',
  fontSize: '0.72rem', letterSpacing: '0.15em',
  textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem',
};

export default function BookClubCreate() {
  const { createClub, state } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGenreIds, setSelectedGenreIds] = useState([]);
  const [saving, setSaving] = useState(false);

  const genres = state.genres || [];

  function toggleGenre(id) {
    setSelectedGenreIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    const club = await createClub({ name: name.trim(), description: description.trim() || undefined, genreIds: selectedGenreIds });
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
          <label style={labelStyle}>{t('clubs.fieldName')}</label>
          <input
            style={inputStyle}
            placeholder={t('clubs.fieldNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus maxLength={120}
          />
        </div>

        <div>
          <label style={labelStyle}>
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
            <label style={labelStyle}>
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

        <div className="club-form__actions">
          <button className="btn btn-secondary" onClick={() => go('book-clubs')}>{t('clubs.cancel')}</button>
          <button className="btn" onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? t('clubs.creating') : t('clubs.createButton')}
          </button>
        </div>
      </div>
    </>
  );
}
