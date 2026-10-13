import { useOracleQuota } from '../../contexts/OracleQuotaContext';
import { IconSparkle } from './WidgetShell';

// ─── AI Quota Bar ─────────────────────────────────────────────────────────────
export default function AIQuotaBar({ go, t }) {
  const { quota, loading } = useOracleQuota();
  if (loading || !quota) return null;

  const isPro = quota.subscription_status === 'active';
  const isDay = quota.period === 'day';

  // v0.58: an unlimited quota has no bar to draw. This used to fall through to
  // the clamping below, where `calls_limit ?? 5` turned null into 5 and
  // `Math.min(calls_used, limit)` turned a used-count of 32 into 5 — so an
  // unmetered account read "5 of 5 used" forever and looked walled when
  // nothing was blocking it. Branch out before the clamp, not after.
  if (quota.unlimited) {
    return (
      <div className="db-ai">
        <div className="db-ai__head">
          <div className="db-ai__label">
            <IconSparkle /> {t('dashboard.aiQuotaTitle')}
          </div>
          <span className="db-ai__usage">{t('dashboard.aiQuotaUnlimited')}</span>
        </div>
      </div>
    );
  }

  const isEmpty = quota.calls_remaining === 0;
  // v0.43.1: clamp to the CURRENT tier's limit. After a Pro→Free downgrade
  // calls_used can legitimately exceed the free limit (e.g. 14 used, limit 5)
  // — showing "14 of 5" reads as a bug, so the display caps at the limit.
  const limit = quota.calls_limit ?? 5;
  const usedDisplay = Math.min(quota.calls_used ?? 0, limit);
  const pct = Math.min(100, Math.round(((quota.calls_used ?? 0) / limit) * 100));
  const resetDate = quota.reset_at
    ? quota.reset_at.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="db-ai">
      <div className="db-ai__head">
        <div className="db-ai__label">
          <IconSparkle /> {t('dashboard.aiQuotaTitle')}
        </div>
        <span className="db-ai__usage">
          {t(isDay ? 'dashboard.aiQuotaPro' : 'dashboard.aiQuotaFree', {
            used: usedDisplay,
            limit,
            type: isPro ? t('dashboard.aiQuotaTypeDaily') : t('dashboard.aiQuotaTypeMonthly'),
          })}
        </span>
      </div>
      <div className="db-ai__track">
        <div
          className={`db-ai__fill${isEmpty ? ' db-ai__fill--empty' : ''}`}
          style={{ '--ai-pct': `${pct}%` }}
        />
      </div>
      <div className="db-ai__note">
        {quota.welcome ? t('dashboard.aiQuotaWelcome', { limit }) : t('dashboard.aiQuotaIncludes')}
        {/* v0.61: the curator note is gone with the exemption it explained.
            Catalog categorization is no longer a metered in-app action for
            anyone — it runs nightly in CI — so there is no longer a class of
            user for whom part of this bar behaves differently. */}
        {resetDate && <> · {t('dashboard.aiQuotaResetsOn', { date: resetDate })}</>}
        {!isPro && (
          <> · <button className="btn-text" style={{ padding: 0, fontSize: 'inherit' }}
            onClick={() => go('profile', { scrollTo: 'subscription' })}>{t('dashboard.aiQuotaUpgrade')}</button></>
        )}
      </div>
    </div>
  );
}
