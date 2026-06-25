// src/views/Dashboard.jsx — v0.35
// Customizable widget dashboard.
// Widgets: currently-reading, plans, feed, quick-actions, clubs,
//          reading-stats, oracle-spark, reading-goal, series-progress, streak

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useAuth } from '../lib/AuthContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { callClaude, QuotaExceededError } from '../lib/claudeApi';
import { bookKey, openBookTab } from '../lib/bookHelpers';
import { getFriendsFeedEvents } from '../lib/useFriends';

const FEED_PAGE_SIZE = 5;

// ─── Default layout ───────────────────────────────────────────────────────────
// The canonical widget list. Order here = default order on dashboard.
export const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'currently-reading', visible: true  },
  { id: 'oracle-spark',      visible: true  },
  { id: 'quick-actions',     visible: true  },
  { id: 'reading-stats',     visible: true  },
  { id: 'reading-goal',      visible: true  },
  { id: 'series-progress',   visible: true  },
  { id: 'streak',            visible: true  },
  { id: 'plans',             visible: true  },
  { id: 'clubs',             visible: true  },
  { id: 'friends-feed',      visible: true  },  // v0.36.1 — hidden if no friends
  { id: 'feed',              visible: true  },  // renamed to "My activity" in UI
];

function resolveLayout(saved) {
  if (!saved || !Array.isArray(saved)) return DEFAULT_DASHBOARD_LAYOUT;
  // Merge: keep saved order/visibility, append any new widgets not yet in saved
  const savedIds = new Set(saved.map((w) => w.id));
  const merged = [...saved];
  for (const w of DEFAULT_DASHBOARD_LAYOUT) {
    if (!savedIds.has(w.id)) merged.push({ ...w });
  }
  return merged;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayKey(dateStr) {
  if (!dateStr) return 'unknown';
  return new Date(dateStr).toISOString().slice(0, 10);
}

function relativeDay(dateStr, t) {
  if (!dateStr) return '';
  const d    = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return t('dashboard.today');
  if (diff === 1) return t('dashboard.yesterday');
  if (diff <  7)  return t('dashboard.daysAgo', { count: diff });
  if (diff < 30)  return t('dashboard.weeksAgo', { count: Math.floor(diff/7) });
  if (diff < 365) return t('dashboard.monthsAgo', { count: Math.floor(diff/30) });
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function buildFeed(state) {
  const events = [];
  (state.library || []).forEach(b => {
    const date = b.dateRead || b.readAt || b.read_at;
    if (date) events.push({ type:'finished', date, book:b, key:`fin-${b.bookId||b.t}` });
  });
  (state.currentlyReading || []).forEach(b => {
    const date = b.startedAt || b.started_at;
    if (date) events.push({ type:'started', date, book:b, key:`started-${b.bookId||b.t}` });
  });
  const wishByDay = {};
  (state.wishlist || []).forEach(b => {
    const date = b.addedAt || b.added_at;
    if (!date) return;
    const dk = dayKey(date);
    if (!wishByDay[dk]) wishByDay[dk] = { date, books: [] };
    wishByDay[dk].books.push(b);
  });
  Object.values(wishByDay).forEach(({ date, books }) => {
    events.push({ type: 'wishlisted', date, books, key: `wish-${date}` });
  });
  if (state.currentPlan?._id) {
    events.push({
      type: 'plan', date: state.currentPlan.createdAt || null,
      plan: state.currentPlan, key: `plan-${state.currentPlan._id}`,
    });
  }
  events.sort((a, b) => (!a.date ? 1 : !b.date ? -1 : new Date(b.date) - new Date(a.date)));
  return events;
}

// ─── Cover ────────────────────────────────────────────────────────────────────

function Cover({ book, size = 56, onClick }) {
  const style = {
    width: size, height: Math.round(size * 1.5), borderRadius: 2,
    objectFit: 'cover', flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)', display: 'block',
  };
  if (book.coverUrl) return <img src={book.coverUrl} alt={book.t} style={style} onClick={onClick} />;
  return (
    <div style={{ ...style, background: 'linear-gradient(155deg,#3a2a1c,#1a100a)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(201,162,75,0.12)' }} onClick={onClick}>
      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: Math.max(7, size / 9), color: 'rgba(233,217,182,0.55)', textAlign: 'center', padding: '4px', lineHeight: 1.2 }}>
        {book.t?.slice(0, 16)}
      </span>
    </div>
  );
}

// ─── Widget shell ─────────────────────────────────────────────────────────────

