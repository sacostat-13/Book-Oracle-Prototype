// src/views/Dashboard.jsx — The Books Oracle R3
// Zero inline styles. All widget patterns use classes from pages/_dashboard.scss.
// DS spec: gradient surfaces, gold section eyebrows, consistent cover sizes.

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { useAuth } from '../lib/AuthContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { callClaude, QuotaExceededError } from '../lib/claudeApi';
import { bookKey, openBookTab } from '../lib/bookHelpers';
import { buildTasteProfile, suggestLevelFromTaste, goalDirective } from '../lib/matchHelpers';
import { getFriendsFeedEvents } from '../lib/useFriends';
import { supabase } from '../lib/supabase';
import CoachMark from '../components/CoachMark';
import Avatar from '../components/Avatar';

const FEED_PAGE_SIZE = 5;

// ─── Default widget layout ────────────────────────────────────────────────────
export const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'currently-reading', visible: true },
  { id: 'oracle-spark', visible: true },
  { id: 'quick-actions', visible: true },
  { id: 'reading-stats', visible: true },
  { id: 'reading-goal', visible: true },
  { id: 'series-progress', visible: true },
  { id: 'streak', visible: true },
  { id: 'plans', visible: true },
  { id: 'clubs', visible: true },
  { id: 'friends-feed', visible: true },
  { id: 'feed', visible: true },
];

function resolveLayout(saved) {
  if (!saved || !Array.isArray(saved)) return DEFAULT_DASHBOARD_LAYOUT;
  const savedIds = new Set(saved.map((w) => w.id));
  const merged = [...saved];
  for (const w of DEFAULT_DASHBOARD_LAYOUT) {
    if (!savedIds.has(w.id)) merged.push({ ...w });
  }
  return merged;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dayKey(d) { return d ? new Date(d).toISOString().slice(0, 10) : 'x'; }

function relativeDay(dateStr, t) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (diff === 0) return t('dashboard.today');
  if (diff === 1) return t('dashboard.yesterday');
  if (diff < 7) return t('dashboard.daysAgo', { count: diff });
  if (diff < 30) return t('dashboard.weeksAgo', { count: Math.floor(diff / 7) });
  return t('dashboard.monthsAgo', { count: Math.floor(diff / 30) });
}

function buildFeed(state) {
  const events = [];
  const lib = state.library || [];
  const wl = state.wishlist || [];
  const plans = state.plans || [];

  for (const b of lib) {
    if (b.dateRead) events.push({ type: 'finished', date: b.dateRead, book: b, key: 'f-' + bookKey(b) });
    if (b.startedAt) events.push({ type: 'started', date: b.startedAt, book: b, key: 's-' + bookKey(b) });
  }
  for (const b of state.currentlyReading || []) {
    if (b.startedAt) events.push({ type: 'started', date: b.startedAt, book: b, key: 'cs-' + bookKey(b) });
  }
  // Group wishlist additions by day
  const byDay = {};
  for (const b of wl) {
    if (b.addedAt) { const k = dayKey(b.addedAt); (byDay[k] = byDay[k] || { date: b.addedAt, books: [] }).books.push(b); }
  }
  for (const [k, { date, books }] of Object.entries(byDay)) {
    events.push({ type: 'wishlisted', date, books, key: 'w-' + k });
  }
  for (const p of plans) {
    if (p.createdAt) events.push({ type: 'plan', date: p.createdAt, plan: p, key: 'p-' + (p._id || p.createdAt) });
  }
  return events.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ─── Sparkle SVG icon (Oracle sigil) ─────────────────────────────────────────
const IconSparkle = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5Z" />
  </svg>
);
const IconDiamond = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2 L20 12 L12 22 L4 12Z" />
  </svg>
);
const IconBook = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

// ─── Book cover ────────────────────────────────────────────────────────────────
function Cover({ book, w = 60, h, onClick }) {
  const rh = h || Math.round(w * 1.5);
  const vars = { '--db-cw': `${w}px`, '--db-ch': `${rh}px`, cursor: onClick ? 'pointer' : 'default' };
  if (book.coverUrl) {
    return <img src={book.coverUrl} alt={book.t} className="db-cover" style={vars} onClick={onClick} />;
  }
  return (
    <div className="db-cover db-cover--placeholder" style={vars} onClick={onClick}>
      <span className="db-cover__label" style={{ fontSize: Math.max(7, w / 9) }}>
        {book.t?.slice(0, 16)}
      </span>
    </div>
  );
}

// ─── Section eyebrow ──────────────────────────────────────────────────────────
function Eyebrow({ icon, label }) {
  return (
    <div className="db-eyebrow">
      {icon && <span className="db-eyebrow__glyph">{icon}</span>}
      {label}
    </div>
  );
}

// ─── Widget shell ─────────────────────────────────────────────────────────────
function WidgetShell({ icon, label, children }) {
  return (
    <section className="db-section">
      {label && <Eyebrow icon={icon} label={label} />}
      {children}
    </section>
  );
}

