import { useRef, useState } from 'react';
import { checkUsernameAvailability, validateUsername } from '../../../hooks/useFollows';
import ShareModal from '../../../components/ShareModal';

// ── Username section ──────────────────────────────────────────────────────────
export default function UsernameSection({ profile, user, updateUsername, t }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [availability, setAvailability] = useState(null); // 'available'|'taken'|'invalid'|null
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [shareOpen, setShareOpen] = useState(false); // v0.43
  const debounceRef = useRef(null);

  function onInputChange(val) {
    setInput(val);
    setAvailability(null);
    clearTimeout(debounceRef.current);
    if (!val) return;
    const lower = val.toLowerCase().trim();
    const valid = validateUsername(lower);
    if (valid !== 'ok') { setAvailability('invalid'); return; }
    if (lower === profile.username) { setAvailability('available'); return; }
    debounceRef.current = setTimeout(async () => {
      const result = await checkUsernameAvailability(lower, user.id);
      setAvailability(result);
    }, 400);
  }

  async function save() {
    if (availability !== 'available') return;
    setSaving(true);
    setError(null);
    const result = await updateUsername(input.toLowerCase().trim());
    setSaving(false);
    if (result?.ok) { setEditing(false); }
    else { setError(result?.error || 'error'); }
  }

  const profileUrl = profile.username ? `${window.location.origin}/u/${profile.username}` : null;
  const availLabel = availability === 'available' ? t('profile.usernameAvailable') : availability === 'taken' ? t('profile.usernameTaken') : availability === 'invalid' ? t('profile.usernameInvalid') : null;

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">
        {t('profile.labelUsername')}
      </h2>
      <p className="pf-section__hint">
        {t('profile.usernameClaimSub')}
      </p>

      {editing ? (
        <div className="pf-edit-stack">
          <div className="pf-edit-row">
            <span className="pf-edit-prefix">@</span>
            <input
              type="text" maxLength={24}
              placeholder="yourname"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus
              className="input"
            />
          </div>
          {availLabel && (
            <div className={`status${availability === 'available' ? ' status--success' : availability === 'taken' ? ' status--error' : ''}`}>{availLabel}</div>
          )}
          {input && (
            <div className="pf-username-url">
              {window.location.origin}/u/{input.toLowerCase()}
            </div>
          )}
          <div className="pf-edit-row pf-edit-row--wrap">
            <button className="btn-tertiary btn--sm" onClick={save} disabled={availability !== 'available' || saving}>
              {saving ? t('profile.usernameSaving') : t('common.save')}
            </button>
            <button className="btn-text" onClick={() => { setEditing(false); setError(null); }}>{t('common.cancel')}</button>
          </div>
          {error && <div className="pf-error">{error}</div>}
        </div>
      ) : profile.username ? (
        <div className="pf-username-row">
          <span className="pf-username-value">@{profile.username}</span>
          {profileUrl && (
            <span className="pf-username-url">{profileUrl}</span>
          )}
          <button className="btn-tertiary btn--sm" onClick={() => { setInput(profile.username || ''); setAvailability(null); setEditing(true); }}>
            {t('profile.usernameEdit')}
          </button>
          {profileUrl && (
            <button className="btn-tertiary btn--sm" onClick={() => setShareOpen(true)}>
              ↗ {t('share.shareProfile')}
            </button>
          )}
        </div>
      ) : (
        <button className="btn-tertiary btn--sm" onClick={() => { setInput(''); setAvailability(null); setEditing(true); }}>
          {t('profile.usernameClaim')}
        </button>
      )}

      {/* v0.43: page-share modal */}
      {shareOpen && profileUrl && (
        <ShareModal
          title={profile.displayName || `@${profile.username}`}
          text={t('share.text.profile', { name: profile.displayName || profile.username })}
          url={profileUrl}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