function WidgetShell({ eyebrow, ornament, children }) {
  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      {eyebrow && (
        <div className="db-section-eyebrow">
          {ornament && <span className="db-ornament">{ornament}</span>}
          {eyebrow}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── Currently Reading ────────────────────────────────────────────────────────

function CurrentlyReadingWidget({ books, onOpenBook, t }) {
  if (!books?.length) return null;
  return (
    <WidgetShell eyebrow={t('dashboard.currentlyReading')} ornament="❧">
      <div className="db-cr__grid">
        {books.map((b, i) => (
          <div key={b.bookId || i} className="db-cr__card" onClick={() => onOpenBook?.(b)}>
            <Cover book={b} size={80} />
            <div className="db-cr__meta">
              <div className="db-cr__title">{b.t}</div>
              <div className="db-cr__author">{b.a}</div>
              {(b.startedAt || b.started_at) && (
                <div className="db-cr__since">{t('dashboard.since')} {relativeDay(b.startedAt || b.started_at, t)}</div>
              )}
              <button className="db-cr__open btn btn-ghost" style={{ marginTop: 'auto' }}>
                {t('dashboard.open')} →
              </button>
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

// ─── Oracle Spark ─────────────────────────────────────────────────────────────

function OracleSparkWidget({ wishlist, go, t }) {
  const { quota, refresh: refreshQuota } = useOracleQuota();
  const [state, setState]   = useState('idle'); // idle | loading | result | error | quota
  const [result, setResult] = useState(null);

  const hasWishlist = (wishlist || []).length > 0;
  const quotaEmpty  = !quota?.unlimited && quota?.calls_remaining === 0;

  async function draw() {
    if (!hasWishlist || quotaEmpty) return;
    setState('loading');
    setResult(null);
    try {
      const titles = (wishlist || [])
        .sort(() => Math.random() - 0.5)
        .slice(0, 20)
        .map((b) => `"${b.t}" by ${b.a}`)
        .join('\n');

      const raw = await callClaude(
        `From this list of books on my wishlist, pick ONE that would most pleasantly surprise me right now. Consider variety of mood and genre. Return ONLY a JSON object with keys: title (string), author (string), reason (one sentence, max 20 words, evocative not generic).\n\n${titles}`,
        'You are a literary oracle. Be bold and specific. Never say "a great choice" or "perfect for". Return only valid JSON, no markdown.'
      );

      if (!raw) { setState('error'); return; }
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      // Find matching wishlist book for cover
      const match = (wishlist || []).find((b) =>
        b.t?.toLowerCase().replace(/[^a-z0-9]/g, '') === parsed.title?.toLowerCase().replace(/[^a-z0-9]/g, '')
      );
      setResult({ ...parsed, book: match || null });
      setState('result');
      refreshQuota?.();
    } catch (e) {
      if (e?.code === 'quota_exceeded') { setState('quota'); }
      else { setState('error'); }
    }
  }

  return (
    <WidgetShell eyebrow={t('dashboard.widgetSpark')} ornament="❦">
      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '3px', padding: '1.25rem', background: 'var(--surface-tint)' }}>
        {state === 'idle' && (
          <>
            <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              {t('dashboard.sparkSub')}
            </p>
            {quotaEmpty ? (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  {t('oracle.quotaWallTitle')}
                </span>
                <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => go('profile')}>
                  {t('dashboard.aiQuotaUpgrade')}
                </button>
              </div>
            ) : !hasWishlist ? (
              <button className="btn btn-ghost" onClick={() => go('wishlist')} style={{ fontSize: 'var(--text-sm)' }}>
                {t('dashboard.sparkNoWishlist')}
              </button>
            ) : (
              <button className="btn" onClick={draw}>{t('dashboard.sparkButton')}</button>
            )}
          </>
        )}

        {state === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
            <div className="loading-spinner" style={{ width: 20, height: 20 }} />
            <span style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {t('dashboard.sparkDrawing')}
            </span>
          </div>
        )}

        {state === 'result' && result && (
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
            {result.book && (
              <div style={{ flexShrink: 0, cursor: 'pointer' }} onClick={() => result.book && openBookTab(result.book, 'dashboard')}>
                <Cover book={result.book} size={64} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                {t('dashboard.sparkResult')}
              </div>
              <div
                style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600, fontSize: '1.2rem', color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: '0.2rem', cursor: result.book ? 'pointer' : 'default' }}
                onClick={() => result.book && openBookTab(result.book, 'dashboard')}
              >
                {result.title}
              </div>
              <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                {result.author}
              </div>
              {result.reason && (
                <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '0.95rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '0.9rem' }}>
                  "{result.reason}"
                </p>
              )}
              <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => { setState('idle'); setResult(null); }}>
                {t('dashboard.sparkTryAgain')}
              </button>
            </div>
          </div>
        )}

        {(state === 'error') && (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)', fontStyle: 'italic' }}>Something went wrong.</span>
            <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => setState('idle')}>Try again</button>
          </div>
        )}

        {state === 'quota' && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)', fontStyle: 'italic' }}>{t('oracle.quotaWallTitle')}</span>
            <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => go('profile')}>
              {t('dashboard.aiQuotaUpgrade')}
            </button>
          </div>
        )}
      </div>
    </WidgetShell>
  );
}

