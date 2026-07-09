// src/components/OracleQuotaBadge.jsx — v0.38 DS
// Two exports:
//   <OracleQuotaBadge />   — inline badge: "3 of 5 left today"
//   <OracleQuotaWall />    — full empty-state when all calls are exhausted

import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { useRouter } from '../lib/RouterContext';

export function OracleQuotaBadge({ style = {} }) {
  const { quota, loading } = useOracleQuota();
  const t = useT();
  if (loading || !quota) return null;

  const remaining = quota.calls_remaining ?? 0;
  const limit     = quota.calls_limit ?? 5;
  const isEmpty   = remaining === 0;
  const isDay     = quota.period === 'day';

  return (
    <span
      className={`quota-badge${isEmpty ? ' quota-badge--low' : ''}`}
      style={style}
    >
      <span className="quota-dot" />
      <span className="quota-count">
        {isEmpty
          ? t(isDay ? 'oracle.quotaEmpty' : 'oracle.quotaEmptyMonth')
          : t(isDay ? 'oracle.quotaBadge' : 'oracle.quotaBadgeMonth', { remaining, limit })}
      </span>
    </span>
  );
}

export function OracleQuotaWall() {
  const { quota } = useOracleQuota();
  const t = useT();
  const { go } = useRouter();

  const isDay   = quota?.period === 'day';
  const limit   = quota?.calls_limit ?? 5;
  const resetAt = quota?.reset_at;
  const isPro   = quota?.subscription_status === 'active';

  const resetDate = resetAt
    ? resetAt.toLocaleDateString(undefined, {
        month: 'long', day: 'numeric',
        ...(isDay ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    : null;

  return (
    <div className="quota-wall">
      <div className="quota-wall__icon">❦</div>

      <div className="quota-wall__eyebrow">
        {t(isDay ? 'oracle.quotaWallEyebrow' : 'oracle.quotaWallEyebrowMonth')}
      </div>

      <h2 className="quota-wall__title">
        {t('oracle.quotaWallTitle')}
      </h2>

      <p className="quota-wall__body">
        {t(isDay ? 'oracle.quotaWallBody' : 'oracle.quotaWallBodyMonth', { limit })}
        {resetDate && (
          <> <span className="quota-wall__reset">{t('oracle.quotaWallReset', { date: resetDate })}</span></>
        )}
      </p>

      <div className="session-divider" style={{ width: 48, margin: "4px 0" }} />

      {!isPro && (
        <>
          <p className="quota-wall__body">
            {t('oracle.quotaWallUpgradeNote')}
          </p>
          {/* v0.43.1: all Upgrade CTAs route to Profile → subscription section */}
          <button
            className="btn-primary btn--sm"
            onClick={() => go('profile', { scrollTo: 'subscription' })}
          >
            {t('dashboard.aiQuotaUpgrade')}
          </button>
        </>
      )}
    </div>
  );
}
