// src/components/OracleGateDialog.jsx — v0.58
//
// The single confirmation dialog behind `confirmOracleCall()`. Mounted once,
// in App, and driven entirely by OracleQuotaContext — no surface mounts its
// own copy, so the wording of "this costs a call" cannot drift between the
// eight places that can spend one.
//
// Two variants:
//   intro — first time this account is about to spend a call. Explains the
//           rule once: anything labelled Oracle draws on the quota.
//   last  — the call about to be made is the final one of the period.
//
// `intro` absorbs the last-call warning when both apply rather than queueing a
// second modal behind the first.
//
// Cancel is a real answer, not a dismissal: the promise resolves false and the
// calling surface returns without touching the network. Escape and the overlay
// both mean cancel, because the safe default when someone is unsure is to not
// spend their call.

import { useEffect } from 'react';
import { useT } from '../lib/I18nContext';
import { useOracleQuota } from '../lib/OracleQuotaContext';
import { useRouter } from '../lib/RouterContext';
import CornerBrackets from './CornerBrackets';

export default function OracleGateDialog() {
  const { gate, resolveGate, markIntroSeen, quota } = useOracleQuota();
  const t = useT();
  const { go } = useRouter();

  useEffect(() => {
    if (!gate) return;
    function onKey(e) { if (e.key === 'Escape') resolveGate(false); }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [gate, resolveGate]);

  if (!gate) return null;

  const isIntro   = gate.variant === 'intro';
  const remaining = quota?.calls_remaining ?? 0;
  const limit     = quota?.calls_limit ?? 5;
  const isDay     = quota?.period === 'day';
  const isPro     = quota?.subscription_status === 'active';

  const resetDate = quota?.reset_at
    ? quota.reset_at.toLocaleDateString(undefined, {
        month: 'long', day: 'numeric',
        ...(isDay ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    : null;

  function confirm() {
    // Acknowledged by proceeding, not by dismissing — see
    // profiles.oracle_intro_seen_at in schema_v44.
    if (isIntro) markIntroSeen();
    resolveGate(true);
  }

  return (
    <div
      className="rating-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) resolveGate(false); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="oracle-gate-title"
    >
      <div className="rating-modal oracle-gate">
        <CornerBrackets />

        <div className="modal-head">
          <div>
            <div className="rn-version">
              {t(isIntro ? 'oracleGate.introEyebrow' : 'oracleGate.lastEyebrow')}
            </div>
            <h2 className="rn-title" id="oracle-gate-title">
              {t(isIntro ? 'oracleGate.introTitle' : 'oracleGate.lastTitle')}
            </h2>
          </div>
          <button
            onClick={() => resolveGate(false)}
            aria-label={t('common.close')}
            className="modal-close-btn"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {isIntro ? (
            <>
              <p className="about-section__body">{t('oracleGate.introBody')}</p>
              <p className="about-section__body">{t('oracleGate.introFree')}</p>
              {/* `quota &&` matters: the disclosure can fire before the quota
                  has loaded, and `?? 5` would then assert a specific number of
                  remaining calls that nobody has checked. Say nothing rather
                  than say something unverified about someone's balance. */}
              {quota && !quota.unlimited && (
                <p className="about-section__body">
                  {t(isDay ? 'oracleGate.introCount' : 'oracleGate.introCountMonth', { remaining, limit })}
                </p>
              )}
              {/* Both conditions at once: say so here instead of opening a
                  second dialog the moment this one closes. */}
              {gate.isLast && (
                <p className="oracle-gate__warn">
                  {t(isDay ? 'oracleGate.alsoLast' : 'oracleGate.alsoLastMonth')}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="about-section__body">
                {t(isDay ? 'oracleGate.lastBody' : 'oracleGate.lastBodyMonth', { limit })}
              </p>
              {resetDate && (
                <p className="about-section__body">
                  {t('oracleGate.lastReset', { date: resetDate })}
                </p>
              )}
            </>
          )}

          <p className="oracle-gate__hint">{t('oracleGate.historyHint')}</p>
        </div>

        <div className="modal-foot oracle-gate__foot">
          {!isPro && !quota?.unlimited && (
            <button
              className="btn-text btn--sm"
              onClick={() => { resolveGate(false); go('profile', { tab: 'subscription' }); }}
            >
              {t('oracleGate.seePlans')}
            </button>
          )}
          <button className="btn-secondary" onClick={() => resolveGate(false)}>
            {t('oracleGate.cancel')}
          </button>
          <button className="btn-primary" onClick={confirm}>
            {t(isIntro ? 'oracleGate.introConfirm' : 'oracleGate.lastConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
