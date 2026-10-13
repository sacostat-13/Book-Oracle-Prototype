// src/contexts/data/rollups.js — view rows → the { bookId: [...] } maps in state.

// v0.12: take a list of book_categories_view rows (with bookId + category
// fields) and roll them up into the { bookId → [categories] } shape used
// in state. Dedupes by category_id within each book — a category can appear
// in both the verified-global and user-private rows; we keep one entry but
// prefer 'verified' as the source for the pill style.
export function rollupCategories(rows) {
  const map = {};
  for (const r of rows || []) {
    const bookId = r.book_id;
    if (!bookId) continue;
    if (!map[bookId]) map[bookId] = {};
    const existing = map[bookId][r.category_id];
    const incoming = {
      categoryId: r.category_id,
      name: r.category_name,
      verified: r.verified,
      usageCount: r.usage_count,
      source: r.source, // 'verified' | 'user'
    };
    // If we already have this category for this book, prefer 'verified'
    // source over 'user' (the verified pill style wins).
    if (existing) {
      if (existing.source === 'user' && incoming.source === 'verified') {
        map[bookId][r.category_id] = incoming;
      }
    } else {
      map[bookId][r.category_id] = incoming;
    }
  }
  // Convert inner objects → arrays, sorted verified-first then alphabetical.
  const out = {};
  for (const bookId of Object.keys(map)) {
    out[bookId] = Object.values(map[bookId]).sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
}

// v0.15 phase 2.3: roll up book_genres_view rows into { bookId → [genres] }.
// Each genre row: { genreId, name, normalizedName, source, usageCount, description, assignedBySource }.
// Sorted by usage_count desc then alpha — most-used genres surface first.
export function rollupGenres(rows) {
  const map = {};
  for (const r of rows) {
    const key = r.book_id;
    if (!map[key]) map[key] = {};
    const gKey = r.genre_id;
    if (!map[key][gKey]) {
      map[key][gKey] = {
        genreId: r.genre_id,
        name: r.genre_name,
        normalizedName: r.normalized_name,
        source: r.genre_source,
        usageCount: r.usage_count,
        description: r.genre_description || null,
        assignedBySource: r.assigned_by_source,
        // v0.67 — the browsing axis. Null until curation assigns a family, which
        // is the state every Oracle-invented genre is born in; the UI groups
        // those under a fallback heading rather than dropping them.
        familySlug: r.family_slug || null,
        familyName: r.family_name || null,
        familySort: r.family_sort ?? 999,
      };
    }
  }
  const out = {};
  for (const bookId of Object.keys(map)) {
    out[bookId] = Object.values(map[bookId]).sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
}

// ---------- Supabase loaders ----------
