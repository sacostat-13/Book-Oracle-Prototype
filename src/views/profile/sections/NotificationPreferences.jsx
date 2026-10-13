import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/api/supabase';

export const DEFAULT_PREFS = {
  book_club: true,
  follows: true,
  announcements: true,
  email: true,
  // v0.63. Defaults ON, and rollup_list_notifications reads the same key with
  // coalesce(..., true) — the column has no `curated_lists` entry on any
  // profile created before that migration, and defaulting those to off would
  // make following look broken for every existing account.
  curated_lists: true,
};

export default function NotificationPreferences({ t, user, showToast }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('notification_preferences')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPrefs({ ...DEFAULT_PREFS, ...(data?.notification_preferences || {}) });
      });
  }, [user]);

  async function save(next) {
    setPrefs(next);
    setSaving(true);
    await supabase.from('profiles').update({ notification_preferences: next }).eq('id', user.id);
    setSaving(false);
    showToast(t('notifications.prefSaved'));
  }

  if (!prefs) return null;

  const rows = [
    { key: 'book_club', label: t('notifications.prefBookClub'), desc: t('notifications.prefBookClubDesc'), locked: false },
    { key: 'follows', label: t('notifications.prefFollows'), desc: t('notifications.prefFollowsDesc'), locked: false },
    { key: 'curated_lists', label: t('notifications.prefCuratedLists'), desc: t('notifications.prefCuratedListsDesc'), locked: false },
    { key: 'announcements', label: t('notifications.prefAnnouncements'), desc: t('notifications.prefAnnouncementsDesc'), locked: true },
    { key: 'email', label: t('notifications.prefEmail'), desc: t('notifications.prefEmailDesc'), locked: false },
  ];

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">
        {t('notifications.prefTitle')}
      </h2>
      <div>
        {rows.map(({ key, label, desc, locked }) => (
          <div key={key} className="pf-toggle-row">
            <div>
              <div className={`pf-toggle-label${locked ? ' pf-notif-label--locked' : ''}`}>{label}</div>
              <div className="pf-notif-desc">{desc}</div>
            </div>
            <button
              onClick={() => !locked && save({ ...prefs, [key]: !prefs[key] })}
              disabled={locked || saving}
              aria-pressed={prefs[key] || locked}
              className={`pf-toggle-switch${(prefs[key] || locked) ? ' pf-toggle-switch--on' : ''}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
