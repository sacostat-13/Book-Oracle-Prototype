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

// ── Shared sub-components ─────────────────────────────────────────────────────

function Avatar({ displayName, avatarUrl, size = 28 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = (displayName || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (avatarUrl && !imgFailed) {
    return <img src={avatarUrl} alt={displayName} onError={() => setImgFailed(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(176,140,63,0.15)', border: '1px solid rgba(176,140,63,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Special Elite', monospace", fontSize: size * 0.35, color: 'var(--gilt)', flexShrink: 0 }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0', borderBottom: '1px solid rgba(176,140,63,0.07)' }}>
      <Avatar displayName={member.display_name} avatarUrl={member.avatar_url} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.3rem' }}>
          <span style={{ fontSize: '0.88rem', color: 'var(--paper)' }}>
            {member.display_name || 'Anonymous reader'}
          </span>
          {member.role === 'admin' && (
            <span style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.58rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.8 }}>admin</span>
          )}
        </div>
        {member.is_reading ? (
          totalPages ? (
            <div>
              <div style={{ height: '3px', background: 'rgba(176,140,63,0.12)', borderRadius: 2, overflow: 'hidden', marginBottom: '0.25rem' }}>
                <div style={{ height: '100%', width: `${pct ?? 0}%`, background: finished ? 'var(--gilt-bright, #e8c560)' : 'var(--gilt, #b08c3f)', borderRadius: 2, transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.68rem', letterSpacing: '0.04em', color: 'var(--paper-aged)', opacity: 0.55 }}>
                {member.pages_read > 0
                  ? `${member.pages_read} / ${totalPages} pages${pct !== null ? ` · ${pct}%` : ''}${finished ? ' · ✓ Finished' : ''}`
                  : `0 / ${totalPages} pages — not started`}
              </div>
            </div>
          ) : (
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.68rem', letterSpacing: '0.04em', color: 'var(--paper-aged)', opacity: 0.55 }}>
              {member.pages_read > 0 ? `${member.pages_read} pages read` : 'Reading — no page count yet'}
            </div>
          )
        ) : (
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.68rem', letterSpacing: '0.04em', color: 'var(--paper-aged)', opacity: 0.35 }}>
            Not tracking progress
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
  borderRadius: '2px',
  padding: '0.6rem 0.85rem',
  color: 'var(--paper)',
  fontFamily: "'Cormorant Garamond', serif",
  fontSize: '1.05rem',
};

const labelStyle = {
  display: 'block',
  fontFamily: "'Special Elite', monospace",
  fontSize: '0.72rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'var(--gilt)',
  marginBottom: '0.4rem',
};

function BookThumb({ book, size = 28 }) {
  return (
    <div style={{ width: size, height: size * 1.5, flexShrink: 0, overflow: 'hidden', borderRadius: 2 }}>
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,0.78)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: 'var(--ink, #1a1410)', border: '1px solid rgba(176,140,63,0.35)', borderRadius: '4px', maxWidth: '520px', width: '100%', padding: '2rem 2.2rem', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.75rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.5rem' }}>
          Admin
        </div>
        <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.6rem', color: 'var(--paper)', margin: '0 0 1.5rem' }}>
          Edit session
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Book picker */}
          <div>
            <label style={labelStyle}>Book</label>
            {selectedBook ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', border: '1px solid rgba(176,140,63,0.35)', borderRadius: 2, background: 'rgba(176,140,63,0.04)' }}>
                <BookThumb book={selectedBook} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', color: 'var(--paper)', fontSize: '0.95rem' }}>{selectedBook.t || selectedBook.title}</div>
                  {(selectedBook.a || selectedBook.author) && <div style={{ fontSize: '0.78rem', color: 'var(--paper-aged)', opacity: 0.65 }}>{selectedBook.a || selectedBook.author}</div>}
                </div>
                <button className="li-action" onClick={() => { setSelectedBook(null); setBookResults([]); }}>Change</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  style={inputStyle}
                  placeholder="Search by title or author…"
                  value={bookQuery}
                  onChange={(e) => { setBookQuery(e.target.value); searchBooks(e.target.value); }}
                  autoFocus
                />
                {(bookResults.length > 0 || searching) && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--ink, #1a1410)', border: '1px solid rgba(176,140,63,0.25)', borderTop: 'none', borderRadius: '0 0 2px 2px', maxHeight: 240, overflowY: 'auto' }}>
                    {searching && <div style={{ padding: '0.6rem 0.85rem', color: 'var(--paper-aged)', fontSize: '0.85rem', opacity: 0.6 }}>Searching…</div>}
                    {bookResults.map((b, i) => (
                      <div
                        key={b.bookId || i}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(176,140,63,0.1)' }}
                        onClick={() => { setSelectedBook(b); setBookResults([]); setBookQuery(''); }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(176,140,63,0.06)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <BookThumb book={b} size={24} />
                        <div>
                          <div style={{ fontSize: '0.9rem', color: 'var(--paper)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>{b.t}</div>
                          {b.a && <div style={{ fontSize: '0.75rem', color: 'var(--paper-aged)', opacity: 0.6 }}>{b.a}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
              <span style={{ opacity: 0.45, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
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
              {saving ? 'Saving…' : 'Save changes ❦'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function SessionDetail() {
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
        <div className="loading-text">Loading session…</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <>
        <div className="breadcrumb"><a onClick={() => go('book-clubs')}>Book Clubs</a></div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">Session not found</div>
          <div className="empty-state-text">This session may have been removed, or you are not a member of the club.</div>
          <button className="btn btn-ghost" style={{ marginTop: '1.5rem' }} onClick={() => go('book-clubs')}>Back to clubs</button>
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
      showToast('Could not save changes — try again', true);
      return;
    }
    setShowEditModal(false);
    showToast('Session updated');
    await loadDetail();
  }

  async function handleDelete() {
    setDeleting(true);
    const { error } = await supabase.from('book_club_sessions').delete().eq('id', sessionId);
    setDeleting(false);
    if (error) {
      console.error('Session delete failed', error);
      showToast('Could not delete session — try again', true);
      return;
    }
    go('book-club-detail', { clubId });
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>Book Clubs</a>
        {club && <> · <a onClick={() => go('book-club-detail', { clubId })}>{club.name}</a></>}
        {' · Session'}
      </div>

      {/* Book header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.5rem', marginBottom: '2rem', alignItems: 'start' }}>
        <div style={{ width: 90, cursor: 'pointer' }} onClick={() => openBookTab(bookForModal, 'session')}>
          <BookCover title={book.title} author={book.author} coverUrl={book.cover_url} />
        </div>
        <div>
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: isActive ? 'var(--gilt)' : isPast ? 'rgba(233,223,202,0.3)' : 'var(--paper-aged)', marginBottom: '0.4rem' }}>
            {isActive ? '✦ Active session' : isPast ? 'Past session' : 'Upcoming'}
          </div>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '1.7rem', color: 'var(--paper)', margin: 0, lineHeight: 1.15, marginBottom: '0.25rem' }}>
            {session.title}
          </h1>
          {book.author && (
            <div style={{ fontSize: '0.9rem', color: 'var(--paper-aged)', opacity: 0.65, marginBottom: '0.5rem' }}>
              {book.author}
            </div>
          )}
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.72rem', letterSpacing: '0.06em', color: 'var(--paper-aged)', opacity: 0.5 }}>
            {fmtDate(session.starts_at)} — {fmtDate(session.ends_at)}
            {book.pages ? ` · ${book.pages} pages` : ''}
          </div>
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <button className="li-action" onClick={() => setShowEditModal(true)}>
            ✎ Edit session
          </button>
          {!confirmDelete ? (
            <button className="li-action danger" onClick={() => setConfirmDelete(true)}>
              Delete session
            </button>
          ) : (
            <>
              <span style={{ fontSize: '0.82rem', color: 'var(--paper-aged)', opacity: 0.7, alignSelf: 'center' }}>
                Delete this session?
              </span>
              <button className="li-action danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button className="li-action" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          )}
        </div>
      )}

      {/* Admin notes */}
      {session.admin_notes && (
        <div style={{ borderLeft: '2px solid rgba(176,140,63,0.35)', paddingLeft: '1rem', marginBottom: '2rem' }}>
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.7, marginBottom: '0.4rem' }}>
            From the admin
          </div>
          <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1.05rem', color: 'var(--paper-aged)', lineHeight: 1.65, margin: 0 }}>
            {session.admin_notes}
          </p>
        </div>
      )}

      {/* Book description */}
      {book.description && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', opacity: 0.7, marginBottom: '0.5rem' }}>
            About the book
          </div>
          <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1.05rem', color: 'var(--paper-aged)', lineHeight: 1.65, margin: 0 }}>
            {book.description}
          </p>
        </div>
      )}

      {/* My progress CTA */}
      {user && isActive && (
        <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {iAmReading ? (
            <button className="btn" onClick={() => setShowProgressModal(true)}>
              ↑ Update my progress
            </button>
          ) : (
            <>
              <button className="btn" onClick={handleStartReading}>
                Start tracking this book
              </button>
              <span style={{ fontSize: '0.8rem', color: 'var(--paper-aged)', opacity: 0.5, alignSelf: 'center' }}>
                Adds it to your Currently Reading
              </span>
            </>
          )}
        </div>
      )}

      {/* Progress grid */}
      <section>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.75rem' }}>
          Member progress · {(progress || []).length}
        </div>
        {sortedProgress.length === 0 ? (
          <div style={{ color: 'rgba(233,223,202,0.3)', fontStyle: 'italic', fontSize: '0.9rem' }}>
            No members yet.
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
      <hr style={{ border: 'none', borderTop: '1px solid rgba(176,140,63,0.1)', margin: '2.5rem 0' }} />
      <SessionDiscussion
        sessionId={sessionId}
        clubId={session.club_id}
        isAdmin={isAdmin}
      />
    </>
  );
}
