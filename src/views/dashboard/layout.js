// src/views/dashboard/layout.js — which widgets the Dashboard shows, in what order.
// The saved layout lives in state.dashboardLayout (null = DEFAULT_DASHBOARD_LAYOUT).

// ─── Default widget layout ────────────────────────────────────────────────────
export const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'currently-reading', visible: true },
  { id: 'oracle-spark', visible: true },
  { id: 'quick-actions', visible: true },
  { id: 'reading-stats', visible: true },
  { id: 'reading-goal', visible: true },
  { id: 'series-progress', visible: true },
  { id: 'streak', visible: true },
  { id: 'plans', visible: true },
  { id: 'clubs', visible: true },
  { id: 'friends-feed', visible: true },
  { id: 'feed', visible: true },
];

export function resolveLayout(saved) {
  if (!saved || !Array.isArray(saved)) return DEFAULT_DASHBOARD_LAYOUT;
  const savedIds = new Set(saved.map((w) => w.id));
  const merged = [...saved];
  for (const w of DEFAULT_DASHBOARD_LAYOUT) {
    if (!savedIds.has(w.id)) merged.push({ ...w });
  }
  return merged;
}

// ─── Widget Settings ──────────────────────────────────────────────────────────
export const WIDGET_LABELS = {
  'currently-reading': 'widgetCurrentlyReading',
  'oracle-spark': 'widgetSpark',
  'quick-actions': 'widgetQuickActions',
  'reading-stats': 'widgetStats',
  'reading-goal': 'widgetGoal',
  'series-progress': 'widgetSeries',
  'streak': 'widgetStreak',
  'plans': 'widgetPlans',
  'clubs': 'widgetClubs',
  'friends-feed': 'widgetFriendsFeed',
  'feed': 'widgetMyFeed',
};
