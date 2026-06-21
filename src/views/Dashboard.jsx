// src/views/Dashboard.jsx — v0.26
// Layout: Currently Reading → Current Plan → CTAs → Activity Feed (paginated)

import { useMemo, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';

const LEVEL_NAMES = { 1:'Casual', 2:'Steady', 3:'Devoted', 4:'Literary', 5:'Voracious' };
const FEED_PAGE_SIZE = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeDay(dateStr) {
  if (!dateStr) return '';
  const d    = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <  7)  return `${diff} days ago`;
  if (diff < 30)  return `${Math.floor(diff/7)}w ago`;
  if (diff < 365) return `${Math.floor(diff/30)}mo ago`;
  return d.toLocaleDateString(undefined,{month:'short',year:'numeric'});
}

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

  // Flatten into a simple list (no day-bucketing for paginated view — day labels inline)
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

function CurrentlyReading({ books, onOpenBook }) {
  if (!books?.length) return null;
  return (
    <div className="db-cr">
      <div className="db-section-eyebrow">
        <span className="db-ornament">❧</span> Currently Reading
      </div>
      <div className="db-cr__grid">
        {books.map((b, i) => (
          <div key={b.bookId||i} className="db-cr__card" onClick={() => onOpenBook?.(b)}>
            <Cover book={b} size={80} />
            <div className="db-cr__meta">
              <div className="db-cr__title">{b.t}</div>
              <div className="db-cr__author">{b.a}</div>
              {(b.startedAt||b.started_at) && (
                <div className="db-cr__since">Since {relativeDay(b.startedAt||b.started_at)}</div>
              )}
              <button className="db-cr__open btn btn-ghost" style={{marginTop:'auto'}}>
                Open →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Plans ───────────────────────────────────────────────────────────────────

function AllPlans({ plans, go }) {
  if (!plans?.length) return null;
  return (
    <div className="db-plans">
      <div className="db-section-eyebrow">
        <span className="db-ornament">✦</span> Reading Plans
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
                <div className="db-plan-banner__label">Current Reading Plan</div>
              )}
              <div className="db-plan-banner__title">{plan.title || 'Untitled plan'}</div>
              <div className="db-plan-banner__meta">
                {(plan.books||[]).length} books · {plan.timeline} months
              </div>
            </div>
            <div className="db-plan-banner__cta">View →</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── CTAs ─────────────────────────────────────────────────────────────────────

function QuickActions({ go }) {
  const actions = [
    { label: 'The <span>Book Oracle</span>', sub: 'Draw from the vault by mood or genre', ornament: '❦', route: 'oracle', accent: true },
    { label: 'Create a <span>Reading Plan</span>', sub: 'A curated path to your next obsession', ornament: '✦', route: 'plan-create', accent: false },
    { label: 'Browse <span>Wishlist</span>', sub: `Your queue of books to read`, ornament: '↗', route: 'wishlist', accent: false },
    { label: 'View <span>Library</span>', sub: 'Everything you\'ve read', ornament: '▤', route: 'library', accent: false },
  ];
  return (
    <div className="db-ctas">
      {actions.map(({ label, sub, ornament, route, accent }) => (
        <div
          key={route}
          className={`db-cta-card${accent ? ' db-cta-card--accent' : ''}`}
          onClick={() => go(route)}
        >
          <div className="db-cta-card__ornament">{ornament}</div>
          <div className="db-cta-card__label" dangerouslySetInnerHTML={{ __html: label }}></div>
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

function FeedDateLabel({ date, prev }) {
  const dk  = dayKey(date);
  const pdk = prev ? dayKey(prev) : null;
  if (dk === pdk) return null;
  return <div className="feed-date-label">{relativeDay(date)}</div>;
}

function FinishedEvent({ ev, onOpenBook }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedIcon type="finished" />
      <div className="feed-row__body">
        <span className="feed-verb">Finished</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> by {b.a}</span>}
        {b.g && <span className="feed-tag">{b.g}</span>}
      </div>
      <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}

function StartedEvent({ ev, onOpenBook }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedIcon type="started" />
      <div className="feed-row__body">
        <span className="feed-verb">Started reading</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> by {b.a}</span>}
      </div>
      <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}

function WishlistEvent({ ev, onOpenBook }) {
  const { books } = ev;
  if (books.length === 1) {
    const b = books[0];
    return (
      <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
        <FeedIcon type="wishlisted" />
        <div className="feed-row__body">
          <span className="feed-verb">Added to wishlist</span>{' '}
          <span className="feed-title">{b.t}</span>
          {b.a && <span className="feed-author"> by {b.a}</span>}
        </div>
        <Cover book={b} size={75} onClick={() => onOpenBook?.(b)} />
      </div>
    );
  }
  return (
    <div className="feed-row">
      <FeedIcon type="wishlisted" />
      <div className="feed-row__body">
        <span className="feed-verb">Added {books.length} books to wishlist</span>
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

function PlanEvent({ ev, go }) {
  const { plan } = ev;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => go('plan-view')}>
      <FeedIcon type="plan" />
      <div className="feed-row__body">
        <span className="feed-verb">Created reading plan</span>{' '}
        <span className="feed-title">{plan.title||'Untitled plan'}</span>
        <div className="feed-sub">{(plan.books||[]).length} books · {plan.timeline} months</div>
      </div>
    </div>
  );
}

function FeedEvent({ ev, prev, onOpenBook, go }) {
  return (
    <>
      <FeedDateLabel date={ev.date} prev={prev?.date} />
      {ev.type==='finished'   && <FinishedEvent  ev={ev} onOpenBook={onOpenBook} />}
      {ev.type==='started'    && <StartedEvent   ev={ev} onOpenBook={onOpenBook} />}
      {ev.type==='wishlisted' && <WishlistEvent  ev={ev} onOpenBook={onOpenBook} />}
      {ev.type==='plan'       && <PlanEvent      ev={ev} go={go} />}
    </>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function ActiveClubSessions({ clubs, go }) {
  if (!clubs || clubs.length === 0) return null;
  // We only have lightweight club data here — no sessions.
  // Just show a prompt to visit clubs if they have any.
  // Phase 5 can enrich this with a full active session query.
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="db-section-eyebrow">
        <span className="db-ornament">◈</span> Your Book Clubs
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
          All clubs →
        </button>
      </div>
    </section>
  );
}

export default function Dashboard({ onOpenBook }) {
  const { state } = useData();
  const { go }    = useRouter();
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);

  const events  = useMemo(() => buildFeed(state), [state]);
  const plans   = state.plans || [];
  const visible = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  const firstName = (state.profile?.displayName || state.profile?.display_name || '').split(' ')[0];

  return (
    <>
      {/* ── Header ── */}
      <div className="page-header">
        <div className="page-eyebrow">Your Library</div>
        <h1 className="page-title">
          {firstName
            ? <>Good to see you, <span className="accent">{firstName}</span></>
            : <>Welcome <span className="accent">back</span></>}
        </h1>
        <div className="dashboard-pills">
          {state.profile?.readingLevel && (
            <span className="level-pill">◆ {LEVEL_NAMES[state.profile.readingLevel]} reader</span>
          )}
          <span className="level-pill">▤ {state.library.length} read</span>
          <span className="level-pill">❦ {(state.wishlist||[]).length} in wishlist</span>
          {(state.currentlyReading||[]).length > 0 && (
            <span className="level-pill">❧ {state.currentlyReading.length} reading now</span>
          )}
        </div>
      </div>

      {/* ── CTAs ── */}
      <QuickActions go={go} />

      {/* ── Currently Reading ── */}
      <CurrentlyReading books={state.currentlyReading||[]} onOpenBook={onOpenBook} />

      {/* ── Active Book Club Sessions ── */}
      <ActiveClubSessions clubs={state.clubs||[]} go={go} />

      {/* ── Reading Plans ── */}
      <AllPlans plans={state.plans||[]} go={go} />

      {/* ── Activity Feed ── */}
      <div className="db-feed-header">
        <div className="db-section-eyebrow" style={{marginBottom:0}}>
          <span className="db-ornament">◈</span> Recent Activity
        </div>
      </div>

      {events.length === 0 ? (
        <div className="feed-empty">
          <div style={{fontSize:'2rem',marginBottom:'0.75rem',opacity:0.25}}>❦</div>
          <p style={{color:'var(--text-dim)',fontStyle:'italic',textAlign:'center'}}>
            Your reading story starts here.<br/>
            Mark a book as read or add one to your wishlist.
          </p>
        </div>
      ) : (
        <div className="feed">
          {visible.map((ev, i) => (
            <FeedEvent key={ev.key} ev={ev} prev={visible[i-1]||null}
              onOpenBook={onOpenBook} go={go} />
          ))}

          {hasMore && (
            <button
              className="feed-load-more"
              onClick={() => setVisibleCount(c => c + FEED_PAGE_SIZE)}
            >
              Show {Math.min(FEED_PAGE_SIZE, events.length-visibleCount)} more updates
            </button>
          )}
        </div>
      )}
    </>
  );
}
