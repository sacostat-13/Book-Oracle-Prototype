// genreService.js — public reads for the genre and family pages.
//
// These pages must be CORRECT WHEN LOGGED OUT. That is the whole constraint:
// a page that needs a session renders empty for a crawler, and an empty page is
// the one Search Console declined to index in August. So everything here reads
// tables that are public — `genres`, `genre_families` and `book_genres_view`
// are all granted to anon — and nothing here touches user state.

import { supabase } from './supabase';

// One page of the wall. The genre page is a browse surface like The Stacks —
// you scroll, you press More, you keep going — so this is a page size, not a
// ceiling. The old 24-with-a-120-pool capped the shelf at 120 books no matter
// how large the genre was, which quietly hid most of Fantasy.
export const GENRE_PAGE_SIZE = 20;

// Hard ceiling on the id fetch. Ids are one uuid column, so even the largest
// family shelf is a small payload — but a runaway query should still stop.
const MAX_SHELF = 3000;

// Below this a genre page is real but not worth advertising: it is precisely
// the thin page a crawler judges and declines. Reachable and linked, `noindex`,
// out of the sitemap. Mirrors the floor the families spec sets for badges.
export const INDEX_FLOOR = 5;

// ── The daily shuffle ─────────────────────────────────────────────────────────
//
// A reader returning to Folk Horror should find something new. A page that
// reorders on every request is one a crawler cannot form an opinion about, and
// it defeats the prerender cache.
//
// So the seed is the genre plus the DAY: everyone sees the same order today, a
// different one tomorrow. The prerendered HTML and the client render agree, so
// nothing reshuffles under the reader on hydration; the cache stays valid for a
// day; and across a week the internal link graph surfaces far more of the
// catalogue than a fixed list ever would.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10); // UTC, so every viewer agrees
}

export function dailyShuffle(items, seedKey, now = new Date()) {
  // Nothing to rotate. A genre whose whole shelf fits on the first page and
  // reorders daily reads as broken rather than fresh, so leave short lists
  // alone.
  if (!Array.isArray(items) || items.length <= GENRE_PAGE_SIZE) return items || [];

  let state = hashSeed(`${seedKey}:${dayStamp(now)}`);
  const rand = () => {
    // xorshift32 — deterministic from the seed, adequate for shuffling covers.
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

// Families with the number of genres on each. Powers /genres.
export async function fetchFamilies() {
  const [{ data: fams, error: fe }, { data: genres, error: ge }] = await Promise.all([
    supabase.from('genre_families').select('id, slug, name, description, sort_order').order('sort_order'),
    supabase.from('genres').select('id, family_id, usage_count'),
  ]);
  if (fe) { console.warn('[genreService] families:', fe.message); return []; }
  if (ge) { console.warn('[genreService] genres:', ge.message); }

  const counts = new Map();
  for (const g of genres || []) {
    if (!g.family_id) continue;
    const c = counts.get(g.family_id) || { genres: 0, books: 0 };
    c.genres += 1;
    c.books += g.usage_count || 0;
    counts.set(g.family_id, c);
  }
  return (fams || []).map((f) => ({
    ...f,
    genreCount: counts.get(f.id)?.genres || 0,
    bookCount: counts.get(f.id)?.books || 0,
  }));
}

// One family plus every genre on it, most-used first.
export async function fetchFamily(slug) {
  const { data: fam, error } = await supabase
    .from('genre_families')
    .select('id, slug, name, description, sort_order')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !fam) return null;

  const { data: genres } = await supabase
    .from('genres')
    .select('id, name, normalized_name, description, usage_count, parent_id')
    .eq('family_id', fam.id)
    .order('usage_count', { ascending: false })
    .order('name');

  return { ...fam, genres: genres || [] };
}

// One genre, its family, and its siblings on that family — the siblings are the
// internal link graph the crawler follows, so they are part of the page, not a
// nicety.
export async function fetchGenre(normalizedName) {
  const { data: genre, error } = await supabase
    .from('genres')
    .select('id, name, normalized_name, description, usage_count, family_id, parent_id, genre_families ( slug, name, description )')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
  if (error || !genre) return null;

  let siblings = [];
  if (genre.family_id) {
    const { data } = await supabase
      .from('genres')
      .select('name, normalized_name, usage_count')
      .eq('family_id', genre.family_id)
      .neq('id', genre.id)
      .order('usage_count', { ascending: false })
      .limit(24);
    siblings = data || [];
  }
  return { ...genre, family: genre.genre_families || null, siblings };
}

// Books on a genre's shelf. Covered books first — a cover wall with holes in it
// reads as broken — then the daily shuffle over the pool.
// The ordered id list for a genre's shelf, shuffled for the day.
//
// Ids first, rows later, on purpose: the ORDER has to be stable across pages or
// pressing More would re-roll the shuffle and show duplicates. Fetching every id
// once (one uuid column) and shuffling that list gives one deterministic
// ordering the whole session pages through.
export async function fetchGenreShelf(genreId, seedKey) {
  const ids = [];
  const PAGE = 1000;
  for (let from = 0; from < MAX_SHELF; from += PAGE) {
    const { data, error } = await supabase
      .from('book_genres')
      .select('book_id')
      .eq('genre_id', genreId)
      .order('book_id')          // stable base order, so the shuffle is the only randomness
      .range(from, from + PAGE - 1);
    if (error) { console.warn('[genreService] shelf ids:', error.message); break; }
    ids.push(...(data || []).map((r) => r.book_id).filter(Boolean));
    if (!data || data.length < PAGE) break;
  }
  return dailyShuffle(ids, seedKey || String(genreId));
}

// Hydrate one page of ids into book rows.
//
// TWO QUERIES, NOT AN EMBED. The first version of this asked book_genres_view
// for `books:book_id ( ... )` and got nothing back, for two reasons at once:
//
//   1. book_genres_view is a VIEW, and PostgREST resolves an embed from a
//      FOREIGN KEY. A view carries none, so the embed cannot be built. This is
//      the same trap that forced oracleBatch to hydrate from `books` rather
//      than select whole rows from books_needing_curation, and it is worth
//      stating plainly because it will happen a third time:
//      **never embed off a view.**
//   2. It asked for `share_key`, which is not a column on `books` at all — it
//      is computed by the books_share_key VIEW. The app does not need it
//      either: bookKey() derives the same key from title + author on the
//      client, which is what every other in-app book link already does.
export async function fetchBooksByIds(ids) {
  if (!ids || !ids.length) return [];
  // Chunked for the same reason every other .in() in this codebase is: a URL
  // carrying 100 UUIDs is rejected long before Postgres sees it.
  const CHUNK = 50;
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('books')
      .select('id, title, author, cover_url')
      .in('id', ids.slice(i, i + CHUNK));
    if (error) { console.warn('[genreService] books:', error.message); continue; }
    rows.push(...(data || []));
  }
  // Restore the shuffled order — `.in()` returns rows in whatever order Postgres
  // likes, which would undo the shuffle and make paging look random.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((b) => b && b.title);
  // Covered books first WITHIN the page. Not globally: sorting the whole shelf
  // by cover would push every uncovered book to a last page nobody reaches.
  return [...ordered.filter((b) => b.cover_url), ...ordered.filter((b) => !b.cover_url)];
}
