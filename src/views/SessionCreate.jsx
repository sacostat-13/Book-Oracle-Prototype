// src/views/SessionCreate.jsx — v0.28
// Admin-only form to create a new session for a book club.

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { supabase } from '../lib/supabase';
import { lookupByTitle } from '../lib/bookLookup';
import BookCover from '../components/BookCover';

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

// Thumbnail wrapper that constrains BookCover to a fixed size
function BookThumb({ book, size = 28 }) {
  return (
    <div style={{ width: size, height: size * 1.5, flexShrink: 0, overflow: 'hidden', borderRadius: 2 }}>
      <BookCover title={book.t} author={book.a} coverUrl={book.coverUrl} />
    </div>
  );
}

export default function SessionCreate() {
  const { state, showToast, upsertBookOnServer } = useData();
  const { go, route } = useRouter();

  const clubId = route.params?.clubId;
  const club = (state.clubs || []).find((c) => c.id === clubId);

  const today = new Date().toISOString().slice(0, 10);
  const fourWeeks = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Pre-fill from poll winner if navigated from a poll result
  const prefillTitle = route.params?.prefillTitle || '';
  const prefillAuthor = route.params?.prefillAuthor || '';

  const [bookQuery, setBookQuery] = useState(prefillTitle);
  const [bookResults, setBookResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // If we have a prefill title, pre-select a stub so the user can see it immediately
  const [selectedBook, setSelectedBook] = useState(
    prefillTitle ? { t: prefillTitle, a: prefillAuthor, coverUrl: null, bookId: null } : null
  );
  const [adminNotes, setAdminNotes] = useState('');
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(fourWeeks);
  const [saving, setSaving] = useState(false);

  async function searchBooks(q) {
    if (!q.trim()) { setBookResults([]); return; }
    setSearching(true);

    const vaultHits = (state.vault || [])
      .filter((b) => b.t.toLowerCase().includes(q.toLowerCase()) || b.a?.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);

    if (vaultHits.length >= 3) {
      setBookResults(vaultHits);
      setSearching(false);
      return;
    }

    try {
      const remote = await lookupByTitle(q);
      const combined = [...vaultHits];
      if (remote && !vaultHits.find((b) => b.t.toLowerCase() === remote.t.toLowerCase())) {
        combined.push(remote);
      }
      setBookResults(combined.slice(0, 6));
    } catch {
      setBookResults(vaultHits);
    }
    setSearching(false);
  }

  async function handleSubmit() {
    if (!selectedBook || !startsAt || !endsAt || !clubId) return;
    if (endsAt < startsAt) { showToast('End date must be after start date', true); return; }

    setSaving(true);

    // Ensure book has a DB record — use the real upsertBookOnServer from DataContext
    let bookId = selectedBook.bookId;
    if (!bookId) {
      bookId = await upsertBookOnServer(selectedBook, 'discovered');
    }

    if (!bookId) {
      showToast('Could not save book — try again', true);
      setSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from('book_club_sessions')
      .insert({
        club_id: clubId,
        book_id: bookId,
        admin_notes: adminNotes.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
      })
      .select()
      .single();

    setSaving(false);

    if (error) {
      console.error('SessionCreate failed', error);
      showToast('Could not create session — try again', true);
      return;
    }

    go('session-detail', { sessionId: data.id });
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>Book Clubs</a>
        {club && <> · <a onClick={() => go('book-club-detail', { clubId })}>{club.name}</a></>}
        {' · New Session'}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{club?.name || 'Book Club'}</div>
        <h1 className="page-title">New <span className="accent">Session</span></h1>
      </div>

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Book picker */}
        <div>
          <label style={labelStyle}>Book *</label>
          {selectedBook ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', border: '1px solid rgba(176,140,63,0.35)', borderRadius: 2, background: 'rgba(176,140,63,0.04)' }}>
              <BookThumb book={selectedBook} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', color: 'var(--paper)', fontSize: '1rem' }}>{selectedBook.t}</div>
                {selectedBook.a && <div style={{ fontSize: '0.8rem', color: 'var(--paper-aged)', opacity: 0.65 }}>{selectedBook.a}</div>}
              </div>
              <button className="li-action" onClick={() => { setSelectedBook(null); setBookQuery(''); setBookResults([]); }}>Change</button>
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
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--ink, #1a1410)', border: '1px solid rgba(176,140,63,0.25)', borderTop: 'none', borderRadius: '0 0 2px 2px', maxHeight: 280, overflowY: 'auto' }}>
                  {searching && <div style={{ padding: '0.75rem 1rem', color: 'var(--paper-aged)', fontSize: '0.85rem', opacity: 0.6 }}>Searching…</div>}
                  {bookResults.map((b, i) => (
                    <div
                      key={b.bookId || i}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(176,140,63,0.1)', transition: 'background 0.12s' }}
                      onClick={() => { setSelectedBook(b); setBookResults([]); setBookQuery(''); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(176,140,63,0.06)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <BookThumb book={b} size={28} />
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Starts *</label>
            <input type="date" style={inputStyle} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Ends *</label>
            <input type="date" style={inputStyle} value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        {/* Admin notes */}
        <div>
          <label style={labelStyle}>
            Notes for members{' '}
            <span style={{ opacity: 0.45, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </label>
          <textarea
            style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
            placeholder="What should members know? Discussion questions, reading goals, pace suggestions…"
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            rows={4}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => go('book-club-detail', { clubId })}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={handleSubmit}
            disabled={!selectedBook || !startsAt || !endsAt || saving}
          >
            {saving ? 'Creating…' : 'Create session ❦'}
          </button>
        </div>
      </div>
    </>
  );
}
