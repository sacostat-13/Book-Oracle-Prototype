import { useData } from '../lib/DataContext';
import { useRouter } from '../lib/RouterContext';
import { bookKey, findBookByTitle } from '../lib/bookHelpers';
import { useT, useTNode, useI18n } from '../lib/I18nContext';

// How many books in this plan does the user already have in their library?
function planProgress(plan, state) {
  const books = plan.books || [];
  if (books.length === 0) return { read: 0, total: 0, pct: 0 };
  let read = 0;
  for (const b of books) {
    const found = findBookByTitle(b.title || b.t, state.wishlist) ||
      { t: b.title || b.t, a: b.author || b.a };
    const k = bookKey(found);
    if (state.library.some((l) => bookKey(l) === k)) read += 1;
  }
  return { read, total: books.length, pct: Math.round((read / books.length) * 100) };
}

function formatDate(iso, lang) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return null;
  }
}

export default function PlanList() {
  const { state } = useData();
  const { go } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const { lang } = useI18n();

  const plans = state.plans || [];

  return (
    <>
      <div className="page-head">
        <div className="page-head__eyebrow">
          <a onClick={() => go('dashboard')}>{t('nav.dashboard')}</a> · {t('plans.listEyebrow')}
        </div>
        <h1 className="page-head__title">
          {tNode('plans.listTitle', { accent: <span className="accent">{t('plans.listTitleAccent')}</span> })}
        </h1>
        <p className="page-head__lead">{t('plans.listSubtitle')}</p>
      </div>

      <div className="bp-actions">
        <button className="btn-primary" onClick={() => go('plan-create')}>
          {t('plans.createOwnPlan')}
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="lv-empty">
          <div className="lv-empty-icon">❦</div>
          <div className="lv-empty-title">{t('plans.noPlansTitle')}</div>
          <div className="lv-empty-text">{t('plans.noPlansText')}</div>
          <button className="btn-primary" onClick={() => go('plan-create')}>
            {t('plans.createOwnPlan')}
          </button>
        </div>
      ) : (
        <div className="plan-list">
          {plans.map((plan) => {
            const { read, total, pct } = planProgress(plan, state);
            const months = (plan.books || []).some((b) => b.month)
              ? Math.max(...(plan.books || []).map((b) => b.month || 1))
              : null;
            const created = formatDate(plan.createdAt, lang);
            return (
              <button
                key={plan._id}
                className="plan-list-card"
                onClick={() => go('plan-view', { planId: plan._id, from: 'plan-list' })}
              >
                <div className="plan-list-card__head">
                  <h2 className="plan-list-card__title">{plan.title}</h2>
                  {created && <span className="plan-list-card__date">{created}</span>}
                </div>

                {plan.intro && <p className="plan-list-card__desc">{plan.intro}</p>}

                <div className="plan-list-card__meta">
                  <span className="plan-badge">
                    {total} {total === 1 ? t('plans.bookSingular') : t('plans.bookPlural')}
                  </span>
                  {months && (
                    <span className="plan-badge">
                      {months} {months === 1 ? t('plans.monthSingular') : t('plans.monthPlural')}
                    </span>
                  )}
                </div>

                {total > 0 && (
                  <div className="plan-list-card__progress">
                    <div className="plan-progress-track">
                      <div className="plan-progress-fill" style={{ '--plan-pct': `${pct}%` }} />
                    </div>
                    <div className="plan-progress-label">
                      {t('plans.progressRead', { read, total })}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
