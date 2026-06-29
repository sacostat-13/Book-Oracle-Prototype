// src/views/SessionDetail.jsx — v0.28
// Book info, admin notes, member progress grid.
// Admins can edit (book, dates, notes) and delete the session.

import { useState, useEffect, useCallback } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { openBookTab } from '../lib/bookHelpers';
import { lookupByTitle } from '../lib/bookLookup';
import BookCover from '../components/BookCover';
import ProgressUpdateModal from '../components/ProgressUpdateModal';
import SessionDiscussion from '../components/SessionDiscussion';
import { useT } from '../lib/I18nContext';

// ── Shared sub-components ─────────────────────────────────────────────────────

function Avatar({ displayName, avatarUrl, size = 28 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (displayName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (avatarUrl && !imgFailed) {
    return <img src={avatarUrl} alt={displayName} onError={() => setImgFailed(true)} className="friend-avatar" style={{ '--fa-sz': `${size}px` }} />;
  }
  return (
    <div className="friend-avatar--fallback" style={{ '--fa-sz': `${size}px`, fontSize: size * 0.35 }}>
      {initials}
    </div>
  );
}

function MemberProgressRow({ member, totalPages }) {
  const pct = totalPages && member.pages_read > 0
    ? Math.min(100, Math.round((member.pages_read / totalPages) * 100))
    : null;
  const finished = pct === 100;
  return (
    <div className="club-member-row">
      <Avatar displayName={member.display_name} avatarUrl={member.avatar_url} />
      <div className="club-member-row__body">
        <div className="club-member-row__name">
          <span className="club-member-row__display">
            {member.display_name || 'Anonymous reader'}
          </span>
          {member.role === 'admin' && (
            <span className="club-member-row__admin">admin</span>
          )}
        </div>
        {member.is_reading ? (
          totalPages ? (
            <div>
              <div className="club-member-progress-bar">
                <div className={`club-member-progress-fill${finished ? ' club-member-progress-fill--done' : ''}`} style={{ '--mp-pct': `${pct ?? 0}%` }} />
              </div>
              <div className="club-member-progress-label">
                {member.pages_read > 0
                  ? `${member.pages_read} / ${totalPages} pages${pct !== null ? ` · ${pct}%` : ''}${finished ? ' · ✓ Finished' : ''}`
                  : `0 / ${totalPages} pages — not started`}
              </div>
            </div>
          ) : (
            <div className="club-member-progress-label">
              {member.pages_read > 0 ? t('sessions.pagesNoTotal', { count: member.pages_read }) : t('sessions.pagesNoTotalYet')}
            </div>
          )
        ) : (
          <div className="club-member-progress-label" style={{ opacity: .35 }}>
            {t('sessions.notTracking')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit session modal ────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(176, 140, 63, 0.04)',
  border: '1px solid rgba(176, 140, 63, 0.25)',
  borderRadius: 'var(--ro-radius-sm)',
  padding: '0.6rem 0.85rem',
  color: 'var(--paper)',
  fontFamily: 'var(--ro-font-display)',
  fontSize: '1.05rem',
};

const labelStyle = {
  display: 'block',
  fontFamily: 'var(--ro-font-mono)',
  fontSize: '0.72rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'var(--gilt)',
  marginBottom: '0.4rem',
};

function BookThumb({ book, size = 28 }) {
  return (
    <div className="session-form__cover" style={{ '--sc-w': `${size}px`, '--sc-h': `${size * 1.5}px` }}>
      <BookCover title={book.t || book.title} author={book.a || book.author} coverUrl={book.coverUrl || book.cover_url} />
    </div>
  );
}

function EditSessionModal({ session, book, onSave, onClose }) {
  const { state, upsertBookOnServer } = useData();

  // Normalise the current book into the client shape the picker expects
  const currentBook = { t: book.title, a: book.author, coverUrl: book.cover_url, bookId: book.id, pp: book.pages };

  const [selectedBook, setSelectedBook] = useState(currentBook);
  const [bookQuery, setBookQuery] = useState('');
  const [bookResults, setBookResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adminNotes, setAdminNotes] = useState(session.admin_notes || '');
  const [startsAt, setStartsAt] = useState(session.starts_at);
  const [endsAt, setEndsAt] = useState(session.ends_at);
  const [saving, setSaving] = useState(false);

  async function searchBooks(q) {
    if (!q.trim()) { setBookResults([]); return; }
    setSearching(true);
    const vaultHits = (state.vault || [])
      .filter((b) => b.t.toLowerCase().includes(q.toLowerCase()) || b.a?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);
    if (vaultHits.length >= 3) { setBookResults(vaultHits); setSearching(false); return; }
    try {
      const remote = await lookupByTitle(q);
      const combined = [...vaultHits];
      if (remote && !vaultHits.find((b) => b.t.toLowerCase() === remote.t.toLowerCase())) combined.push(remote);
      setBookResults(combined.slice(0, 6));
    } catch { setBookResults(vaultHits); }
    setSearching(false);
  }

  async function handleSave() {
    if (!selectedBook || !startsAt || !endsAt) return;
    setSaving(true);

    let bookId = selectedBook.bookId;
    if (!bookId) bookId = await upsertBookOnServer(selectedBook, 'discovered');
    if (!bookId) { setSaving(false); return; }

    await onSave({ bookId, adminNotes: adminNotes.trim() || null, startsAt, endsAt });
    setSaving(false);
  }

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      className="rating-modal-overlay"
    >
      <div className="rating-modal" style={{ maxWidth: "520px", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="rating-modal__eyebrow">
          {t('sessions.editEyebrow', { clubName: 'Admin' })}
        </div>
        <h2 className="rating-modal__title">
          {t('sessions.editTitle')}
        </h2>

        <div className="session-form">
          {/* Book picker */}
          <div>
            <label style={labelStyle}>Book</label>
            {selectedBook ? (
              <div className="session-form__book-row">
                <BookThumb book={selectedBook} size={28} />
                <div className="club-member-row__body">
                  <div className="session-form__book-title">{selectedBook.t || selectedBook.title}</div>
                  {(selectedBook.a || selectedBook.author) && <div className="session-form__book-author">{selectedBook.a || selectedBook.author}</div>}
                </div>
                <button className="li-action" onClick={() => { setSelectedBook(null); setBookResults([]); }}>{t('sessions.changeBook')}</button>
              </div>
            ) : (
              <div className="session-form__dropdown">
                <input
                  style={inputStyle}
                  placeholder="Search by title or author…"
                  value={bookQuery}
                  onChange={(e) => { setBookQuery(e.target.value); searchBooks(e.target.value); }}
                  autoFocus
                />
                {(bookResults.length > 0 || searching) && (
                  <div className="session-form__search-results">
                    {searching && <div className="ldetail-empty">Searching…</div>}
                    {bookResults.map((b, i) => (
                      <div
                        key={b.bookId || i}
                        className="ldetail-pick-row"
                        onClick={() => { setSelectedBook(b); setBookResults([]); setBookQuery(''); }}
                      >
                        <BookThumb book={b} size={24} />
                        <div>
                          <div className="ldetail-pick-title">{b.t}</div>
                          {b.a && <div className="ldetail-pick-author">{b.a}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="db-stats-grid">
            <div>
              <label style={labelStyle}>Starts</label>
              <input type="date" style={inputStyle} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Ends</label>
              <input type="date" style={inputStyle} value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>
              Notes for members{' '}
              <span className="club-form__optional">(optional)</span>
            </label>
            <textarea
              className="textarea"
              placeholder="Discussion questions, reading goals, pace suggestions…"
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn" onClick={handleSave} disabled={!selectedBook || !startsAt || !endsAt || saving}>
              {saving ? t('sessions.saving') : t('sessions.saveButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function SessionDetail() {
  const t = useT();
  const { state, updateReadingProgress, startReading, showToast } = useData();
  const { go, route } = useRouter();
  const { user } = useAuth();

  const sessionId = route.params?.sessionId;

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_session_detail', { p_session_id: sessionId });
    setLoading(false);
    if (error) { console.error('get_session_detail failed', error); return; }
    setDetail(data);
  }, [sessionId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  if (loading) {
    return (
      <div className="loading" style={{ paddingTop: '6rem' }}>
        <div className="loading-spinner" />
        <div className="loading-text">{t('sessions.loadingSession')}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <>
        <div className="breadcrumb"><a onClick={() => go('book-clubs')}>{t('clubs.createBreadcrumb')}</a></div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('sessions.sessionNotFound')}</div>
          <div className="empty-state-text">{t('sessions.sessionNotFoundText')}</div>
          <button className="btn-secondary" onClick={() => go('book-clubs')}>{t('sessions.backToClubs')}</button>
        </div>
      </>
    );
  }

  const { session, book, progress, caller_role } = detail;
  const isAdmin = caller_role === 'admin';
  const clubId = session.club_id;
  const club = (state.clubs || []).find((c) => c.id === clubId);

  const now = new Date();
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at);
  const isActive = now >= start && now <= end;
  const isPast = now > end;

  const fmtDate = (d) =>
    new Date(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  const myProgress = (progress || []).find((m) => m.user_id === user?.id);
  const iAmReading = myProgress?.is_reading;

  // Use the actual book_id from the user's currently_reading row (cr_book_id),
  // which may differ from the session's book_id if the same book was added via
  // a different path. Falls back to session book_id for the "start tracking" flow.
  const bookForModal = {
    t: book.title, a: book.author, pp: book.pages,
    bookId: myProgress?.cr_book_id || book.id,
    pagesRead: myProgress?.pages_read ?? 0,
  };

  const sortedProgress = [...(progress || [])].sort((a, b) => {
    if (a.is_reading && !b.is_reading) return -1;
    if (!a.is_reading && b.is_reading) return 1;
    return (b.pages_read || 0) - (a.pages_read || 0);
  });

  async function handleProgressSave(pagesRead) {
    await updateReadingProgress(bookForModal, pagesRead);
    setShowProgressModal(false);
    await loadDetail();
  }

  async function handleStartReading() {
    await startReading(bookForModal);
    await loadDetail();
  }

  async function handleEditSave({ bookId, adminNotes, startsAt, endsAt }) {
    const { error } = await supabase
      .from('book_club_sessions')
      .update({ book_id: bookId, admin_notes: adminNotes, starts_at: startsAt, ends_at: endsAt })
      .eq('id', sessionId);
    if (error) {
      console.error('Session update failed', error);
      showToast(t('sessions.saveChangesError'), true);
      return;
    }
    setShowEditModal(false);
    showToast(t('sessions.saveChangesToast'));
    await loadDetail();
  }

  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase.from('book_club_sessions').delete().eq('id', sessionId);
    setDeleting(false);
    if (error) {
      console.error('Session delete failed', error);
      showToast(t('sessions.deleteError'), true);
      return;
    }
    go('book-club-detail', { clubId });
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>Book Clubs</a>
        {club && <> · <a onClick={() => go('book-club-detail', { clubId })}>{club.name}</a></>}
        {' · '}{t('sessions.detailBreadcrumb')}
      </div>

      {/* Book header */}
      <div className="session-hero">
        <div className="session-hero__cover" onClick={() => openBookTab(bookForModal, 'session')}>
          <BookCover title={book.title} author={book.author} coverUrl={book.cover_url} />
        </div>
        <div>
          <div className={`session-hero__status${isActive ? ' session-hero__status--active' : isPast ? ' session-hero__status--past' : ' session-hero__status--upcoming'}`}>
            {isActive ? t('sessions.statusActive') : isPast ? t('sessions.statusPast') : t('sessions.statusUpcoming')}
          </div>
          <h1 className="session-hero__title">
            {session.title}
          </h1>
          {book.author && (
            <div className="session-hero__book">
              {book.author}
            </div>
          )}
          <div className="session-hero__meta">
            {fmtDate(session.starts_at)} — {fmtDate(session.ends_at)}
            {book.pages ? ` · ${book.pages} pages` : ''}
          </div>
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="session-hero__actions">
          <button className="li-action" onClick={() => setShowEditModal(true)}>
            {t('sessions.editSession')}
          </button>
          {!confirmDelete ? (
            <button className="li-action danger" onClick={() => setConfirmDelete(true)}>
              {t('sessions.deleteSession')}
            </button>
          ) : (
            <>
              <span className="session-hero__action-note">
                {t('sessions.deleteConfirm')}
              </span>
              <button className="li-action danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? t('sessions.deleting') : t('sessions.deleteYes')}
              </button>
              <button className="li-action" onClick={() => setConfirmDelete(false)}>{t('sessions.cancel')}</button>
            </>
          )}
        </div>
      )}

      {/* Admin notes */}
      {session.admin_notes && (
        <div className="session-prompt">
          <div className="session-prompt__label">
            {t('sessions.adminLabel')}
          </div>
          <p className="session-prompt__text">
            {session.admin_notes}
          </p>
        </div>
      )}

      {/* Book description */}
      {book.description && (
        <div className="db-section">
          <div className="session-section-label">
            {t('sessions.aboutBook')}
          </div>
          <p className="session-prompt__text">
            {book.description}
          </p>
        </div>
      )}

      {/* My progress CTA */}
      {user && isActive && (
        <div className="session-member-list">
          {iAmReading ? (
            <button className="btn" onClick={() => setShowProgressModal(true)}>
              {t('sessions.updateProgress')}
            </button>
          ) : (
            <>
              <button className="btn" onClick={handleStartReading}>
                {t('sessions.startTracking')}
              </button>
              <span className="session-section-note">
                {t('sessions.startTrackingNote')}
              </span>
            </>
          )}
        </div>
      )}

      {/* Progress grid */}
      <section>
        <div className="session-section-label">
          {t('sessions.memberProgress', { count: (progress || []).length })}
        </div>
        {sortedProgress.length === 0 ? (
          <div className="session-no-comments">
            {t('sessions.noMembers')}
          </div>
        ) : (
          <div>
            {sortedProgress.map((m) => (
              <MemberProgressRow key={m.user_id} member={m} totalPages={book.pages} />
            ))}
          </div>
        )}
      </section>

      {showProgressModal && (
        <ProgressUpdateModal
          book={bookForModal}
          onSave={handleProgressSave}
          onClose={() => setShowProgressModal(false)}
        />
      )}

      {showEditModal && (
        <EditSessionModal
          session={session}
          book={book}
          onSave={handleEditSave}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Discussion — questions + free comments */}
      <hr className="session-divider" />
      <SessionDiscussion
        sessionId={sessionId}
        clubId={session.club_id}
        isAdmin={isAdmin}
        book={{ title: book.title, author: book.author, description: book.description }}
      />
    </>
  );
}
