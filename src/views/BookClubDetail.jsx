// src/views/BookClubDetail.jsx — v0.28
// Full detail page for a book club. Loads club data on mount via RPC.
// Admins see extra controls (edit, add session, manage members, copy join link).

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import BookCover from '../components/BookCover';
import ClubPolls from '../components/ClubPolls';

function Avatar({ displayName, avatarUrl, size = 32 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (displayName || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const initialsEl = (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: 'rgba(176,140,63,0.15)',
        border: '1px solid rgba(176,140,63,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Special Elite', monospace",
        fontSize: size * 0.35,
        color: 'var(--gilt)',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );

  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return initialsEl;
}

function SessionCard({ session, onClick }) {
  const now = new Date();
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at);
  const isActive = now >= start && now <= end;
  const isPast = now > end;

  const fmtDate = (d) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div
      className="cr-card"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', cursor: 'pointer', gridTemplateColumns: undefined }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {session.book?.cover_url && (
          <div style={{ width: 40, flexShrink: 0 }}>
            <BookCover
              title={session.book.title}
              author={session.book.author}
              coverUrl={session.book.cover_url}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.05rem', color: 'var(--paper)', lineHeight: 1.2 }}>
            {session.title}
          </div>
          {session.book?.author && (
            <div style={{ fontSize: '0.8rem', color: 'var(--paper-aged)', opacity: 0.65 }}>
              {session.book.author}
            </div>
          )}
        </div>
        {isActive && (
          <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gilt)', flexShrink: 0 }}>
            ✦ Active
          </span>
        )}
        {isPast && (
          <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--paper-aged)', opacity: 0.4, flexShrink: 0 }}>
            Past
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--paper-aged)', opacity: 0.55, fontFamily: "'Special Elite', monospace", letterSpacing: '0.04em' }}>
        {fmtDate(session.starts_at)} — {fmtDate(session.ends_at)}
      </div>
    </div>
  );
}

