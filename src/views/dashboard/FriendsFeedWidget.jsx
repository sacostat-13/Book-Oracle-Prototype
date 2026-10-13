// src/views/dashboard/FriendsFeedWidget.jsx — "My Kindred reading": what followed readers are up to.

import { useState, useCallback, useEffect } from 'react';
import { RowListSkeleton } from '../../components/Skeleton';
import { openBookTab } from '../../lib/book/bookHelpers';
import { getFollowingFeedEvents } from '../../hooks/useFollows';
import StarRating from '../../components/primitives/StarRating';
import { IconDiamond, WidgetShell } from './WidgetShell';

// ─── Friends Feed ──────────────────────────────────────────────────────────────
export function FriendAvatar({ friend, size = 30 }) {
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

export default function FriendsFeedWidget({ userId, hasFriends, go, t, scope = 'both' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (!userId || !hasFriends) return;
    setLoading(true);
    // scope comes from the reader's preference: 'follows' | 'mutuals' | 'both'.
    // Muted follows are dropped inside the query for every scope — that is what
    // separates a mute from an unfollow.
    try { const evs = await getFollowingFeedEvents(userId, { scope }); setEvents(evs); setUpdatedAt(new Date()); }
    finally { setLoading(false); }
  }, [userId, hasFriends, scope]);

  useEffect(() => { load(); }, [load]);

  const relTime = updatedAt
    ? updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  if (!hasFriends) {
    return (
      <WidgetShell icon={<IconDiamond />} label={t('dashboard.widgetFriendsFeed')}>
        <div className="db-ff-empty">
          <p className="db-ff-empty-text">{t('dashboard.friendsFeedNoFriends')}</p>
          <button className="btn-tertiary btn--sm" onClick={() => go('kindred')}>
            {t('profile.viewKindred')}
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
        <RowListSkeleton count={3} />
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
                    <StarRating className="db-ff-stars" value={ev.book?.rating} showEmpty />
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
