import { useEffect, useState } from 'react';
import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey, findBookByTitle } from '../lib/bookHelpers';
import { useT } from '../lib/I18nContext';
import { supabase } from '../lib/supabase';
import ShareModal from '../components/ShareModal';
import { planShareUrl } from '../lib/shareService';

export default function PlanView() {
  const { state, addToReadNext, markAsRead, deletePlan, setCurrentPlan, showToast } = useData();
  const { go, route } = useRouter();
  const t = useT();
  const [shareOpen, setShareOpen] = useState(false); // v0.43

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
  const cameFromList = route.params?.from === 'plan-list';
  // On a shared plan link, a logged-out visitor has no library/queue to act
  // on. Only offer per-book actions when we have a signed-in user's data.
  const canAct = !isSharedView;

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
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">{t('plans.noActivePlan')}</div>
          <div className="lv-empty-text">{t('plans.noActivePlanText')}</div>
          <button className="btn-primary" onClick={() => go('plan-create')}>{t('plans.createOwnPlan')}</button>
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
        {cameFromList ? (
          <><a onClick={() => go('plan-list')}>{t('plans.listEyebrow')}</a> · {t('plans.readingPlanBreadcrumb')}</>
        ) : (
          <><a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a> · {t('plans.readingPlanBreadcrumb')}</>
        )}
      </div>
      <div className="plan-hero">
        <div className="plan-hero__eyebrow">
          {isSharedView && remoteOwner ? (
            <>Reading plan by <strong className="lv-curator-name">{remoteOwner.display_name}</strong></>
          ) : (
            t('plans.yourPlan')
          )}
        </div>
        <h1 className="plan-hero__title">{plan.title}</h1>
        {plan.intro && <p className="plan-hero__desc">{plan.intro}</p>}
        <div className="plan-hero__badges">
          <span className="plan-badge">📚 {plan.books.length} {plan.books.length === 1 ? 'Book' : 'Books'}</span>
          {plan.books.some((b) => b.month) && (
            <span className="plan-badge">◔ {Math.max(...plan.books.map((b) => b.month || 1))} Months</span>
          )}
        </div>
      </div>

      <div className="plan-divider"><span className="plan-divider__glyph">✦</span></div>

      <div className="bp-actions">
        {plan.type === 'series' && plan.seriesName && (
          <button
            className="btn-primary"
            onClick={() => go('series-page', { seriesName: plan.seriesName, from: 'plan-view', fromLabel: t('plans.readingPlanBreadcrumb') })}
          >
            {t('plans.openSeries')}
          </button>
        )}
        {canAct && (
          <button className="btn-primary" onClick={addAllToQueue}>
            {t('plans.addAllToQueue')}
          </button>
        )}
        {!isSharedView && (
          <>
            <button className="btn-secondary" onClick={() => go('plan-create')}>
              {t('plans.createAnother')}
            </button>
            <button className="btn-secondary" onClick={handleDeletePlan}>
              Delete this plan
            </button>
          </>
        )}
        {isSharedView && (
          <>
            <button className="btn-primary" onClick={handleCopyPlan}>
              {t('plans.copyPlan')}
            </button>
            <button className="btn-secondary" onClick={() => go('plan-create')}>
              {t('plans.createOwnPlan')}
            </button>
          </>
        )}
        {/* v0.43: share — plans are publicly reachable via get_public_plan */}
        {plan._id && (
          <button className="btn-tertiary" onClick={() => setShareOpen(true)}>
            ↗ {t('share.sharePlan')}
          </button>
        )}
      </div>

      <div className="plan-months">
        {plan.books.map((b, i) => {
          const found = findBookByTitle(b.title || b.t, state.wishlist) ||
            { t: b.title || b.t, a: b.author || b.a, d: b.description || '' };
          const pages = b.pp || found.pp || null;
          const k = bookKey(found);
          const isRead = state.library.some((l) => bookKey(l) === k);
          const isQueued = state.readNext.some((l) => bookKey(l) === k);
          return (
            <div className="plan-month-card" key={i}>
              <div className="plan-month-card__label">Month {b.month || i + 1}</div>
              <div className="plan-month-card__content">
                <div className="plan-month-card__title">{found.t}</div>
                <div className="plan-month-card__author">
                  {found.a}
                  {pages && <span className="lv-hl-muted"> · ~{pages} pages</span>}
                </div>
                {(b.reason || found.d) && (
                  <div className="plan-month-card__blurb">{b.reason || found.d}</div>
                )}
                {(() => {
                  const genres = genresByBookId[found.bookId];
                  return genres && genres.length > 0 ? (
                    <div className="plan-month-card__genres bp-meta">
                      {genres.map((g) => (
                        <span key={g.genreId} className="chip" title={g.description || undefined}>
                          {g.name}
                        </span>
                      ))}
                    </div>
                  ) : null;
                })()}
                <div className="plan-month-card__actions bp-actions">
                  {isRead ? (
                    <span className="bp-pill bp-pill--moss">✓ Read</span>
                  ) : isQueued ? (
                    <span className="bp-pill">✓ Queued</span>
                  ) : canAct ? (
                    <>
                      <button className="btn-tertiary" onClick={() => addToReadNext(found)}>+ Add to Read Next</button>
                      <button className="btn-secondary" onClick={() => markAsRead(found)}>✓ Mark as Read</button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* v0.43: page-share modal */}
      {shareOpen && plan._id && (
        <ShareModal
          title={plan.title}
          text={t('share.text.planPage', { title: plan.title, count: plan.books.length })}
          url={planShareUrl(plan._id)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>
  );
}
