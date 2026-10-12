// src/lib/readingStreak.js — the Dashboard "Reading streak" number.
//
// A streak is a run of consecutive CALENDAR MONTHS in which the reader finished
// at least one book. Months, not days: reading a book takes days, so a daily
// streak would break for every reader every week.
//
// The current month is a grace period, not a gap. On the 1st of the month nobody
// has finished anything yet "this month", and counting that as a break showed a
// reader with eight straight months a streak of 0 until their next finish. So:
// if this month has a finish it counts; if it doesn't YET, the run is measured
// from last month and is still alive. Only a missing *completed* month breaks it.
//
// See docs/MATH.md → "Reading streak".

/** Month key for a Date in the reader's local calendar, e.g. "2026-10". */
function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The month key `offset` months before `date` (offset 0 = date's own month). */
function monthKeyBefore(date, offset) {
  return monthKeyOf(new Date(date.getFullYear(), date.getMonth() - offset, 1));
}

/**
 * Count the reader's monthly reading streak.
 *
 * @param {Array<{dateRead?: string}>} library  finished books; `dateRead` is an
 *        ISO date ("YYYY-MM-DD…"). Books without one are ignored.
 * @param {Date} [now=new Date()]  injectable for tests
 * @returns {{ months: number, includesCurrentMonth: boolean, lastFinishedOn: string|null }}
 *   `months` — length of the run (0 when the last completed month had no finish);
 *   `includesCurrentMonth` — whether this month already has a finish (false means
 *   the streak is alive but the reader still needs a finish before the month ends);
 *   `lastFinishedOn` — the most recent `dateRead`, or null.
 */
export function monthlyReadingStreak(library, now = new Date()) {
  const dates = (library || []).map((b) => b?.dateRead).filter(Boolean).sort();
  const lastFinishedOn = dates.length ? dates[dates.length - 1] : null;
  const monthsWithAFinish = new Set(dates.map((d) => String(d).slice(0, 7)));

  const includesCurrentMonth = monthsWithAFinish.has(monthKeyBefore(now, 0));
  let offset = includesCurrentMonth ? 0 : 1;
  let months = 0;
  while (monthsWithAFinish.has(monthKeyBefore(now, offset))) {
    months += 1;
    offset += 1;
  }
  return { months, includesCurrentMonth, lastFinishedOn };
}

/** Visual temperature of a streak, used for the number's colour modifier. */
export const STREAK_WARM_MONTHS = 3;
export const STREAK_HOT_MONTHS = 6;

/**
 * @param {number} months
 * @returns {'cold'|'warm'|'hot'}
 */
export function streakTemperature(months) {
  if (months >= STREAK_HOT_MONTHS) return 'hot';
  if (months >= STREAK_WARM_MONTHS) return 'warm';
  return 'cold';
}
