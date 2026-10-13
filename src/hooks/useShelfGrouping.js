// useShelfGrouping — decides how a filtered shelf is sectioned.
//
// Wishlist and Library held byte-identical copies of this, the same way they
// held byte-identical copies of the filter logic before useShelfFilters. One
// place, two callers.
//
// THE RULE: each level of filtering reveals the next level of grouping, and the
// last level has nothing left to group by.
//
//   no genre filter   → group by FAMILY   (16 headings, not 167)
//   family filter     → group by GENRE    (the shape of your Horror)
//   genre filter      → FLAT              (nothing left to say)
//
// The last line is the bug this fixes. Sections were keyed on each book's
// PRIMARY genre, so filtering the shelf to Science Fiction still produced an
// "Adventure" heading — because that was the primary genre of a book that also
// happens to be science fiction. The reader had already said what they wanted;
// re-sorting their answer by a different axis is noise.
//
// Grouping by family when unfiltered is the other half. With 167 genres and a
// 1,500-book shelf, primary-genre sections produced a heading roughly every
// nine books. Sixteen families is a shelf you can take in.
//
// PAGINATION. Callers page over SECTIONS, six at a time, so that each loaded
// section is complete and its count is honest. Flat mode has no sections, so it
// synthesises them: chunks of FLAT_CHUNK books with no label. Paging keeps
// working unchanged, and a filtered 1,500-book shelf does not try to render
// 1,500 covers at once.

import { useMemo } from 'react';

const FLAT_CHUNK = 60;
const UNFILED_LABEL = 'Everything else';

export const FAMILY_PREFIX = 'family:';

/**
 * @param {Array}  filtered           books surviving the filters
 * @param {Object} deps.genresByBookId  from DataContext
 * @param {string} deps.genre            the active genre filter value
 * @param {(b) => string} deps.primaryGenreOf  fallback labeller
 * @returns {{ mode, sections, keys, grouped, labels }}
 */
export function useShelfGrouping(filtered, { genresByBookId, genre, primaryGenreOf }) {
  return useMemo(() => {
    const isFamily = typeof genre === 'string' && genre.startsWith(FAMILY_PREFIX);
    const isGenre = genre && genre !== 'all' && !isFamily;

    // ── FLAT ──────────────────────────────────────────────────────────────────
    if (isGenre) {
      const sections = [];
      for (let i = 0; i < filtered.length; i += FLAT_CHUNK) {
        sections.push({ key: `flat:${i}`, label: null, books: filtered.slice(i, i + FLAT_CHUNK) });
      }
      return toResult('flat', sections);
    }

    // ── GROUPED ───────────────────────────────────────────────────────────────
    // A book lands in exactly one section. Its genres are already sorted by
    // usage_count desc (rollupGenres), so [0] is the broadest shelf it sits on —
    // the same choice getPrimaryGenre makes, applied one level up.
    const buckets = new Map();
    for (const b of filtered) {
      const genres = genresByBookId[b.bookId] || [];
      let key, label, sort;

      if (isFamily) {
        const g = genres.find((x) => x.familySlug === genre.slice(FAMILY_PREFIX.length)) || genres[0];
        key = g?.normalizedName || 'unfiled';
        label = g?.name || primaryGenreOf(b);
        sort = label;
      } else {
        const g = genres.find((x) => x.familySlug) || null;
        key = g?.familySlug || 'unfiled';
        label = g?.familyName || UNFILED_LABEL;
        // Families sort in their curated order; the unfiled bucket always last.
        sort = g ? String(g.familySort ?? 999).padStart(5, '0') : '99999';
      }

      if (!buckets.has(key)) buckets.set(key, { key, label, sort, books: [] });
      buckets.get(key).books.push(b);
    }

    const sections = [...buckets.values()].sort(
      (a, b) => String(a.sort).localeCompare(String(b.sort)) || a.label.localeCompare(b.label)
    );
    return toResult(isFamily ? 'genre' : 'family', sections);
  }, [filtered, genresByBookId, genre, primaryGenreOf]);
}

// Views still speak `grouped[key]` and `keys`, so keep handing them that shape
// rather than rewriting two render trees for a data-structure preference.
function toResult(mode, sections) {
  const grouped = {};
  const labels = {};
  for (const s of sections) { grouped[s.key] = s.books; labels[s.key] = s.label; }
  return { mode, sections, keys: sections.map((s) => s.key), grouped, labels };
}
