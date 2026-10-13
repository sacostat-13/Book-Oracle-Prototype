// src/views/Dashboard.jsx — The Books Oracle R3
// Zero inline styles. All widget patterns use classes from pages/_dashboard.scss.
// DS spec: gradient surfaces, gold section eyebrows, consistent cover sizes.

import { useMemo, useState, useEffect } from 'react';
import { useData } from '../contexts/DataContext';
import { useClubs } from '../hooks/useClubs';
import { useRouter } from '../contexts/RouterContext';
import { useT, useTNode } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { buildTasteProfile } from '../lib/scoring/tasteProfile';
import { supabase } from '../lib/api/supabase';
import CoachMark from '../components/CoachMark';
import AddBooksChooser from '../components/AddBooksChooser';
import { resolveLayout } from './dashboard/layout';
import { IconSparkle, IconDiamond } from './dashboard/WidgetShell';
import CurrentlyReadingWidget from './dashboard/CurrentlyReadingWidget';
import OracleSparkWidget from './dashboard/OracleSparkWidget';
import ReadingStatsWidget from './dashboard/ReadingStatsWidget';
import ReadingGoalWidget from './dashboard/ReadingGoalWidget';
import SeriesProgressWidget from './dashboard/SeriesProgressWidget';
import StreakWidget from './dashboard/StreakWidget';
import PlansWidget from './dashboard/PlansWidget';
import ClubsWidget from './dashboard/ClubsWidget';
import QuickActionsWidget from './dashboard/QuickActionsWidget';
import FeedWidget from './dashboard/FeedWidget';
import AIQuotaBar from './dashboard/AIQuotaBar';
import FriendsFeedWidget from './dashboard/FriendsFeedWidget';
import WidgetSettings from './dashboard/WidgetSettings';
import LevelNudge from './dashboard/LevelNudge';

