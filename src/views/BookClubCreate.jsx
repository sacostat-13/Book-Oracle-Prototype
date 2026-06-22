// src/views/BookClubCreate.jsx — v0.31

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(176, 140, 63, 0.04)',
  border: '1px solid rgba(176, 140, 63, 0.25)',
  borderRadius: '2px', padding: '0.6rem 0.85rem',
  color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif",
  fontSize: '1.05rem', lineHeight: 1.5,
};

const labelStyle = {
  display: 'block', fontFamily: "'Special Elite', monospace",
  fontSize: '0.72rem', letterSpacing: '0.15em',
  textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem',
};

export default function BookClubCreate() {
  const { createClub, state } = useData();
  const { go } = useRouter();
  const t = useT();

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
        <h1 className="page-title">{t('clubs.createTitle', { accent: <span className="accent">{t('clubs.createTitleAccent')}</span> })}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.5rem' }}>
          {t('clubs.createSubtitle')}
        </p>
      </div>

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
            <span style={{ opacity: 0.45, textTransform: 'none', letterSpacing: 0 }}>({t('clubs.fieldOptional')})</span>
          </label>
          <textarea
            style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
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
              <span style={{ opacity: 0.45, textTransform: 'none', letterSpacing: 0 }}>({t('clubs.fieldOptional')})</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginTop: '0.1rem' }}>
              {genres.map((g) => {
                const selected = selectedGenreIds.includes(g.id);
                return (
                  <button
                    key={g.id} type="button" onClick={() => toggleGenre(g.id)}
                    style={{
                      padding: '0.3rem 0.75rem', borderRadius: '1rem',
                      border: `1px solid ${selected ? 'rgba(176,140,63,0.7)' : 'rgba(176,140,63,0.2)'}`,
                      background: selected ? 'rgba(176,140,63,0.12)' : 'transparent',
                      color: selected ? 'var(--gilt-bright, #e8c560)' : 'var(--paper-aged)',
                      fontFamily: "'Special Elite', monospace", fontSize: '0.7rem',
                      letterSpacing: '0.08em', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => go('book-clubs')}>{t('clubs.cancel')}</button>
          <button className="btn" onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? t('clubs.creating') : t('clubs.createButton')}
          </button>
        </div>
      </div>
    </>
  );
}
