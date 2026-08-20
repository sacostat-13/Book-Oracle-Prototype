// src/views/Kindred.jsx — v0.66
//
// Replaces Friends.jsx. One asymmetric relationship instead of a request queue:
// you follow a reader, they may follow back, and a pair pointing both ways is a
// Kinship. Nothing here has an Accept button, because there is nothing to
// accept — which is most of the reason for the change.
//
// Three tabs, in the order they are useful:
//   Your Kindred    — who you follow. The one with a maintenance need (unfollow,
//                     mute), which is why it leads.
//   Following you   — who follows you, with a follow-back affordance.
//
// A third tab for followed LISTS was tried and removed: the Lists page already
// owns that, and the same thing in two rooms is worse than the thing in one.
// Kindred is about people.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFollows, searchReaders } from '../lib/useFollows';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import Avatar from '../components/Avatar';
import { RowListSkeleton } from '../components/Skeleton';

// ── One reader, in a list ────────────────────────────────────────────────────

function ReaderRow({ entry, t, onOpen, actions }) {
  const p = entry.profile;
  const name = p?.display_name || p?.username || 'Unknown reader';

  return (
    <div className="kin-row">
      <button
        className="kin-row__main"
        onClick={() => p?.username && onOpen(p.username)}
        disabled={!p?.username}
      >
        <Avatar avatarUrl={p?.avatar_url} displayName={name} size={44} />
        <div className="kin-row__body">
          <div className="kin-row__name">
            {name}
            {p?.is_curator && (
              <span className="kin-badge kin-badge--curator" title={t('kindred.curatorHint')}>
                {t('kindred.curator')}
              </span>
            )}
            {entry.mutual && (
              <span className="kin-badge kin-badge--mutual" title={t('kindred.mutualHint')}>
                {t('kindred.mutual')}
              </span>
            )}
          </div>
          {p?.username && <div className="kin-row__meta">@{p.username}</div>}
          {p?.bio && <div className="kin-row__bio">{p.bio}</div>}
        </div>
      </button>
      <div className="kin-row__actions">{actions}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Kindred() {
  const { go } = useRouter();
  const t = useT();
  const {
    following, followers, loading,
    follow, unfollow, setMuted, isFollowing,
  } = useFollows();

  const [tab, setTab] = useState('kindred');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(undefined); // undefined = nothing typed yet
  const [busyId, setBusyId] = useState(null);
  const searchSeq = useRef(0);

  const openProfile = useCallback((username) => {
    go('reader-profile', { username });
  }, [go]);

  // ── Search, as you type ────────────────────────────────────────────────────
  //
  // 250ms debounce. Long enough that a normal typing speed produces one request
  // per pause rather than one per keystroke; short enough that it still feels
  // like the results are keeping up.
  //
  // searchSeq guards against out-of-order responses: a two-character query is
  // slower to run than the five-character one typed after it, so without the
  // sequence check the broader result set can land last and overwrite the
  // narrower one. The results would look wrong in a way that is very hard to
  // reproduce on purpose.
  useEffect(() => {
    const q = query.trim();
    if (q.replace(/^@/, '').length < 2) {
      setResults(undefined);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const found = await searchReaders(q);
      if (seq !== searchSeq.current) return; // a newer query is in flight
      setResults(found);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function toggleFollow(userId) {
    setBusyId(userId);
    try {
      if (isFollowing(userId)) await unfollow(userId);
      else await follow(userId);
    } finally {
      setBusyId(null);
    }
  }

  const TABS = [
    { id: 'kindred', label: t('kindred.tabKindred'), count: following.length },
    { id: 'followers', label: t('kindred.tabFollowers'), count: followers.length },
  ];

  return (
    <>
      <div className="page-head">
        <div className="page-head__eyebrow"><span>{t('kindred.pageEyebrow')}</span></div>
        <h1 className="page-head__title">{t('kindred.pageTitle')}</h1>
        <p className="page-head__sub">{t('kindred.pageSub')}</p>
      </div>

      {/* ── Find a reader ──
          No submit button: results arrive as you type. The form element stays
          so Enter does not reload the page. */}
      <form className="kin-search" onSubmit={(e) => e.preventDefault()} role="search">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('kindred.searchPlaceholder')}
          aria-label={t('kindred.searchPlaceholder')}
          autoComplete="off"
        />
      </form>
      <p className="kin-search__hint">
        {searching ? t('kindred.searching') : t('kindred.searchHint')}
      </p>

      {results?.length === 0 && !searching && (
        <p className="kin-empty">{t('kindred.noResults')}</p>
      )}
      {results?.length > 0 && (
        <div className="kin-list kin-list--result">
          {results.map((r) => (
            <ReaderRow
              key={r.id}
              entry={{ profile: r, userId: r.id, mutual: false }}
              t={t}
              onOpen={openProfile}
              actions={
                <button
                  className={isFollowing(r.id) ? 'btn-secondary btn--sm' : 'btn-primary btn--sm'}
                  onClick={() => toggleFollow(r.id)}
                  disabled={busyId === r.id}
                >
                  {isFollowing(r.id) ? t('kindred.following') : t('kindred.follow')}
                </button>
              }
            />
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="kin-tabs" role="tablist">
        {TABS.map(({ id, label, count }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`pf-tab${tab === id ? ' pf-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            {count > 0 && <span className="kin-tab__count">{count}</span>}
          </button>
        ))}
      </div>

      {loading && <RowListSkeleton rows={4} />}

      {/* ── Your Kindred ── */}
      {!loading && tab === 'kindred' && (
        following.length === 0 ? (
          <div className="kin-empty">
            <p className="kin-empty__title">{t('kindred.emptyKindred')}</p>
            <p className="kin-empty__sub">{t('kindred.emptyKindredSub')}</p>
          </div>
        ) : (
          <div className="kin-list">
            {following.map((entry) => (
              <ReaderRow
                key={entry.userId}
                entry={entry}
                t={t}
                onOpen={openProfile}
                actions={
                  <>
                    {/* Mute before unfollow, deliberately: it is the gentler
                        of the two and the one people actually want when a
                        reader gets loud. Offering only unfollow is how a
                        product turns "too many updates" into a severed
                        relationship. */}
                    <button
                      className="btn-tertiary btn--sm"
                      onClick={() => setMuted(entry.userId, !entry.muted)}
                      title={entry.muted ? t('kindred.mutedHint') : undefined}
                    >
                      {entry.muted ? t('kindred.unmute') : t('kindred.mute')}
                    </button>
                    <button
                      className="btn-secondary btn--sm"
                      onClick={() => toggleFollow(entry.userId)}
                      disabled={busyId === entry.userId}
                    >
                      {t('kindred.unfollow')}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )
      )}

      {/* ── Following you ── */}
      {!loading && tab === 'followers' && (
        followers.length === 0 ? (
          <div className="kin-empty">
            <p className="kin-empty__title">{t('kindred.emptyFollowers')}</p>
            <p className="kin-empty__sub">{t('kindred.emptyFollowersSub')}</p>
          </div>
        ) : (
          <div className="kin-list">
            {followers.map((entry) => (
              <ReaderRow
                key={entry.userId}
                entry={entry}
                t={t}
                onOpen={openProfile}
                actions={
                  entry.followedBack
                    ? <span className="kin-row__note">{t('kindred.mutual')}</span>
                    : (
                      <button
                        className="btn-primary btn--sm"
                        onClick={() => toggleFollow(entry.userId)}
                        disabled={busyId === entry.userId}
                      >
                        {t('kindred.followBack')}
                      </button>
                    )
                }
              />
            ))}
          </div>
        )
      )}

    </>
  );
}
