// publicationYear.mjs — the pure decisions behind books.first_published_year.
//
// No network, no database: imported by publicationYearBackfill.mjs and tested
// directly by tests/publication-year.test.js.
//
// WHY "CORROBORATE", NOT "EARLIEST WINS"
// --------------------------------------
// The first full run (2026-09-30, 5,307 rows written) settled Hardcover-vs-
// OpenLibrary disagreements by taking the earlier year, on the reasoning that a
// reissue can only make a year later. The 423-row conflicts CSV showed that
// reasoning was wrong in a way that matters: BOTH sources carry junk, and the
// junk is not biased towards late.
//
//   OpenLibrary  sentinel-looking early years — Frankenstein 1718, Interview
//                with the Vampire 1672, Peyton Place 1603, Lolita 1777,
//                Hannibal Rising 1837, "1800" and "1900" on dozens of rows.
//   Hardcover    truncated or garbage years — The Screaming Staircase 8, Red
//                Rabbit 20, Picnic at Hanging Rock 1, Lord Edgware Dies 197 —
//                and reissue years (Harry Potter 2016, Little Women 2026).
//
// "Earliest wins" picked the OpenLibrary sentinel or the Hardcover fragment
// every time one was present. So the rule is now agreement: a year is written
// only when two independent sources land within TOLERANCE of each other, and
// Wikidata's P577 is the third source that breaks a tie.

export const TOLERANCE = 3;

// Earliest year anything in this catalog can plausibly claim WITHOUT a second
// source agreeing. The Iliad, Meditations and The Art of War are real, but a
// lone "8" or "197" is a truncated field far more often than it is antiquity.
export const LONE_SOURCE_FLOOR = 1000;

export function plausibleYear(y, now = new Date().getFullYear()) {
  const n = Number(y);
  return Number.isInteger(n) && n !== 0 && n >= -800 && n <= now + 1 ? n : null;
}

/**
 * Decide a year from up to three sources.
 *
 *   decideYear({ hc: 2000, ol: 1996, wd: 1996 })  → { year: 1996, basis: 'ol+wd' }
 *   decideYear({ hc: 2016, ol: 2000, wd: 1997 })  → { year: 1997, basis: 'ol+wd' }
 *   decideYear({ hc: 2026, ol: 1848, wd: 1868 })  → { year: null, basis: 'conflict' }
 *   decideYear({ hc: 1985 })                      → { year: 1985, basis: 'hc' }
 *   decideYear({ hc: 8 })                         → { year: null, basis: 'implausible' }
 *
 * With two or more answers, the largest group that agrees within TOLERANCE
 * wins, and the year written is the earliest IN THAT GROUP — earliest among
 * corroborated values, never among all values. Ties between equally sized
 * groups are a conflict: there is no principled way to pick.
 *
 * A single answer is accepted when it is at or after LONE_SOURCE_FLOOR.
 */
export function decideYear(sources) {
  const entries = Object.entries(sources)
    .map(([k, v]) => [k, plausibleYear(v)])
    .filter(([, v]) => v != null);

  if (!entries.length) return { year: null, basis: 'none' };

  if (entries.length === 1) {
    const [k, v] = entries[0];
    return v >= LONE_SOURCE_FLOOR ? { year: v, basis: k } : { year: null, basis: 'implausible' };
  }

  // Every agreeing group: for each value, the sources in the window
  // [value, value + TOLERANCE]. Windows, not "within TOLERANCE of the anchor",
  // so every member of a group is within TOLERANCE of every other — 1994,
  // 1997 and 2000 are not one group. Keep groups of size >= 2.
  const groups = [];
  for (const [, anchor] of entries) {
    const g = entries.filter(([, v]) => v >= anchor && v - anchor <= TOLERANCE);
    if (g.length >= 2) groups.push(g);
  }
  if (!groups.length) return { year: null, basis: 'conflict' };

  const size = Math.max(...groups.map((g) => g.length));
  const biggest = groups.filter((g) => g.length === size);
  const key = (g) => g.map(([k]) => k).sort().join('+');
  const distinct = [...new Map(biggest.map((g) => [key(g), g])).values()];
  if (distinct.length > 1) {
    // Two different pairs agree internally but not with each other — only
    // possible with 3 sources spread just over TOLERANCE. Could be either.
    // Accept when they overlap enough to share a member and still agree on
    // the earliest value; otherwise refuse.
    const mins = new Set(distinct.map((g) => Math.min(...g.map(([, v]) => v))));
    if (mins.size > 1) return { year: null, basis: 'conflict' };
  }
  const g = distinct[0];
  return { year: Math.min(...g.map(([, v]) => v)), basis: key(g) };
}

/**
 * Year out of a Wikidata time value: "+1954-07-29T00:00:00Z", "-0750-00-00T…".
 * Precision below "year" (decade = 8, century = 7) returns null — "the 1950s"
 * is not a publication year.
 */
export function wikidataYear(value) {
  if (!value || typeof value.time !== 'string') return null;
  if (typeof value.precision === 'number' && value.precision < 9) return null;
  const m = value.time.match(/^([+-])(\d{1,16})-/);
  if (!m) return null;
  const y = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  return plausibleYear(y);
}
