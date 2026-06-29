// src/components/OracleQuotaBadge.jsx — v0.38 DS
// Two exports:
//   <OracleQuotaBadge />   — inline badge: "3 of 5 left today"
//   <OracleQuotaWall />    — full empty-state when all calls are exhausted

import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';

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
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', padding: '3rem 2rem', gap: '1rem',
      maxWidth: 480, margin: '0 auto',
    }}>
      <div style={{ fontSize: '2rem', color: 'var(--ro-dim)', lineHeight: 1 }}>❦</div>

      <div style={{
        fontFamily: 'var(--ro-font-mono)', fontSize: 10,
        fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--ro-error)',
      }}>
        {t(isDay ? 'oracle.quotaWallEyebrow' : 'oracle.quotaWallEyebrowMonth')}
      </div>

      <h2 style={{
        fontFamily: 'var(--ro-font-display)', fontStyle: 'italic',
        fontSize: 28, color: 'var(--ro-text)', margin: 0, lineHeight: 1.1,
      }}>
        {t('oracle.quotaWallTitle')}
      </h2>

      <p style={{ fontFamily: 'var(--ro-font-body)', color: 'var(--ro-text-2)', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
        {t(isDay ? 'oracle.quotaWallBody' : 'oracle.quotaWallBodyMonth', { limit })}
        {resetDate && (
          <> <span style={{ color: 'var(--ro-gold-text)' }}>{t('oracle.quotaWallReset', { date: resetDate })}</span></>
        )}
      </p>

      <div style={{ width: 48, height: 1, background: 'var(--ro-border-strong)', margin: '4px 0' }} />

      <p style={{ fontFamily: 'var(--ro-font-body)', fontStyle: 'italic', color: 'var(--ro-muted)', fontSize: 14, margin: 0 }}>
        {!isPro && t('oracle.quotaWallUpgradeNote')}
      </p>
    </div>
  );
}
