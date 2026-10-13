import { IconSparkle, WidgetShell } from './WidgetShell';

// ─── Reading Plans ─────────────────────────────────────────────────────────────
export default function PlansWidget({ plans, go, t }) {
  if (!plans?.length) return null;
  return (
    <WidgetShell icon={<IconSparkle />} label={t('dashboard.readingPlans')}>
      <div className="db-plans-list">
        {plans.map((plan, i) => (
          <div key={plan._id || i}
            className={`db-plan-row${i === 0 ? ' db-plan-row--current' : ''}`}
            onClick={() => go('plan-view', { planId: plan._id })}>
            <span className="db-plan-glyph"><IconSparkle /></span>
            <div className="db-plan-body">
              {i === 0 && <div className="db-plan-current-label">{t('dashboard.currentPlanLabel')}</div>}
              <div className="db-plan-title">{plan.title || t('dashboard.untitledPlan')}</div>
              <div className="db-plan-meta">
                {t('dashboard.planMeta', { count: (plan.books || []).length, months: plan.timeline })}
              </div>
            </div>
            <div className="db-plan-cta">{t('dashboard.viewPlan')}</div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

// ─── Book Clubs ────────────────────────────────────────────────────────────────
