// src/views/BookClubDetail.jsx — v0.31

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';
import BookCover from '../components/BookCover';
import ClubPolls from '../components/ClubPolls';

function Avatar({ displayName, avatarUrl, size = 32 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (displayName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const initialsEl = (
    <div className="friend-avatar--fallback" style={{ '--fa-sz': `${size}px`, fontSize: size * 0.35 }}>
      {initials}
    </div>
  );
  if (avatarUrl && !imgFailed) {
    return <img src={avatarUrl} alt={displayName} onError={() => setImgFailed(true)} className="friend-avatar" style={{ '--fa-sz': `${size}px` }} />;
  }
  return initialsEl;
}

function SessionCard({ session, onClick, t }) {
  const now = new Date();
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at);
  const isActive = now >= start && now <= end;
  const isPast = now > end;
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="session-card" onClick={onClick}>
      <div className="session-card__head">
        {session.book?.cover_url && (
          <div className="session-card__cover--placeholder">
            <BookCover title={session.book.title} author={session.book.author} coverUrl={session.book.cover_url} />
          </div>
        )}
        <div className="session-card__body">
          <div className="session-card__title">{session.title}</div>
          {session.book?.author && <div className="session-card__author">{session.book.author}</div>}
        </div>
        {isActive && <span className="session-card__status session-card__status--active">{t('clubs.sessionActive')}</span>}
        {isPast && <span className="session-card__status session-card__status--past">{t('clubs.sessionPast')}</span>}
      </div>
      <div className="club-member-progress-label">
        {fmtDate(session.starts_at)} — {fmtDate(session.ends_at)}
      </div>
    </div>
  );
}

