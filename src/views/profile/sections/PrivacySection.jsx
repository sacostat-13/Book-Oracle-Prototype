// ── Privacy section ───────────────────────────────────────────────────────────
export default function PrivacySection({ profile, updatePrivacyPrefs, t }) {
  function toggle(field, current) {
    updatePrivacyPrefs({ [field]: !current });
  }

  const Toggle = ({ label, value, onToggle }) => (
    <div className="pf-toggle-row">
      <span className="pf-toggle-label">{label}</span>
      <button
        onClick={onToggle}
        className={`pf-toggle-switch${value ? ' pf-toggle-switch--on' : ''}`}
        aria-pressed={value}
      />
    </div>
  );

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">
        {t('profile.labelPrivacy')}
      </h2>
      <Toggle label={t('profile.privacyDiscoverable')} value={profile.isDiscoverable} onToggle={() => toggle('isDiscoverable', profile.isDiscoverable)} />
      <Toggle label={t('profile.privacyEmailNotifs')} value={profile.emailNotifications} onToggle={() => toggle('emailNotifications', profile.emailNotifications)} />
    </div>
  );
}
