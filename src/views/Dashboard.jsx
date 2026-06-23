// src/views/Dashboard.jsx — v0.31
// Layout: Currently Reading → Current Plan → CTAs → Activity Feed (paginated)

import { useMemo, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';

const FEED_PAGE_SIZE = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayKey(dateStr) {
  if (!dateStr) return 'unknown';
  return new Date(dateStr).toISOString().slice(0, 10);
}

function buildFeed(state) {
  const events = [];

  (state.library || []).forEach(b => {
    const date = b.readAt || b.read_at;
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
    if (!wishByDay[dk]) wishByDay[dk] = { date, books:[] };
    wishByDay[dk].books.push(b);
  });
  Object.values(wishByDay).forEach(({ date, books }) => {
    events.push({ type:'wishlisted', date, books, key:`wish-${date}` });
  });

  if (state.currentPlan?._id) {
    events.push({
      type:'plan', date: state.currentPlan.createdAt || null,
      plan: state.currentPlan, key:`plan-${state.currentPlan._id}`,
    });
  }

  events.sort((a,b) => (!a.date?1:!b.date?-1:new Date(b.date)-new Date(a.date)));
  return events;
}

// ─── Cover ────────────────────────────────────────────────────────────────────

function Cover({ book, size=56, onClick, className='' }) {
  const style = {
    width: size,
    height: Math.round(size * 1.5),
    borderRadius: 2,
    objectFit: 'cover',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    display: 'block',
  };
  if (book.coverUrl) {
    return <img src={book.coverUrl} alt={book.t} style={style} className={className} onClick={onClick} />;
  }
  return (
    <div style={{
      ...style,
      background: `linear-gradient(155deg,#3a2a1c,#1a100a)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', border: '1px solid rgba(201,162,75,0.12)',
    }} className={className} onClick={onClick}>
      <span style={{
        fontFamily:"'Cormorant Garamond',serif", fontStyle:'italic',
        fontSize: Math.max(7, size/9), color:'rgba(233,217,182,0.55)',
        textAlign:'center', padding:'4px', lineHeight:1.2,
      }}>
        {book.t?.slice(0,16)}
      </span>
    </div>
  );
}

// ─── Currently Reading ────────────────────────────────────────────────────────

function CurrentlyReadingSection({ books, onOpenBook, t }) {
  if (!books?.length) return null;
  return (
    <div className="db-cr">
      <div className="db-section-eyebrow">
        <span className="db-ornament">❧</span> {t('dashboard.currentlyReading')}
      </div>
      <div className="db-cr__grid">
        {books.map((b, i) => (
          <div key={b.bookId||i} className="db-cr__card" onClick={() => onOpenBook?.(b)}>
            <Cover book={b} size={80} />
            <div className="db-cr__meta">
              <div className="db-cr__title">{b.t}</div>
              <div className="db-cr__author">{b.a}</div>
              {(b.startedAt||b.started_at) && (
                <div className="db-cr__since">{t('dashboard.since')} {relativeDay(b.startedAt||b.started_at, t)}</div>
              )}
              <button className="db-cr__open btn btn-ghost" style={{marginTop:'auto'}}>
                {t('dashboard.open')} →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── relativeDay (needs t passed in) ─────────────────────────────────────────

function relativeDay(dateStr, t) {
  if (!dateStr) return '';
  const d    = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return t('dashboard.today');
  if (diff === 1) return t('dashboard.yesterday');
  if (diff <  7)  return t('dashboard.daysAgo', { count: diff });
  if (diff < 30)  return t('dashboard.weeksAgo', { count: Math.floor(diff/7) });
  if (diff < 365) return t('dashboard.monthsAgo', { count: Math.floor(diff/30) });
  return d.toLocaleDateString(undefined,{month:'short',year:'numeric'});
}

// ─── Plans ───────────────────────────────────────────────────────────────────

function AllPlans({ plans, go, t }) {
  if (!plans?.length) return null;
  return (
    <div className="db-plans">
      <div className="db-section-eyebrow">
        <span className="db-ornament">✦</span> {t('dashboard.readingPlans')}
      </div>
      {plans.map((plan, i) => (
        <div
          key={plan._id || i}
          className="db-plan-banner"
          onClick={() => go('plan-view', { planId: plan._id })}
        >
          <div className="db-plan-banner__inner">
            <div className="db-plan-banner__ornament">✦</div>
            <div className="db-plan-banner__body">
              {i === 0 && (
                <div className="db-plan-banner__label">{t('dashboard.currentPlanLabel')}</div>
              )}
              <div className="db-plan-banner__title">{plan.title || t('dashboard.untitledPlan')}</div>
              <div className="db-plan-banner__meta">
                {t('dashboard.planMeta', { count: (plan.books||[]).length, months: plan.timeline })}
              </div>
            </div>
            <div className="db-plan-banner__cta">{t('dashboard.viewPlan')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── CTAs ─────────────────────────────────────────────────────────────────────

function QuickActions({ go, t }) {
  const actions = [
    {
      label: t('dashboard.ctaOracle'), accent: t('dashboard.ctaOracleAccent'),
      sub: t('dashboard.ctaOracleSub'), ornament: '❦', route: 'oracle', isAccent: true,
    },
    {
      label: t('dashboard.ctaPlan'), accent: t('dashboard.ctaPlanAccent'),
      sub: t('dashboard.ctaPlanSub'), ornament: '✦', route: 'plan-create', isAccent: false,
    },
    {
      label: t('dashboard.ctaWishlist'), accent: t('dashboard.ctaWishlistAccent'),
      sub: t('dashboard.ctaWishlistSub'), ornament: '↗', route: 'wishlist', isAccent: false,
    },
    {
      label: t('dashboard.ctaLibrary'), accent: t('dashboard.ctaLibraryAccent'),
      sub: t('dashboard.ctaLibrarySub'), ornament: '▤', route: 'library', isAccent: false,
    },
  ];
  return (
    <div className="db-ctas">
      {actions.map(({ label, accent, sub, ornament, route, isAccent }) => (
        <div
          key={route}
          className={`db-cta-card${isAccent ? ' db-cta-card--accent' : ''}`}
          onClick={() => go(route)}
        >
          <div className="db-cta-card__ornament">{ornament}</div>
          <div className="db-cta-card__label">{label} <span className="accent">{accent}</span></div>
          <div className="db-cta-card__sub">{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Feed event renderers ─────────────────────────────────────────────────────

function FeedIcon({ type }) {
  const cfg = {
    finished:   { char:'✓', mod:''        },
    started:    { char:'❧', mod:'reading' },
    wishlisted: { char:'+', mod:'wish'    },
    plan:       { char:'✦', mod:'plan'    },
  }[type] || { char:'·', mod:'' };
  return <div className={`feed-icon${cfg.mod ? ' feed-icon--'+cfg.mod : ''}`}>{cfg.char}</div>;
}

function FeedDateLabel({ date, prev, t }) {
  const dk  = dayKey(date);
  const pdk = prev ? dayKey(prev) : null;
  if (dk === pdk) return null;
  return <div className="feed-date-label">{relativeDay(date, t)}</div>;
}

function FinishedEvent({ ev, onOpenBook, t }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedIcon type="finished" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedFinished')}</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> {t('dashboard.feedBy')} {b.a}</span>}
        {b.g && <span className="feed-tag">{b.g}</span>}
      </div>
      <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}

function StartedEvent({ ev, onOpenBook, t }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedIcon type="started" />
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
        <FeedIcon type="wishlisted" />
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
      <FeedIcon type="wishlisted" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedAddedMany', { count: books.length })}</span>
        <div className="feed-bulk">
          {books.slice(0,8).map((b,i) => (
            <Cover key={i} book={b} size={75}
              onClick={e => { e.stopPropagation(); onOpenBook?.(b); }} />
          ))}
          {books.length > 8 && (
            <div className="feed-bulk__more">+{books.length-8}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanEvent({ ev, go, t }) {
  const { plan } = ev;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => go('plan-view')}>
      <FeedIcon type="plan" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedPlanCreated')}</span>{' '}
        <span className="feed-title">{plan.title || t('dashboard.untitledPlan')}</span>
        <div className="feed-sub">{t('dashboard.planMeta', { count: (plan.books||[]).length, months: plan.timeline })}</div>
      </div>
    </div>
  );
}

function FeedEvent({ ev, prev, onOpenBook, go, t }) {
  return (
    <>
      <FeedDateLabel date={ev.date} prev={prev?.date} t={t} />
      {ev.type==='finished'   && <FinishedEvent  ev={ev} onOpenBook={onOpenBook} t={t} />}
      {ev.type==='started'    && <StartedEvent   ev={ev} onOpenBook={onOpenBook} t={t} />}
      {ev.type==='wishlisted' && <WishlistEvent  ev={ev} onOpenBook={onOpenBook} t={t} />}
      {ev.type==='plan'       && <PlanEvent      ev={ev} go={go} t={t} />}
    </>
  );
}

// ─── AI Quota Widget ─────────────────────────────────────────────────────────

function AIQuotaWidget({ go, t }) {
  const { quota, loading } = useOracleQuota();
  if (loading || !quota) return null;

  const isEmpty   = !quota.unlimited && quota.calls_remaining === 0;
  const pct       = quota.unlimited ? 100 : Math.round(((quota.calls_used ?? 0) / (quota.calls_limit ?? 5)) * 100);
  const resetDate = quota.reset_at
    ? new Date(quota.reset_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;

  return (
    <div style={{
      border: `1px solid ${isEmpty ? 'rgba(180,60,60,0.3)' : 'rgba(201,162,75,0.2)'}`,
      borderRadius: '4px',
      padding: '1rem 1.25rem',
      marginBottom: '2rem',
      background: isEmpty ? 'rgba(180,60,60,0.04)' : 'rgba(201,162,75,0.03)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.8 }}>
          {t('dashboard.aiQuotaTitle')}
        </div>
        {quota.unlimited ? (
          <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gilt)', background: 'rgba(201,162,75,0.12)', border: '1px solid rgba(201,162,75,0.3)', padding: '0.1rem 0.5rem', borderRadius: '2px' }}>
            {t('dashboard.aiQuotaUnlimited')}
          </span>
        ) : (
          <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', color: isEmpty ? 'rgba(180,60,60,0.9)' : 'var(--paper-aged)', opacity: isEmpty ? 1 : 0.7 }}>
            {t('dashboard.aiQuotaFree', { used: quota.calls_used ?? 0, limit: quota.calls_limit ?? 5 })}
          </span>
        )}
      </div>

      {!quota.unlimited && (
        <div style={{ height: '3px', background: 'rgba(201,162,75,0.12)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: isEmpty ? 'rgba(180,60,60,0.7)' : 'var(--gilt)',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--paper-aged)', opacity: 0.55 }}>
          {t('dashboard.aiQuotaIncludes')}
          {resetDate && !quota.unlimited && (
            <> · {t('dashboard.aiQuotaResetsOn', { date: resetDate })}</>
          )}
        </span>
        {!quota.unlimited && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
            onClick={() => go('profile')}
          >
            {t('dashboard.aiQuotaUpgrade')}
          </button>
        )}
      </div>
    </div>
  );
}



function ActiveClubSessions({ clubs, go, t }) {
  if (!clubs || clubs.length === 0) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="db-section-eyebrow">
        <span className="db-ornament">◈</span> {t('dashboard.yourClubs')}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {clubs.map((c) => (
          <button
            key={c.id}
            className="btn btn-ghost"
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.85rem' }}
            onClick={() => go('book-club-detail', { clubId: c.id })}
          >
            {c.name}
          </button>
        ))}
        <button
          className="btn btn-ghost"
          style={{ fontSize: '0.85rem', padding: '0.35rem 0.85rem', opacity: 0.5 }}
          onClick={() => go('book-clubs')}
        >
          {t('dashboard.allClubs')}
        </button>
      </div>
    </section>
  );
}

export default function Dashboard({ onOpenBook }) {
  const { state } = useData();
  const { go }    = useRouter();
  const t         = useT();
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);

  const events  = useMemo(() => buildFeed(state), [state]);
  const plans   = state.plans || [];
  const visible = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  const firstName = (state.profile?.displayName || state.profile?.display_name || '').split(' ')[0];
  const levelName = state.profile?.readingLevel
    ? state.profile.readingLevel
    : null;

  return (
    <>
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-eyebrow">{t('dashboard.eyebrow')}</div>
        <h1 className="page-title">
          {firstName
            ? <>{t('dashboard.greeting')} <span className="accent">{firstName}</span></>
            : <>{t('dashboard.greetingBack')} <span className="accent">{t('dashboard.greetingAccent')}</span></>}
        </h1>
        <div className="dashboard-pills">
          {levelName && (
            <span className="level-pill">◆ {t('dashboard.levelPill', { level: levelName })}</span>
          )}
          <span className="level-pill">▤ {t('dashboard.booksRead', { count: state.library.length })}</span>
          <span className="level-pill">❦ {t('dashboard.inWishlist', { count: (state.wishlist||[]).length })}</span>
          {(state.currentlyReading||[]).length > 0 && (
            <span className="level-pill">❧ {t('dashboard.readingNow', { count: state.currentlyReading.length })}</span>
          )}
        </div>
      </div>

      {/* ── CTAs ── */}
      <QuickActions go={go} t={t} />

      {/* ── AI Quota ── */}
      <AIQuotaWidget go={go} t={t} />

      {/* ── Currently Reading ── */}
      <CurrentlyReadingSection books={state.currentlyReading||[]} onOpenBook={onOpenBook} t={t} />

      {/* ── Active Book Club Sessions ── */}
      <ActiveClubSessions clubs={state.clubs||[]} go={go} t={t} />

      {/* ── Reading Plans ── */}
      <AllPlans plans={state.plans||[]} go={go} t={t} />

      {/* ── Activity Feed ── */}
      <div className="db-feed-header">
        <div className="db-section-eyebrow" style={{marginBottom:0}}>
          <span className="db-ornament">◈</span> {t('dashboard.recentActivity')}
        </div>
      </div>

      {events.length === 0 ? (
        <div className="feed-empty">
          <div style={{fontSize:'2rem',marginBottom:'0.75rem',opacity:0.25}}>{t('dashboard.emptyFeedOrnament')}</div>
          <p style={{color:'var(--text-dim)',fontStyle:'italic',textAlign:'center'}}>
            {t('dashboard.emptyFeedText')}<br/>
            {t('dashboard.emptyFeedSub')}
          </p>
        </div>
      ) : (
        <div className="feed">
          {visible.map((ev, i) => (
            <FeedEvent key={ev.key} ev={ev} prev={visible[i-1]||null}
              onOpenBook={onOpenBook} go={go} t={t} />
          ))}

          {hasMore && (
            <button
              className="feed-load-more"
              onClick={() => setVisibleCount(c => c + FEED_PAGE_SIZE)}
            >
              {t('dashboard.showMore', { count: Math.min(FEED_PAGE_SIZE, events.length-visibleCount) })}
            </button>
          )}
        </div>
      )}
    </>
  );
}
