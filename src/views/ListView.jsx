// src/views/ListView.jsx — v0.27
// Public read-only view for shared lists and plans.
// Rendered when a non-user (or any user) opens a share URL.
// Route: #list-view/{listId} or #plan-view-public/{planId}

import { useState, useEffect } from 'react';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useData } from '../lib/DataContext';
import { supabase } from '../lib/supabase';

function CoverImg({ book, size = 60 }) {
  const s = { width: size, height: Math.round(size * 1.5), objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.5)' };
  if (book.cover_url || book.coverUrl)
    return <img src={book.cover_url || book.coverUrl} alt={book.title || book.t} style={s} />;
  return (
    <div style={{ ...s, background: 'linear-gradient(155deg,#3a2a1c,#1a100a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 9, color: 'rgba(233,217,182,.5)', textAlign: 'center', padding: 4 }}>
        {(book.title || book.t || '').slice(0, 14)}
      </span>
    </div>
  );
}

export default function ListView() {
  const { route, go } = useRouter();
  const { user }      = useAuth();
  const { state }     = useData();
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const listId = route.params?.listId;
  const planId = route.params?.planId;
  const mode   = listId ? 'list' : 'plan';

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      try {
        if (mode === 'list') {
          const { data: d, error: e } = await supabase.rpc('get_public_list', { p_list_id: listId });
          if (e || !d) throw new Error('List not found or not public');
          setData(d);
        } else {
          const { data: d, error: e } = await supabase.rpc('get_public_plan', { p_plan_id: planId });
          if (e || !d) throw new Error('Plan not found');
          setData(d);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (listId || planId) load();
  }, [listId, planId]);

  if (loading) return (
    <div className="loading" style={{ paddingTop: '6rem' }}>
      <div className="loading-spinner" />
      <div className="loading-text">Loading…</div>
    </div>
  );

  if (error || !data) return (
    <div className="empty-state">
      <div className="ornament">❦</div>
      <div className="empty-state-title">{error || 'Not found'}</div>
      <div className="empty-state-text">This list may be private or no longer exist.</div>
      {user && <button className="btn" style={{ marginTop: '1.5rem' }} onClick={() => go('dashboard')}>Go to dashboard</button>}
    </div>
  );

  // ── List view ────────────────────────────────────────────────────────────────
  if (mode === 'list') {
    const { list, owner, books } = data;
    return (
      <>
        <div className="page-header">
          <div className="page-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Curated by</span>
            <strong style={{ color: '#d8b66a' }}>{owner.display_name}</strong>
          </div>
          <h1 className="page-title">{list.title}</h1>
          {list.description && (
            <p style={{ color: 'rgba(233,223,202,.5)', marginTop: '0.5rem' }}>{list.description}</p>
          )}
          <div style={{ marginTop: '0.75rem' }}>
            <span className="level-pill">▤ {books.length} books</span>
          </div>
        </div>

        {user && (
          <div style={{ marginBottom: '1.5rem' }}>
            <button className="btn btn-ghost" onClick={() => go('lists')}>
              ↗ Save to my lists
            </button>
          </div>
        )}

        <div>
          {books.map((entry, i) => (
            <div key={i} className="list-item" style={{ borderLeftColor: 'rgba(201,162,75,.18)' }}>
              <div className="li-num" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '0.7rem', color: 'rgba(233,223,202,.25)' }}>
                {i + 1}
              </div>
              <CoverImg book={entry.book} size={52} />
              <div className="li-content">
                <div className="li-title">{entry.book.title || entry.book.t}</div>
                <div className="li-author">{entry.book.author || entry.book.a}</div>
                {entry.note && <div style={{ fontSize: '0.82rem', color: 'rgba(233,223,202,.4)', fontStyle: 'italic', marginTop: '0.2rem' }}>{entry.note}</div>}
              </div>
              {user && (
                <div className="li-actions">
                  <button className="li-action" onClick={() => {
                    // Open book modal if it's in the user's collection
                    go('book-page', { bookKey: `${(entry.book.title||'').toLowerCase().replace(/[^a-z0-9]/g,'')}|${(entry.book.author||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,10)}` });
                  }}>
                    View →
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── Plan view ────────────────────────────────────────────────────────────────
  const { plan, owner } = data;
  const content = plan.content || {};
  const books   = content.books || [];

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Reading plan by</span>
          <strong style={{ color: '#d8b66a' }}>{owner.display_name}</strong>
        </div>
        <h1 className="page-title">{plan.title || content.title}</h1>
        {content.intro && (
          <p style={{ color: 'rgba(233,223,202,.5)', marginTop: '0.5rem' }}>{content.intro}</p>
        )}
        <div style={{ marginTop: '0.75rem' }}>
          <span className="level-pill">▤ {books.length} books</span>
          {content.timeline && <span className="level-pill" style={{ marginLeft: '0.5rem' }}>◷ {content.timeline} months</span>}
        </div>
      </div>

      {user && (
        <div style={{ marginBottom: '1.5rem' }}>
          <button className="btn btn-gilt" onClick={() => go('plan-view', { planId: plan.id })}>
            Save this plan →
          </button>
        </div>
      )}

      <div>
        {books.map((b, i) => (
          <div key={i} className="plan-step">
            <div className="plan-month">Month {b.month || i + 1}</div>
            <div>
              <div className="plan-book">{b.title || b.t}</div>
              <div className="plan-author">{b.author || b.a}</div>
              {b.reason && <div className="plan-reason">{b.reason}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
