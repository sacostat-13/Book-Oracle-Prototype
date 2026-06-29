// src/views/SessionCreate.jsx — v0.31

import { useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { useT, useTNode } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';
import { lookupByTitle } from '../lib/bookLookup';
import BookCover from '../components/BookCover';

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(176, 140, 63, 0.04)', border: '1px solid rgba(176, 140, 63, 0.25)',
  borderRadius: 'var(--ro-radius-sm)', padding: '0.6rem 0.85rem', color: 'var(--paper)',
  fontFamily: 'var(--ro-font-display)', fontSize: '1.05rem',
};
const labelStyle = {
  display: 'block', fontFamily: 'var(--ro-font-mono)', fontSize: '0.72rem',
  letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--gilt)', marginBottom: '0.4rem',
};

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
  const t = useT();
  const tNode = useTNode();

  const clubId = route.params?.clubId;
  const club = (state.clubs || []).find((c) => c.id === clubId);
  const today = new Date().toISOString().slice(0, 10);
  const fourWeeks = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const prefillTitle = route.params?.prefillTitle || '';
  const prefillAuthor = route.params?.prefillAuthor || '';

  const [bookQuery, setBookQuery] = useState(prefillTitle);
  const [bookResults, setBookResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedBook, setSelectedBook] = useState(prefillTitle ? { t: prefillTitle, a: prefillAuthor, coverUrl: null, bookId: null } : null);
  const [adminNotes, setAdminNotes] = useState('');
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(fourWeeks);
  const [saving, setSaving] = useState(false);

  async function searchBooks(q) {
    if (!q.trim()) { setBookResults([]); return; }
    setSearching(true);
    const vaultHits = (state.vault || []).filter((b) => b.t.toLowerCase().includes(q.toLowerCase()) || b.a?.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
    if (vaultHits.length >= 3) { setBookResults(vaultHits); setSearching(false); return; }
    try {
      const remote = await lookupByTitle(q);
      const combined = [...vaultHits];
      if (remote && !vaultHits.find((b) => b.t.toLowerCase() === remote.t.toLowerCase())) combined.push(remote);
      setBookResults(combined.slice(0, 6));
    } catch { setBookResults(vaultHits); }
    setSearching(false);
  }

  async function handleSubmit() {
    if (!selectedBook || !startsAt || !endsAt || !clubId) return;
    if (endsAt < startsAt) { showToast(t('sessions.endDateError'), true); return; }
    setSaving(true);
    let bookId = selectedBook.bookId;
    if (!bookId) bookId = await upsertBookOnServer(selectedBook, 'discovered');
    if (!bookId) { showToast(t('sessions.saveBookError'), true); setSaving(false); return; }
    const { data, error } = await supabase.from('book_club_sessions').insert({
      club_id: clubId, book_id: bookId, admin_notes: adminNotes.trim() || null, starts_at: startsAt, ends_at: endsAt,
    }).select().single();
    setSaving(false);
    if (error) { console.error('SessionCreate failed', error); showToast(t('sessions.saveError'), true); return; }
    go('session-detail', { sessionId: data.id });
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('book-clubs')}>{t('clubs.createBreadcrumb')}</a>
        {club && <> · <a onClick={() => go('book-club-detail', { clubId })}>{club.name}</a></>}
        {' · '}{t('sessions.breadcrumbNew')}
      </div>
      <div className="page-header">
        <div className="page-eyebrow">{club?.name || t('clubs.titleAccent')}</div>
        <h1 className="page-title">{tNode('sessions.createPageTitle')}</h1>
      </div>

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <label style={labelStyle}>{t('sessions.fieldBook')}</label>
          {selectedBook ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', border: '1px solid rgba(176,140,63,0.35)', borderRadius: 2, background: 'rgba(176,140,63,0.04)' }}>
              <BookThumb book={selectedBook} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', color: 'var(--paper)', fontSize: '1rem' }}>{selectedBook.t}</div>
                {selectedBook.a && <div style={{ fontSize: '0.8rem', color: 'var(--paper-aged)', opacity: 0.65 }}>{selectedBook.a}</div>}
              </div>
              <button className="li-action" onClick={() => { setSelectedBook(null); setBookQuery(''); setBookResults([]); }}>{t('sessions.changeBook')}</button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input style={inputStyle} placeholder={t('sessions.fieldBookPlaceholder')} value={bookQuery} onChange={(e) => { setBookQuery(e.target.value); searchBooks(e.target.value); }} autoFocus />
              {(bookResults.length > 0 || searching) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--ink, #1a1410)', border: '1px solid rgba(176,140,63,0.25)', borderTop: 'none', borderRadius: '0 0 2px 2px', maxHeight: 280, overflowY: 'auto' }}>
                  {searching && <div style={{ padding: '0.75rem 1rem', color: 'var(--paper-aged)', fontSize: '0.85rem', opacity: 0.6 }}>{t('sessions.searching')}</div>}
                  {bookResults.map((b, i) => (
                    <div key={b.bookId || i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(176,140,63,0.1)', transition: 'background 0.12s' }}
                      onClick={() => { setSelectedBook(b); setBookResults([]); setBookQuery(''); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(176,140,63,0.06)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <BookThumb book={b} size={28} />
                      <div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--paper)', fontFamily: 'var(--ro-font-display)', fontStyle: 'italic' }}>{b.t}</div>
                        {b.a && <div style={{ fontSize: '0.75rem', color: 'var(--paper-aged)', opacity: 0.6 }}>{b.a}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>{t('sessions.fieldStarts')}</label>
            <input type="date" style={inputStyle} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>{t('sessions.fieldEnds')}</label>
            <input type="date" style={inputStyle} value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>
            {t('sessions.fieldNotes')}{' '}
            <span style={{ opacity: 0.45, textTransform: 'none', letterSpacing: 0 }}>{t('sessions.fieldNotesOptional')}</span>
          </label>
          <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} placeholder={t('sessions.fieldNotesPlaceholder')} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={4} />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => go('book-club-detail', { clubId })}>{t('sessions.cancel')}</button>
          <button className="btn" onClick={handleSubmit} disabled={!selectedBook || !startsAt || !endsAt || saving}>
            {saving ? t('sessions.creating') : t('sessions.createButton')}
          </button>
        </div>
      </div>
    </>
  );
}
