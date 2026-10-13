// src/views/profile/SubscriptionTab.jsx — Profile's Subscription tab: plan,
// Oracle call usage, upgrade (Lemon Squeezy checkout) and manage (portal).

import { useState } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../contexts/I18nContext';
import { useOracleQuota } from '../../contexts/OracleQuotaContext';
import { supabase } from '../../lib/api/supabase';
import OracleCallHistory from '../../components/OracleCallHistory';

// v0.75: display price of the annual Pro variant, e.g. "$49.99". Unset = monthly only.
const ANNUAL_PRICE = import.meta.env.VITE_ANNUAL_PRICE || null;

/**
 * @param {{ billingState: null|'comped'|'missing', setBillingState: Function }} props
 *   Lifted to Profile so a "nothing to manage" answer survives switching tabs, as before.
 */
export default function SubscriptionTab({ billingState, setBillingState }) {
  const { showToast } = useData();
  const { user } = useAuth();
  const t = useT();
  const { quota, refresh: refreshQuota } = useOracleQuota();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // v0.75: `plan` is 'monthly' (default) or 'annual'. The annual option only
  // renders when VITE_ANNUAL_PRICE is set, which should be set together with
  // LEMON_SQUEEZY_REDIRECT_URL_ANNUAL on the function side.
  async function handleUpgrade(plan = 'monthly') {
    if (!user) return;
    setCheckoutLoading(true);
    try {
      // v0.43.1: use the static import — the dynamic import('../lib/api/supabase')
      // resolved to a namespace without `supabase` in the prod bundle
      // (chunk/SW interop), killing checkout with "reading 'auth'".
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const res = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ plan: plan === 'annual' ? 'annual' : 'monthly' }),
      });
      const json = await res.json();
      if (!json.url) {
        // v0.43.2: already subscribed — point at Manage instead of erroring,
        // and refresh the quota so a stale "Upgrade" CTA flips to Manage.
        if (json.code === 'already_subscribed') {
          showToast(t('subscription.alreadyProToast'));
          refreshQuota();
          return;
        }
        console.error('[checkout] no URL from create-checkout-session:', res.status, json);
        showToast(t('subscription.checkoutError'), true);
        return;
      }

      const checkoutUrl = json.url;

      // Listen for successful payment — LS fires a postMessage on completion
      function onLSMessage(e) {
        if (!e.origin.includes('lemonsqueezy.com')) return;
        if (e.data?.event === 'Checkout.Success') {
          window.removeEventListener('message', onLSMessage);
          showToast(t('subscription.checkoutSuccess'));
          refreshQuota();
          setTimeout(() => refreshQuota(), 2000);
          setTimeout(() => refreshQuota(), 5000);
        }
      }
      window.addEventListener('message', onLSMessage);

      // Use LS overlay JS if available, otherwise fall back to full redirect.
      //
      // v0.43.1: the overlay path can no longer fail silently. Url.Open()
      // doesn't throw when the embed can't render (blocked iframe, half-
      // initialized lemon.js, etc.) — it just does nothing, which read as
      // "the button is dead" in production. Now: log the path taken, wrap
      // Url.Open in try/catch, and verify the overlay actually appeared
      // ~1.5s later — if no LS iframe is in the DOM by then, hard-redirect
      // to the checkout URL, which cannot fail silently.
      const redirectFallback = () => { window.location.href = checkoutUrl; };
      const verifyOverlayOpened = () => {
        setTimeout(() => {
          const overlayVisible = !!document.querySelector('iframe[src*="lemonsqueezy.com"], .lemonsqueezy-modal');
          if (!overlayVisible) {
            console.warn('[checkout] LS overlay did not appear — falling back to redirect');
            redirectFallback();
          }
        }, 1500);
      };

      if (window.LemonSqueezy?.Url?.Open) {
        console.log('[checkout] opening via LS overlay');
        try {
          window.LemonSqueezy.Url.Open(checkoutUrl);
          verifyOverlayOpened();
        } catch (e) {
          console.error('[checkout] LS overlay threw — falling back to redirect', e);
          redirectFallback();
        }
      } else {
        // Load LS overlay JS then open
        const existing = document.getElementById('lemon-squeezy-js');
        if (!existing) {
          console.log('[checkout] loading lemon.js, then opening');
          const script = document.createElement('script');
          script.id = 'lemon-squeezy-js';
          script.src = 'https://assets.lemonsqueezy.com/lemon.js';
          script.defer = true;
          script.onload = () => {
            window.createLemonSqueezy?.();
            if (window.LemonSqueezy?.Url?.Open) {
              try {
                window.LemonSqueezy.Url.Open(checkoutUrl);
                verifyOverlayOpened();
              } catch (e) {
                console.error('[checkout] LS overlay threw — falling back to redirect', e);
                redirectFallback();
              }
            } else {
              redirectFallback();
            }
          };
          script.onerror = () => { console.warn('[checkout] lemon.js failed to load — redirecting'); redirectFallback(); };
          document.head.appendChild(script);
        } else {
          // Script tag exists but Url.Open not ready yet — just redirect
          console.log('[checkout] lemon.js present but not ready — redirecting');
          redirectFallback();
        }
      }
    } catch (e) {
      console.error('[checkout] handleUpgrade failed', e);
      showToast(t('subscription.checkoutError'), true);
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function handleManage() {
    if (!user) return;
    setPortalLoading(true);
    try {
      // v0.43.1: use the static import — the dynamic import('../lib/api/supabase')
      // resolved to a namespace without `supabase` in the prod bundle
      // (chunk/SW interop), killing checkout with "reading 'auth'".
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const res = await fetch('/.netlify/functions/manage-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      // v0.43.2: server errors carry a `code`; map them to i18n toasts
      // instead of raw English strings. 'no_subscription' nudges toward
      // upgrading rather than reading as a failure.
      if (json.url) window.location.href = json.url;
      else if (json.code === 'no_subscription') showToast(t('subscription.noSubToast'), true);
      // v0.58: two new codes, both permanent rather than retryable.
      // `comped` = Pro granted directly, nothing to manage. `subscription_missing`
      // = we hold an id Lemon Squeezy will not honour (test-mode leftover or a
      // deleted subscription). Neither should say "try again shortly".
      else if (json.code === 'comped') {
        setBillingState('comped');
        showToast(t('subscription.compedToast'), false);
      }
      else if (json.code === 'subscription_missing') {
        setBillingState('missing');
        showToast(t('subscription.subMissingToast'), true);
      }
      else showToast(t('subscription.portalError'), true);
    } catch (e) {
      showToast(t('subscription.portalError'), true);
    } finally {
      setPortalLoading(false);
    }
  }

  return (
          <div className="pf-section" id="pf-subscription">
            <h2 className="pf-section__title">
              {t('subscription.sectionTitle')}
            </h2>

            {/* Tier badge — reuses the global .status pill system */}
            {(() => {
              const status = quota?.subscription_status || 'free';
              const isPro = status === 'active';
              const isPastDue = status === 'past_due';
              return (
                <div className="pf-tier-row">
                  <span className={`status${isPro ? ' status--success' : isPastDue ? ' status--warn' : ''}`}>
                    {isPro ? `✦ ${t('subscription.tierPro')}` : isPastDue ? `⚠ ${t('subscription.tierPastDue')}` : t('subscription.tierFree')}
                  </span>
                  <span className="pf-section__hint">
                    {isPro
                      ? t('subscription.proDesc')
                      : isPastDue
                        ? t('subscription.pastDueDesc')
                        : t('subscription.freeDesc', {
                          remaining: quota?.calls_remaining ?? 5,
                          limit: quota?.calls_limit ?? 5,
                        })}
                  </span>
                </div>
              );
            })()}

            {/* Quota bar — reuses the dashboard's AI-quota bar (.db-ai__track/__fill),
                the same visual pattern, instead of a duplicate .pf-quota* set */}
            {quota && quota.unlimited && (
              <div className="db-ai__note">{t('dashboard.aiQuotaUnlimited')}</div>
            )}

            {/* v0.58: only draw a bar when there is a limit to draw it against.
                `calls_limit ?? 5` previously turned an unlimited quota's null
                into 5 and pegged the bar at 100%, which read as "you are out
                of calls" on an account that could not run out. */}
            {quota && !quota.unlimited && (
              <div>
                <div className="db-ai__track">
                  <div
                    className={`db-ai__fill${quota.calls_remaining === 0 ? ' db-ai__fill--empty' : ''}`}
                    style={{ '--ai-pct': `${Math.min(100, Math.round(((quota.calls_used ?? 0) / (quota.calls_limit ?? 5)) * 100))}%` }}
                  />
                </div>
                {/* v0.61: curator exemption note removed — see Dashboard.jsx */}
                {quota.reset_at && (
                  <div className="db-ai__note">
                    {t('subscription.resetsOn', { date: new Date(quota.reset_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) })}
                  </div>
                )}
              </div>
            )}

            {/* v0.58: the bar says how much is gone; this says where it went.
                Directly beneath it, because the two are the same question
                asked at different resolutions. */}
            <OracleCallHistory />

            {/* CTA */}
            {quota?.subscription_status === 'active' ? (
              /* v0.58: once we know there is no portal to open, stop offering
                 to open one. A button whose only outcome is an error toast is
                 worse than a sentence explaining why there is no button. */
              billingState ? (
                <div className="pf-billing-note">
                  <div className="pf-billing-note__title">
                    {t(billingState === 'comped'
                      ? 'subscription.compedTitle'
                      : 'subscription.subMissingTitle')}
                  </div>
                  <p className="pf-section__hint">
                    {t(billingState === 'comped'
                      ? 'subscription.compedBody'
                      : 'subscription.subMissingBody')}
                  </p>
                </div>
              ) : (
                <button className="btn-secondary" onClick={handleManage} disabled={portalLoading}>
                  {portalLoading ? t('subscription.redirecting') : t('subscription.manageBtn')}
                </button>
              )
            ) : (
              <div className="pf-upgrade">
                <button className="btn-primary" onClick={() => handleUpgrade('monthly')} disabled={checkoutLoading}>
                  {checkoutLoading ? t('subscription.redirecting') : t('subscription.upgradeBtn')}
                </button>
                {ANNUAL_PRICE && (
                  <button className="btn-text btn--sm" onClick={() => handleUpgrade('annual')} disabled={checkoutLoading}>
                    {t('subscription.annualOption', { price: ANNUAL_PRICE })}
                  </button>
                )}
                <div className="pf-upgrade__features">
                  {t('subscription.upgradePrice')} ·{' '}
                  {[
                    t('subscription.upgradeFeature1'),
                    t('subscription.upgradeFeature2'),
                    t('subscription.upgradeFeature3'),
                    t('subscription.upgradeFeature4'),
                  ].join(' · ')}
                </div>
              </div>
            )}
          </div>
  );
}