// ─── Currently Reading ────────────────────────────────────────────────────────
function CurrentlyReadingWidget({ books, onOpenBook, t }) {
  if (!books?.length) return null;
  return (
    <WidgetShell icon={<IconBook />} label={t('dashboard.currentlyReading')}>
      <div className="db-cr-grid">
        {books.map((b, i) => (
          <div key={b.bookId || i} className="db-cr-card" onClick={() => onOpenBook?.(b)}>
            <Cover book={b} w={60} />
            <div className="db-cr-body">
              <div className="db-cr-title">{b.t}</div>
              <div className="db-cr-author">{b.a}</div>
              {(b.startedAt || b.started_at) && (
                <div className="db-cr-since">
                  {t('dashboard.since')} {relativeDay(b.startedAt || b.started_at, t)}
                </div>
              )}
              <button className="db-cr-open">{t('dashboard.open')} →</button>
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

// ─── Oracle Spark ─────────────────────────────────────────────────────────────
function OracleSparkWidget({ wishlist, go, t, profile }) {
  const { quota, refresh: refreshQuota } = useOracleQuota();
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);

  const hasWishlist = (wishlist || []).length > 0;
  const quotaEmpty = !quota?.unlimited && quota?.calls_remaining === 0;

  async function draw() {
    if (!hasWishlist || quotaEmpty) return;
    setState('loading'); setResult(null);
    try {
      const titles = (wishlist || [])
        .sort(() => Math.random() - 0.5).slice(0, 20)
        .map((b) => `"${b.t}" by ${b.a}`).join('\n');
      // v0.38: fold onboarding personalization into the Spark prompt when present —
      // favorite genres bias the pick, current mood shapes the "reason" framing.
      const favGenres = profile?.favoriteGenres || [];
      const mood = profile?.currentMood || [];
      // v0.50: stated reading level + goal join the Spark personalization.
      const personalization = [
        favGenres.length > 0 ? `Reader's favorite genres: ${favGenres.join(', ')}. Lean toward these when a good option exists, but don't force it.` : null,
        mood.length > 0 ? `Reader says they're currently in the mood for: ${mood.join(', ')}. Frame the pick and reason with this in mind.` : null,
        profile?.readingLevel != null ? `Reader's stated reading level: ${profile.readingLevel}/5 (1=casual page-turners, 5=experimental prose).` : null,
        goalDirective(profile?.goal),
      ].filter(Boolean).join(' ');
      const raw = await callClaude(
        `${personalization ? personalization + '\n\n' : ''}From this wishlist, pick ONE book that would most pleasantly surprise me right now. Return ONLY JSON: { title, author, reason (max 20 words, evocative) }.\n\n${titles}`,
        'You are a literary oracle. Be bold. Return only valid JSON, no markdown.'
      );
      if (!raw) { setState('error'); return; }
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      const match = (wishlist || []).find((b) =>
        b.t?.toLowerCase().replace(/[^a-z0-9]/g, '') === parsed.title?.toLowerCase().replace(/[^a-z0-9]/g, '')
      );
      setResult({ ...parsed, book: match || null });
      setState('result');
      refreshQuota?.();
    } catch (e) {
      setState(e?.code === 'quota_exceeded' ? 'quota' : 'error');
    }
  }

  return (
    <WidgetShell icon={<IconSparkle />} label={t('dashboard.widgetSpark')}>
      <div className="db-spark">
        {state === 'idle' && (
          <>
            <p className="db-spark__prompt">{t('dashboard.sparkSub')}</p>
            <div className="db-spark__actions">
              {quotaEmpty ? (
                <>
                  <span className="db-spark__empty-text">{t('oracle.quotaWallTitle')}</span>
                  <button className="btn-tertiary btn--sm" onClick={() => go('profile', { scrollTo: 'subscription' })}>
                    {t('dashboard.aiQuotaUpgrade')}
                  </button>
                </>
              ) : !hasWishlist ? (
                <button className="btn-tertiary" onClick={() => go('wishlist')}>
                  {t('dashboard.sparkNoWishlist')}
                </button>
              ) : (
                <button className="btn-accent" onClick={draw}>
                  {t('dashboard.sparkButton')} ✦
                </button>
              )}
            </div>
          </>
        )}

        {state === 'loading' && (
          <div className="db-spark__loading">
            <div className="loading-spinner" />
            <span className="db-spark__loading-label">{t('dashboard.sparkDrawing')}</span>
          </div>
        )}

        {state === 'result' && result && (
          <div className="db-spark__result">
            {result.book && (
              <Cover book={result.book} w={64} onClick={() => result.book && openBookTab(result.book, 'dashboard')} />
            )}
            <div className="db-spark__result-meta">
              <div className="db-spark__result-eyebrow">
                <IconSparkle /> {t('dashboard.sparkResult')}
              </div>
              <div className="db-spark__result-title"
                onClick={() => result.book && openBookTab(result.book, 'dashboard')}>
                {result.title}
              </div>
              <div className="db-spark__result-author">{result.author}</div>
              {result.reason && (
                <p className="db-spark__result-reason">"{result.reason}"</p>
              )}
              <button className="btn-tertiary btn--sm"
                onClick={() => { setState('idle'); setResult(null); }}>
                {t('dashboard.sparkTryAgain')}
              </button>
            </div>
          </div>
        )}

        {(state === 'error' || state === 'quota') && (
          <div className="db-spark__empty">
            <span className="db-spark__empty-text">
              {state === 'quota' ? t('oracle.quotaWallTitle') : 'Something went wrong.'}
            </span>
            <button className="btn-tertiary btn--sm"
              onClick={() => state === 'quota' ? go('profile', { scrollTo: 'subscription' }) : setState('idle')}>
              {state === 'quota' ? t('dashboard.aiQuotaUpgrade') : 'Try again'}
            </button>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}

// ─── Reading Stats ─────────────────────────────────────────────────────────────
function ReadingStatsWidget({ library, go, t }) {
  const now = new Date();
  const year = now.getFullYear();
  const total = library.length;
  const thisYearCount = library.filter(
    (b) => b.dateRead && new Date(b.dateRead).getFullYear() === year
  ).length;
  const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const recent = library.filter((b) => b.dateRead && new Date(b.dateRead) >= twelveAgo);
  const pace = recent.length > 0 ? (recent.length / 12).toFixed(1) : null;
  const pages = library.reduce((s, b) => s + (b.pp || 0), 0);

  const cards = [
    { value: total, label: thisYearCount > 0 ? t('dashboard.statsWidgetThisYear', { count: thisYearCount }) : t('dashboard.statsWidgetBooks', { count: total }) },
    { value: pace ?? '—', label: 'avg per month' },
    { value: pages > 0 ? pages.toLocaleString() : '—', label: 'pages total' },
  ];

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.statsWidgetTitle')}>
      <div className="db-stats-grid">
        {cards.map((c, i) => (
          <div key={i} className="db-stat-card">
            <div className="db-stat-value">{c.value}</div>
            <div className="db-stat-label">{c.label}</div>
          </div>
        ))}
      </div>
      <button className="btn-text" onClick={() => go('profile')}>
        {t('dashboard.statsWidgetSeeAll')}
      </button>
    </WidgetShell>
  );
}

// ─── Reading Goal ─────────────────────────────────────────────────────────────
function ReadingGoalWidget({ library, genresByBookId, readingGoalCount, setReadingGoalCount, t }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const target = readingGoalCount;
  const done = library.filter((b) => b.dateRead && new Date(b.dateRead).getFullYear() === year).length;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const yearFrac = (Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1) / daysInYear;
  const expected = target ? Math.round(target * yearFrac) : 0;
  const delta = target ? done - expected : 0;
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const reached = target && done >= target;

  // v0.42-ish: yearly genre breakdown — same source of truth as Profile's
  // all-time "Top genres" (state.genresByBookId), but scoped to books read
  // this year and capped to 3, to sit compactly under the goal bar.
  const topGenres = useMemo(() => {
    const counts = {};
    for (const b of library) {
      if (!b.dateRead || new Date(b.dateRead).getFullYear() !== year) continue;
      for (const g of (genresByBookId?.[b.bookId] || [])) {
        counts[g.name] = (counts[g.name] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
  }, [library, genresByBookId, year]);
  const genreBarColors = ['--ro-burgundy', '--ro-forest', '--ro-gold'];

  function save() {
    const n = parseInt(input, 10);
    if (n > 0 && n <= 9999) setReadingGoalCount(n);
    setEditing(false);
  }

  return (
    <WidgetShell icon={<IconSparkle />} label={t('dashboard.goalWidgetTitle')}>
      <div className="db-goal">
        {editing ? (
          <div className="db-goal__edit-form">
            <input
              className="input"
              type="number" min="1" max="9999"
              placeholder={t('dashboard.goalWidgetPlaceholder')}
              defaultValue={target || ''}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus
              style={{ width: 120 }}
            />
            <button className="btn-primary btn--sm" onClick={save}>{t('dashboard.goalWidgetSave')}</button>
            <button className="btn-tertiary btn--sm" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        ) : !target ? (
          <button className="btn-tertiary" onClick={() => { setInput(''); setEditing(true); }}>
            {t('dashboard.goalWidgetSet')}
          </button>
        ) : (
          <>
            <div className="db-goal__head">
              <div className="db-goal__count">
                <em>{done}</em> <span>/ {target}</span>
              </div>
              <button className="db-goal__edit"
                onClick={() => { setInput(String(target)); setEditing(true); }}>
                {t('dashboard.goalWidgetEdit')}
              </button>
            </div>
            <div className="db-goal__track">
              <div
                className={`db-goal__fill${reached ? ' db-goal__fill--reached' : ''}`}
                style={{ '--goal-pct': `${pct}%` }}
              />
              {!reached && (
                <div className="db-goal__tick"
                  style={{ '--goal-tick': `${Math.min(100, Math.round(yearFrac * 100))}%` }}
                />
              )}
            </div>
            <div className={`db-goal__status${reached || delta > 0 ? ' db-goal__status--ahead' : delta === 0 ? ' db-goal__status--neutral' : ''}`}>
              {reached
                ? t('dashboard.goalWidgetDone')
                : delta > 0
                  ? `${t('dashboard.goalWidgetAhead', { n: delta })} · ${year}`
                  : delta < 0
                    ? `${t('dashboard.goalWidgetBehind', { n: Math.abs(delta) })} · ${year}`
                    : t('dashboard.goalWidgetProgress', { done, target })}
            </div>
          </>
        )}

        {topGenres.length > 0 && (
          <div className="db-goal__genres">
            <div className="db-goal__genres-label">{t('dashboard.goalWidgetGenresTitle')}</div>
            {topGenres.map((g, i) => (
              <div key={g.name} className="db-goal__genre-row">
                <div className="db-goal__genre-head">
                  <span className="db-goal__genre-name">{g.name}</span>
                  <span className="db-goal__genre-count">{g.count}</span>
                </div>
                <div className="db-goal__genre-track">
                  <div
                    className="db-goal__genre-fill"
                    style={{
                      '--genre-pct': `${Math.round((g.count / topGenres[0].count) * 100)}%`,
                      '--genre-color': `var(${genreBarColors[i % genreBarColors.length]})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}

// ─── Series in Progress ────────────────────────────────────────────────────────
function SeriesProgressWidget({ library, wishlist, readNext, go, t }) {
  const allBooks = [...library, ...(wishlist || []), ...(readNext || [])];
  const seriesMap = {};
  for (const b of allBooks) {
    if (!b.s?.name) continue;
    const n = b.s.name;
    if (!seriesMap[n]) seriesMap[n] = { name: n, total: b.s.total || null, read: 0, coverUrl: null };
    if (library.some((l) => bookKey(l) === bookKey(b))) {
      seriesMap[n].read++;
      if (!seriesMap[n].coverUrl && b.coverUrl) seriesMap[n].coverUrl = b.coverUrl;
    }
  }
  const inProgress = Object.values(seriesMap)
    .filter((s) => s.read > 0 && s.total && s.read < s.total)
    .sort((a, b) => b.read - a.read).slice(0, 4);

  if (!inProgress.length) return null;

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.seriesWidgetTitle')}>
      <div className="db-series-list">
        {inProgress.map((s) => {
          const pct = Math.round((s.read / s.total) * 100);
          return (
            <div key={s.name} className="db-series-row"
              onClick={() => go('series-page', { seriesName: s.name, from: 'dashboard', fromLabel: t('dashboard.eyebrow') })}>
              {s.coverUrl && <img src={s.coverUrl} alt={s.name} className="db-series-cover" />}
              <div className="db-series-body">
                <div className="db-series-title">{s.name}</div>
                <div className="db-series-track">
                  <div className="db-series-fill" style={{ '--series-pct': `${pct}%` }} />
                </div>
                <div className="db-series-meta">
                  {t('dashboard.seriesWidgetRead', { read: s.read, total: s.total })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

// ─── Reading Streak ────────────────────────────────────────────────────────────
function StreakWidget({ library, t }) {
  const sorted = [...library].filter((b) => b.dateRead)
    .sort((a, b) => new Date(b.dateRead) - new Date(a.dateRead));
  if (!sorted.length) return null;

  const lastDate = new Date(sorted[0].dateRead);
  const now = new Date();
  let streak = 0;
  for (let i = 0; i < 24; i++) {
    const m = now.getMonth() - i;
    const y = now.getFullYear() + Math.floor(m / 12);
    const key = `${y}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}`;
    if (sorted.some((b) => b.dateRead?.slice(0, 7) === key)) streak++;
    else break;
  }

  const numMod = streak >= 6 ? ' db-streak__num--hot' : streak >= 3 ? ' db-streak__num--warm' : ' db-streak__num--cold';

  return (
    <WidgetShell icon={<IconBook />} label={t('dashboard.streakWidgetTitle')}>
      <div className="db-streak">
        <div className="db-streak__num-col">
          <div className={`db-streak__num${numMod}`}>{streak}</div>
          <div className="db-streak__unit">{streak === 1 ? 'month' : 'months'}</div>
        </div>
        <div>
          <div className="db-streak__label">
            {t('dashboard.streakWidgetDays', { count: streak })}
          </div>
          <div className="db-streak__sub">
            {t('dashboard.streakWidgetLastRead', {
              date: lastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            })}
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

// ─── Reading Plans ─────────────────────────────────────────────────────────────
function PlansWidget({ plans, go, t }) {
  if (!plans?.length) return null;
  return (
    <WidgetShell icon={<IconSparkle />} label={t('dashboard.readingPlans')}>
      <div className="db-plans-list">
        {plans.map((plan, i) => (
          <div key={plan._id || i}
            className={`db-plan-row${i === 0 ? ' db-plan-row--current' : ''}`}
            onClick={() => go('plan-view', { planId: plan._id })}>
            <span className="db-plan-glyph"><IconSparkle /></span>
            <div className="db-plan-body">
              {i === 0 && <div className="db-plan-current-label">{t('dashboard.currentPlanLabel')}</div>}
              <div className="db-plan-title">{plan.title || t('dashboard.untitledPlan')}</div>
              <div className="db-plan-meta">
                {t('dashboard.planMeta', { count: (plan.books || []).length, months: plan.timeline })}
              </div>
            </div>
            <div className="db-plan-cta">{t('dashboard.viewPlan')}</div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

// ─── Book Clubs ────────────────────────────────────────────────────────────────

function ClubsWidget({ clubs, summary, go, t }) {
  if (!clubs?.length) return null;
  // summary === null while the get_dashboard_clubs_summary RPC is still loading —
  // fall back to the plain name/member-count row for that brief window rather
  // than blocking the whole widget.
  const summaryById = new Map((summary || []).map((s) => [s.id, s]));

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.yourClubs')}>
      <div className="db-clubs-list">
        {clubs.map((c) => {
          const s = summaryById.get(c.id);
          const hasBook = s?.current_book_title;
          return (
            <div key={c.id} className="db-club-row"
              onClick={() => go('book-club-detail', { clubId: c.id })}>

              {hasBook && (
                <Cover book={{ coverUrl: s.current_book_cover, t: s.current_book_title }} w={44} />
              )}

              <div className="db-club-body">
                <div className="db-club-row__head">
                  <div className="db-club-title">{c.name}</div>
                  {s?.session_number && s.session_status && (
                    <span className={`db-club-session-badge db-club-session-badge--${s.session_status}`}>
                      {t('dashboard.clubSession', { n: s.session_number })}
                    </span>
                  )}
                </div>
                <div className="db-club-meta">
                  {hasBook
                    ? t('dashboard.clubReadingMeta', { title: s.current_book_title })
                    : (s?.member_count
                      ? t('dashboard.clubMemberCount', { count: s.member_count })
                      : (c.memberCount ? t('dashboard.clubMemberCount', { count: c.memberCount }) : ''))}
                </div>
                {s?.member_avatars?.length > 0 && (
                  <div className="db-club-avatars">
                    <div className="db-club-avatars__stack">
                      {s.member_avatars.slice(0, 3).map((m, i) => (
                        <Avatar key={i} displayName={m.display_name} avatarUrl={m.avatar_url} />
                      ))}
                    </div>
                    {s.member_count > 3 && (
                      <span className="db-club-avatars__more">
                        {t('dashboard.clubReadingAlong', { count: s.member_count - 3 })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="db-club-cta">{t('dashboard.viewPlan')}</div>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}

// ─── Quick Actions ─────────────────────────────────────────────────────────────
function QuickActionsWidget({ go, t }) {
  const tNode = useTNode();
  const actions = [
    { richLabel: 'dashboard.ctaOracle', sub: t('dashboard.ctaOracleSub'), glyph: '❦', route: 'oracle', isAccent: true },
    { richLabel: 'dashboard.ctaPlan', sub: t('dashboard.ctaPlanSub'), glyph: '✦', route: 'plan-create', isAccent: false },
    { richLabel: 'dashboard.ctaWishlist', sub: t('dashboard.ctaWishlistSub'), glyph: '↗', route: 'wishlist', isAccent: false },
    { richLabel: 'dashboard.ctaLibrary', sub: t('dashboard.ctaLibrarySub'), glyph: '▤', route: 'library', isAccent: false },
  ];
  return (
    <section className="db-ctas">
      {actions.map(({ richLabel, sub, glyph, route, isAccent }) => (
        <button key={route}
          className={`db-cta-card${isAccent ? ' db-cta-card--ro-accent' : ''}`}
          onClick={() => go(route)}>
          <div className="db-cta-glyph">{glyph}</div>
          <div className="db-cta-label">{tNode(richLabel)}</div>
          <div className="db-cta-sub">{sub}</div>
        </button>
      ))}
    </section>
  );
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────
const FEED_CFG = {
  finished: { char: '<svg data-dc-tpl="879" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ro-forest)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path data-dc-tpl="880" d="M20 6 9 17l-5-5"></path></svg>', label: 'finished' },
  started: { char: '<svg data-dc-tpl="879" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ro-gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path data-dc-tpl="880" d="M12 7v14M3 18V5a2 2 0 0 1 2-2h6v15H5a2 2 0 0 0-2 2M21 18V5a2 2 0 0 0-2-2h-6v15h6a2 2 0 0 1 2 2"></path></svg>', label: 'started' },
  wishlisted: { char: '<svg data-dc-tpl="879" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ro-burgundy)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path data-dc-tpl="880" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"></path></svg>', label: 'wishlisted' },
  plan: { char: '✦', label: 'plan' },
};
function FeedAccent({ type }) {
  const mod = FEED_CFG[type]?.label || '';
  return <div className={`feed-accent${mod ? ' feed-accent--' + mod : ''}`} />;
}
function FeedIcon({ type }) {
  const cfg = FEED_CFG[type] || { char: '·', label: '' };
  return <div className={`feed-icon${cfg.label ? ' feed-icon--' + cfg.label : ''}`} dangerouslySetInnerHTML={{ __html: cfg.char }}></div>;
}
function FeedDateLabel({ date, prev, t }) {
  if (dayKey(date) === (prev ? dayKey(prev) : null)) return null;
  return <div className="feed-date-label">{relativeDay(date, t)}</div>;
}
function FinishedEvent({ ev, onOpenBook, t }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedAccent type="finished" /><FeedIcon type="finished" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedFinished')}</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> {t('dashboard.feedBy')} {b.a}</span>}
        {b.rating > 0 && (
          <span className="feed-sub feed-stars">
            {'★'.repeat(b.rating)}<span>{'★'.repeat(5 - b.rating)}</span>
          </span>
        )}
        {b.g && !b.rating && <span className="feed-tag">{b.g}</span>}
      </div>
      <Cover book={b} w={40} h={60} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}
function StartedEvent({ ev, onOpenBook, t }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedAccent type="started" /><FeedIcon type="started" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedStarted')}</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> {t('dashboard.feedBy')} {b.a}</span>}
      </div>
      <Cover book={b} w={40} h={60} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}
function WishlistEvent({ ev, onOpenBook, t }) {
  const { books } = ev;
  if (books.length === 1) {
    const b = books[0];
    return (
      <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
        <FeedAccent type="wishlisted" /><FeedIcon type="wishlisted" />
        <div className="feed-row__body">
          <span className="feed-verb">{t('dashboard.feedAddedOne')}</span>{' '}
          <span className="feed-title">{b.t}</span>
          {b.a && <span className="feed-author"> {t('dashboard.feedBy')} {b.a}</span>}
        </div>
        <Cover book={b} w={40} h={60} onClick={() => onOpenBook?.(b)} />
      </div>
    );
  }
  return (
    <div className="feed-row">
      <FeedAccent type="wishlisted" /><FeedIcon type="wishlisted" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedAddedMany', { count: books.length })}</span>
        <div className="feed-bulk">
          {books.slice(0, 8).map((b, i) => (
            <Cover key={i} book={b} w={40} h={60} onClick={(e) => { e.stopPropagation(); onOpenBook?.(b); }} />
          ))}
          {books.length > 8 && <div className="feed-bulk__more">+{books.length - 8}</div>}
        </div>
      </div>
    </div>
  );
}
function PlanEvent({ ev, go, t }) {
  const { plan } = ev;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => go('plan-view')}>
      <FeedAccent type="plan" /><FeedIcon type="plan" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedPlanCreated')}</span>{' '}
        <span className="feed-title">{plan.title || t('dashboard.untitledPlan')}</span>
        <div className="feed-sub">
          {t('dashboard.planMeta', { count: (plan.books || []).length, months: plan.timeline })}
        </div>
      </div>
    </div>
  );
}

function FeedWidget({ state, onOpenBook, go, t, eyebrow }) {
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const events = useMemo(() => buildFeed(state), [state]);
  const visible = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  return (
    <WidgetShell icon={<IconDiamond />} label={eyebrow || t('dashboard.recentActivity')}>
      {events.length === 0 ? (
        <div className="feed-empty">
          <div className="feed-empty__ornament">{t('dashboard.emptyFeedOrnament')}</div>
          <p className="feed-empty__text">
            {t('dashboard.emptyFeedText')}<br />{t('dashboard.emptyFeedSub')}
          </p>
        </div>
      ) : (
        <div className="feed">
          {visible.map((ev, i) => (
            <div key={ev.key}>
              <FeedDateLabel date={ev.date} prev={visible[i - 1]?.date} t={t} />
              {ev.type === 'finished' && <FinishedEvent ev={ev} onOpenBook={onOpenBook} t={t} />}
              {ev.type === 'started' && <StartedEvent ev={ev} onOpenBook={onOpenBook} t={t} />}
              {ev.type === 'wishlisted' && <WishlistEvent ev={ev} onOpenBook={onOpenBook} t={t} />}
              {ev.type === 'plan' && <PlanEvent ev={ev} go={go} t={t} />}
            </div>
          ))}
          {hasMore && (
            <button className="feed-load-more"
              onClick={() => setVisibleCount((c) => c + FEED_PAGE_SIZE)}>
              {t('dashboard.showMore', { count: Math.min(FEED_PAGE_SIZE, events.length - visibleCount) })}
            </button>
          )}
        </div>
      )}
    </WidgetShell>
  );
}

// ─── AI Quota Bar ─────────────────────────────────────────────────────────────
function AIQuotaBar({ go, t }) {
  const { quota, loading } = useOracleQuota();
  if (loading || !quota) return null;

  const isPro = quota.subscription_status === 'active';
  const isDay = quota.period === 'day';
  const isEmpty = quota.calls_remaining === 0;
  // v0.43.1: clamp to the CURRENT tier's limit. After a Pro→Free downgrade
  // calls_used can legitimately exceed the free limit (e.g. 14 used, limit 5)
  // — showing "14 of 5" reads as a bug, so the display caps at the limit.
  const limit = quota.calls_limit ?? 5;
  const usedDisplay = Math.min(quota.calls_used ?? 0, limit);
  const pct = Math.min(100, Math.round(((quota.calls_used ?? 0) / limit) * 100));
  const resetDate = quota.reset_at
    ? quota.reset_at.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="db-ai">
      <div className="db-ai__head">
        <div className="db-ai__label">
          <IconSparkle /> {t('dashboard.aiQuotaTitle')}
        </div>
        <span className="db-ai__usage">
          {t(isDay ? 'dashboard.aiQuotaPro' : 'dashboard.aiQuotaFree', {
            used: usedDisplay,
            limit,
            type: isPro ? t('dashboard.aiQuotaTypeDaily') : t('dashboard.aiQuotaTypeMonthly'),
          })}
        </span>
      </div>
      <div className="db-ai__track">
        <div
          className={`db-ai__fill${isEmpty ? ' db-ai__fill--empty' : ''}`}
          style={{ '--ai-pct': `${pct}%` }}
        />
      </div>
      <div className="db-ai__note">
        {t('dashboard.aiQuotaIncludes')}
        {resetDate && <> · {t('dashboard.aiQuotaResetsOn', { date: resetDate })}</>}
        {!isPro && (
          <> · <button className="btn-text" style={{ padding: 0, fontSize: 'inherit' }}
            onClick={() => go('profile', { scrollTo: 'subscription' })}>{t('dashboard.aiQuotaUpgrade')}</button></>
        )}
      </div>
    </div>
  );
}

// ─── Friends Feed ──────────────────────────────────────────────────────────────
function FriendAvatar({ friend, size = 30 }) {
  // v0.52: no-referrer + error fallback, same fixes as the shared Avatar
  // (this one keeps its own db-ff-avatar styling so it stays local).
  const [imgFailed, setImgFailed] = useState(false);
  const label = friend?.display_name || friend?.username || '?';
  const vars = { '--ff-sz': `${size}px`, fontSize: size * 0.42 };
  if (friend?.avatar_url && !imgFailed) {
    return <img src={friend.avatar_url} alt={label} referrerPolicy="no-referrer" onError={() => setImgFailed(true)} className="db-ff-avatar" style={vars} />;
  }
  return (
    <div className="db-ff-avatar db-ff-avatar--fallback" style={vars}>
      {label[0].toUpperCase()}
    </div>
  );
}

function FriendsFeedWidget({ userId, hasFriends, go, t }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (!userId || !hasFriends) return;
    setLoading(true);
    try { const evs = await getFriendsFeedEvents(userId); setEvents(evs); setUpdatedAt(new Date()); }
    finally { setLoading(false); }
  }, [userId, hasFriends]);

  useEffect(() => { load(); }, [load]);

  const relTime = updatedAt
    ? updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  if (!hasFriends) {
    return (
      <WidgetShell icon={<IconDiamond />} label={t('dashboard.widgetFriendsFeed')}>
        <div className="db-ff-empty">
          <p className="db-ff-empty-text">{t('dashboard.friendsFeedNoFriends')}</p>
          <button className="btn-tertiary btn--sm" onClick={() => go('profile')}>
            {t('profile.labelFriends')}
          </button>
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell icon={<IconDiamond />} label={t('dashboard.widgetFriendsFeed')}>
      <div className="db-ff-toolbar">
        {relTime && !loading && (
          <span className="db-ff-time">
            {t('dashboard.friendsFeedUpdated', { time: relTime })}
          </span>
        )}
        <button className="db-ff-refresh" onClick={load} disabled={loading}>
          {loading ? '···' : t('dashboard.friendsFeedRefresh')}
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div className="db-ff-loading">
          <div className="loading-spinner" />
          <span className="db-spark__loading-label">{t('common.loading')}</span>
        </div>
      ) : events.length === 0 ? (
        <p className="db-ff-empty-text">{t('dashboard.friendsFeedEmpty')}</p>
      ) : (
        <div className="db-ff-list">
          {events.map((ev) => {
            const friendLabel = ev.friend?.display_name || (ev.friend?.username ? `@${ev.friend.username}` : '?');
            const verb = ev.type === 'finished' ? t('dashboard.friendsFeedFinished') : t('dashboard.friendsFeedStarted');
            const daysAgo = Math.floor((Date.now() - new Date(ev.date)) / 86400000);
            const timeLabel = daysAgo === 0 ? t('dashboard.today') : daysAgo === 1 ? t('dashboard.yesterday') : t('dashboard.daysAgo', { count: daysAgo });
            return (
              <div key={ev.key} className="db-ff-row">
                <div className="db-ff-avatar-wrap"
                  onClick={() => ev.friend?.username && go('friend-profile', { username: ev.friend.username })}>
                  <FriendAvatar friend={ev.friend} size={30} />
                </div>
                {ev.book?.coverUrl && (
                  <img
                    src={ev.book.coverUrl} alt={ev.book.t} className="db-ff-book-cover"
                    style={{ cursor: 'pointer' }}
                    onClick={() => ev.book?.t && openBookTab(ev.book, 'dashboard')}
                  />
                )}
                <div className="db-ff-body">
                  <div className="db-ff-text">
                    <span className="db-ff-name"
                      onClick={() => ev.friend?.username && go('friend-profile', { username: ev.friend.username })}>
                      {friendLabel}
                    </span>{' '}
                    <span className="db-ff-verb">{verb}</span>{' '}
                    <span
                      className="db-ff-title"
                      style={{ cursor: 'pointer' }}
                      onClick={() => ev.book?.t && openBookTab(ev.book, 'dashboard')}
                    >
                      {ev.book?.t}
                    </span>
                  </div>
                  <div className="db-ff-meta">
                    {ev.book?.rating > 0 && (
                      <span className="db-ff-stars">
                        {'★'.repeat(ev.book.rating)}<span>{'★'.repeat(5 - ev.book.rating)}</span>
                      </span>
                    )}
                    <span className="db-ff-time-label">{timeLabel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}

// ─── Widget Settings ──────────────────────────────────────────────────────────
const WIDGET_LABELS = {
  'currently-reading': 'widgetCurrentlyReading',
  'oracle-spark': 'widgetSpark',
  'quick-actions': 'widgetQuickActions',
  'reading-stats': 'widgetStats',
  'reading-goal': 'widgetGoal',
  'series-progress': 'widgetSeries',
  'streak': 'widgetStreak',
  'plans': 'widgetPlans',
  'clubs': 'widgetClubs',
  'friends-feed': 'widgetFriendsFeed',
  'feed': 'widgetMyFeed',
};

function WidgetSettings({ layout, onClose, onChange, t }) {
  const [local, setLocal] = useState(layout);

  function toggle(id) {
    setLocal((l) => l.map((w) => w.id === id ? { ...w, visible: !w.visible } : w));
  }
  function move(id, dir) {
    setLocal((l) => {
      const idx = l.findIndex((w) => w.id === id);
      if (idx < 0) return l;
      const next = [...l]; const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return l;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function save() { onChange(local); onClose(); }

  return (
    <div className="db-settings-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="db-settings">
        <div className="db-settings__head">
          <div>
            <div className="db-settings__eyebrow">
              <IconSparkle /> {t('dashboard.widgetSettingsTitle')}
            </div>
            <div className="db-settings__sub">{t('dashboard.widgetSettingsSub')}</div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="db-settings__list">
          {local.map((w, i) => (
            <div key={w.id} className={`db-settings__row${w.visible ? '' : ' db-settings__row--hidden'}`}>
              <button
                className={`db-settings__toggle${w.visible ? ' db-settings__toggle--on' : ''}`}
                onClick={() => toggle(w.id)}
                title={w.visible ? t('dashboard.widgetHide') : t('dashboard.widgetShow')}
              >
                {w.visible ? '✓' : '○'}
              </button>
              <span className="db-settings__name">
                {t(`dashboard.${WIDGET_LABELS[w.id] || w.id}`)}
              </span>
              <div className="db-settings__moves">
                <button className="db-settings__move" onClick={() => move(w.id, -1)} disabled={i === 0} title="Up">↑</button>
                <button className="db-settings__move" onClick={() => move(w.id, 1)} disabled={i === local.length - 1} title="Down">↓</button>
              </div>
            </div>
          ))}
        </div>

        <button className="btn-primary btn--block" onClick={save}>
          {t('dashboard.widgetDone')}
        </button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
// ── Level growth nudge (v0.50) ────────────────────────────────────────────────
// Compares the earned complexity signal (avg complexity of 4-5★ rated books,
// min 5 samples) against the stated reading level. One step up at a time,
// always opt-in, dismissible per suggested level so it never nags.
function LevelNudge({ state, t }) {
  const { setProfile } = useData();
  const suggested = useMemo(() => {
    const tp = buildTasteProfile(state.library, state.genresByBookId, state.profile);
    return suggestLevelFromTaste(tp);
  }, [state.library, state.genresByBookId, state.profile]);

  if (!suggested) return null;
  if ((state.profile.levelNudgeDismissed || 0) >= suggested) return null;

  const currentName = t(`onboarding.levels.${state.profile.readingLevel}.title`);
  const nextName = t(`onboarding.levels.${suggested}.title`);

  return (
    <div className="db-level-nudge">
      <div className="db-level-nudge__glyph">☩</div>
      <div className="db-level-nudge__body">
        <div className="db-level-nudge__title">{t('dashboard.levelNudgeTitle')}</div>
        <p className="db-level-nudge__text">
          {t('dashboard.levelNudgeBody', { current: currentName, next: nextName })}
        </p>
      </div>
      <div className="db-level-nudge__actions">
        <button
          className="btn-primary btn--sm"
          onClick={() => setProfile({ readingLevel: suggested, levelNudgeDismissed: suggested })}
        >
          {t('dashboard.levelNudgeAccept', { next: nextName })}
        </button>
        <button
          className="btn-tertiary btn--sm"
          onClick={() => setProfile({ levelNudgeDismissed: suggested })}
        >
          {t('dashboard.levelNudgeDismiss')}
        </button>
      </div>
    </div>
  );
}

export default function Dashboard({ onOpenBook }) {
  const { state, setDashboardLayout, setReadingGoalCount, dismissCoachmark } = useData();
  const { go } = useRouter();
  const { user } = useAuth();
  const t = useT();
  const tNode = useTNode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [friendCount, setFriendCount] = useState(0);
  const [clubsSummary, setClubsSummary] = useState(null); // null = not loaded yet

  // v0.43.1: static supabase import — the dynamic import('../lib/supabase')
  // pattern resolved to a namespace without `supabase` in the prod bundle
  // (chunk/SW interop), silently breaking the friend count and clubs summary.
  useEffect(() => {
    if (!user) return;
    supabase.from('friend_pairs').select('user_b', { count: 'exact', head: true })
      .eq('user_a', user.id).then(({ count }) => setFriendCount(count || 0));
  }, [user]);

  useEffect(() => {
    if (!user || !(state.clubs || []).length) { setClubsSummary([]); return; }
    supabase.rpc('get_dashboard_clubs_summary').then(({ data, error }) => {
      if (error) { console.error('get_dashboard_clubs_summary failed', error); setClubsSummary([]); return; }
      setClubsSummary(data || []);
    });
  }, [user, state.clubs]);

  const layout = useMemo(() => resolveLayout(state.dashboardLayout), [state.dashboardLayout]);
  const firstName = (state.profile?.displayName || state.profile?.display_name || '').split(' ')[0];
  const levelName = state.profile?.readingLevel || null;

  function renderWidget(id) {
    switch (id) {
      case 'currently-reading': return <CurrentlyReadingWidget key={id} books={state.currentlyReading || []} onOpenBook={onOpenBook} t={t} />;
      case 'oracle-spark': return <OracleSparkWidget key={id} wishlist={state.wishlist} go={go} t={t} profile={state.profile} />;
      case 'quick-actions': return <QuickActionsWidget key={id} go={go} t={t} />;
      case 'reading-stats': return <ReadingStatsWidget key={id} library={state.library || []} go={go} t={t} />;
      case 'reading-goal': return <ReadingGoalWidget key={id} library={state.library || []} genresByBookId={state.genresByBookId || {}} readingGoalCount={state.readingGoalCount} setReadingGoalCount={setReadingGoalCount} t={t} />;
      case 'series-progress': return <SeriesProgressWidget key={id} library={state.library || []} wishlist={state.wishlist} readNext={state.readNext} go={go} t={t} />;
      case 'streak': return <StreakWidget key={id} library={state.library || []} t={t} />;
      case 'plans': return <PlansWidget key={id} plans={state.plans || []} go={go} t={t} />;
      case 'clubs': return <ClubsWidget key={id} clubs={state.clubs || []} summary={clubsSummary} go={go} t={t} />;
      case 'friends-feed': return <FriendsFeedWidget key={id} userId={user?.id} hasFriends={friendCount > 0} go={go} t={t} />;
      case 'feed': return <FeedWidget key={id} state={state} onOpenBook={onOpenBook} go={go} t={t} eyebrow={t('dashboard.widgetMyFeed')} />;
      default: return null;
    }
  }

  // ── Hero level chip (badge only — numeric counts moved to the glance grid) ──
  const levelChip = levelName ? { glyph: '◆', label: t('dashboard.levelPill', { level: levelName }) } : null;

  // ── Hero "at a glance" stat cards ───────────────────────────────────────────
  const glanceCards = [
    { value: state.library?.length || 0, label: t('dashboard.glanceRead') },
    { value: (state.wishlist || []).length, label: t('dashboard.glanceWishlist') },
    (state.currentlyReading || []).length > 0 &&
    { value: state.currentlyReading.length, label: t('dashboard.currentlyReading') },
    { value: (state.plans || []).length, label: t('dashboard.readingPlans') },
    { value: (state.clubs || []).length, label: t('dashboard.glanceClubs') },
  ].filter(Boolean);

  return (
    <div className="db-page">
      {/* ── Hero ── */}
      <div className="db-hero">
        <div className="db-hero__eyebrow">
          <IconDiamond /> {t('dashboard.eyebrow')}
        </div>
        <h1 className="db-hero__title">
          {firstName
            ? <>{t('dashboard.greeting')} <span>{firstName}</span></>
            : tNode('dashboard.greetingBack')}
        </h1>
        {levelChip && (
          <div className="db-chips">
            <div className="db-chip">
              <span className="db-chip__glyph">{levelChip.glyph}</span>
              {levelChip.label}
            </div>
          </div>
        )}

        <div className="db-glance-grid">
          {glanceCards.map((c, i) => (
            <div key={i} className="db-stat-card db-stat-card--glance">
              <div className="db-stat-value">{c.value}</div>
              <div className="db-stat-label">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sparkle divider */}
      <div className="db-divider">
        <div className="db-divider__mark"><IconSparkle size={13} /></div>
      </div>

      {/* AI quota bar */}
      <AIQuotaBar go={go} t={t} />

      {/* v0.50: level growth nudge — the Oracle notices when your rated
          reading has outgrown your stated level, and asks before changing it. */}
      <LevelNudge state={state} t={t} />

      {/* Widget grid */}
      <div className="db-widgets">
        <button
          className="db-hero__settings"
          onClick={() => { dismissCoachmark('dashboard-customize'); setSettingsOpen(true); }}
          title={t('dashboard.widgetSettingsTitle')}
          aria-label={t('dashboard.widgetSettingsTitle')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {/* v0.46: one-time hint — dashboard customization is easy to miss */}
        <CoachMark
          id="dashboard-customize"
          placement="bottom"
          className="coachmark--dash"
          title={t('coachmark.dashboardTitle')}
          body={t('coachmark.dashboardBody')}
        />
        {layout.filter((w) => w.visible).map((w) => renderWidget(w.id))}
      </div>

      {/* Widget settings */}
      {settingsOpen && (
        <WidgetSettings
          layout={layout}
          onClose={() => setSettingsOpen(false)}
          onChange={setDashboardLayout}
          t={t}
        />
      )}
    </div>
  );
}