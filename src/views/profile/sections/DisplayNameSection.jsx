import { useState } from 'react';

export default function DisplayNameSection({ profile, updateDisplayName, t }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await updateDisplayName(input);
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">
        {t('profile.labelDisplayName')}
      </h2>
      <p className="pf-section__hint">
        {t('profile.displayNameSub')}
      </p>
      {editing ? (
        <div className="pf-edit-row pf-edit-row--wrap">
          <input
            type="text" maxLength={50}
            placeholder={t('profile.displayNamePlaceholder')}
            defaultValue={profile.displayName || ''}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
            className="input"
          />
          <button className="btn-tertiary btn--sm" onClick={save} disabled={saving}>{saving ? t('profile.usernameSaving') : t('common.save')}</button>
          <button className="btn-text" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
        </div>
      ) : (
        <div className="pf-value-row">
          <span className="pf-account-card__name">
            {profile.displayName || <span className="lv-hl-muted">{t('profile.notSet')}</span>}
          </span>
          <button className="btn-tertiary btn--sm" onClick={() => { setInput(profile.displayName || ''); setEditing(true); }}>
            {t('profile.usernameEdit')}
          </button>
        </div>
      )}
    </div>
  );
}