// ─── Reading Stats ────────────────────────────────────────────────────────────

function ReadingStatsWidget({ library, go, t }) {
  const now       = new Date();
  const thisYear  = now.getFullYear();
  const total     = library.length;
  const thisYearCount = library.filter((b) => b.dateRead && new Date(b.dateRead).getFullYear() === thisYear).length;
  const twelveAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const recent    = library.filter((b) => b.dateRead && new Date(b.dateRead) >= twelveAgo);
  const pace      = recent.length > 0 ? (recent.length / 12).toFixed(1) : null;
  const pages     = library.reduce((s, b) => s + (b.pp || 0), 0);

  const stats = [
    { value: total,       label: t('dashboard.statsWidgetBooks', { count: total }),     sub: thisYearCount > 0 ? t('dashboard.statsWidgetThisYear', { count: thisYearCount }) : null },
    { value: pace,        label: pace ? t('dashboard.statsWidgetPace', { pace })  : '—', sub: null },
    { value: pages > 0 ? pages.toLocaleString() : '—', label: t('dashboard.statsWidgetPages', { count: pages.toLocaleString() }), sub: null },
  ];

  return (
    <WidgetShell eyebrow={t('dashboard.statsWidgetTitle')} ornament="◈">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        {stats.map((s, i) => (
          <div key={i} style={{ background: 'var(--surface-tint)', border: '1px solid var(--border-subtle)', borderRadius: '3px', padding: '0.75rem 1rem' }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 500, fontSize: '1.6rem', color: 'var(--text-primary)', lineHeight: 1 }}>
              {s.value ?? '—'}
            </div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              {s.sub || (i === 0 ? (thisYearCount > 0 ? t('dashboard.statsWidgetThisYear', { count: thisYearCount }) : '') : i === 1 ? 'avg per month' : 'pages total')}
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => go('profile')}>
        {t('dashboard.statsWidgetSeeAll')}
      </button>
    </WidgetShell>
  );
}

// ─── Reading Goal ─────────────────────────────────────────────────────────────

function ReadingGoalWidget({ library, readingGoalCount, setReadingGoalCount, t }) {
  const [editing, setEditing] = useState(false);
  const [input,   setInput]   = useState('');

  const now        = new Date();
  const year       = now.getFullYear();
  const target     = readingGoalCount;
  const done       = library.filter((b) => b.dateRead && new Date(b.dateRead).getFullYear() === year).length;
  const dayOfYear  = Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const yearFrac   = dayOfYear / daysInYear;
  const expected   = target ? Math.round(target * yearFrac) : 0;
  const delta      = target ? done - expected : 0;
  const pct        = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const reached    = target && done >= target;

  function save() {
    const n = parseInt(input, 10);
    if (n > 0 && n <= 9999) setReadingGoalCount(n);
    setEditing(false);
  }

  return (
    <WidgetShell eyebrow={t('dashboard.goalWidgetTitle')} ornament="✦">
      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '3px', padding: '1rem 1.25rem', background: 'var(--surface-tint)' }}>
        {editing ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="number" min="1" max="9999"
              placeholder={t('dashboard.goalWidgetPlaceholder')}
              defaultValue={target || ''}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus
              style={{ width: '100px', fontFamily: "'Cormorant Garamond', serif", fontSize: '1.1rem', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', padding: '0.4rem 0.6rem', borderRadius: '2px' }}
            />
            <button className="btn" style={{ padding: '0.4rem 1rem', fontSize: 'var(--text-sm)' }} onClick={save}>{t('dashboard.goalWidgetSave')}</button>
            <button className="btn btn-ghost" style={{ padding: '0.4rem 0.75rem', fontSize: 'var(--text-sm)' }} onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        ) : !target ? (
          <button className="btn btn-ghost" onClick={() => { setInput(''); setEditing(true); }}>
            {t('dashboard.goalWidgetSet')}
          </button>
        ) : (
          <>
            {/* Count + percentage */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 500, fontSize: '1.5rem', color: reached ? 'var(--status-read-fg)' : 'var(--text-primary)', lineHeight: 1 }}>
                {done} <span style={{ fontSize: '1rem', opacity: 0.5 }}>/ {target}</span>
              </span>
              <button
                onClick={() => { setInput(String(target)); setEditing(true); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}
              >
                {t('dashboard.goalWidgetEdit')}
              </button>
            </div>

            {/* Progress bar with pace marker */}
            <div style={{ position: 'relative', height: '6px', background: 'var(--border-subtle)', borderRadius: '3px', marginBottom: '0.5rem' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: reached ? 'var(--status-read-fg)' : 'var(--gilt)', borderRadius: '3px', transition: 'width 0.4s ease' }} />
              {!reached && (
                <div style={{ position: 'absolute', top: '-3px', left: `${Math.min(100, Math.round(yearFrac * 100))}%`, transform: 'translateX(-50%)', width: '2px', height: '12px', background: 'var(--text-dim)', borderRadius: '1px', opacity: 0.45 }} />
              )}
            </div>

            {/* Pace status */}
            <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: 'var(--text-sm)', color: reached ? 'var(--status-read-fg)' : delta > 0 ? 'var(--status-read-fg)' : delta < 0 ? 'var(--blood-bright)' : 'var(--text-muted)' }}>
              {reached
                ? t('dashboard.goalWidgetDone')
                : delta > 0
                ? `${t('dashboard.goalWidgetAhead', { n: delta })} · ${year}`
                : delta < 0
                ? `${t('dashboard.goalWidgetBehind', { n: Math.abs(delta) })} · ${year}`
                : `${t('dashboard.goalWidgetProgress', { done, target })}`}
            </div>
          </>
        )}
      </div>
    </WidgetShell>
  );
}