export default function BookClubDetail() {
  const { state, deleteClub, leaveClub, regenerateJoinToken, showToast } = useData();
  const { go, route } = useRouter();
  const { user } = useAuth();
  const t = useT();

  const clubId = route.params?.clubId;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  function joinUrl(token) { return `${window.location.origin}${window.location.pathname}#join-club?token=${token}`; }

  async function copyJoinLink() {
    const token = detail?.club?.join_token || stateClub?.joinToken;
    if (!token) return;
    await navigator.clipboard.writeText(joinUrl(token));
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleRegenerateToken() {
    if (!confirm(t('clubs.confirmRegenerate'))) return;
    const newToken = await regenerateJoinToken(clubId);
    if (newToken) {
      setDetail((d) => d ? { ...d, club: { ...d.club, join_token: newToken } } : d);
      showToast(t('clubs.regeneratedToast'));
    }
  }

  async function handleRemoveMember(userId, displayName) {
    if (!confirm(t('clubs.confirmRemoveMember', { name: displayName }))) return;
    await supabase.from('book_club_members').delete().eq('club_id', clubId).eq('user_id', userId);
    await loadDetail();
  }

  async function handlePromoteMember(userId) {
    await supabase.from('book_club_members').update({ role: 'admin' }).eq('club_id', clubId).eq('user_id', userId);
    await loadDetail();
  }

  async function handleLeave() {
    if (!confirm(t('clubs.confirmLeaveText'))) return;
    await leaveClub(clubId);
    go('book-clubs');
  }

  async function handleDelete() { await deleteClub(clubId); go('book-clubs'); }

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div className="loading-text">{t('clubs.loadingClub')}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <>
        <div className="breadcrumb"><a onClick={() => go('book-clubs')}>{t('clubs.createBreadcrumb')}</a></div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('clubs.clubNotFound')}</div>
          <div className="empty-state-text">{t('clubs.clubNotFoundText')}</div>
          <button className="btn-secondary" onClick={() => go('book-clubs')}>{t('clubs.backToClubs')}</button>
        </div>
      </>
    );
  }

  const { club, members, sessions, genres, caller_role } = detail;
  const isAdmin = caller_role === 'admin';
  const isCreator = club.created_by === user?.id;
  const now = new Date();
  const activeSession = (sessions || []).find((s) => { const start = new Date(s.starts_at); const end = new Date(s.ends_at); return now >= start && now <= end; });
  const otherSessions = (sessions || []).filter((s) => s.id !== activeSession?.id);

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>{t('clubs.createBreadcrumb')}</a> · {club.name}
      </div>

      <div className="page-header">
        <div className="page-eyebrow">{isAdmin ? t('clubs.detailAdminBadge') : t('clubs.memberBadge')}</div>
        <h1 className="page-title">{club.name}</h1>
        {club.description && <p className="club-form__desc">{club.description}</p>}
        {genres?.length > 0 && (
          <div className="club-form__genre-row">
            {genres.map((g) => <span key={g.id} className="li-genre-pill">{g.name}</span>)}
          </div>
        )}
      </div>

      <div className="bp-actions">
        <button className="li-action" onClick={copyJoinLink}>{linkCopied ? t('clubs.linkCopied') : t('clubs.copyJoinLink')}</button>
        {isAdmin && (
          <>
            <button className="li-action" onClick={() => go('session-create', { clubId })}>{t('clubs.newSession')}</button>
            <button className="li-action" onClick={handleRegenerateToken}>{t('clubs.regenerateLink')}</button>
          </>
        )}
        {!isCreator && <button className="li-action danger" onClick={handleLeave}>{t('clubs.leaveClub')}</button>}
      </div>

      {activeSession && (
        <div className="db-section">
          <div className="session-section-label">
            {t('clubs.currentSession')}
          </div>
          <SessionCard session={activeSession} onClick={() => go('session-detail', { sessionId: activeSession.id })} t={t} />
        </div>
      )}

      <section className="db-section">
        <div className="club-card__head">
          <div className="session-section-label">
            {activeSession ? t('clubs.pastSessions') : t('clubs.sessions')}
          </div>
          {isAdmin && <button className="li-action" onClick={() => go('session-create', { clubId })}>{t('clubs.newSessionBtn')}</button>}
        </div>
        {(activeSession ? otherSessions : sessions).length === 0 ? (
          <div className="session-no-comments">
            {isAdmin ? t('clubs.noSessionsAdmin') : t('clubs.noSessions')}
          </div>
        ) : (
          <div className="pf-series-list">
            {(activeSession ? otherSessions : sessions).map((s) => (
              <SessionCard key={s.id} session={s} onClick={() => go('session-detail', { sessionId: s.id })} t={t} />
            ))}
          </div>
        )}
      </section>

      <ClubPolls
        clubId={clubId} clubName={club.name}
        clubGenres={(genres || []).map((g) => g.name)}
        isAdmin={isAdmin}
        recentBooks={(sessions || []).slice(0, 5).map((s) => ({ title: s.book?.title, author: s.book?.author })).filter((b) => b.title)}
        onCreateSession={(winnerOption) => go('session-create', { clubId, prefillTitle: winnerOption.label, prefillAuthor: winnerOption.book_author })}
      />

      <section className="db-section">
        <div className="session-section-label">
          {t('clubs.membersSection', { count: members?.length ?? 0 })}
        </div>
        <div className="pf-series-list">
          {(members || []).map((m) => {
            const isSelf = m.user_id === user?.id;
            return (
              <div key={m.id} className="session-card__head">
                <Avatar displayName={m.display_name} avatarUrl={m.avatar_url} />
                <div className="session-card__body">
                  <span className="club-member-row__display">{m.display_name || t('clubs.anonymousReader')}</span>
                  {isSelf && <span className="lv-hl-muted">{t('clubs.you')}</span>}
                </div>
                <span className={`club-card__badge${m.role === 'admin' ? ' club-card__badge--active' : ''}`}>
                  {m.role === 'admin' ? t('clubs.roleAdmin') : t('clubs.roleMember')}
                </span>
                {isAdmin && !isSelf && (
                  <div className="friend-row__actions">
                    {m.role === 'member' && <button className="li-action" onClick={() => handlePromoteMember(m.user_id)}>{t('clubs.makeAdmin')}</button>}
                    <button className="li-action" onClick={() => handleRemoveMember(m.user_id, m.display_name)}>{t('clubs.removeMember')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {isCreator && (
        <section className="session-divider" style={{ paddingTop: "1.5rem" }}>
          <div className="session-section-label" style={{ color: "var(--ro-error)" }}>
            {t('clubs.dangerZone')}
          </div>
          {!confirmDelete ? (
            <button className="li-action danger" onClick={() => setConfirmDelete(true)}>{t('clubs.deleteClub')}</button>
          ) : (
            <div className="bp-actions">
              <span className="clubs-empty-text">{t('clubs.deleteClubConfirm')}</span>
              <button className="li-action danger" onClick={handleDelete}>{t('clubs.confirmDeleteYes')}</button>
              <button className="li-action" onClick={() => setConfirmDelete(false)}>{t('clubs.cancel')}</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