export default function Dashboard({ onOpenBook }) {
  const { state, setDashboardLayout, setReadingGoalCount, dismissCoachmark } = useData();
  const { clubs } = useClubs();
  const { go } = useRouter();
  const { user } = useAuth();
  const t = useT();
  const tNode = useTNode();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [friendCount, setFriendCount] = useState(0);
  const [clubsSummary, setClubsSummary] = useState(null); // null = not loaded yet

  // v0.43.1: static supabase import — the dynamic import('../lib/api/supabase')
  // pattern resolved to a namespace without `supabase` in the prod bundle
  // (chunk/SW interop), silently breaking the friend count and clubs summary.
  useEffect(() => {
    if (!user) return;
    // v0.66: friend_pairs is gone. "Do I follow anyone" is what decides
    // whether the feed widget has anything to say, and that is one direction
    // of user_follows.
    supabase.from('user_follows').select('followee_id', { count: 'exact', head: true })
      .eq('follower_id', user.id).then(({ count }) => setFriendCount(count || 0));
  }, [user]);

  useEffect(() => {
    if (!user || !(state.clubs || []).length) { setClubsSummary([]); return; }
    supabase.rpc('get_dashboard_clubs_summary').then(({ data, error }) => {
      if (error) { console.error('get_dashboard_clubs_summary failed', error); setClubsSummary([]); return; }
      setClubsSummary(data || []);
    });
  }, [user, state.clubs]); // the stored array, not the `|| []` fallback: a fresh [] would re-run this every render

  const layout = useMemo(() => resolveLayout(state.dashboardLayout), [state.dashboardLayout]);
  // v0.63.3: memoised here rather than inside the Spark widget so it is not
  // rebuilt on every dashboard render for a feature that fires on a click.
  const tasteProfile = useMemo(
    () => buildTasteProfile(state.library, state.genresByBookId, state.profile),
    [state.library, state.genresByBookId, state.profile]
  );
  const firstName = (state.profile?.displayName || state.profile?.display_name || '').split(' ')[0];
  const levelName = state.profile?.readingLevel || null;

  function renderWidget(id) {
    switch (id) {
      case 'currently-reading': return <CurrentlyReadingWidget key={id} books={state.currentlyReading || []} onOpenBook={onOpenBook} t={t} />;
      case 'oracle-spark': return <OracleSparkWidget key={id} wishlist={state.wishlist} go={go} t={t} profile={state.profile} tasteProfile={tasteProfile} />;
      case 'reading-stats': return <ReadingStatsWidget key={id} library={state.library || []} editions={state.editionsByBookId} currentlyReading={state.currentlyReading || []} go={go} t={t} />;
      case 'reading-goal': return <ReadingGoalWidget key={id} library={state.library || []} genresByBookId={state.genresByBookId || {}} readingGoalCount={state.readingGoalCount} setReadingGoalCount={setReadingGoalCount} t={t} />;
      case 'series-progress': return <SeriesProgressWidget key={id} library={state.library || []} wishlist={state.wishlist} readNext={state.readNext} go={go} t={t} />;
      case 'streak': return <StreakWidget key={id} library={state.library || []} t={t} />;
      case 'plans': return <PlansWidget key={id} plans={state.plans || []} go={go} t={t} />;
      case 'clubs': return <ClubsWidget key={id} clubs={clubs} summary={clubsSummary} go={go} t={t} />;
      case 'friends-feed': return <FriendsFeedWidget key={id} userId={user?.id} hasFriends={friendCount > 0} go={go} t={t} scope={state.profile?.feedScope || 'both'} />;
      case 'feed': return <FeedWidget key={id} state={state} onOpenBook={onOpenBook} go={go} t={t} eyebrow={t('dashboard.widgetMyFeed')} />;
      default: return null;
    }
  }

  // ── Hero level chip (badge only — numeric counts moved to the glance grid) ──
  const levelChip = levelName ? { glyph: '◆', label: t('dashboard.levelPill', { level: levelName }) } : null;

  // ── Hero "at a glance" stat cards ───────────────────────────────────────────
  const glanceCards = [
    { value: state.library?.length || 0, label: t('dashboard.glanceRead') },
    { value: (state.wishlist || []).length, label: t('dashboard.glanceWishlist') },
    (state.currentlyReading || []).length > 0 &&
    { value: state.currentlyReading.length, label: t('dashboard.currentlyReading') },
    { value: (state.plans || []).length, label: t('dashboard.readingPlans') },
    { value: clubs.length, label: t('dashboard.glanceClubs') },
  ].filter(Boolean);

  return (
    <div className="db-page">
      {/* ── Hero ── */}
      <div className="db-hero">
        <div className="db-hero__eyebrow">
          <IconDiamond /> {t('dashboard.eyebrow')}
        </div>
        <h1 className="db-hero__title">
          {firstName
            ? <>{t('dashboard.greeting')} <span>{firstName}</span></>
            : tNode('dashboard.greetingBack')}
        </h1>
        {levelChip && (
          <div className="db-chips">
            <div className="db-chip">
              <span className="db-chip__glyph">{levelChip.glyph}</span>
              {levelChip.label}
            </div>
          </div>
        )}

        <div className="db-glance-grid">
          {glanceCards.map((c, i) => (
            <div key={i} className="db-stat-card db-stat-card--glance">
              <div className="db-stat-value">{c.value}</div>
              <div className="db-stat-label">{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* v0.71: one door to every way of adding books — open while the
          shelves are nearly empty, a single button after that. */}
      <AddBooksChooser />

      {/* Quick Actions Permanent Widget   */}
      <QuickActionsWidget go={go} t={t} />

      {/* Sparkle divider */}
      <div className="db-divider">
        <div className="db-divider__mark"><IconSparkle size={13} /></div>
      </div>

      {/* AI quota bar */}
      <AIQuotaBar go={go} t={t} />

      {/* v0.50: level growth nudge — the Oracle notices when your rated
          reading has outgrown your stated level, and asks before changing it. */}
      <LevelNudge state={state} t={t} />

      {/* Widget grid */}
      <div className="db-widgets">
        <button
          className="db-hero__settings"
          onClick={() => { dismissCoachmark('dashboard-customize'); setSettingsOpen(true); }}
          title={t('dashboard.widgetSettingsTitle')}
          aria-label={t('dashboard.widgetSettingsTitle')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {/* v0.46: one-time hint — dashboard customization is easy to miss */}
        <CoachMark
          id="dashboard-customize"
          placement="bottom"
          className="coachmark--dash"
          title={t('coachmark.dashboardTitle')}
          body={t('coachmark.dashboardBody')}
        />
        {layout.filter((w) => w.visible).map((w) => renderWidget(w.id))}
      </div>

      {/* Widget settings */}
      {settingsOpen && (
        <WidgetSettings
          layout={layout}
          onClose={() => setSettingsOpen(false)}
          onChange={setDashboardLayout}
          t={t}
        />
      )}
    </div>
  );
}