// ─── Series in Progress ───────────────────────────────────────────────────────

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
    .sort((a, b) => b.read - a.read)
    .slice(0, 4);

  if (!inProgress.length) return null;

  return (
    <WidgetShell eyebrow={t('dashboard.seriesWidgetTitle')} ornament="◆">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {inProgress.map((s) => {
          const pct = Math.round((s.read / s.total) * 100);
          return (
            <div
              key={s.name}
              onClick={() => go('series-page', { seriesName: s.name, from: 'dashboard', fromLabel: t('dashboard.eyebrow') })}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.9rem', background: 'var(--surface-tint)', border: '1px solid var(--border-subtle)', borderRadius: '3px', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface-tint)'}
            >
              {s.coverUrl && <img src={s.coverUrl} alt={s.name} style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ height: '3px', background: 'var(--border-subtle)', borderRadius: '2px', marginBottom: '0.25rem' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--status-read-fg)', borderRadius: '2px' }} />
                </div>
                <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
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

// ─── Reading Streak ───────────────────────────────────────────────────────────

function StreakWidget({ library, t }) {
  const sorted = [...library]
    .filter((b) => b.dateRead)
    .sort((a, b) => new Date(b.dateRead) - new Date(a.dateRead));

  if (!sorted.length) return null;

  const lastDate = new Date(sorted[0].dateRead);
  const daysSince = Math.floor((Date.now() - lastDate) / 86400000);

  // Count consecutive months with at least one book
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const y = now.getFullYear();
    const m = now.getMonth() - i;
    const key = `${y}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}`;
    const hasBook = sorted.some((b) => b.dateRead?.slice(0, 7) === key);
    if (hasBook) streak++; else break;
  }

  const streakColor = streak >= 6 ? 'var(--gilt-bright)' : streak >= 3 ? 'var(--gilt)' : 'var(--text-muted)';

  return (
    <WidgetShell eyebrow={t('dashboard.streakWidgetTitle')} ornament="❧">
      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '3px', padding: '1rem 1.25rem', background: 'var(--surface-tint)', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 500, fontSize: '2.4rem', color: streakColor, lineHeight: 1 }}>
            {streak}
          </div>
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {streak === 1 ? 'month' : 'months'}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '1rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {t('dashboard.streakWidgetDays', { count: streak })}
          </div>
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.08em', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
            {t('dashboard.streakWidgetLastRead', { date: lastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })}
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

// ─── Plans ────────────────────────────────────────────────────────────────────

function PlansWidget({ plans, go, t }) {
  if (!plans?.length) return null;
  return (
    <WidgetShell eyebrow={t('dashboard.readingPlans')} ornament="✦">
      {plans.map((plan, i) => (
        <div key={plan._id || i} className="db-plan-banner" onClick={() => go('plan-view', { planId: plan._id })}>
          <div className="db-plan-banner__inner">
            <div className="db-plan-banner__ornament">✦</div>
            <div className="db-plan-banner__body">
              {i === 0 && <div className="db-plan-banner__label">{t('dashboard.currentPlanLabel')}</div>}
              <div className="db-plan-banner__title">{plan.title || t('dashboard.untitledPlan')}</div>
              <div className="db-plan-banner__meta">{t('dashboard.planMeta', { count: (plan.books || []).length, months: plan.timeline })}</div>
            </div>
            <div className="db-plan-banner__cta">{t('dashboard.viewPlan')}</div>
          </div>
        </div>
      ))}
    </WidgetShell>
  );
}

// ─── Clubs ────────────────────────────────────────────────────────────────────

function ClubsWidget({ clubs, go, t }) {
  if (!clubs?.length) return null;
  return (
    <WidgetShell eyebrow={t('dashboard.yourClubs')} ornament="◈">
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {clubs.map((c) => (
          <button key={c.id} className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '0.35rem 0.85rem' }} onClick={() => go('book-club-detail', { clubId: c.id })}>
            {c.name}
          </button>
        ))}
        <button className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '0.35rem 0.85rem', opacity: 0.5 }} onClick={() => go('book-clubs')}>
          {t('dashboard.allClubs')}
        </button>
      </div>
    </WidgetShell>
  );
}

