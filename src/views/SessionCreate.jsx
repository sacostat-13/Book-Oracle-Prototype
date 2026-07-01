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
    <div className="session-form__cover" style={{ '--sc-w': `${size}px`, '--sc-h': `${size * 1.5}px` }}>
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

      <div className="session-form">
        <div>
          <label style={labelStyle}>{t('sessions.fieldBook')}</label>
          {selectedBook ? (
            <div className="session-form__book-row">
              <BookThumb book={selectedBook} size={32} />
              <div className="session-form__book-wrap">
                <div className="session-form__book-title">{selectedBook.t}</div>
                {selectedBook.a && <div className="session-form__book-author">{selectedBook.a}</div>}
              </div>
              <button className="li-action" onClick={() => { setSelectedBook(null); setBookQuery(''); setBookResults([]); }}>{t('sessions.changeBook')}</button>
            </div>
          ) : (
            <div className="session-form__dropdown">
              <input style={inputStyle} placeholder={t('sessions.fieldBookPlaceholder')} value={bookQuery} onChange={(e) => { setBookQuery(e.target.value); searchBooks(e.target.value); }} autoFocus />
              {(bookResults.length > 0 || searching) && (
                <div className="session-form__search-results">
                  {searching && <div className="ldetail-empty">{t('sessions.searching')}</div>}
                  {bookResults.map((b, i) => (
                    <div key={b.bookId || i} className="ldetail-pick-row"
                      onClick={() => { setSelectedBook(b); setBookResults([]); setBookQuery(''); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(176,140,63,0.06)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <BookThumb book={b} size={28} />
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

        <div className="db-stats-grid">
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
            <span className="club-form__optional">{t('sessions.fieldNotesOptional')}</span>
          </label>
          <textarea className="textarea" placeholder={t('sessions.fieldNotesPlaceholder')} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={4} />
        </div>

        <div className="club-form__actions">
          <button className="btn btn-secondary" onClick={() => go('book-club-detail', { clubId })}>{t('sessions.cancel')}</button>
          <button className="btn" onClick={handleSubmit} disabled={!selectedBook || !startsAt || !endsAt || saving}>
            {saving ? t('sessions.creating') : t('sessions.createButton')}
          </button>
        </div>
      </div>
    </>
  );
}
