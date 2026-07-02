// src/views/Friends.jsx — The Books Oracle v0.38
// Dedicated Friends page: search/invite, incoming requests, current friends, suggestions.
// Extracted from Profile.jsx per v0.38 design system — Friends is now its own route.

import { useState, useEffect, useCallback } from 'react';
import { useFriends, checkUsernameAvailability } from '../lib/useFriends';
import { useAuth } from '../lib/AuthContext';
import { useRouter } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

// ── Avatar component ──────────────────────────────────────────────────────────
function Avatar({ url, name, size = 44 }) {
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  const colors = ['#3d5a80', '#6b4226', '#3d6b45', '#6b3d5a', '#4d6b3d', '#5a3d6b'];
  const bg = colors[(initial.charCodeAt(0) || 0) % colors.length];

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="friend-avatar" style={{ '--fa-sz': `${size}px` }}
      />
    );
  }
  return (
    <div className="friend-avatar--fallback" style={{ '--fa-sz': `${size}px`, background: bg, fontSize: Math.round(size * 0.38) }}>
      {initial}
    </div>
  );
}

// ── Friend request row ────────────────────────────────────────────────────────
function RequestRow({ req, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false);
  const other = req.other;

  async function handle(fn) {
    setBusy(true);
    await fn(req.id);
    setBusy(false);
  }

  return (
    <div className="friend-row friend-row--request">
      <Avatar url={other?.avatar_url} name={other?.display_name || other?.username || '?'} size={44} />
      <div className="friend-row__body">
        <div className="friend-row__name">
          {other?.display_name || other?.username || 'Unknown reader'}
        </div>
        {other?.username && (
          <div className="friend-row__meta">
            @{other.username}
          </div>
        )}
      </div>
      <div className="friend-row__actions">
        <button
          className="btn btn-sm"
          onClick={() => handle(onAccept)}
          disabled={busy}
        >
          Accept
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={() => handle(onDecline)}
          disabled={busy}

        >
          Decline
        </button>
      </div>
    </div>
  );
}

// ── Friend row ────────────────────────────────────────────────────────────────
function FriendRow({ friend, onRemove, onView }) {
  const [busy, setBusy] = useState(false);
  const other = friend.other;

  return (
    <div className="friend-row friend-row--request">
      <Avatar url={other?.avatar_url} name={other?.display_name || other?.username || '?'} size={46} />
      <div className="friend-row__body">
        <div className="friend-row__name-row">
          <span className="friend-row__name">
            {other?.display_name || other?.username || 'Unknown reader'}
          </span>
          {other?.username && (
            <span className="friend-row__meta">
              @{other.username}
            </span>
          )}
        </div>
      </div>
      <div className="friend-row__actions">
        {other?.username && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => onView(other.username)}

          >
            View
          </button>
        )}
        <button
          className="btn-danger btn-sm"
          onClick={async () => { setBusy(true); await onRemove(friend.id); setBusy(false); }}
          disabled={busy}

        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Search result row ─────────────────────────────────────────────────────────
