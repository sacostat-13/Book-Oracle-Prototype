// Pagination helpers for PostgREST queries that can exceed the row cap.
//
// WHY THIS EXISTS
// Supabase/PostgREST enforces a server-side `max-rows` limit (1000 by default).
// A query returning more rows is SILENTLY truncated — no error, no warning,
// no indication in the response. A 1170-item wishlist loaded as exactly 1000
// items on every fresh page load; the missing 170 were in the DB the whole time.
//
// Any query whose result set can grow without bound must page. This includes
// RPCs: `returns setof` functions go through PostgREST and are capped identically.
//
// Helpers return the same `{ data, error }` shape as a Supabase query so they
// drop into existing call sites (including Promise.all) without reshaping.

const PAGE_SIZE = 1000;

/**
 * Page a PostgREST query to completion.
 *
 * @param {() => object} buildQuery  Factory returning a FRESH query builder on
 *   every call — builders are single-use. The query MUST carry a stable
 *   .order(); without a deterministic sort, rows can be dropped or duplicated
 *   across page boundaries.
 * @returns {Promise<{data: any[], error: any}>}
 */
export async function fetchAllRows(buildQuery, { pageSize = PAGE_SIZE, maxPages = 50 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
  console.warn(`[supabasePaging] hit maxPages (${maxPages}) — result may be truncated at ${all.length} rows`);
  return { data: all, error: null };
}

/**
 * Page an RPC that accepts p_limit / p_offset.
 * @returns {Promise<{data: any[], error: any}>}
 */
export async function fetchAllRpc(supabase, fnName, args = {}, { pageSize = PAGE_SIZE, maxPages = 50 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await supabase.rpc(fnName, {
      ...args,
      p_limit: pageSize,
      p_offset: page * pageSize,
    });
    if (error) return { data: all, error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
  console.warn(`[supabasePaging] ${fnName} hit maxPages (${maxPages}) — truncated at ${all.length} rows`);
  return { data: all, error: null };
}
