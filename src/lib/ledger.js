// ledger.js — how earned accomplishments become Ledger rows.
//
// Extracted from Profile.jsx so the part with rules in it can be tested without
// mounting a 1,000-line view. Pure: no React, no data fetching.

import { FAMILY_MILESTONES } from './shareMoments';

// Kinds that render as a family ROW rather than as a plaque. A family can earn
// new_family, several family_count rungs and several family_breadth rungs; as
// separate plaques that is one achievement minced into five, which is the
// 835-plaque problem the family ladders were introduced to fix, reappearing one
// level down in the UI.
export const FAMILY_KINDS = ['family_count', 'family_breadth', 'new_family'];

// Kinds retired in v0.67 but never deleted — "earned once, kept forever"
// (reading-accomplishments-v1-spec, rule 3). Displayed, collapsed, never minted.
export const LEGACY_KINDS = ['genre_count', 'new_genre'];

/**
 * Gather every family accomplishment onto one row per family.
 * @returns [{ family: { slug, name, sort }, counts, others }] in shelf order.
 *   counts — family_count entries, ascending by rung (the track)
 *   others — everything else, ascending by date (the aside)
 */
export function groupFamilyAccomplishments(accomplishments = []) {
  const map = new Map();
  for (const a of accomplishments) {
    if (!FAMILY_KINDS.includes(a.kind)) continue;
    const slug = a.meta?.family;
    if (!slug) continue;           // malformed row: skip rather than crash a shelf
    if (!map.has(slug)) {
      map.set(slug, {
        family: {
          slug,
          name: a.meta.familyName || slug,
          // Shelf order, so the Ledger reads in the same order as /genres
          // rather than in whatever order the rows arrived from the server.
          sort: a.meta.familySort ?? 999,
        },
        entries: [],
      });
    }
    map.get(slug).entries.push(a);
  }

  return [...map.values()]
    .map((row) => ({
      family: row.family,
      counts: row.entries
        .filter((e) => e.kind === 'family_count')
        .sort((a, b) => (a.meta?.n || 0) - (b.meta?.n || 0)),
      others: row.entries
        .filter((e) => e.kind !== 'family_count')
        .sort((a, b) => (a.earnedAt < b.earnedAt ? -1 : a.earnedAt > b.earnedAt ? 1 : 0)),
    }))
    .sort((a, b) => a.family.sort - b.family.sort || a.family.name.localeCompare(b.family.name));
}

/**
 * The one rung shown beyond the last earned one — a LABEL, not a destination.
 * Null once the ladder is finished, so a reader who has topped out sees a
 * closed record rather than an open-ended one.
 */
export function nextRung(counts = []) {
  const highest = counts.length ? (counts[counts.length - 1].meta?.n || 0) : 0;
  return FAMILY_MILESTONES.find((r) => r > highest) ?? null;
}
