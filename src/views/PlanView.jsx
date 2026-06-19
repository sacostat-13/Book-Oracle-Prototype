import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey, findBookByTitle } from '../lib/bookHelpers';
import { useI18n } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

export default function PlanView() {
  const { state, addToReadNext, markAsRead, deletePlan, setCurrentPlan, showToast } = useData();
  const { go, route } = useRouter();
  const { lang } = useI18n();
  const isSpanish = lang === 'es';

  const planId = route.params?.planId;

  // Try local state first; if not found, fetch publicly via RPC (shared plan URL)
  const localPlan = planId
    ? (state.plans || []).find((p) => p._id === planId) || state.currentPlan
    : state.currentPlan;

  const [remotePlan, setRemotePlan] = useState(null);
  const [remoteOwner, setRemoteOwner] = useState(null);
  const [loadingRemote, setLoadingRemote] = useState(false);

  useEffect(() => {
    // Only fetch remotely if we have a planId and it wasn't found locally
    if (!planId || localPlan) return;
    setLoadingRemote(true);
    supabase.rpc('get_public_plan', { p_plan_id: planId })
      .then(({ data, error }) => {
        if (!error && data) {
          const content = data.plan?.content || {};
          setRemotePlan({
            ...content,
            _id: data.plan.id,
            title: data.plan.title || content.title,
            createdAt: data.plan.created_at,
          });
          setRemoteOwner(data.owner);
        }
        setLoadingRemote(false);
      });
  }, [planId, localPlan]);

  const plan = localPlan || remotePlan;
  const isSharedView = !localPlan && remotePlan;

  const { genresByBookId } = state;

  if (loadingRemote) return (
    <div className="loading" style={{ paddingTop: '6rem' }}>
      <div className="loading-spinner" />
      <div className="loading-text">{isSpanish ? 'Cargando plan…' : 'Loading plan…'}</div>
    </div>
  );

  if (!plan) {
    return (
      <>
        <div className="breadcrumb">
          <a onClick={() => go('dashboard')}>Dashboard</a> · Your Reading Plan
        </div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">No active plan</div>
          <div className="empty-state-text">Create one from the dashboard.</div>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="btn" onClick={() => go('plan-create')}>Create a plan</button>
          </div>
        </div>
      </>
    );
  }

  function addAllToQueue() {
    let added = 0;
    for (const b of plan.books) {
      const found = findBookByTitle(b.title || b.t, state.wishlist) || { t: b.title || b.t, a: b.author || b.a };
      const k = bookKey(found);
      if (
        !state.library.some((l) => bookKey(l) === k) &&
        !state.readNext.some((l) => bookKey(l) === k)
      ) {
        addToReadNext(found);
        added++;
      }
    }
    showToast(`Added ${added} books to Read Next`);
  }

  async function handleDeletePlan() {
    if (!confirm('Delete this reading plan?')) return;
    await deletePlan(plan._id);
    go('dashboard');
  }

  async function handleCopyPlan() {
    const copy = {
      ...plan,
      title: `Copy of ${plan.title || 'plan'}`,
      _id: undefined,
      createdAt: undefined,
    };
    await setCurrentPlan(copy);
    showToast(isSpanish ? 'Plan copiado a tu cuenta ✓' : 'Plan copied to your account ✓');
    go('dashboard');
  }

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · Reading Plan
      </div>
      <div className="page-header">
        <div className="page-eyebrow">
          {isSharedView && remoteOwner ? (
            <>Reading plan by <strong style={{ color: '#d8b66a' }}>{remoteOwner.display_name}</strong></>
          ) : (
            isSpanish ? 'Tu plan de lectura' : 'Your Reading Plan'
          )}
        </div>
        <h1 className="page-title">{plan.title}</h1>
        <p className="page-subtitle">{plan.intro || ''}</p>
      </div>

      <div style={{ marginBottom: '2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {plan.type === 'series' && plan.seriesName && (
          <button
            className="btn"
            onClick={() => go('series-page', { seriesName: plan.seriesName, from: 'plan-view', fromLabel: isSpanish ? 'Plan' : 'Reading Plan' })}
          >
            {isSpanish ? 'Abrir saga ↗' : 'Open Series ↗'}
          </button>
        )}
        <button className="btn btn-gilt" onClick={addAllToQueue}>
          {isSpanish ? 'Agregar todo a la cola' : 'Add all to Read Next'}
        </button>
        {!isSharedView && (
          <>
            <button className="btn btn-ghost" onClick={() => go('plan-create')}>
              {isSpanish ? 'Crear otro plan' : 'Create another plan'}
            </button>
            <button className="btn btn-ghost" onClick={handleDeletePlan}>
              Delete this plan
            </button>
          </>
        )}
        {isSharedView && (
          <>
            <button className="btn btn-gilt" onClick={handleCopyPlan}>
              {isSpanish ? '✦ Copiar este plan' : '✦ Copy this plan'}
            </button>
            <button className="btn btn-ghost" onClick={() => go('plan-create')}>
              {isSpanish ? 'Crear mi propio plan' : 'Create my own plan'}
            </button>
          </>
        )}
      </div>

      <div>
        {plan.books.map((b, i) => {
          const found = findBookByTitle(b.title || b.t, state.wishlist) ||
            { t: b.title || b.t, a: b.author || b.a, d: b.description || '' };
          const pages = b.pp || found.pp || null;
          const k = bookKey(found);
          const isRead = state.library.some((l) => bookKey(l) === k);
          const isQueued = state.readNext.some((l) => bookKey(l) === k);
          return (
            <div className="plan-step" key={i}>
              <div className="plan-month">Month {b.month || i + 1}</div>
              <div>
                <div className="plan-book">{found.t}</div>
                <div className="plan-author">
                  {found.a}
                  {pages && (
                    <> · <span style={{ color: 'var(--paper-aged)', opacity: 0.7, fontSize: '0.9rem' }}>
                      ~{pages} pages
                    </span></>
                  )}
                </div>
                <div className="plan-reason">{b.reason || found.d || ''}</div>
                {(() => {
                  const genres = genresByBookId[found.bookId];
                  return genres && genres.length > 0 ? (
                    <div className="li-genres" style={{ marginTop: '0.5rem' }}>
                      {genres.map((g) => (
                        <span key={g.genreId} className="li-genre-pill" title={g.description || undefined}>
                          {g.name}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {isRead ? (
                    <span className="level-pill" style={{ background: 'var(--moss)', color: 'var(--paper)', borderColor: 'var(--moss)' }}>
                      ✓ Read
                    </span>
                  ) : isQueued ? (
                    <span className="level-pill">✓ Queued</span>
                  ) : (
                    <>
                      <button className="li-action" onClick={() => addToReadNext(found)}>+ Add to Read Next</button>
                      <button className="li-action success" onClick={() => markAsRead(found)}>✓ Mark as Read</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
