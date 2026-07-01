import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey, findBookByTitle } from '../lib/bookHelpers';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';

export default function PlanView() {
  const { state, addToReadNext, markAsRead, deletePlan, setCurrentPlan, showToast } = useData();
  const { go, route } = useRouter();
  const t = useT();

  const planId = route.params?.planId;

  // Try local state first. Also accept the plan object passed directly via
  // route params — this covers the case where we've just created a plan and
  // React hasn't flushed the setState from setCurrentPlan yet.
  const localPlan = (planId
    ? (state.plans || []).find((p) => p._id === planId) || state.currentPlan
    : state.currentPlan) || route.params?.plan || null;

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
    <div className="loading">
      <div className="loading-spinner" />
      <div className="loading-text">{t('plans.loadingPlan')}</div>
    </div>
  );

  if (!plan) {
    return (
      <>
        <div className="breadcrumb">
          <a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a> · {t('plans.readingPlanBreadcrumb')}
        </div>
        <div className="empty-state">
          <div className="ornament">❦</div>
          <div className="empty-state-title">{t('plans.noActivePlan')}</div>
          <div className="empty-state-text">{t('plans.noActivePlanText')}</div>
          <div >
            <button className="btn" onClick={() => go('plan-create')}>{t('plans.createOwnPlan')}</button>
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
    showToast(t('plans.planCopied'));
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
            <>Reading plan by <strong className="lv-curator-name">{remoteOwner.display_name}</strong></>
          ) : (
            t('plans.yourPlan')
          )}
        </div>
        <h1 className="page-title">{plan.title}</h1>
        <p className="page-subtitle">{plan.intro || ''}</p>
      </div>

      <div className="plan-actions">
        {plan.type === 'series' && plan.seriesName && (
          <button
            className="btn"
            onClick={() => go('series-page', { seriesName: plan.seriesName, from: 'plan-view', fromLabel: t('plans.readingPlanBreadcrumb') })}
          >
            {t('plans.openSeries')}
          </button>
        )}
        <button className="btn btn-gilt" onClick={addAllToQueue}>
          {t('plans.addAllToQueue')}
        </button>
        {!isSharedView && (
          <>
            <button className="btn btn-secondary" onClick={() => go('plan-create')}>
              {t('plans.createAnother')}
            </button>
            <button className="btn btn-secondary" onClick={handleDeletePlan}>
              Delete this plan
            </button>
          </>
        )}
        {isSharedView && (
          <>
            <button className="btn btn-gilt" onClick={handleCopyPlan}>
              {t('plans.copyPlan')}
            </button>
            <button className="btn btn-secondary" onClick={() => go('plan-create')}>
              {t('plans.createOwnPlan')}
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
                    <> · <span className="plan-book-author">
                      ~{pages} pages
                    </span></>
                  )}
                </div>
                <div className="plan-reason">{b.reason || found.d || ''}</div>
                {(() => {
                  const genres = genresByBookId[found.bookId];
                  return genres && genres.length > 0 ? (
                    <div className="li-genres cr-genres">
                      {genres.map((g) => (
                        <span key={g.genreId} className="li-genre-pill" title={g.description || undefined}>
                          {g.name}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div className="bp-actions">
                  {isRead ? (
                    <span className="level-pill bp-pill--moss">
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
