// useShelfFilters — the filtering behind the Wishlist and Library shelves.
//
// v0.62. Extracted, not rewritten. Wishlist.jsx and Library.jsx carried
// byte-identical copies of this logic: the same genreFilter/categoryFilter/
// search state, the same two option memos, the same `filtered` memo with its
// filters applied in the same order, and the same resetKey string. Adding the
// advanced filters (pages, prose, depth, author) to both by hand would have
// turned one duplicated block into eight divergent ones.
//
// THIS EXTRACTION IS DELIBERATELY BEHAVIOUR-NEUTRAL.
//
// No new filters, no persistence, no reordering. Same inputs, same outputs,
// same resetKey format — so if a shelf renders differently after this change,
// that is a bug in the extraction and not a new feature interacting with an old
// one. The advanced filters land on top of this, separately. Verifying a
// refactor and reviewing a feature at the same time is how a silent change in
// filtering gets shipped.
//
// See docs/shelf-filters-v1-spec.md.

import { useState, useMemo, useCallback, useEffect } from 'react';

// A filter over a column that is empty is worse than no filter — it reads as a
// broken feature. Each advanced control renders only once its field is present
// on enough of the shelf to do useful work.
const COVERAGE_FLOOR = 0.10; // 10% of the shelf…
const MIN_ABSOLUTE = 5;      // …and at least this many books

// The one inverted page option: 501 means "more than 500", not "at most 501".
const PAGES_OVER = 501;

export const PAGE_OPTIONS = [200, 300, 400, 500, PAGES_OVER];
export const GENDER_OPTIONS = ['female', 'nonbinary', 'mixed', 'male'];
export const LEVELS = [1, 2, 3, 4, 5];

const DEFAULTS = {
  genre: 'all',
  category: 'all',
  pages: 'all',
  gender: 'all',
  complexity: [],
  depth: [],
  includeUnrated: false,
};

