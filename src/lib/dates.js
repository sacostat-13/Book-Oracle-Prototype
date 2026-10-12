// src/lib/dates.js — date helpers that respect the reader's local calendar.
//
// `new Date('2026-10-05')` is parsed as UTC midnight, which in Costa Rica
// (UTC-6) is 18:00 on Oct 4 — so a book finished on the 5th was displayed as
// finished on the 4th. Postgres `date` columns (read_books.read_at and friends)
// arrive as bare "YYYY-MM-DD" strings, so anything that displays one must parse
// it as a local calendar day. Use parseIsoDate for that.

/**
 * Parse an ISO date or timestamp. A bare "YYYY-MM-DD" becomes local midnight of
 * that calendar day; anything longer is handed to `Date` unchanged.
 *
 * @param {string | null | undefined} value
 * @returns {Date | null} null for empty or unparseable input
 */
export function parseIsoDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