function SearchResultRow({ profile, onSend, relationStatus }) {
  const [busy, setBusy] = useState(false);

  let actionLabel = 'Add friend';
  let actionClass = 'btn btn-secondary btn-sm';
  let disabled = false;
  if (relationStatus === 'friends') { actionLabel = 'Friends ✓'; disabled = true; }
  if (relationStatus === 'pending_out') { actionLabel = 'Request sent'; disabled = true; }
  if (relationStatus === 'pending_in') { actionLabel = 'Accept request'; actionClass = 'btn-sm'; }

  return (
    <div className="friends-suggest-card">
      <Avatar url={profile.avatar_url} name={profile.display_name || profile.username} size={54} />
      <div>
        <div className="friend-row__name">
          {profile.display_name || profile.username}
        </div>
        {profile.username && (
          <div className="friend-row__meta">
            @{profile.username}
          </div>
        )}
      </div>
      <button
        className={actionClass}
        disabled={disabled || busy}

        onClick={async () => { setBusy(true); await onSend(profile.id); setBusy(false); }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

// ── Main Friends view ─────────────────────────────────────────────────────────
export default function Friends() {
  const t = useT();
  const { user } = useAuth();
  const { go } = useRouter();
  const { friends, incoming, pending, loading, acceptRequest, declineRequest, removeFriend, sendRequest } = useFriends();

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);

  // Derive relation status map for search results
  const relationMap = {};
  friends.forEach(f => { if (f.other?.id) relationMap[f.other.id] = 'friends'; });
  pending.forEach(f => { if (f.other?.id) relationMap[f.other.id] = 'pending_out'; });
  incoming.forEach(f => { if (f.other?.id) relationMap[f.other.id] = 'pending_in'; });

  // Search debounce
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]); setSearchDone(false); return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const q = query.trim().replace(/^@/, '');
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .neq('id', user?.id || '')
        .limit(12);
      setSearchResults(data || []);
      setSearchDone(true);
      setSearching(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, user]);

  function handleView(username) {
    go('friend-profile', { username });
  }

  const incomingCount = incoming.length;
  const friendsCount = friends.length;

  return (
    <div className="friends-page">

      {/* ── Page header ── */}
      <div>
        <div className="page-eyebrow">
          <span class="t-gold">Dashboard</span>
          <span className="sep"> · </span>
          Friends
        </div>
        <h1 className="page-title">
          Reading <span className="accent">friends</span>
        </h1>
        <p className="page-subtitle">Follow readers and see what they finish.</p>
      </div>

      {/* ── Search & invite ── */}
      <div className="friends-toolbar">
        <div className="lv-search">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ro-gold-text)" strokeWidth={1.8}>
            <circle cx={11} cy={11} r={7} /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find readers by name or @handle…"
            className="search__input"
          />
          {searching && (
            <div className="loading-spinner" style={{ width: 14, height: 14 }} />
          )}
        </div>
        <button className="btn-primary">
          Invite a friend
        </button>
      </div>

      {/* ── Search results ── */}
      {searchDone && (
        <div>
          <div className="pf-overline">
            Search Results · {searchResults.length}
          </div>
          {searchResults.length === 0 ? (
            <div className="friends-empty">
              No readers found for "{query}".
            </div>
          ) : (
            <div className="friends-suggest-grid">
              {searchResults.map(p => (
                <SearchResultRow
                  key={p.id}
                  profile={p}
                  relationStatus={relationMap[p.id]}
                  onSend={sendRequest}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Incoming requests ── */}
      {(loading || incomingCount > 0) && (
        <div>
          <div className="pf-overline">
            Friend Requests {incomingCount > 0 && `· ${incomingCount}`}
          </div>
          {loading ? (
            <div className="db-ff-loading">
              <div className="loading-spinner" />
            </div>
          ) : incomingCount === 0 ? (
            <div className="friends-empty">
              No pending requests.
            </div>
          ) : (
            <div className="pf-series-list">
              {incoming.map(req => (
                <RequestRow
                  key={req.id}
                  req={req}
                  onAccept={acceptRequest}
                  onDecline={declineRequest}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Your friends ── */}
      <div>
        <div className="pf-overline">
          Your Friends {friendsCount > 0 && `· ${friendsCount}`}
        </div>
        {loading ? (
          <div className="db-ff-loading">
            <div className="loading-spinner" />
          </div>
        ) : friendsCount === 0 ? (
          <div className="empty-state">
            <div className="ornament">📚</div>
            <div className="empty-state-title">No reading friends yet</div>
            <div className="empty-state-text">Search for readers above or invite someone to join.</div>
          </div>
        ) : (
          <div className="pf-series-list">
            {friends.map(f => (
              <FriendRow
                key={f.id}
                friend={f}
                onRemove={removeFriend}
                onView={handleView}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Pending sent requests ── */}
      {pending.length > 0 && (
        <div>
          <div className="pf-overline">
            Sent Requests · {pending.length}
          </div>
          <div className="pf-series-list">
            {pending.map(p => (
              <div key={p.id} className="friend-row">
                <Avatar url={p.other?.avatar_url} name={p.other?.display_name || p.other?.username} size={44} />
                <div className="friend-row__body">
                  <div className="friend-row__name">
                    {p.other?.display_name || p.other?.username || 'Unknown reader'}
                  </div>
                  {p.other?.username && (
                    <div className="friend-row__meta">
                      @{p.other.username}
                    </div>
                  )}
                </div>
                <span className="pf-overline" style={{ flexShrink: 0, marginBottom: 0 }}>
                  Pending
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
