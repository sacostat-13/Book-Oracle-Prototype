import { useMemo, useState, useEffect } from 'react';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from '../contexts/RouterContext';
import { useT, useTNode, useI18n } from '../contexts/I18nContext';
import { useOracleQuota } from '../contexts/OracleQuotaContext';
import ReaderSettings from '../components/ReaderSettings';
import CornerBrackets from '../components/CornerBrackets';
import Tabs from '../components/primitives/Tabs';
import Ledger from './profile/Ledger';
import PrivacySection from './profile/sections/PrivacySection';
import NotificationPreferences from './profile/sections/NotificationPreferences';
import OverviewTab from './profile/OverviewTab';
import AccountTab from './profile/AccountTab';
import SubscriptionTab from './profile/SubscriptionTab';
import { computeProfileStats } from './profile/profileStats';

export default function Profile() {
  const { state, showToast, updatePrivacyPrefs, accomplishments, accomplishmentsBackfilling, shareAccomplishment } = useData();
  const { user } = useAuth();
  const { go, route } = useRouter();
  const t = useT();
  const tNode = useTNode();
  const { lang } = useI18n();
  const { refresh: refreshQuota } = useOracleQuota();
  // v0.58: null | 'comped' | 'missing'. Set only after a Manage attempt tells
  // us so. Deliberately NOT fetched on page load: `profile_billing` has no
  // client-readable policies (schema_v28) and answering "does this account
  // have billing?" eagerly would mean a Netlify round trip on every visit to
  // the tab. The button is honest the moment it is pressed, which is when the
  // question is actually being asked.
  const [billingState, setBillingState] = useState(null);

  // Refresh quota when returning from Stripe Checkout so the tier badge
  // updates immediately. Must be in useEffect — never call setState during render.
  const checkoutResult = route.params?.checkout;
  useEffect(() => {
    if (checkoutResult === 'success') {
      showToast(t('subscription.checkoutSuccess'));
      // Poll a couple of times — webhook may take a moment to update the profile
      refreshQuota();
      const t1 = setTimeout(() => refreshQuota(), 2000);
      const t2 = setTimeout(() => refreshQuota(), 5000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (checkoutResult === 'cancelled') {
      showToast(t('subscription.checkoutCancelled'));
    }
  }, [checkoutResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // v0.43.1: settings live in tabs (Account · Privacy · Subscription ·
  // Notifications). Active tab is reflected in the URL as ?tab=<name> so
  // deep links and back-nav work; ?scrollTo=subscription (used by the
  // Upgrade CTAs) stays supported as an alias for ?tab=subscription.
  // v0.67: 'ledger' is its own tab. It was the last block inside Overview,
  // below the stats and the charts — a record of everything the reader's whole
  // library has earned, buried under a summary of the current year. It is not
  // an appendix to the overview; it is the other half of the page.
  const VALID_TABS = ['overview', 'ledger', 'account', 'privacy', 'subscription', 'notifications'];
  const tabFromRoute = VALID_TABS.includes(route.params?.tab)
    ? route.params.tab
    : route.params?.scrollTo === 'subscription' ? 'subscription' : null;
  const [tab, setTab] = useState(tabFromRoute || 'overview');

  // Follow route changes while mounted (Upgrade CTA fired from Dashboard,
  // browser back/forward re-parsing the URL, etc.)
  useEffect(() => {
    if (tabFromRoute && tabFromRoute !== tab) setTab(tabFromRoute);
  }, [tabFromRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectTab(next) {
    setTab(next);
    // Reflect in the URL without go() — the router scrolls to top on every
    // navigation, which is wrong for an in-place tab switch. replaceState
    // also avoids polluting history with one entry per tab click.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      url.searchParams.delete('scrollTo');
      history.replaceState(null, '', url.pathname + url.search);
    } catch { /* URL API unavailable — tab still switches */ }
  }

  // Arriving with an explicit tab intent (e.g. Upgrade CTA): bring the
  // settings card into view. Delayed a tick so it wins over the router's
  // own scroll-to-top.
  useEffect(() => {
    if (!tabFromRoute) return;
    const timer = setTimeout(() => {
      // v0.71: the dashboard's "I track on Goodreads" lands on the import
      // panel itself, not the top of the Account tab.
      const target = route.params?.anchor === 'goodreads' ? 'pf-goodreads' : 'pf-settings';
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => clearTimeout(timer);
  }, [tabFromRoute, route.params?.anchor]);

  // ── Stats (profile/profileStats.js) — the page head uses them too ─────────
  const stats = useMemo(
    () => computeProfileStats(state),
    [state.library, state.wishlist, state.readNext, state.genresByBookId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const hasStats = stats.totalBooks > 0;

  return (
    <>
      <div className="breadcrumb">
        <a onClick={() => go('dashboard')}>Dashboard</a> · {t('profile.breadcrumb')}
      </div>
      <div className="page-head">
        <div className="page-head__eyebrow">{t('profile.eyebrowTitle')}</div>
        <h1 className="page-head__title">
          {tNode('profile.pageTitle')}
        </h1>
        {hasStats && (
          <p className="page-head__lead">
            {t('profile.subtitleStats', {
              books: stats.totalBooks,
              pages: stats.totalPages > 0 ? t('profile.subtitlePages', { pages: stats.totalPages.toLocaleString() }) : '',
            })}
          </p>
        )}
      </div>

      {/* ── v0.43.1: the whole page is tabbed. Overview = reading identity
          (stats, pace, genres, author, series, challenge); the other four
          tabs are settings. One card, one tab row, no long scroll. */}
      <div className="pf-account-card" id="pf-settings">
        <CornerBrackets />

        <Tabs
          className="pf-tabs"
          tabClassName="pf-tab"
          activeClassName="pf-tab--active"
          label={t('profile.breadcrumb')}
          tabs={[
            { id: 'overview', label: t('profile.tabOverview') },
            { id: 'ledger', label: t('profile.tabLedger') },
            { id: 'account', label: t('profile.tabAccount') },
            { id: 'privacy', label: t('profile.tabPrivacy') },
            ...(user ? [
              { id: 'subscription', label: t('profile.tabSubscription') },
              { id: 'notifications', label: t('profile.tabNotifications') },
            ] : []),
          ]}
          value={tab}
          onChange={selectTab}
        />

        {tab === 'overview' && (
        <>
          <OverviewTab stats={stats} />
        </>
        )}

        {/* v0.45: The Ledger — retroactive accomplishments shelf.
            v0.67: its own tab.

            A SIBLING of the other tab panels, deliberately. When this moved out
            of Overview it was first pasted inside the overview fragment, which
            made the condition `tab === 'overview' && tab === 'ledger'` — never
            true, and silent, because an unreachable branch throws nothing. */}
        {tab === 'ledger' && (
        <>
          <Ledger
            accomplishments={accomplishments}
            onShare={shareAccomplishment}
            t={t}
            locale={lang}
            backfilling={accomplishmentsBackfilling}
          />
          {(!accomplishments || accomplishments.length === 0) && !accomplishmentsBackfilling && (
            <p className="pf-ledger-lede">{t('ledger.empty')}</p>
          )}
        </>
        )}

        {tab === 'account' && (
        <>
          <AccountTab />
        </>
        )}

        {tab === 'privacy' && (
          <>
            <PrivacySection profile={state.profile} updatePrivacyPrefs={updatePrivacyPrefs} t={t} />
            {/* v0.66 — shelf visibility and feed scope. The bio and the
                curator request moved to Account, where a reader would think
                to look for them. */}
            <ReaderSettings section="privacy" />
          </>
        )}

        {/* ── Subscription tab ──────────────────────────────────────────────── */}
        {tab === 'subscription' && user && (
          <SubscriptionTab billingState={billingState} setBillingState={setBillingState} />
        )}

        {/* ── Notifications tab ─────────────────────────────────────────────── */}
        {tab === 'notifications' && user && (
          <NotificationPreferences t={t} user={user} showToast={showToast} />
        )}
      </div>
    </>
  );
}

// ── NotificationPreferences ───────────────────────────────────────────────────