function loadPersisted(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...saved,
      // Arrays are the one shape a corrupted or older payload can break on.
      complexity: Array.isArray(saved.complexity) ? saved.complexity : [],
      depth: Array.isArray(saved.depth) ? saved.depth : [],
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * @param {Array}    books                  the shelf — state.wishlist or state.library
 * @param {Object}   deps
 * @param {Object}   deps.genresByBookId    from DataContext state
 * @param {Function} deps.getCategoriesForBook  from useData()
 * @param {string}   deps.storageKey        scopes persistence per shelf
 */
export function useShelfFilters(books, { genresByBookId, getCategoriesForBook, storageKey }) {
  const initial = useMemo(() => (storageKey ? loadPersisted(storageKey) : DEFAULTS), [storageKey]);

  // Search is deliberately NOT persisted. A saved query silently hiding most of
  // the shelf on the next visit is the classic version of this bug — the filter
  // that is hardest to notice is the one you did not set this session.
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState(initial.genre);
  const [category, setCategory] = useState(initial.category);
  const [pages, setPages] = useState(initial.pages);
  const [gender, setGender] = useState(initial.gender);
  const [complexity, setComplexity] = useState(initial.complexity);
  const [depth, setDepth] = useState(initial.depth);
  const [includeUnrated, setIncludeUnrated] = useState(initial.includeUnrated);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ genre, category, pages, gender, complexity, depth, includeUnrated })
      );
    } catch { /* private mode — filters just don't persist */ }
  }, [storageKey, genre, category, pages, gender, complexity, depth, includeUnrated]);

  // --- Genre dropdown options ---
  // Keyed on normalizedName because that is what the filter compares against;
  // `name` is only ever displayed. Counting is retained from the original even
  // though no caller renders the count yet.
  const genreOptions = useMemo(() => {
    const map = new Map();
    for (const b of books) {
      const genres = genresByBookId[b.bookId] || [];
      for (const g of genres) {
        const existing = map.get(g.normalizedName);
        if (existing) existing.count++;
        else map.set(g.normalizedName, {
          name: g.name,
          normalizedName: g.normalizedName,
          count: 1,
          // v0.67 — carried so the picker can group. Null is legitimate: a genre
          // curation has not yet filed. The picker puts those under a fallback
          // heading rather than dropping them, because one of them may hold the
          // only copy of a book on this shelf.
          familySlug: g.familySlug || null,
          familyName: g.familyName || null,
          familySort: g.familySort ?? 999,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [books, genresByBookId]);

  // --- Category dropdown options ---
  // Verified categories sort first, then alphabetical. A category can appear
  // both verified-globally and user-privately; one entry wins and `verified`
  // sticks if either says so.
  const categoryOptions = useMemo(() => {
    const map = new Map();
    for (const b of books) {
      for (const c of getCategoriesForBook(b)) {
        if (!map.has(c.name)) map.set(c.name, { name: c.name, verified: c.verified });
        else if (c.verified) map.get(c.name).verified = true;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [books, getCategoriesForBook]);

  // --- Coverage ---
  // Computed against the UNFILTERED shelf on purpose. Measuring the current
  // result instead would make controls appear and vanish as the reader narrows,
  // which is unusable.
  //
  // Gender uses agChecked, NOT ag. `ag` collapses 'unknown' and never-checked
  // into undefined (bookRowToClient in DataContext.jsx), so a shelf where the
  // Oracle honestly answered "no reliable signal" for 700 books would look
  // identical to one it has never seen. agChecked reads
  // author_gender_checked_at, which is stamped either way.
  const coverage = useMemo(() => {
    const n = books.length || 1;
    const count = (fn) => books.reduce((acc, b) => acc + (fn(b) ? 1 : 0), 0);
    return {
      pages: count((b) => b.pp != null) / n,
      complexity: count((b) => b.c != null) / n,
      depth: count((b) => b.p != null) / n,
      gender: count((b) => b.agChecked) / n,
    };
  }, [books]);

  const available = useMemo(() => {
    const ok = (ratio) => ratio >= COVERAGE_FLOOR && ratio * books.length >= MIN_ABSOLUTE;
    return {
      pages: ok(coverage.pages),
      complexity: ok(coverage.complexity),
      depth: ok(coverage.depth),
      gender: ok(coverage.gender),
    };
  }, [coverage, books.length]);

  // --- Predicates ---
  // Each returns { pass, measured }. Splitting those apart is what lets a null
  // fail *visibly* rather than silently: `measured: false` is the difference
  // between "this book is 900 pages" and "nobody knows how long this book is",
  // and the reader is owed that distinction.
  const advanced = useMemo(() => {
    const tests = [];

    if (pages !== 'all' && available.pages) {
      const max = Number(pages);
      tests.push((b) => ({
        measured: b.pp != null,
        pass: b.pp != null && (max === PAGES_OVER ? b.pp > 500 : b.pp <= max),
      }));
    }
    if (complexity.length > 0 && available.complexity) {
      tests.push((b) => ({ measured: b.c != null, pass: complexity.includes(b.c) }));
    }
    if (depth.length > 0 && available.depth) {
      tests.push((b) => ({ measured: b.p != null, pass: depth.includes(b.p) }));
    }
    if (gender !== 'all' && available.gender) {
      tests.push((b) => ({ measured: !!b.agChecked, pass: b.ag === gender }));
    }
    return tests;
  }, [pages, complexity, depth, gender, available]);

  // --- Filtering ---
  // Order: genre, pages/levels/gender (scalar compares), category (a function
  // call per book), then search (two toLowerCase().includes() per book). Each
  // stage runs on a smaller set than the last. The genre → category → search
  // sequence is unchanged from the original.
  const { filtered, unmeasuredCount } = useMemo(() => {
    let result = books;

    // v0.67 — `family:<slug>` matches any genre on that shelf. "Show me my
    // Horror" is one choice rather than seventeen, and it stays correct as the
    // family gains genres without anyone updating a saved filter.
    if (typeof genre === 'string' && genre.startsWith('family:')) {
      const slug = genre.slice('family:'.length);
      result = result.filter((b) =>
        (genresByBookId[b.bookId] || []).some((g) => g.familySlug === slug)
      );
    } else if (genre !== 'all') {
      result = result.filter((b) => {
        const genres = genresByBookId[b.bookId] || [];
        return genres.some((g) => g.normalizedName === genre);
      });
    }

    // A book fails an advanced filter either because it was measured and did
    // not match, or because it was never measured. Only the second kind is
    // recoverable by the reader, so only the second kind is counted and offered
    // back to them.
    let unmeasured = 0;
    if (advanced.length > 0) {
      result = result.filter((b) => {
        let anyUnmeasured = false;
        for (const test of advanced) {
          const { pass, measured } = test(b);
          if (!measured) { anyUnmeasured = true; continue; }
          if (!pass) return false;
        }
        if (anyUnmeasured) {
          unmeasured++;
          return includeUnrated;
        }
        return true;
      });
    }

    if (category !== 'all') {
      result = result.filter((b) => {
        const cats = getCategoriesForBook(b);
        return cats.some((c) => c.name === category);
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) => b.t.toLowerCase().includes(q) || (b.a || '').toLowerCase().includes(q)
      );
    }
    return { filtered: result, unmeasuredCount: unmeasured };
  }, [books, genre, category, search, advanced, includeUnrated, genresByBookId, getCategoriesForBook]);

  // A stable string that changes whenever any filter changes. usePagedList
  // watches it and snaps the page count back to 1, so the user never sees a
  // half-loaded page left over from a previous filter state.
  //
  // The first three are unchanged from both views' originals; every advanced
  // filter is appended. A filter missing from this string narrows the list
  // without resetting pagination, which leaves a stale "showing N of M" count.
  const resetKey = [
    genre, category, search, pages, gender,
    complexity.join(','), depth.join(','), includeUnrated,
  ].join('|');

  const activeCount =
    (pages !== 'all' ? 1 : 0) +
    (gender !== 'all' ? 1 : 0) +
    (complexity.length > 0 ? 1 : 0) +
    (depth.length > 0 ? 1 : 0);

  const toggleLevel = useCallback((which, level) => {
    const setter = which === 'complexity' ? setComplexity : setDepth;
    setter((prev) => (prev.includes(level) ? prev.filter((v) => v !== level) : [...prev, level]));
  }, []);

  const clearAdvanced = useCallback(() => {
    setPages('all');
    setGender('all');
    setComplexity([]);
    setDepth([]);
    setIncludeUnrated(false);
  }, []);

  return {
    filtered,
    resetKey,
    values: { search, genre, category, pages, gender, complexity, depth, includeUnrated },
    set: {
      search: setSearch,
      genre: setGenre,
      category: setCategory,
      pages: setPages,
      gender: setGender,
      includeUnrated: setIncludeUnrated,
      toggleLevel,
    },
    options: { genres: genreOptions, categories: categoryOptions },
    // Both shelves hide the category dropdown when the shelf has no categories
    // at all, rather than showing a select whose only option is "all".
    hasCategoryFilter: categoryOptions.length > 0,
    available,
    coverage,
    activeCount,
    unmeasuredCount,
    clearAdvanced,
    // If nothing clears the coverage floor there is no panel worth opening —
    // on a fresh, empty shelf the button itself should not exist.
    hasAdvanced: available.pages || available.complexity || available.depth || available.gender,
  };
}

export default useShelfFilters;
