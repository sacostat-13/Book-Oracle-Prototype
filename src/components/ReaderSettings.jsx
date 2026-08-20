// src/components/ReaderSettings.jsx — v0.66
//
// The settings that came with follows: who may see your shelves, whose updates
// reach your feed, the bio and genres that make a profile worth opening, and
// the curator request.
//
// These write to REAL COLUMNS on profiles (bio, favorite_genres,
// shelf_visibility) rather than into the preferences blob, because two of them
// are read by things other than the client: shelf_visibility is consulted by
// can_view_shelf() inside the read_books policy, and favorite_genres is what a
// curator directory will filter on. A setting the database has to reason about
// does not belong in a JSON column.
//
// feedScope is the exception and stays in preferences — nothing server-side
// reads it, it only decides which query the dashboard widget runs.
//
// ── Two sections, two tabs ───────────────────────────────────────────────────
// `section="identity"`  → Account tab: the bio, and the curator request.
// `section="privacy"`   → Privacy tab: shelf visibility, feed scope.
//
// These shipped together because follows needed all four at once, but they do
// not BELONG together. A reader looking for "where do I write something about
// myself" does not open a tab called Privacy, and a bio filed under privacy
// controls reads as something to be guarded rather than something to write.
// One component, because they share the column-writing helper; two mount
// points, because they answer different questions.

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { requestCurator, getMyCuratorRequest } from '../lib/useFollows';

const BIO_MAX = 280;

const VISIBILITY = [
  { value: 'public',    labelKey: 'visibilityPublic',    descKey: 'visibilityPublicDesc' },
  { value: 'followers', labelKey: 'visibilityFollowers', descKey: 'visibilityFollowersDesc' },
  { value: 'private',   labelKey: 'visibilityPrivate',   descKey: 'visibilityPrivateDesc' },
];

const FEED_SCOPE = [
  { value: 'both',    labelKey: 'feedScopeBoth' },
  { value: 'mutuals', labelKey: 'feedScopeMutuals' },
];

// ── One radio row ────────────────────────────────────────────────────────────

function ChoiceRow({ checked, onChange, label, desc, name }) {
  return (
    <label className={`pf-choice${checked ? ' pf-choice--on' : ''}`}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="pf-choice__radio"
      />
      <span className="pf-choice__body">
        <span className="pf-choice__label">{label}</span>
        {desc && <span className="pf-choice__desc">{desc}</span>}
      </span>
    </label>
  );
}

export default function ReaderSettings({ section = 'privacy' }) {
  const { user } = useAuth();
  const { state, setProfile, showToast } = useData();
  const t = useT();

  const [bio, setBio] = useState(state.profile?.bio || '');
  const [savingBio, setSavingBio] = useState(false);
  const [curatorReq, setCuratorReq] = useState(undefined); // undefined = loading
  const [curatorMsg, setCuratorMsg] = useState('');
  const [sendingReq, setSendingReq] = useState(false);

  useEffect(() => { setBio(state.profile?.bio || ''); }, [state.profile?.bio]);

  useEffect(() => {
    if (!user) return;
    getMyCuratorRequest().then(setCuratorReq);
  }, [user]);

  if (!user) return null;

  const visibility = state.profile?.shelfVisibility || 'followers';
  const feedScope = state.profile?.feedScope || 'both';

  async function saveColumn(column, value, localKey) {
    const { error } = await supabase
      .from('profiles')
      .update({ [column]: value })
      .eq('id', user.id);
    if (error) {
      console.error(`profiles.${column} update failed`, error);
      showToast?.("Couldn't save that", true);
      return false;
    }
    setProfile?.({ [localKey]: value });
    return true;
  }

  async function saveBio() {
    setSavingBio(true);
    try {
      const trimmed = bio.trim().slice(0, BIO_MAX);
      if (await saveColumn('bio', trimmed || null, 'bio')) {
        showToast?.(t('common.done'));
      }
    } finally {
      setSavingBio(false);
    }
  }

  async function sendCuratorRequest() {
    setSendingReq(true);
    try {
      const res = await requestCurator(curatorMsg);
      if (res.ok) {
        setCuratorReq({ status: 'pending', message: curatorMsg });
        setCuratorMsg('');
      } else {
        showToast?.("Couldn't send that request", true);
      }
    } finally {
      setSendingReq(false);
    }
  }

  return (
    <>
      {section === 'privacy' && (
      <>
      {/* ── Shelf visibility ─────────────────────────────────────────────── */}
      <div className="pf-section">
        <h2 className="pf-section__title">{t('profile.labelVisibility')}</h2>
        <div className="pf-choices">
          {VISIBILITY.map(({ value, labelKey, descKey }) => (
            <ChoiceRow
              key={value}
              name="shelf-visibility"
              checked={visibility === value}
              onChange={() => saveColumn('shelf_visibility', value, 'shelfVisibility')}
              label={t(`profile.${labelKey}`)}
              desc={t(`profile.${descKey}`)}
            />
          ))}
        </div>
      </div>

      {/* ── Feed scope ───────────────────────────────────────────────────── */}
      <div className="pf-section">
        <h2 className="pf-section__title">{t('profile.labelFeedScope')}</h2>
        <div className="pf-choices">
          {FEED_SCOPE.map(({ value, labelKey }) => (
            <ChoiceRow
              key={value}
              name="feed-scope"
              checked={feedScope === value}
              onChange={() => setProfile?.({ feedScope: value })}
              label={t(`profile.${labelKey}`)}
            />
          ))}
        </div>
      </div>
      </>
      )}

      {section === 'identity' && (
      <>
      {/* ── Bio ──────────────────────────────────────────────────────────── */}
      <div className="pf-section">
        <h2 className="pf-section__title">{t('profile.labelBio')}</h2>
        <div className="field field-full">
          <textarea
            className="textarea"
            rows={3}
            value={bio}
            maxLength={BIO_MAX}
            placeholder={t('profile.bioPlaceholder')}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="pf-value-row">
            <span className="lv-item-note">{t('profile.bioCounter', { n: bio.length })}</span>
            <button
              className="btn-tertiary btn--sm"
              onClick={saveBio}
              disabled={savingBio || bio === (state.profile?.bio || '')}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Curator ──────────────────────────────────────────────────────── */}
      <div className="pf-section">
        <h2 className="pf-section__title">{t('kindred.curator')}</h2>
        {state.profile?.isCurator ? (
          <p className="pf-text">{t('profile.curatorRequestGranted')}</p>
        ) : curatorReq === undefined ? null
          : curatorReq?.status === 'pending' ? (
            <p className="pf-text">{t('profile.curatorRequestPending')}</p>
          ) : (
            <>
              <p className="pf-notif-desc">{t('profile.curatorRequestDesc')}</p>
              {curatorReq?.status === 'denied' && (
                <p className="pf-notif-desc">{t('profile.curatorRequestDenied')}</p>
              )}
              <div className="field field-full">
                <textarea
                  className="textarea"
                  rows={3}
                  value={curatorMsg}
                  maxLength={500}
                  placeholder={t('profile.curatorRequestPlaceholder')}
                  onChange={(e) => setCuratorMsg(e.target.value)}
                />
                <button
                  className="btn-secondary btn--sm"
                  onClick={sendCuratorRequest}
                  disabled={sendingReq || !curatorMsg.trim()}
                >
                  {t('profile.curatorRequestSend')}
                </button>
              </div>
            </>
          )}
      </div>
      </>
      )}
    </>
  );
}
