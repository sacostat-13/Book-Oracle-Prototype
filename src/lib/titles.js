// src/lib/titles.js — v0.51
//
// Reader Titles: the app-granted rank ladder. A title can ONLY be earned by
// reading — there is no way to type one in — which is exactly what makes
// wearing one mean something. The reader picks WHICH earned title to display
// (profile.preferences.displayTitle); the app decides which are earned.
//
// Pure logic + one Supabase helper:
//   - TITLE_TIERS / isTierEarned / earnedTierKeys / highestTierKey — the
//     ladder, driven by total books read (library length).
//   - sanitizeTitleKey — viewers trust preferences.displayTitle, but only
//     known tier keys ever render; anything else displays as no title.
//   - fetchTitlesByUserId — batch-load other readers' titles for surfaces
//     where rows only carry a user id (club members, discussion comments).
//
// Labels live in i18n (`titles.<key>`), EN/ES like everything user-facing.

import { supabase } from './supabase';

// Thresholds are total books read. Early wins come fast (1, 5); the top of
// the ladder is a reading life, not a reading year. The 250 tier bridges the
// long silence between 100 and 500 so heavy readers always have a next rung
// in sight — and lifelong readers land mid-ladder instead of maxed out.
export const TITLE_TIERS = [
  { key: 'initiate',  threshold: 1 },
  { key: 'seeker',    threshold: 5 },
  { key: 'scribe',    threshold: 15 },
  { key: 'archivist', threshold: 30 },
  { key: 'keeper',    threshold: 60 },
  { key: 'voice',     threshold: 100 },
  { key: 'sage',      threshold: 250 },
  { key: 'warden',    threshold: 500 },
  { key: 'library',   threshold: 1000 },
];

const TIER_KEYS = new Set(TITLE_TIERS.map((tier) => tier.key));

export function isTierEarned(key, booksRead) {
  const tier = TITLE_TIERS.find((t) => t.key === key);
  return !!tier && (booksRead || 0) >= tier.threshold;
}

export function earnedTierKeys(booksRead) {
  return TITLE_TIERS.filter((t) => (booksRead || 0) >= t.threshold).map((t) => t.key);
}

export function highestTierKey(booksRead) {
  const earned = earnedTierKeys(booksRead);
  return earned.length > 0 ? earned[earned.length - 1] : null;
}

// Only known tier keys render — a hand-edited preferences blob can't invent
// "Grand Admiral of Books"; it just displays as no title.
export function sanitizeTitleKey(key) {
  return TIER_KEYS.has(key) ? key : null;
}

// The i18n label for a tier key (or null). Callers pass their t().
export function titleLabel(key, t) {
  const k = sanitizeTitleKey(key);
  return k ? t(`titles.${k}`) : null;
}

// Batch: user ids -> displayed title key (sanitized). One query, one map.
// Used by club member lists and discussion threads, whose rows carry only
// created_by / user_id. Returns {} on any failure — titles are decoration,
// never worth breaking a page over.
export async function fetchTitlesByUserId(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, preferences')
    .in('id', ids);
  if (error) {
    console.warn('fetchTitlesByUserId failed — rendering without titles', error);
    return {};
  }
  const map = {};
  for (const p of data || []) {
    const key = sanitizeTitleKey(p.preferences?.displayTitle);
    if (key) map[p.id] = key;
  }
  return map;
}
