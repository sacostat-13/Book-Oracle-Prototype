// src/views/dashboard/feed.js — the reader's own activity feed: events built from
// the shelves (finished, started, wishlisted, Passages) and how they are dated.

import { bookKey } from '../../lib/book/bookHelpers';

export const FEED_PAGE_SIZE = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function dayKey(d) { return d ? new Date(d).toISOString().slice(0, 10) : 'x'; }

export function relativeDay(dateStr, t) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (diff === 0) return t('dashboard.today');
  if (diff === 1) return t('dashboard.yesterday');
  if (diff < 7) return t('dashboard.daysAgo', { count: diff });
  if (diff < 30) return t('dashboard.weeksAgo', { count: Math.floor(diff / 7) });
  return t('dashboard.monthsAgo', { count: Math.floor(diff / 30) });
}

export function buildFeed(state) {
  const events = [];
  const lib = state.library || [];
  const wl = state.wishlist || [];
  const plans = state.plans || [];

  for (const b of lib) {
    if (b.dateRead) events.push({ type: 'finished', date: b.dateRead, book: b, key: 'f-' + bookKey(b) });
    if (b.startedAt) events.push({ type: 'started', date: b.startedAt, book: b, key: 's-' + bookKey(b) });
  }
  for (const b of state.currentlyReading || []) {
    if (b.startedAt) events.push({ type: 'started', date: b.startedAt, book: b, key: 'cs-' + bookKey(b) });
  }
  // Group wishlist additions by day
  const byDay = {};
  for (const b of wl) {
    if (b.addedAt) { const k = dayKey(b.addedAt); (byDay[k] = byDay[k] || { date: b.addedAt, books: [] }).books.push(b); }
  }
  for (const [k, { date, books }] of Object.entries(byDay)) {
    events.push({ type: 'wishlisted', date, books, key: 'w-' + k });
  }
  for (const p of plans) {
    if (p.createdAt) events.push({ type: 'plan', date: p.createdAt, plan: p, key: 'p-' + (p._id || p.createdAt) });
  }
  return events.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ─── Activity Feed ─────────────────────────────────────────────────────────────
export const FEED_CFG = {
  finished: { char: '<svg data-dc-tpl="879" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ro-forest)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path data-dc-tpl="880" d="M20 6 9 17l-5-5"></path></svg>', label: 'finished' },
  started: { char: '<svg data-dc-tpl="879" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ro-gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path data-dc-tpl="880" d="M12 7v14M3 18V5a2 2 0 0 1 2-2h6v15H5a2 2 0 0 0-2 2M21 18V5a2 2 0 0 0-2-2h-6v15h6a2 2 0 0 1 2 2"></path></svg>', label: 'started' },
  wishlisted: { char: '<svg data-dc-tpl="879" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ro-burgundy)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path data-dc-tpl="880" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"></path></svg>', label: 'wishlisted' },
  plan: { char: '✦', label: 'plan' },
};
