import { useState, Fragment } from 'react';
import { STANDARD_AVATARS, GENRE_AVATARS } from '../../../data/avatars';
import Avatar from '../../../components/Avatar';

// ── v0.52: Avatar picker — Google photo or a preset sigil ────────────────────
// The reader's OAuth photo lives in user.user_metadata even after they switch
// to a sigil, so "use your Google photo" can always bring it back. Presets are
// site-relative SVG paths in profiles.avatar_url — no storage bucket involved.
export default function AvatarSection({ state, user, updateAvatar, showToast, t }) {
  const [saving, setSaving] = useState(false);
  const current = state.profile.avatarUrl || null;
  const oauthPhoto = user?.user_metadata?.avatar_url || null;
  const usingOauth = !!current && current === oauthPhoto;

  async function pick(url) {
    if (saving || url === current) return;
    setSaving(true);
    const res = await updateAvatar(url);
    setSaving(false);
    if (res?.error) showToast(t('profile.avatarSaveFailed'));
  }

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">
        {t('profile.sectionAvatar')}
      </h2>
      <p className="pf-section__hint">
        {t('profile.avatarHint')}
      </p>
      <div className="pf-avatar-row">
        <Avatar displayName={state.profile.displayName || '?'} avatarUrl={current} size={64} />
        <div className="pf-avatar-row__actions">
          {oauthPhoto && !usingOauth && (
            <button className="btn-tertiary btn--sm" disabled={saving} onClick={() => pick(oauthPhoto)}>
              {t('profile.avatarUseGoogle')}
            </button>
          )}
          {current && (
            <button className="btn-text" disabled={saving} onClick={() => pick(null)}>
              {t('profile.avatarClear')}
            </button>
          )}
        </div>
      </div>
      <div className="pf-avatar-set-label">{t('profile.avatarStandardSet')}</div>
      <div className="pf-avatar-grid">
        {STANDARD_AVATARS.map((a) => (
          <AvatarChoice key={a.key} url={a.file} label={a.label} current={current} saving={saving} pick={pick} />
        ))}
      </div>
      <div className="pf-avatar-set-label">{t('profile.avatarGenreSet')}</div>
      <div className="pf-avatar-grid">
        {GENRE_AVATARS.map((a) => (
          <Fragment key={a.key}>
            {a.solid && <AvatarChoice url={a.solid} label={a.label} current={current} saving={saving} pick={pick} />}
            {a.outline && <AvatarChoice url={a.outline} label={`${a.label} — ${t('profile.avatarOutline')}`} current={current} saving={saving} pick={pick} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// One gallery cell. The design system pairs every genre motif in a solid and
// an outline (ring) variant; standard-set picks are solid only.
export function AvatarChoice({ url, label, current, saving, pick }) {
  const active = current === url;
  return (
    <button
      className={`pf-avatar-choice${active ? ' pf-avatar-choice--active' : ''}`}
      disabled={saving}
      onClick={() => pick(url)}
      title={label}
      aria-label={label}
    >
      <img src={url} alt="" loading="lazy" />
    </button>
  );
}
