// src/views/ListView.jsx — v0.31

import { useState, useEffect } from 'react';
import { useRouter } from '../lib/RouterContext';
import { useAuth } from '../lib/AuthContext';
import { useData } from '../lib/DataContext';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

function CoverImg({ book, size = 60 }) {
  const s = { width: size, height: Math.round(size * 1.5), objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.5)' };
  if (book.cover_url || book.coverUrl)
    return <img src={book.cover_url || book.coverUrl} alt={book.title || book.t} style={s} />;
  return (
    <div style={{ ...s, background: 'linear-gradient(155deg,#3a2a1c,#1a100a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: 'var(--ro-font-display)', fontStyle: 'italic', fontSize: 9, color: 'rgba(233,217,182,.5)', textAlign: 'center', padding: 4 }}>
        {(book.title || book.t || '').slice(0, 14)}
      </span>
    </div>
  );
}

export default function ListView() {
  const { route, go } = useRouter();
  const { user } = useAuth();
  const { state } = useData();
  const t = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const listId = route.params?.listId;
  const planId = route.params?.planId;
  const mode = listId ? 'list' : 'plan';

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      try {
        if (mode === 'list') {
          const { data: d, error: e } = await supabase.rpc('get_public_list', { p_list_id: listId });
          if (e || !d) throw new Error(t('lists.notFound'));
          setData(d);
        } else {
          const { data: d, error: e } = await supabase.rpc('get_public_plan', { p_plan_id: planId });
          if (e || !d) throw new Error(t('lists.notFound'));
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
    <div className="loading">
      <div className="loading-spinner" />
      <div className="loading-text">{t('lists.loading')}</div>
    </div>
  );

  if (error || !data) return (
    <div className="empty-state">
      <div className="ornament">❦</div>
      <div className="empty-state-title">{error || t('lists.notFound')}</div>
      <div className="empty-state-text">{t('lists.notFoundText')}</div>
      {user && <button className="btn-primary" onClick={() => go('dashboard')}>{t('lists.toDashboard')}</button>}
    </div>
  );

  // ── List view ────────────────────────────────────────────────────────────────
  if (mode === 'list') {
    const { list, owner, books } = data;
    return (
      <>
        <div className="page-header">
          <div className="page-eyebrow lv-curated-by">
            {t('lists.curatedBy', { name: <strong className="lv-curator-name">{owner.display_name}</strong> })}
          </div>
          <h1 className="page-title">{list.title}</h1>
          {list.description && (
            <p className="lv-description">{list.description}</p>
          )}
          <div className="lv-action-row">
            <span className="level-pill">▤ {t('lists.bookCount', { count: books.length })}</span>
          </div>
        </div>

        {user && (
          <div className="lv-list-entries">
            <button className="btn-secondary" onClick={() => go('lists')}>{t('lists.saveToMyLists')}</button>
          </div>
        )}

        <div>
          {books.map((entry, i) => (
            <div key={i} className="list-item lv-list-item">
              <div className="li-num lv-item-num">
                {i + 1}
              </div>
              <CoverImg book={entry.book} size={52} />
              <div className="li-content">
                <div className="li-title">{entry.book.title || entry.book.t}</div>
                <div className="li-author">{entry.book.author || entry.book.a}</div>
                {entry.note && <div className="lv-item-note">{entry.note}</div>}
              </div>
              {user && (
                <div className="li-actions">
                  <button className="li-action" onClick={() => {
                    go('book-page', { bookKey: `${(entry.book.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(entry.book.author || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}` });
                  }}>
                    {t('lists.viewBook')}
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
  const books = content.books || [];

  return (
    <>
      <div className="page-header">
        <div className="page-eyebrow lv-curated-by">
          {t('plans.planBy', { name: <strong className="lv-curator-name">{owner.display_name}</strong> })}
        </div>
        <h1 className="page-title">{plan.title || content.title}</h1>
        {content.intro && (
          <p className="lv-description">{content.intro}</p>
        )}
        <div className="lv-action-row">
          <span className="level-pill">▤ {t('plans.viewBooks', { count: books.length })}</span>
          {content.timeline && <span className="level-pill">◷ {t('plans.timeline', { count: content.timeline })}</span>}
        </div>
      </div>

      {user && (
        <div className="lv-list-entries">
          <button className="btn-primary" onClick={() => go('plan-view', { planId: plan.id })}>
            {t('plans.savePlan')}
          </button>
        </div>
      )}

      <div>
        {books.map((b, i) => (
          <div key={i} className="plan-step">
            <div className="plan-month">{t('plans.month', { n: b.month || i + 1 })}</div>
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