// ─── Quick Actions ────────────────────────────────────────────────────────────

function QuickActionsWidget({ go, t }) {
  const actions = [
    { label: t('dashboard.ctaOracle'), accent: t('dashboard.ctaOracleAccent'), sub: t('dashboard.ctaOracleSub'), ornament: '❦', route: 'oracle', isAccent: true },
    { label: t('dashboard.ctaPlan'), accent: t('dashboard.ctaPlanAccent'), sub: t('dashboard.ctaPlanSub'), ornament: '✦', route: 'plan-create', isAccent: false },
    { label: t('dashboard.ctaWishlist'), accent: t('dashboard.ctaWishlistAccent'), sub: t('dashboard.ctaWishlistSub'), ornament: '↗', route: 'wishlist', isAccent: false },
    { label: t('dashboard.ctaLibrary'), accent: t('dashboard.ctaLibraryAccent'), sub: t('dashboard.ctaLibrarySub'), ornament: '▤', route: 'library', isAccent: false },
  ];
  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <div className="db-ctas">
        {actions.map(({ label, accent, sub, ornament, route, isAccent }) => (
          <div key={route} className={`db-cta-card${isAccent ? ' db-cta-card--accent' : ''}`} onClick={() => go(route)}>
            <div className="db-cta-card__ornament">{ornament}</div>
            <div className="db-cta-card__label">{label} <span className="accent">{accent}</span></div>
            <div className="db-cta-card__sub">{sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

const FEED_CFG = {
  finished:   { char: '✓', label: 'finished'   },
  started:    { char: '❧', label: 'started'    },
  wishlisted: { char: '♡', label: 'wishlisted' },
  plan:       { char: '✦', label: 'plan'       },
};

function FeedAccent({ type }) {
  const mod = FEED_CFG[type]?.label || '';
  return <div className={`feed-accent${mod ? ' feed-accent--' + mod : ''}`} />;
}

function FeedIcon({ type }) {
  const cfg = FEED_CFG[type] || { char: '·', label: '' };
  return <div className={`feed-icon${cfg.label ? ' feed-icon--' + cfg.label : ''}`}>{cfg.char}</div>;
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
        {b.rating > 0 && <span className="feed-sub" style={{ color: 'var(--gilt)' }}>{'★'.repeat(b.rating)}<span style={{ opacity: 0.25 }}>{'★'.repeat(5 - b.rating)}</span></span>}
        {b.g && !b.rating && <span className="feed-tag">{b.g}</span>}
      </div>
      <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
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
      <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
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
        <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
      </div>
    );
  }
  return (
    <div className="feed-row">
      <FeedAccent type="wishlisted" /><FeedIcon type="wishlisted" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedAddedMany', { count: books.length })}</span>
        <div className="feed-bulk">
          {books.slice(0, 8).map((b, i) => <Cover key={i} book={b} size={75} onClick={(e) => { e.stopPropagation(); onOpenBook?.(b); }} />)}
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
        <div className="feed-sub">{t('dashboard.planMeta', { count: (plan.books || []).length, months: plan.timeline })}</div>
      </div>
    </div>
  );
}

function FeedWidget({ state, onOpenBook, go, t, eyebrow }) {
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const events  = useMemo(() => buildFeed(state), [state]);
  const visible = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  return (
    <WidgetShell eyebrow={eyebrow || t('dashboard.recentActivity')} ornament="◈">
      {events.length === 0 ? (
        <div className="feed-empty">
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem', opacity: 0.25 }}>{t('dashboard.emptyFeedOrnament')}</div>
          <p style={{ color: 'var(--text-dim)', fontStyle: 'italic', textAlign: 'center' }}>
            {t('dashboard.emptyFeedText')}<br />{t('dashboard.emptyFeedSub')}
          </p>
        </div>
      ) : (
        <div className="feed">
          {visible.map((ev, i) => (
            <div key={ev.key}>
              <FeedDateLabel date={ev.date} prev={visible[i - 1]?.date} t={t} />
              {ev.type === 'finished'   && <FinishedEvent  ev={ev} onOpenBook={onOpenBook} t={t} />}
              {ev.type === 'started'    && <StartedEvent   ev={ev} onOpenBook={onOpenBook} t={t} />}
              {ev.type === 'wishlisted' && <WishlistEvent  ev={ev} onOpenBook={onOpenBook} t={t} />}
              {ev.type === 'plan'       && <PlanEvent      ev={ev} go={go} t={t} />}
            </div>
          ))}
          {hasMore && (
            <button className="feed-load-more" onClick={() => setVisibleCount((c) => c + FEED_PAGE_SIZE)}>
              {t('dashboard.showMore', { count: Math.min(FEED_PAGE_SIZE, events.length - visibleCount) })}
            </button>
          )}
        </div>
      )}
    </WidgetShell>
  );
}

// ─── AI Quota bar (always shown, not a widget) ────────────────────────────────

function AIQuotaBar({ go, t }) {
  const { quota, loading } = useOracleQuota();
  if (loading || !quota) return null;
  const isPro     = quota.subscription_status === 'active';
  const isDay     = quota.period === 'day';
  const isEmpty   = quota.calls_remaining === 0;
  const pct       = Math.round(((quota.calls_used ?? 0) / (quota.calls_limit ?? 5)) * 100);
  const resetDate = quota.reset_at ? quota.reset_at.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : null;

  return (
    <div style={{ border: `1px solid ${isEmpty ? 'rgba(180,60,60,0.3)' : 'var(--border-subtle)'}`, borderRadius: '4px', padding: '1rem 1.25rem', marginBottom: 'var(--space-4)', background: isEmpty ? 'rgba(180,60,60,0.04)' : 'var(--surface-tint)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.8 }}>
          {t('dashboard.aiQuotaTitle')}
        </div>
        <span style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', color: isEmpty ? 'rgba(180,60,60,0.9)' : 'var(--text-muted)' }}>
          {t(isDay ? 'dashboard.aiQuotaPro' : 'dashboard.aiQuotaFree', { used: quota.calls_used ?? 0, limit: quota.calls_limit ?? 5, type: isPro ? t('dashboard.aiQuotaTypeDaily') : t('dashboard.aiQuotaTypeMonthly') })}
        </span>
      </div>
      <div style={{ height: '3px', background: 'var(--border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: isEmpty ? 'rgba(180,60,60,0.7)' : 'var(--gilt)', borderRadius: '2px', transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-dim)' }}>
          {t('dashboard.aiQuotaIncludes')}
          {resetDate && <> · {t('dashboard.aiQuotaResetsOn', { date: resetDate })}</>}
        </span>
        {!isPro && (
          <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => go('profile')}>
            {t('dashboard.aiQuotaUpgrade')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Widget settings panel ────────────────────────────────────────────────────

// ─── Friends Feed ─────────────────────────────────────────────────────────────

function FriendAvatar({ friend, size = 28 }) {
  const label = friend?.display_name || friend?.username || '?';
  if (friend?.avatar_url) {
    return <img src={friend.avatar_url} alt={label} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border-subtle)' }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: size * 0.45, color: 'var(--text-muted)', flexShrink: 0 }}>
      {label[0].toUpperCase()}
    </div>
  );
}

function FriendsFeedWidget({ userId, hasFriends, go, t }) {
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (!userId || !hasFriends) return;
    setLoading(true);
    try {
      const evs = await getFriendsFeedEvents(userId);
      setEvents(evs);
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [userId, hasFriends]);

  useEffect(() => { load(); }, [load]);

  const relTime = updatedAt
    ? updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  if (!hasFriends) {
    return (
      <WidgetShell eyebrow={t('dashboard.widgetFriendsFeed')} ornament="◈">
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '3px', padding: '1.5rem 1.25rem', background: 'var(--surface-tint)', textAlign: 'center' }}>
          <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>
            {t('dashboard.friendsFeedNoFriends')}
          </p>
          <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)', padding: '0.3rem 0.75rem' }} onClick={() => go('profile')}>
            {t('profile.labelFriends')} →
          </button>
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell eyebrow={t('dashboard.widgetFriendsFeed')} ornament="◈">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
        {relTime && !loading && (
          <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '10px', letterSpacing: '0.06em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
            {t('dashboard.friendsFeedUpdated', { time: relTime })}
          </span>
        )}
        <button
          onClick={load} disabled={loading}
          style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '2px', cursor: loading ? 'default' : 'pointer', color: 'var(--text-dim)', fontFamily: "'Special Elite', monospace", fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0.2rem 0.55rem', opacity: loading ? 0.4 : 1 }}
        >
          {loading ? '···' : t('dashboard.friendsFeedRefresh')}
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 0' }}>
          <div className="loading-spinner" style={{ width: 16, height: 16 }} />
          <span style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{t('common.loading')}</span>
        </div>
      ) : events.length === 0 ? (
        <p style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '0.95rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
          {t('dashboard.friendsFeedEmpty')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {events.map((ev) => {
            const friendLabel = ev.friend?.display_name || (ev.friend?.username ? `@${ev.friend.username}` : '?');
            const verb = ev.type === 'finished' ? t('dashboard.friendsFeedFinished') : t('dashboard.friendsFeedStarted');
            const daysAgo = Math.floor((Date.now() - new Date(ev.date)) / 86400000);
            const timeLabel = daysAgo === 0 ? t('dashboard.today') : daysAgo === 1 ? t('dashboard.yesterday') : t('dashboard.daysAgo', { count: daysAgo });
            return (
              <div key={ev.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ cursor: ev.friend?.username ? 'pointer' : 'default', flexShrink: 0, marginTop: '2px' }} onClick={() => ev.friend?.username && go('friend-profile', { username: ev.friend.username })}>
                  <FriendAvatar friend={ev.friend} size={30} />
                </div>
                {ev.book?.coverUrl && (
                  <img src={ev.book.coverUrl} alt={ev.book.t} style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 1, flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600, color: 'var(--text-primary)', cursor: ev.friend?.username ? 'pointer' : 'default' }} onClick={() => ev.friend?.username && go('friend-profile', { username: ev.friend.username })}>
                      {friendLabel}
                    </span>{' '}
                    <span style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', color: 'var(--text-muted)' }}>{verb}</span>{' '}
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 600, color: 'var(--text-primary)' }}>{ev.book?.t}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                    {ev.book?.rating > 0 && (
                      <span style={{ color: 'var(--gilt)', fontSize: '0.65rem' }}>{'★'.repeat(ev.book.rating)}<span style={{ opacity: 0.2 }}>{'★'.repeat(5 - ev.book.rating)}</span></span>
                    )}
                    <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{timeLabel}</span>
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

const WIDGET_LABELS = {
  'currently-reading': 'widgetCurrentlyReading',
  'oracle-spark':      'widgetSpark',
  'quick-actions':     'widgetQuickActions',
  'reading-stats':     'widgetStats',
  'reading-goal':      'widgetGoal',
  'series-progress':   'widgetSeries',
  'streak':            'widgetStreak',
  'plans':             'widgetPlans',
  'clubs':             'widgetClubs',
  'friends-feed':      'widgetFriendsFeed',
  'feed':              'widgetMyFeed',
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
      const next = [...l];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return l;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function save() { onChange(local); onClose(); }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-bg)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--ink)', border: '1px solid var(--border-mid)', borderRadius: '4px 4px 0 0', width: '100%', maxWidth: '520px', maxHeight: '80vh', overflow: 'auto', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 'var(--text-xs)', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.2rem' }}>
              {t('dashboard.widgetSettingsTitle')}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {t('dashboard.widgetSettingsSub')}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, padding: '0.25rem' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
          {local.map((w, i) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.9rem', background: 'var(--surface-tint)', border: '1px solid var(--border-subtle)', borderRadius: '3px', opacity: w.visible ? 1 : 0.5 }}>
              {/* Toggle */}
              <button
                onClick={() => toggle(w.id)}
                title={w.visible ? t('dashboard.widgetHide') : t('dashboard.widgetShow')}
                style={{ background: w.visible ? 'var(--status-read-bg)' : 'var(--surface-tint)', border: `1px solid ${w.visible ? 'var(--status-read-border)' : 'var(--border-subtle)'}`, borderRadius: '3px', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: w.visible ? 'var(--status-read-fg)' : 'var(--text-dim)', fontSize: '0.9rem', transition: 'all 0.15s' }}
              >
                {w.visible ? '✓' : '○'}
              </button>

              {/* Name */}
              <span style={{ flex: 1, fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1rem', color: 'var(--text-primary)' }}>
                {t(`dashboard.${WIDGET_LABELS[w.id] || w.id}`)}
              </span>

              {/* Up/Down */}
              <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                <button
                  onClick={() => move(w.id, -1)}
                  disabled={i === 0}
                  title={t('dashboard.widgetMoveUp')}
                  style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '2px', width: 26, height: 26, cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.25 : 1, color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >↑</button>
                <button
                  onClick={() => move(w.id, 1)}
                  disabled={i === local.length - 1}
                  title={t('dashboard.widgetMoveDown')}
                  style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '2px', width: 26, height: 26, cursor: i === local.length - 1 ? 'default' : 'pointer', opacity: i === local.length - 1 ? 0.25 : 1, color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >↓</button>
              </div>
            </div>
          ))}
        </div>

        <button className="btn" style={{ width: '100%' }} onClick={save}>
          {t('dashboard.widgetDone')}
        </button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({ onOpenBook }) {
  const { state, setDashboardLayout, setReadingGoalCount } = useData();
  const { go } = useRouter();
  const { user } = useAuth();
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Friends list for the friends-feed widget — lightweight, just need the count
  const [friendCount, setFriendCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    import('../lib/useFriends').then(({ getFriendsFeedEvents: _ }) => {
      // Just check if they have any friends via the friend_pairs view
      import('../lib/supabase').then(({ supabase }) => {
        supabase.from('friend_pairs').select('user_b', { count: 'exact', head: true }).eq('user_a', user.id)
          .then(({ count }) => setFriendCount(count || 0));
      });
    });
  }, [user]);

  const layout = useMemo(() => resolveLayout(state.dashboardLayout), [state.dashboardLayout]);

  function handleLayoutChange(newLayout) {
    setDashboardLayout(newLayout);
  }

  const firstName = (state.profile?.displayName || state.profile?.display_name || '').split(' ')[0];
  const levelName = state.profile?.readingLevel || null;

  function renderWidget(id) {
    switch (id) {
      case 'currently-reading':
        return <CurrentlyReadingWidget key={id} books={state.currentlyReading || []} onOpenBook={onOpenBook} t={t} />;
      case 'oracle-spark':
        return <OracleSparkWidget key={id} wishlist={state.wishlist} go={go} t={t} />;
      case 'quick-actions':
        return <QuickActionsWidget key={id} go={go} t={t} />;
      case 'reading-stats':
        return <ReadingStatsWidget key={id} library={state.library || []} go={go} t={t} />;
      case 'reading-goal':
        return <ReadingGoalWidget key={id} library={state.library || []} readingGoalCount={state.readingGoalCount} setReadingGoalCount={setReadingGoalCount} t={t} />;
      case 'series-progress':
        return <SeriesProgressWidget key={id} library={state.library || []} wishlist={state.wishlist} readNext={state.readNext} go={go} t={t} />;
      case 'streak':
        return <StreakWidget key={id} library={state.library || []} t={t} />;
      case 'plans':
        return <PlansWidget key={id} plans={state.plans || []} go={go} t={t} />;
      case 'clubs':
        return <ClubsWidget key={id} clubs={state.clubs || []} go={go} t={t} />;
      case 'friends-feed':
        return <FriendsFeedWidget key={id} userId={user?.id} hasFriends={friendCount > 0} go={go} t={t} />;
      case 'feed':
        return <FeedWidget key={id} state={state} onOpenBook={onOpenBook} go={go} t={t} eyebrow={t('dashboard.widgetMyFeed')} />;
      default:
        return null;
    }
  }

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="page-eyebrow">{t('dashboard.eyebrow')}</div>
            <h1 className="page-title">
              {firstName
                ? <>{t('dashboard.greeting')} <span className="accent">{firstName}</span></>
                : <>{t('dashboard.greetingBack')} <span className="accent">{t('dashboard.greetingAccent')}</span></>}
            </h1>
          </div>
          {/* Settings gear */}
          <button
            onClick={() => setSettingsOpen(true)}
            title={t('dashboard.widgetSettingsTitle')}
            style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '3px', cursor: 'pointer', color: 'var(--text-dim)', padding: '0.4rem 0.6rem', fontSize: '1rem', marginTop: '0.25rem', transition: 'border-color 0.15s, color 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--gilt)'; e.currentTarget.style.color = 'var(--gilt)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
          >
            ⚙
          </button>
        </div>
        <div className="dashboard-pills">
          {levelName && <span className="level-pill">◆ {t('dashboard.levelPill', { level: levelName })}</span>}
          <span className="level-pill">▤ {t('dashboard.booksRead', { count: state.library.length })}</span>
          <span className="level-pill">❦ {t('dashboard.inWishlist', { count: (state.wishlist || []).length })}</span>
          {(state.currentlyReading || []).length > 0 && (
            <span className="level-pill">❧ {t('dashboard.readingNow', { count: state.currentlyReading.length })}</span>
          )}
        </div>
      </div>

      {/* Always-on quota bar */}
      <AIQuotaBar go={go} t={t} />

      {/* Widgets in user-configured order */}
      {layout
        .filter((w) => w.visible)
        .map((w) => renderWidget(w.id))}

      {/* Widget settings panel */}
      {settingsOpen && (
        <WidgetSettings
          layout={layout}
          onClose={() => setSettingsOpen(false)}
          onChange={handleLayoutChange}
          t={t}
        />
      )}
    </>
  );
}