export default function BookClubDetail() {
  const { state, deleteClub, leaveClub, regenerateJoinToken, showToast } = useData();
  const { go, route } = useRouter();
  const { user } = useAuth();

  const clubId = route.params?.clubId;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Find the lightweight club entry from state (for joinToken while detail loads)
  const stateClub = (state.clubs || []).find((c) => c.id === clubId);

  const loadDetail = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_club_detail', { p_club_id: clubId });
    setLoading(false);
    if (error) { console.error('get_club_detail failed', error); return; }
    setDetail(data);
  }, [clubId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  function joinUrl(token) {
    return `${window.location.origin}${window.location.pathname}#join-club?token=${token}`;
  }

  async function copyJoinLink() {
    const token = detail?.club?.join_token || stateClub?.joinToken;
    if (!token) return;
    await navigator.clipboard.writeText(joinUrl(token));
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleRegenerateToken() {
    if (!confirm('Regenerate join link? The old link will stop working.')) return;
    const newToken = await regenerateJoinToken(clubId);
    if (newToken) {
      setDetail((d) => d ? { ...d, club: { ...d.club, join_token: newToken } } : d);
      showToast('Join link regenerated');
    }
  }

  async function handleRemoveMember(userId, displayName) {
    if (!confirm(`Remove ${displayName} from this club?`)) return;
    await supabase.from('book_club_members').delete()
      .eq('club_id', clubId).eq('user_id', userId);
    await loadDetail();
  }

  async function handlePromoteMember(userId) {
    await supabase.from('book_club_members').update({ role: 'admin' })
      .eq('club_id', clubId).eq('user_id', userId);
    await loadDetail();
  }

  async function handleLeave() {
    if (!confirm('Leave this club?')) return;
    await leaveClub(clubId);
    go('book-clubs');
  }

  async function handleDelete() {
    await deleteClub(clubId);
    go('book-clubs');
  }

  if (loading) {
    return (
      <div className="loading" style={{ paddingTop: '6rem' }}>
        <div className="loading-spinner" />
        <div className="loading-text">Loading club…</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <>
        <div className="breadcrumb"><a onClick={() => go('book-clubs')}>Book Clubs</a></div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Club not found</div>
          <div className="empty-state-text">You may not be a member of this club, or it no longer exists.</div>
          <button className="btn btn-ghost" style={{ marginTop: '1.5rem' }} onClick={() => go('book-clubs')}>Back to clubs</button>
        </div>
      </>
    );
  }

  const { club, members, sessions, genres, caller_role } = detail;
  const isAdmin = caller_role === 'admin';
  const isCreator = club.created_by === user?.id;

  const now = new Date();
  const activeSession = (sessions || []).find((s) => {
    const start = new Date(s.starts_at);
    const end = new Date(s.ends_at);
    return now >= start && now <= end;
  });
  const otherSessions = (sessions || []).filter((s) => s.id !== activeSession?.id);

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>Book Clubs</a> · {club.name}
      </div>

      {/* Club header */}
      <div className="page-header">
        <div className="page-eyebrow">
          {isAdmin ? '✦ You are an admin' : 'Member'}
        </div>
        <h1 className="page-title">{club.name}</h1>
        {club.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.4rem', lineHeight: 1.6 }}>
            {club.description}
          </p>
        )}
        {genres?.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            {genres.map((g) => (
              <span key={g.id} className="li-genre-pill">{g.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
        <button className="li-action" onClick={copyJoinLink}>
          {linkCopied ? '✓ Copied!' : '⬡ Copy join link'}
        </button>
        {isAdmin && (
          <>
            <button className="li-action" onClick={() => go('session-create', { clubId })}>
              + New session
            </button>
            <button className="li-action" onClick={handleRegenerateToken}>
              ↺ New link
            </button>
          </>
        )}
        {!isCreator && (
          <button className="li-action danger" onClick={handleLeave}>
            Leave club
          </button>
        )}
      </div>

      {/* Active session banner */}
      {activeSession && (
        <div style={{ marginBottom: '2rem' }}>
          <div
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.7rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--gilt)',
              marginBottom: '0.6rem',
            }}
          >
            Current session
          </div>
          <SessionCard session={activeSession} onClick={() => go('session-detail', { sessionId: activeSession.id })} />
        </div>
      )}

      {/* Sessions */}
      <section style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '1rem' }}>
          <div
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.7rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--gilt)',
            }}
          >
            {activeSession ? 'Past sessions' : 'Sessions'}
          </div>
          {isAdmin && (
            <button className="li-action" onClick={() => go('session-create', { clubId })}>
              + New
            </button>
          )}
        </div>
        {(activeSession ? otherSessions : sessions).length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.9rem' }}>
            {isAdmin ? 'No sessions yet. Create one to get started.' : 'No sessions yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(activeSession ? otherSessions : sessions).map((s) => (
              <SessionCard key={s.id} session={s} onClick={() => go('session-detail', { sessionId: s.id })} />
            ))}
          </div>
        )}
      </section>

      {/* Polls — v0.29 */}
      <ClubPolls
        clubId={clubId}
        clubName={club.name}
        clubGenres={(genres || []).map((g) => g.name)}
        isAdmin={isAdmin}
        recentBooks={(sessions || []).slice(0, 5).map((s) => ({ title: s.book?.title, author: s.book?.author })).filter((b) => b.title)}
        onCreateSession={(winnerOption) => go('session-create', { clubId, prefillTitle: winnerOption.label, prefillAuthor: winnerOption.book_author })}
      />

      {/* Members */}
      <section style={{ marginBottom: '2.5rem' }}>
        <div
          style={{
            fontFamily: "'Special Elite', monospace",
            fontSize: '0.7rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--gilt)',
            marginBottom: '0.75rem',
          }}
        >
          Members · {members?.length ?? 0}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {(members || []).map((m) => {
            const isSelf = m.user_id === user?.id;
            return (
              <div
                key={m.id}
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
              >
                <Avatar displayName={m.display_name} avatarUrl={m.avatar_url} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--paper)' }}>
                    {m.display_name || 'Anonymous reader'}
                  </span>
                  {isSelf && <span style={{ opacity: 0.4, fontSize: '0.8rem', marginLeft: '0.4rem' }}>(you)</span>}
                </div>
                <span
                  style={{
                    fontFamily: "'Special Elite', monospace",
                    fontSize: '0.62rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: m.role === 'admin' ? 'var(--gilt)' : 'var(--paper-aged)',
                    opacity: m.role === 'admin' ? 1 : 0.4,
                  }}
                >
                  {m.role}
                </span>
                {isAdmin && !isSelf && (
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {m.role === 'member' && (
                      <button className="li-action" style={{ fontSize: '0.7rem' }} onClick={() => handlePromoteMember(m.user_id)}>
                        Make admin
                      </button>
                    )}
                    <button className="li-action danger" style={{ fontSize: '0.7rem' }} onClick={() => handleRemoveMember(m.user_id, m.display_name)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Danger zone — creator only */}
      {isCreator && (
        <section
          style={{
            borderTop: '1px solid rgba(176,140,63,0.1)',
            paddingTop: '1.5rem',
            marginTop: '1rem',
          }}
        >
          <div
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: '0.7rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'rgba(180,60,60,0.7)',
              marginBottom: '0.75rem',
            }}
          >
            Danger zone
          </div>
          {!confirmDelete ? (
            <button
              className="li-action danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete club
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--paper-aged)', opacity: 0.7 }}>
                This will delete all sessions and remove all members. Are you sure?
              </span>
              <button className="li-action danger" onClick={handleDelete}>Yes, delete</button>
              <button className="li-action" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
