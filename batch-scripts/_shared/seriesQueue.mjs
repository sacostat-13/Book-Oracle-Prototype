// seriesQueue.mjs — what the --stale queue serves next, and in what order.
//
// THE BUG THIS EXISTS FOR
//
// 2026-09-15. The first sort key was a BOOLEAN:
//
//   Number(a.volumes_checked_at != null) - Number(b.volumes_checked_at != null)
//
// never-examined before examined, which is the ordering argued for on
// 2026-09-10 and still the right first question. But it only distinguishes null
// from not-null. Once the queue had been round once and 409 of 410 series
// carried a stamp, that term was 0 for every pair and the order collapsed onto
// TOP_SERIES rank and shelf size — both STATIC.
//
// So every run served the same head of the queue. Wicked, Marvel Zombies and The
// Godfather opened the 09-12, 09-13 and 09-14 runs; 60 of the 238 distinct
// series seen across four runs appeared in three or more of them. Each repeat is
// a Hardcover request paid again and a block of CSV rows reviewed again, while
// the series behind them were never reached at all.
//
// This is why it lives in its own file with a test: the defect is not visible in
// one call. Every single ordering was correct. Only the sequence of runs was
// wrong, so the test that catches it has to simulate several runs and assert
// that the queue rotates.

/**
 * When a series was last looked at, as a sortable number.
 * Never examined is 0, which is before any real timestamp — so a series nobody
 * has ever looked at still wins outright, per the 2026-09-10 argument that a
 * first look establishes the facts everything downstream depends on.
 * An unparseable stamp is treated as never examined: being looked at twice is
 * cheaper than never being looked at again.
 */
export const lastSeen = (r) => {
  if (!r || !r.volumes_checked_at) return 0;
  const t = Date.parse(r.volumes_checked_at);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Order the pending series for a --stale run.
 *
 * @param pending  rows from series_completeness with { name, series_id, held, volumes_checked_at }
 * @param demandRank Map of normalised series name -> rank (lower is more wanted)
 * @param normalise  the same name normalisation the rest of the script uses
 *
 * Least recently looked at first, then demand, then the bigger shelf. Demand
 * keeps its job as the tiebreak WITHIN a cohort: a whole run is stamped with one
 * timestamp, so series examined together stay ordered by demand relative to each
 * other, and the cohort as a whole moves to the back.
 */
export function orderStaleQueue(pending, demandRank = new Map(), normalise = (s) => s) {
  return (pending || []).slice().sort((a, b) =>
    (lastSeen(a) - lastSeen(b)) ||
    ((demandRank.get(normalise(a.name)) ?? 999) - (demandRank.get(normalise(b.name)) ?? 999)) ||
    ((b.held ?? 0) - (a.held ?? 0))
  );
}
