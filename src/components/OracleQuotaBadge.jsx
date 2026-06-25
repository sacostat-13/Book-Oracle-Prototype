// src/components/OracleQuotaBadge.jsx
//
// Two exports:
//   <OracleQuotaBadge />   — inline badge: "3 of 5 left today" / "3 of 5 left this month"
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
    <span style={{
      display:        'inline-flex',
      alignItems:     'center',
      fontFamily:     "'Special Elite', monospace",
      fontSize:       '0.65rem',
      letterSpacing:  '0.1em',
      textTransform:  'uppercase',
      color:          isEmpty ? 'rgba(180,60,60,0.9)' : 'rgba(201,162,75,0.7)',
      background:     isEmpty ? 'rgba(180,60,60,0.08)' : 'rgba(201,162,75,0.06)',
      border:         `1px solid ${isEmpty ? 'rgba(180,60,60,0.25)' : 'rgba(201,162,75,0.2)'}`,
      borderRadius:   '2px',
      padding:        '0.15rem 0.5rem',
      ...style,
    }}>
      {isEmpty
        ? t(isDay ? 'oracle.quotaEmpty' : 'oracle.quotaEmptyMonth')
        : t(isDay ? 'oracle.quotaBadge' : 'oracle.quotaBadgeMonth', { remaining, limit })}
    </span>
  );
}

export function OracleQuotaWall() {
  const { quota } = useOracleQuota();
  const t = useT();

  const isDay    = quota?.period === 'day';
  const limit    = quota?.calls_limit ?? 5;
  const resetAt  = quota?.reset_at;
  const isPro    = quota?.subscription_status === 'active';

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
      <div style={{ fontSize: '2.2rem', opacity: 0.25, lineHeight: 1 }}>❦</div>

      <div style={{
        fontFamily: "'Special Elite', monospace", fontSize: '0.7rem',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'rgba(180,60,60,0.8)',
      }}>
        {t(isDay ? 'oracle.quotaWallEyebrow' : 'oracle.quotaWallEyebrowMonth')}
      </div>

      <h2 style={{
        fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic',
        fontSize: '1.7rem', color: 'var(--paper)', margin: 0, lineHeight: 1.2,
      }}>
        {t('oracle.quotaWallTitle')}
      </h2>

      <p style={{ color: 'var(--paper-aged)', fontSize: '0.95rem', lineHeight: 1.6, margin: 0, opacity: 0.8 }}>
        {t(isDay ? 'oracle.quotaWallBody' : 'oracle.quotaWallBodyMonth', { limit })}
        {resetDate && <> <span style={{ color: 'var(--gilt)', opacity: 1 }}>{t('oracle.quotaWallReset', { date: resetDate })}</span></>}
      </p>

      <div style={{ width: '3rem', height: '1px', background: 'rgba(201,162,75,0.2)', margin: '0.5rem 0' }} />

      <p style={{ color: 'var(--paper-aged)', fontSize: '0.85rem', opacity: 0.55, margin: 0, fontStyle: 'italic' }}>
        {isPro
          ? (isDay ? t('oracle.quotaWallBody', { limit }) : '')
          : t('oracle.quotaWallUpgradeNote')}
      </p>
    </div>
  );
}
