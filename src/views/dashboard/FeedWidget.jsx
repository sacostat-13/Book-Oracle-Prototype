// src/views/dashboard/FeedWidget.jsx — "My activity": the reader's own feed (events from ./feed.js).

import { useMemo, useState } from 'react';
import BookMark from '../../components/BookMark';
import StarRating from '../../components/primitives/StarRating';
import CoverThumb from '../../components/CoverThumb';
import { FEED_PAGE_SIZE, dayKey, relativeDay, buildFeed, FEED_CFG } from './feed';
import { IconDiamond, WidgetShell } from './WidgetShell';

export function FeedAccent({ type }) {
  const mod = FEED_CFG[type]?.label || '';
  return <div className={`feed-accent${mod ? ' feed-accent--' + mod : ''}`} />;
}

export function FeedIcon({ type }) {
  const cfg = FEED_CFG[type] || { char: '·', label: '' };
  return <div className={`feed-icon${cfg.label ? ' feed-icon--' + cfg.label : ''}`} dangerouslySetInnerHTML={{ __html: cfg.char }}></div>;
}

export function FeedDateLabel({ date, prev, t }) {
  if (dayKey(date) === (prev ? dayKey(prev) : null)) return null;
  return <div className="feed-date-label">{relativeDay(date, t)}</div>;
}

export function FinishedEvent({ ev, onOpenBook, t }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedAccent type="finished" /><FeedIcon type="finished" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedFinished')}</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> {t('dashboard.feedBy')} {b.a}</span>}
        <StarRating className="feed-sub feed-stars" value={b.rating} showEmpty />
        {b.g && !b.rating && <span className="feed-tag">{b.g}</span>}
      </div>
      <CoverThumb book={b} width={40} height={60} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}

export function StartedEvent({ ev, onOpenBook, t }) {
  const b = ev.book;
  return (
    <div className="feed-row feed-row--clickable" onClick={() => onOpenBook?.(b)}>
      <FeedAccent type="started" /><FeedIcon type="started" />
      <div className="feed-row__body">
        <span className="feed-verb">{t('dashboard.feedStarted')}</span>{' '}
        <span className="feed-title">{b.t}</span>
        {b.a && <span className="feed-author"> {t('dashboard.feedBy')} {b.a}</span>}
      </div>
      <CoverThumb book={b} width={40} height={60} onClick={() => onOpenBook?.(b)} />
    </div>
  );
}

export function WishlistEvent({ ev, onOpenBook, t }) {
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
        <CoverThumb book={b} width={40} height={60} onClick={() => onOpenBook?.(b)} />
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
            <CoverThumb key={i} book={b} width={40} height={60} onClick={(e) => { e.stopPropagation(); onOpenBook?.(b); }} />
          ))}
          {books.length > 8 && <div className="feed-bulk__more">+{books.length - 8}</div>}
        </div>
      </div>
    </div>
  );
}

export function PlanEvent({ ev, go, t }) {
  const { plan } = ev;
  return (
    // v0.62.2: was go('plan-view') with no planId. 'plan-view' is /plans/:planId,
    // so buildPath() returned null and the URL never moved — same silent failure
    // as the search bug. It also meant every plan row in the feed opened
    // whichever plan happened to be current, not the one named on the row.
    <div className="feed-row feed-row--clickable" onClick={() => go('plan-view', { planId: plan._id })}>
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

export default function FeedWidget({ state, onOpenBook, go, t, eyebrow }) {
  const [visibleCount, setVisibleCount] = useState(FEED_PAGE_SIZE);
  const events = useMemo(() => buildFeed(state), [state]);
  const visible = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  return (
    <WidgetShell icon={<IconDiamond />} label={eyebrow || t('dashboard.recentActivity')}>
      {events.length === 0 ? (
        <div className="feed-empty">
          <div className="feed-empty__ornament"><BookMark animate /></div>
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
