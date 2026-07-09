import { useRef, useMemo, useState, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { parseGoodreadsCSV } from '../lib/goodreadsImport';
import { findBookByTitle, bookKey, openBookTab } from '../lib/bookHelpers';
import { useFriends, checkUsernameAvailability, validateUsername } from '../lib/useFriends';
import { supabase } from '../lib/supabase';
import CornerBrackets from '../components/CornerBrackets';
import ShareModal from '../components/ShareModal';

const LEVEL_NAMES = {
  1: 'Casual companion', 2: 'Steady reader', 3: 'Devoted reader',
  4: 'Literary appetite', 5: 'Voracious + experimental',
};
const GOAL_NAMES = {
  'level-up': 'Level up my reading',
  explore: 'Get into a new topic or genre',
  random: 'Just give me something to read',
};

// ── Small stat card ──────────────────────────────────────────────────────────
function StatCard({ value, label, sub }) {
  return (
    <div className="pf-stat-card">
      <div className="pf-stat-value">{value}</div>
      <div className="pf-stat-label">{label}</div>
      {sub && <div className="pf-stat-sub">{sub}</div>}
    </div>
  );
}

// ── Horizontal bar for genre breakdown ───────────────────────────────────────
// NOTE: the wrapper previously reused the ".pf-genre-bar" class name, but in
// the design system ".pf-genre-bar" IS the 2px track itself (overflow:hidden) —
// applying it to the wrapper silently clipped/collapsed the head + track.
// Correct wrapper is ".pf-genre-row"; track is ".pf-genre-bar"; fill is
// ".pf-genre-fill" (".pf-bar-track"/".pf-bar-fill" don't exist in the DS).
function GenreBar({ name, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="pf-genre-row">
      <div className="pf-genre-bar__head">
        <span className="pf-genre-bar__name">{name}</span>
        <span className="pf-genre-bar__count">{count}</span>
      </div>
      <div className="pf-genre-bar">
        <div className="pf-genre-fill" style={{ '--pf-bar-w': `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Reading pace by month ─────────────────────────────────────────────────────
function PaceChart({ books, onOpenBook }) {
  const [hovered, setHovered] = useState(null);   // month key being hovered
  const [selected, setSelected] = useState(null); // month key clicked for drill-down

  // Last 12 months
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      count: 0,
      booksInMonth: [],
    });
  }
  for (const b of books) {
    if (!b.dateRead) continue;
    const d = new Date(b.dateRead);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = months.find((m) => m.key === key);
    if (m) { m.count++; m.booksInMonth.push(b); }
  }
  const maxCount = Math.max(...months.map((m) => m.count), 1);

  const selectedMonth = selected ? months.find((m) => m.key === selected) : null;

  return (
    <div className="pf-pace-panel">
      {/* Bar chart */}
      <div className="pf-pace-bars">
        {months.map((m) => {
          const isHovered = hovered === m.key;
          const isSelected = selected === m.key;
          return (
            <div
              key={m.key}
              className="pf-pace-bar-col"
              onMouseEnter={() => setHovered(m.key)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              {isHovered && (
                <div className="pf-pace-tooltip">
                  {m.count} book{m.count !== 1 ? 's' : ''}<br />
                  <span className="pf-pace-tooltip__meta">{m.fullLabel}</span>
                  {m.count > 0 && <div className="pf-pace-tooltip__hint">click to see list</div>}
                </div>
              )}
              {/* Bar */}
              <div
                onClick={() => m.count > 0 && setSelected(selected === m.key ? null : m.key)}
                className={`pf-pace-bar${isSelected ? ' pf-pace-bar--active' : isHovered && m.count > 0 ? ' pf-pace-bar--hover' : ''}`}
                style={{ '--pf-pace-h': `${Math.max(m.count / maxCount * 52, m.count > 0 ? 4 : 1)}px` }}
              />
              {/* Month label */}
              <div className="pf-pace-label">
                {m.label[0]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drill-down list for selected month */}
      {selectedMonth && selectedMonth.booksInMonth.length > 0 && (
        <div className="pf-pace-drill">
          <div className="pf-pace-drill__heading">
            {selectedMonth.fullLabel} · {selectedMonth.count} book{selectedMonth.count !== 1 ? 's' : ''}
          </div>
          <div className="pf-pace-drill__list">
            {selectedMonth.booksInMonth.map((b, i) => (
              <div
                key={b.bookId || b.t + i}
                onClick={() => onOpenBook?.(b)}
                className={`pf-pace-drill__row${onOpenBook ? ' pf-pace-drill__row--clickable' : ''}`}
              >
                {b.coverUrl ? (
                  <img src={b.coverUrl} alt={b.t} className="pf-pace-drill__cover" />
                ) : (
                  <div className="pf-pace-drill__cover--placeholder" />
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="pf-pace-drill__title">{b.t}</div>
                  <div className="pf-pace-drill__author">{b.a}</div>
                  {b.rating > 0 && (
                    <div className="pf-pace-drill__stars">
                      {'★'.repeat(b.rating)}<span className="dim">{'★'.repeat(5 - b.rating)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Username section ──────────────────────────────────────────────────────────
function UsernameSection({ profile, user, updateUsername, t }) {
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

// ── Display name section ──────────────────────────────────────────────────────
function DisplayNameSection({ profile, updateDisplayName, t }) {
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

// ── Privacy section ───────────────────────────────────────────────────────────
function PrivacySection({ profile, updatePrivacyPrefs, t }) {
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

// ── Favorite genres + current mood (v0.38, editable from Profile) ────────────
const MOODS = ['comfort', 'challenge', 'escapism', 'mind-bending', 'character-driven', 'atmospheric', 'fast-paced', 'short-read'];
const GENRE_MAX = 5;
const MOOD_MAX = 3;

function ReaderPrefsSection({ state, setProfile, t }) {
  const [editingGenres, setEditingGenres] = useState(false);
  const [editingMood, setEditingMood] = useState(false);
  const favoriteGenres = state.profile.favoriteGenres || [];
  const currentMood = state.profile.currentMood || [];
  const genreOptions = (state.genres || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  function toggleGenre(name) {
    const has = favoriteGenres.includes(name);
    if (!has && favoriteGenres.length >= GENRE_MAX) return;
    setProfile({ favoriteGenres: has ? favoriteGenres.filter((g) => g !== name) : [...favoriteGenres, name] });
  }

  function toggleMood(id) {
    const has = currentMood.includes(id);
    if (!has && currentMood.length >= MOOD_MAX) return;
    setProfile({ currentMood: has ? currentMood.filter((m) => m !== id) : [...currentMood, id] });
  }

  return (
    <div className="pf-section">
      <h2 className="pf-section__title">{t('profile.labelFavoriteGenres')}</h2>
      {!editingGenres ? (
        <p className="pf-text pf-text--gap-lg">
          {favoriteGenres.length > 0 ? favoriteGenres.join(', ') : t('profile.genresNotSet')}
          <br />
          <button className="btn-secondary" onClick={() => setEditingGenres(true)}>{t('common.edit')}</button>
        </p>
      ) : (
        <>
          <div className="chip-grid">
            {genreOptions.map((g) => (
              <button
                key={g.id}
                className={`chip ${favoriteGenres.includes(g.name) ? 'selected' : ''}`}
                disabled={!favoriteGenres.includes(g.name) && favoriteGenres.length >= GENRE_MAX}
                onClick={() => toggleGenre(g.name)}
              >
                {g.name}
              </button>
            ))}
          </div>
          <p className="onb-hint">{t('profile.genreMaxHint', { max: GENRE_MAX })}</p>
          <button className="btn-secondary" onClick={() => setEditingGenres(false)}>{t('common.done')}</button>
        </>
      )}

      <h2 className="pf-section__title">{t('profile.labelCurrentMood')}</h2>
      {!editingMood ? (
        <p className="pf-text pf-text--gap-lg">
          {currentMood.length > 0 ? currentMood.map((id) => t(`onboarding.moods.${id}.title`)).join(', ') : t('profile.moodNotSet')}
          <br />
          <button className="btn-secondary" onClick={() => setEditingMood(true)}>{t('common.edit')}</button>
        </p>
      ) : (
        <>
          <div className="chip-grid">
            {MOODS.map((id) => (
              <button
                key={id}
                className={`chip ${currentMood.includes(id) ? 'selected' : ''}`}
                disabled={!currentMood.includes(id) && currentMood.length >= MOOD_MAX}
                onClick={() => toggleMood(id)}
              >
                {t(`onboarding.moods.${id}.title`)}
              </button>
            ))}
          </div>
          <p className="onb-hint">{t('profile.moodMaxHint', { max: MOOD_MAX })}</p>
          <button className="btn-secondary" onClick={() => setEditingMood(false)}>{t('common.done')}</button>
        </>
      )}
    </div>
  );
}

// ── Friends callout — now a dedicated page ────────────────────────────────────
function FriendsCallout({ go, t }) {
  const { friends, incoming } = useFriends();
  return (
    <div className="pf-callout">
      <div>
        <div className="pf-callout__label">
          {t('profile.labelFriends')}
        </div>
        <div className="pf-callout__text">
          {friends.length > 0
            ? `${friends.length} reading friend${friends.length !== 1 ? 's' : ''}${incoming.length > 0 ? ` · ${incoming.length} request${incoming.length !== 1 ? 's' : ''}` : ''}`
            : t('profile.friendsEmpty')}
        </div>
      </div>
      <button className="btn-tertiary btn--sm" onClick={() => go('friends')}>
        {incoming.length > 0 ? `View (${incoming.length})` : 'View friends'}
      </button>
    </div>
  );
}

// ── Reading Challenge ─────────────────────────────────────────────────────────
// Full-featured annual reading goal: set target, track progress, show pace.
function ReadingChallenge({ library, readingGoalCount, setReadingGoalCount, t }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const target = readingGoalCount;

  // Books finished this calendar year
  const done = library.filter((b) => {
    if (!b.dateRead) return false;
    return new Date(b.dateRead).getFullYear() === year;
  }).length;

  // Pace calculation: days elapsed / days in year × target = expected by now
  const dayOfYear = Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const yearFraction = dayOfYear / daysInYear;
  const expected = target ? Math.round(target * yearFraction) : 0;
  const projected = target ? Math.round(done / Math.max(yearFraction, 0.01)) : 0;
  const delta = target ? done - expected : 0; // positive = ahead, negative = behind
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const reached = target && done >= target;

  function save() {
    const n = parseInt(inputVal, 10);
    if (n > 0 && n <= 9999) setReadingGoalCount(n);
    setEditing(false);
  }

  function remove() {
    setReadingGoalCount(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="pf-section">
        <p className="pf-prompt">
          {t('profile.challengeSubtitle')}
        </p>
        <div className="pf-edit-row pf-edit-row--wrap">
          <input
            type="number" min="1" max="9999"
            placeholder={t('profile.challengePlaceholder')}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
            className="input pf-input--narrow"
          />
          <button className="btn-tertiary btn--sm" onClick={save}>{t('profile.challengeSave')}</button>
          <button className="btn-text" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          {target && (
            <button
              onClick={remove}
              className="pf-btn-link"
            >
              {t('profile.challengeRemove')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="pf-section">
        <p className="pf-prompt">
          {t('profile.challengeSubtitle')}
        </p>
        <button className="btn-tertiary btn--sm" onClick={() => { setInputVal(''); setEditing(true); }}>
          {t('profile.challengeSet')}
        </button>
      </div>
    );
  }

  return (
    <div className="pf-section">
      {/* Year label */}
      <div className="pf-challenge__year">
        {t('profile.challengeYear', { year })}
      </div>

      {/* Progress bar */}
      <div className="pf-challenge__bar">
        <div
          className={`pf-challenge__bar-fill${reached ? ' pf-challenge__bar-fill--reached' : ''}`}
          style={{ '--pf-challenge-w': `${pct}%` }}
        />
        {/* Pace marker — where you should be */}
        {!reached && (
          <div
            className="pf-challenge__marker"
            style={{ '--pf-marker-x': `${Math.min(100, Math.round(yearFraction * 100))}%` }}
          />
        )}
      </div>

      {/* Counts row */}
      <div className="pf-challenge__counts">
        <span className={`pf-challenge__done${reached ? ' pf-challenge__done--reached' : ''}`}>
          {done} <span className="pf-challenge__target">/ {target}</span>
        </span>
        <span className="pf-challenge__pct">
          {pct}%
        </span>
      </div>

      {/* Status line */}
      <div className="pf-challenge__status">
        {reached ? (
          <span className="pf-hl-success">
            {t('profile.challengeComplete', { done })}
          </span>
        ) : delta === 0 ? (
          <span className="lv-hl-muted">
            {t('profile.challengePace', { projected })}
          </span>
        ) : delta > 0 ? (
          <span className="pf-hl-success">
            {t('profile.challengeAhead', { ahead: delta })} · {t('profile.challengePace', { projected })}
          </span>
        ) : (
          <span className="pf-hl-warn">
            {t('profile.challengeBehind', { behind: Math.abs(delta) })} · {t('profile.challengePace', { projected })}
          </span>
        )}
      </div>

      <button
        className="btn-tertiary btn--sm"
        onClick={() => { setInputVal(String(target)); setEditing(true); }}
      >
        {t('profile.challengeEdit')}
      </button>
    </div>
  );
}

export default function Profile() {
  const { state, resetAll, importGoodreads, showToast, setReadingGoalCount, updateUsername, updateDisplayName, updatePrivacyPrefs, setProfile } = useData();
  const { user } = useAuth();
  const { go, route } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const fileRef = useRef(null);
  const { quota, refresh: refreshQuota } = useOracleQuota();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Refresh quota when returning from Stripe Checkout so the tier badge
  // updates immediately. Must be in useEffect — never call setState during render.
  const checkoutResult = route.params?.checkout;
  useEffect(() => {
    if (checkoutResult === 'success') {
      showToast(t('subscription.checkoutSuccess'));
      // Poll a couple of times — webhook may take a moment to update the profile
      refreshQuota();
      const t1 = setTimeout(() => refreshQuota(), 2000);
      const t2 = setTimeout(() => refreshQuota(), 5000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (checkoutResult === 'cancelled') {
      showToast(t('subscription.checkoutCancelled'));
    }
  }, [checkoutResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // v0.43.1: Upgrade CTAs elsewhere in the app land here with
  // ?scrollTo=subscription — scroll the subscription section into view.
  // Delayed a tick so it wins over the router's own scroll-to-top.
  const scrollTarget = route.params?.scrollTo;
  useEffect(() => {
    if (scrollTarget !== 'subscription') return;
    const timer = setTimeout(() => {
      document.getElementById('pf-subscription')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  async function handleUpgrade() {
    if (!user) return;
    setCheckoutLoading(true);
    try {
      const { data } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
      const token = data?.session?.access_token;
      const res = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.url) {
        console.error('[checkout] no URL from create-checkout-session:', res.status, json);
        showToast(json.error || t('subscription.checkoutError'), true);
        return;
      }

      const checkoutUrl = json.url;

      // Listen for successful payment — LS fires a postMessage on completion
      function onLSMessage(e) {
        if (!e.origin.includes('lemonsqueezy.com')) return;
        if (e.data?.event === 'Checkout.Success') {
          window.removeEventListener('message', onLSMessage);
          showToast(t('subscription.checkoutSuccess'));
          refreshQuota();
          setTimeout(() => refreshQuota(), 2000);
          setTimeout(() => refreshQuota(), 5000);
        }
      }
      window.addEventListener('message', onLSMessage);

      // Use LS overlay JS if available, otherwise fall back to full redirect.
      //
      // v0.43.1: the overlay path can no longer fail silently. Url.Open()
      // doesn't throw when the embed can't render (blocked iframe, half-
      // initialized lemon.js, etc.) — it just does nothing, which read as
      // "the button is dead" in production. Now: log the path taken, wrap
      // Url.Open in try/catch, and verify the overlay actually appeared
      // ~1.5s later — if no LS iframe is in the DOM by then, hard-redirect
      // to the checkout URL, which cannot fail silently.
      const redirectFallback = () => { window.location.href = checkoutUrl; };
      const verifyOverlayOpened = () => {
        setTimeout(() => {
          const overlayVisible = !!document.querySelector('iframe[src*="lemonsqueezy.com"], .lemonsqueezy-modal');
          if (!overlayVisible) {
            console.warn('[checkout] LS overlay did not appear — falling back to redirect');
            redirectFallback();
          }
        }, 1500);
      };

      if (window.LemonSqueezy?.Url?.Open) {
        console.log('[checkout] opening via LS overlay');
        try {
          window.LemonSqueezy.Url.Open(checkoutUrl);
          verifyOverlayOpened();
        } catch (e) {
          console.error('[checkout] LS overlay threw — falling back to redirect', e);
          redirectFallback();
        }
      } else {
        // Load LS overlay JS then open
        const existing = document.getElementById('lemon-squeezy-js');
        if (!existing) {
          console.log('[checkout] loading lemon.js, then opening');
          const script = document.createElement('script');
          script.id = 'lemon-squeezy-js';
          script.src = 'https://assets.lemonsqueezy.com/lemon.js';
          script.defer = true;
          script.onload = () => {
            window.createLemonSqueezy?.();
            if (window.LemonSqueezy?.Url?.Open) {
              try {
                window.LemonSqueezy.Url.Open(checkoutUrl);
                verifyOverlayOpened();
              } catch (e) {
                console.error('[checkout] LS overlay threw — falling back to redirect', e);
                redirectFallback();
              }
            } else {
              redirectFallback();
            }
          };
          script.onerror = () => { console.warn('[checkout] lemon.js failed to load — redirecting'); redirectFallback(); };
          document.head.appendChild(script);
        } else {
          // Script tag exists but Url.Open not ready yet — just redirect
          console.log('[checkout] lemon.js present but not ready — redirecting');
          redirectFallback();
        }
      }
    } catch (e) {
      console.error('[checkout] handleUpgrade failed', e);
      showToast(t('subscription.checkoutError'), true);
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleManage() {
    if (!user) return;
    setPortalLoading(true);
    try {
      const { data } = await import('../lib/supabase').then(m => m.supabase.auth.getSession());
      const token = data?.session?.access_token;
      const res = await fetch('/.netlify/functions/manage-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else showToast(json.error || 'Could not open billing portal', true);
    } catch (e) {
      showToast('Could not open billing portal. Try again.', true);
    } finally {
      setPortalLoading(false);
    }
  }

  // ── Stats derivation ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const lib = state.library;
    const genres = state.genresByBookId || {};
    const now = new Date();
    const thisYear = now.getFullYear();

    // Total books & pages
    const totalBooks = lib.length;
    const totalPages = lib.reduce((s, b) => s + (b.pp || 0), 0);

    // This year
    const booksThisYear = lib.filter((b) => {
      if (!b.dateRead) return false;
      return new Date(b.dateRead).getFullYear() === thisYear;
    });
    const pagesThisYear = booksThisYear.reduce((s, b) => s + (b.pp || 0), 0);

    // Books with dates (for pace)
    const datedBooks = lib.filter((b) => b.dateRead);

    // Reading pace — books per month over last 12 months
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const recentDated = datedBooks.filter((b) => new Date(b.dateRead) >= twelveMonthsAgo);
    const pace = recentDated.length > 0
      ? (recentDated.length / 12).toFixed(1)
      : null;

    // Genre breakdown
    const genreCount = {};
    for (const b of lib) {
      const gs = genres[b.bookId] || [];
      for (const g of gs) {
        genreCount[g.name] = (genreCount[g.name] || 0) + 1;
      }
    }
    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Series completion
    const seriesMap = {};
    const allBooks = [...lib, ...state.wishlist, ...state.readNext];
    for (const b of allBooks) {
      if (!b.s?.name) continue;
      const n = b.s.name;
      if (!seriesMap[n]) seriesMap[n] = { name: n, total: b.s.total || null, read: 0, known: 0 };
      seriesMap[n].known++;
      if (lib.some((l) => bookKey(l) === bookKey(b))) seriesMap[n].read++;
    }
    const seriesInProgress = Object.values(seriesMap)
      .filter((s) => s.read > 0 && s.total && s.read < s.total)
      .sort((a, b) => b.read - a.read)
      .slice(0, 5);
    const seriesCompleted = Object.values(seriesMap)
      .filter((s) => s.total && s.read >= s.total)
      .length;

    // Average rating
    const rated = lib.filter((b) => b.rating > 0);
    const avgRating = rated.length > 0
      ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
      : null;

    // Favourite author (most books read)
    const authorCount = {};
    for (const b of lib) {
      if (b.a) authorCount[b.a] = (authorCount[b.a] || 0) + 1;
    }
    const topAuthor = Object.entries(authorCount).sort((a, b) => b[1] - a[1])[0];

    return {
      totalBooks, totalPages, booksThisYear: booksThisYear.length,
      pagesThisYear, pace, topGenres, seriesInProgress, seriesCompleted,
      avgRating, topAuthor, datedBooks,
    };
  }, [state.library, state.wishlist, state.readNext, state.genresByBookId]);

  async function handleReimport(file) {
    try {
      const text = await file.text();
      const books = parseGoodreadsCSV(text);
      if (books.length === 0) {
        showToast(t('profile.csvErrorNoBooks'), true);
        return;
      }
      const enriched = books.map((gb) => {
        const match = findBookByTitle(gb.t);
        return match ? { ...match, ...gb } : { ...gb, g: 'Imported' };
      });
      await importGoodreads(enriched);
    } catch {
      showToast(t('profile.csvReadError'), true);
    }
  }

  const hasStats = stats.totalBooks > 0;
  const sectionTitle = (label) => (
    <div className="pf-overline">{label}</div>
  );

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · {t('profile.breadcrumb')}
      </div>
      <div className="page-head">
        <div className="page-head__eyebrow">{t('profile.eyebrowTitle')}</div>
        <h1 className="page-head__title">
          {tNode('profile.pageTitle')}
        </h1>
        {hasStats && (
          <p className="page-head__lead">
            {t('profile.subtitleStats', {
              books: stats.totalBooks,
              pages: stats.totalPages > 0 ? t('profile.subtitlePages', { pages: stats.totalPages.toLocaleString() }) : '',
            })}
          </p>
        )}
      </div>

      {/* ── Reading Stats ─────────────────────────────────────────────────── */}
      {hasStats && (
        <div className="profile-stats">

          <section>
            {sectionTitle(t('profile.sectionStats'))}

            {/* Top-line numbers */}
            <div className="pf-stats-grid">
              <StatCard
                value={stats.totalBooks}
                label={t('profile.statBooksRead')}
                sub={stats.booksThisYear > 0 ? t('profile.statThisYear', { count: stats.booksThisYear }) : null}
              />
              {stats.totalPages > 0 && (
                <StatCard
                  value={stats.totalPages.toLocaleString()}
                  label={t('profile.statPages')}
                  sub={stats.pagesThisYear > 0 ? t('profile.statThisYear', { count: stats.pagesThisYear.toLocaleString() }) : null}
                />
              )}
              {stats.pace && (
                <StatCard
                  value={stats.pace}
                  label={t('profile.statBooksMonth')}
                  sub={t('profile.statLast12')}
                />
              )}
              {stats.avgRating && (
                <StatCard
                  value={`${stats.avgRating}★`}
                  label={t('profile.statAvgRating')}
                />
              )}
              {stats.seriesCompleted > 0 && (
                <StatCard
                  value={stats.seriesCompleted}
                  label={t('profile.statSeriesFinished')}
                />
              )}
            </div>
          </section>

          {/* Pace chart */}
          {stats.datedBooks.length > 0 && (
            <section>
              {sectionTitle(t('profile.sectionPace'))}
              <PaceChart books={stats.datedBooks} onOpenBook={(b) => openBookTab(b, 'profile')} />
            </section>
          )}

          {/* Top genres */}
          {stats.topGenres.length > 0 && (
            <section>
              {sectionTitle(t('profile.sectionTopGenres'))}
              <div className="pf-pace-panel">
                {stats.topGenres.map((g) => (
                  <GenreBar key={g.name} name={g.name} count={g.count} max={stats.topGenres[0].count} />
                ))}
              </div>
            </section>
          )}

          {/* Favourite author */}
          {stats.topAuthor && stats.topAuthor[1] > 1 && (
            <section>
              {sectionTitle(t('profile.sectionTopAuthor'))}
              <p className="pf-author-line">
                <span className="pf-author-name">{stats.topAuthor[0]}</span>
                <span className="pf-author-count">
                  · {t('profile.topAuthorBooks', { count: stats.topAuthor[1] })}
                </span>
              </p>
            </section>
          )}

          {/* Series in progress */}
          {stats.seriesInProgress.length > 0 && (
            <section>
              {sectionTitle(t('profile.sectionSeries'))}
              <div className="pf-series-list">
                {stats.seriesInProgress.map((s) => (
                  <div
                    key={s.name}
                    className="pf-series-row"
                    onClick={() => go('series-page', { seriesName: s.name, from: 'profile', fromLabel: t('profile.fromProfile') })}
                    title={t('profile.openSeries')}
                  >
                    <div className="pf-series-bar__body">
                      <div className="pf-series-bar__name">{s.name}</div>
                      <div className="pf-series-bar__meta">
                        {t('profile.seriesRead', { read: s.read, total: s.total })}
                      </div>
                    </div>
                    <div className="pf-series-bar__right">
                      <span className="bp-series__open">
                        {t('profile.openLink')}
                      </span>
                      <div className="pf-pips">
                        {Array.from({ length: s.total }).map((_, i) => (
                          <div key={i} className={`pf-pip${i < s.read ? ' pf-pip--filled' : ''}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* No date data nudge */}
          {stats.datedBooks.length === 0 && stats.totalBooks > 0 && (
            <p className="bp-no-rating">
              {t('profile.paceNudge')}
            </p>
          )}
        </div>
      )}

      {/* ── Profile settings ──────────────────────────────────────────────── */}
      <div className="pf-account-card">
        <CornerBrackets />
        {user && (
          <>
            <h2 className="pf-section__title">
              {t('profile.sectionAccount')}
            </h2>
            <p className="pf-text">
              {state.profile.displayName || user.email}
              <br />
              <span className="lv-hl">
                {t('profile.accountSynced')}
              </span>
            </p>
          </>
        )}

        <UsernameSection profile={state.profile} user={user} updateUsername={updateUsername} t={t} />
        <DisplayNameSection profile={state.profile} updateDisplayName={updateDisplayName} t={t} />
        <PrivacySection profile={state.profile} updatePrivacyPrefs={updatePrivacyPrefs} t={t} />
        <ReaderPrefsSection state={state} setProfile={setProfile} t={t} />

        <h2 className="pf-section__title" style={user ? undefined : { marginTop: 0 }}>
          {t('profile.labelReadingLevel')}
        </h2>
        <p className="pf-text">
          {LEVEL_NAMES[state.profile.readingLevel] || t('profile.notSet')}
        </p>

        <h2 className="pf-section__title">
          {t('profile.labelReadingChallenge')}
        </h2>
        <ReadingChallenge
          library={state.library}
          readingGoalCount={state.readingGoalCount}
          setReadingGoalCount={setReadingGoalCount}
          t={t}
        />

        <h2 className="pf-section__title">
          {t('profile.labelLibrary')}
        </h2>
        <p className="pf-text pf-text--gap-lg">
          {t('profile.librarySummary', { books: state.library.length, queued: state.readNext.length })}
          {state.profile.goodreadsImported && (
            <><br /><span className="lv-hl">{t('profile.goodreadsImported')}</span></>
          )}
        </p>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) handleReimport(f);
            }}
          />
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            {state.profile.goodreadsImported
              ? t('profile.reimportGoodreads') : t('profile.importGoodreads')}
          </button>
        </div>

        {/* ── Subscription section ──────────────────────────────────────────── */}
        {user && (
          <div className="pf-section" id="pf-subscription">
            <h2 className="pf-section__title">
              {t('subscription.sectionTitle')}
            </h2>

            {/* Tier badge — reuses the global .status pill system */}
            {(() => {
              const status = quota?.subscription_status || 'free';
              const isPro = status === 'active';
              const isPastDue = status === 'past_due';
              return (
                <div className="pf-tier-row">
                  <span className={`status${isPro ? ' status--success' : isPastDue ? ' status--warn' : ''}`}>
                    {isPro ? `✦ ${t('subscription.tierPro')}` : isPastDue ? `⚠ ${t('subscription.tierPastDue')}` : t('subscription.tierFree')}
                  </span>
                  <span className="pf-section__hint">
                    {isPro
                      ? t('subscription.proDesc')
                      : isPastDue
                        ? t('subscription.pastDueDesc')
                        : t('subscription.freeDesc', {
                          remaining: quota?.calls_remaining ?? 5,
                          limit: quota?.calls_limit ?? 5,
                        })}
                  </span>
                </div>
              );
            })()}

            {/* Quota bar — reuses the dashboard's AI-quota bar (.db-ai__track/__fill),
                the same visual pattern, instead of a duplicate .pf-quota* set */}
            {quota && (
              <div>
                <div className="db-ai__track">
                  <div
                    className={`db-ai__fill${quota.calls_remaining === 0 ? ' db-ai__fill--empty' : ''}`}
                    style={{ '--ai-pct': `${Math.min(100, Math.round(((quota.calls_used ?? 0) / (quota.calls_limit ?? 5)) * 100))}%` }}
                  />
                </div>
                {quota.reset_at && (
                  <div className="db-ai__note">
                    {t('subscription.resetsOn', { date: new Date(quota.reset_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) })}
                  </div>
                )}
              </div>
            )}

            {/* CTA */}
            {quota?.subscription_status === 'active' ? (
              <button className="btn-secondary" onClick={handleManage} disabled={portalLoading}>
                {portalLoading ? t('subscription.redirecting') : t('subscription.manageBtn')}
              </button>
            ) : (
              <div className="pf-upgrade">
                <button className="btn-primary" onClick={handleUpgrade} disabled={checkoutLoading}>
                  {checkoutLoading ? t('subscription.redirecting') : t('subscription.upgradeBtn')}
                </button>
                <div className="pf-upgrade__features">
                  {t('subscription.upgradePrice')} ·{' '}
                  {[
                    t('subscription.upgradeFeature1'),
                    t('subscription.upgradeFeature2'),
                    t('subscription.upgradeFeature3'),
                  ].join(' · ')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Notification Preferences ──────────────────────────────────────── */}
        {user && (
          <NotificationPreferences t={t} user={user} showToast={showToast} />
        )}

        {/* ── Danger zone ───────────────────────────────────────────────────── */}
        <div className="pf-section">
          <button
            className="btn-danger"
            onClick={() => {
              if (confirm(t('library.confirmReset'))) {
                resetAll();
                go('dashboard');
              }
            }}
          >
            {t('profile.resetProfile')}
          </button>
        </div>
      </div>
    </>
  );
}

// ── NotificationPreferences ───────────────────────────────────────────────────

const DEFAULT_PREFS = {
  book_club: true,
  friends: true,
  announcements: true,
  email: true,
};

function NotificationPreferences({ t, user, showToast }) {
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
    { key: 'friends', label: t('notifications.prefFriends'), desc: t('notifications.prefFriendsDesc'), locked: false },
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
