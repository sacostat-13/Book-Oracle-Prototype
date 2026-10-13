// src/contexts/data/load.js — reading a signed-in reader's data from Supabase,
// and writing their preferences back.
//
// loadFromSupabase() reads every table in parallel and returns a complete `state`.
// It THROWS when a shelf query fails rather than returning an empty shelf — see
// the long note inside it; that rule is why a failed load is never cached.
// Moved out of DataContext.jsx in Sprint 4 with behaviour unchanged.

import { supabase } from '../../lib/api/supabase';
import { fetchAllRows } from '../../lib/api/supabasePaging';
import { bookKey } from '../../lib/book/bookHelpers';
import { bookRowToClient } from '../../lib/book/bookRow';
import { fetchMyLists } from '../../lib/api/listsApi';
import { fetchMyClubs } from '../../lib/api/clubsApi';
import { dedupeBooks } from './cache';
import { rollupCategories, rollupGenres } from './rollups';
import { defaultState } from './defaults';

/**
 * Run a query that names a column added by a migration, and fall back to a
 * query that does not if the column is not there yet.
 *
 * v0.65.1, written the day after this exact failure shipped. Adding
 * `progress_minutes` to the currently_reading select made the whole query fail
 * on any database where 20260820120000 had not been applied — PostgREST
 * answers `column ... does not exist` — and because that result is consumed as
 * `(res.data || [])`, four books rendered as an empty shelf. Not an error, not
 * a spinner: an empty state, which reads as "you are not reading anything"
 * rather than "the app could not ask".
 *
 * The lesson had already been learnt one commit earlier, in
 * originalLanguageBackfill.mjs, where detectStampColumn() exists for the same
 * reason and says so at length. It was applied to the batch script and not to
 * the app, which is the half a reader can see.
 *
 * A schema mismatch between a deployed bundle and a database is not an edge
 * case here — it is the NORMAL state for the minutes between a deploy and a
 * migration, and for a developer who pulls before applying. Degrading to the
 * old shape and saying so is the behaviour that fits.
 */
export async function selectTolerant(run, runWithout, column) {
  const res = await run();
  if (!res?.error) return res;
  if (!new RegExp(column).test(res.error.message || '')) return res;
  console.warn(
    `[schema] ${column} is missing — falling back to the previous query shape. ` +
    'Apply the pending migration; until then this column reads as null.',
    res.error.message
  );
  return runWithout();
}

// currently_reading, with and without the audiobook column.
export const CR_TAIL = 'book:books(*, position_in_series, series:series(*))';

export const CR_COLS = `started_at, pages_read, user_page_count, progress_minutes, ${CR_TAIL}`;

export const CR_COLS_PRE_AUDIO = `started_at, pages_read, user_page_count, ${CR_TAIL}`;

// reader_editions, likewise. This one already degraded to {} on error, which
// is correct for a missing TABLE and wrong for a missing column: it would have
// thrown away every recorded edition — page counts, languages, translators —
// over two columns nobody had migrated yet.
export const RE_COLS = 'book_id, language, isbn, edition_title, translator, page_count, format, source, duration_minutes, narrator';

export const RE_COLS_PRE_AUDIO = 'book_id, language, isbn, edition_title, translator, page_count, format, source';

export async function loadFromSupabase(userId) {
  const [profileRes, wishlistRes, readBooksRes, plansRes, currentlyReadingRes, memoriesRes, accomplishmentsRes, editionsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    // v0.48: paged. PostgREST caps any single response at `max-rows` (1000) and
    // truncates SILENTLY — a 1170-item wishlist loaded as 1000 on every visit.
    // Both queries carry an explicit stable sort so page boundaries are safe.
    fetchAllRows(() =>
      supabase
        .from('wishlist_items')
        .select('id, added_at, notes, book:books(*, position_in_series, series:series(*))')
        .eq('user_id', userId)
        .order('added_at', { ascending: true })
        .order('id', { ascending: true })
    ),
    fetchAllRows(() =>
      supabase
        .from('read_books')
        .select('id, rating, notes, read_at, source, book:books(*, position_in_series, series:series(*))')
        .eq('user_id', userId)
        .order('read_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
    ),
    supabase
      .from('plans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    selectTolerant(
      () => supabase.from('currently_reading').select(CR_COLS).eq('user_id', userId),
      () => supabase.from('currently_reading').select(CR_COLS_PRE_AUDIO).eq('user_id', userId),
      'progress_minutes'
    ),
    // v0.44: reading memories — one flat query, keyed by book_id client-side
    supabase
      .from('reading_memories')
      .select('id, book_id, kind, body, pages_at, pct_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    // v0.45: reading accomplishments — flat ledger, newest first
    supabase
      .from('reading_accomplishments')
      .select('id, key, kind, book_id, meta, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false }),
    // v0.65: the reader's own editions (migration 20260818120000). Owner-only
    // RLS, so this returns this reader's rows and nothing else without the
    // query having to say so.
    selectTolerant(
      () => supabase.from('reader_editions').select(RE_COLS).eq('user_id', userId),
      () => supabase.from('reader_editions').select(RE_COLS_PRE_AUDIO).eq('user_id', userId),
      'duration_minutes'
    ),
  ]);

  // v0.65: reader editions by book_id.
  //
  // Degrades to {} on failure exactly like memories below, and that matters
  // more here than it looks: effectivePages() falls back to the catalog page
  // count, so a failed load means progress bars read slightly wrong for one
  // session rather than the shelf failing to open.
  //
  // It also degrades to {} when the migration has not been applied yet, since
  // PostgREST answers an unknown table with an error rather than throwing.
  const editionsByBookId = {};
  if (editionsRes?.error) {
    console.warn('reader_editions load failed — continuing without editions', editionsRes.error);
  } else {
    for (const e of (editionsRes?.data || [])) editionsByBookId[e.book_id] = e;
  }

  // v0.44: group memories by book_id (newest first, from the query order).
  // A failed query degrades to "no memories" — never blocks the main load.
  const memories = {};
  if (memoriesRes.error) {
    console.warn('reading_memories load failed — continuing without memories', memoriesRes.error);
  } else {
    for (const m of (memoriesRes.data || [])) {
      (memories[m.book_id] = memories[m.book_id] || []).push({
        id: m.id,
        kind: m.kind,
        body: m.body,
        pagesAt: m.pages_at,
        pctAt: m.pct_at,
        createdAt: m.created_at,
      });
    }
  }

  // v0.45: reading accomplishments — flat array, newest first (query order).
  // A failed query degrades to "no ledger" — never blocks the main load.
  let accomplishments = [];
  if (accomplishmentsRes.error) {
    console.warn('reading_accomplishments load failed — continuing without ledger', accomplishmentsRes.error);
  } else {
    accomplishments = (accomplishmentsRes.data || []).map((a) => ({
      id: a.id,
      key: a.key,
      kind: a.kind,
      bookId: a.book_id,
      meta: a.meta || {},
      earnedAt: a.earned_at,
    }));
  }

  // Lists and clubs degrade to [] on failure (logged): neither may block the
  // shelves. Mapping lives in lib/api/listsApi.js and clubsApi.js.
  const lists = await fetchMyLists(userId);
  const clubs = await fetchMyClubs(userId);

  const profile = profileRes.data || {};
  const wishlist = (wishlistRes.data || [])
    .map((r) =>
      r.book
        ? bookRowToClient(r.book, {
            notes: r.notes || undefined,
            addedAt: r.added_at,
            _id: r.id,
          })
        : null
    )
    .filter(Boolean);
  const library = (readBooksRes.data || [])
    .map((r) =>
      r.book
        ? bookRowToClient(r.book, {
            rating: r.rating || undefined,
            notes: r.notes || undefined,
            dateRead: r.read_at || undefined,
            fromGoodreads: r.source === 'goodreads_import',
            _id: r.id,
          })
        : null
    )
    .filter(Boolean);
  const plans = (plansRes.data || []).map((r) => ({
    ...(r.content || {}),
    _id: r.id,
    title: r.title,
    createdAt: r.created_at,
  }));
  const currentPlan = plans[0] || null;

  // A FAILED SHELF QUERY MUST NOT BE RETURNED AS AN EMPTY SHELF.
  //
  // This is the defect the progress_minutes mistake exposed, and it is much
  // worse than the mistake was. loadFromSupabase did not throw when a shelf
  // query errored — it returned a state object with `currentlyReading: []`,
  // because every result is consumed as `(res.data || [])`. The caller has no
  // way to tell that apart from a reader who genuinely has nothing on the go,
  // so it did what it does with any successful load:
  //
  //   supabaseLoadedRef.current = true;   // "this is real data now"
  //   setState(remote);                   // renders the empty shelf
  //   saveSessionCache(user.id, remote);  // caches the empty shelf, 30 min
  //   saveLocal(state);                   // and writes it to localStorage
  //
  // So one failed request became a persistent empty shelf that survived
  // reloading, survived fixing the actual cause, and could only be cleared by
  // closing the tab — sessionStorage does not die on F5. A transient failure
  // was laundered into cached truth.
  //
  // Throwing puts it back on the path that already handles this correctly: the
  // caller catches, falls back to localStorage, and crucially does NOT set
  // supabaseLoadedRef, so nothing is persisted and the next load tries again.
  //
  // Only the shelves. memories, accomplishments and reader_editions degrade to
  // empty on purpose and say so where they do it — losing those costs a
  // progress bar's precision, not a reader's library.
  const shelfFailures = [
    ['currently_reading', currentlyReadingRes],
    ['wishlist_items', wishlistRes],
    ['read_books', readBooksRes],
    ['plans', plansRes],
  ].filter(([, res]) => res?.error);

  if (shelfFailures.length) {
    const detail = shelfFailures.map(([name, res]) => `${name}: ${res.error.message}`).join('; ');
    throw new Error(
      `Shelf load failed, refusing to cache an empty library. A missing column here is ` +
      `usually a migration that has not been applied — or applied to a different project ` +
      `than .env.local points at, or applied without PostgREST reloading its schema ` +
      `cache. ${detail}`
    );
  }

  const currentlyReading = (currentlyReadingRes.data || [])
    .map((r) =>
      r.book
        ? bookRowToClient(r.book, {
            startedAt: r.started_at,
            pagesRead: r.pages_read ?? 0,
            userPageCount: r.user_page_count ?? null,
            // v0.65.1 — the audio counterpart of pagesRead. Null for every
            // print row, which is what makes it safe to read unconditionally.
            progressMinutes: r.progress_minutes ?? null,
          })
        : null
    )
    .filter(Boolean);

  // v0.12: load categories for all books in wishlist + library. One round
  // trip via the book_categories_view (UNION of verified global + this user's
  // private categories). RLS on user_book_categories enforces the user filter
  // automatically.
  const allBookIds = [...new Set([
    ...wishlist.map((b) => b.bookId).filter(Boolean),
    ...library.map((b) => b.bookId).filter(Boolean),
    ...currentlyReading.map((b) => b.bookId).filter(Boolean),
  ])];
  // v0.12 hotfix 3: chunk the book_id list. For users with large libraries
  // (700+ books), a single `in.(...)` query exceeds PostgREST's URL length
  // limit and gets rejected with a bare 400 at the edge layer (not by
  // PostgREST itself, which is why no JSON body comes back). 50 IDs per
  // chunk keeps each URL well under 2KB.
  let categoriesByBookId = {};
  if (allBookIds.length > 0) {
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < allBookIds.length; i += CHUNK_SIZE) {
      chunks.push(allBookIds.slice(i, i + CHUNK_SIZE));
    }

    // Fire all chunked queries in parallel — both tables, every chunk.
    const allQueries = [];
    for (const chunk of chunks) {
      allQueries.push(
        supabase
          .from('book_categories')
          .select('book_id, category_id')
          .in('book_id', chunk)
          .then((r) => ({ kind: 'global', ...r }))
      );
      allQueries.push(
        supabase
          .from('user_book_categories')
          .select('book_id, category_id')
          .in('book_id', chunk)
          .then((r) => ({ kind: 'user', ...r }))
      );
    }
    const results = await Promise.all(allQueries);

    const globalLinks = [];
    const userLinks = [];
    for (const r of results) {
      if (r.error) {
        console.warn(`${r.kind} categories chunk failed`, r.error);
        continue;
      }
      if (r.kind === 'global') globalLinks.push(...(r.data || []));
      else userLinks.push(...(r.data || []));
    }

    const allCategoryIds = [...new Set([
      ...globalLinks.map((r) => r.category_id),
      ...userLinks.map((r) => r.category_id),
    ])];

    // Categories themselves may also be many — chunk this query too. Less
    // likely to hit limits (categories are global, total is small), but
    // belt-and-suspenders.
    let categoriesById = {};
    if (allCategoryIds.length > 0) {
      const catChunks = [];
      for (let i = 0; i < allCategoryIds.length; i += CHUNK_SIZE) {
        catChunks.push(allCategoryIds.slice(i, i + CHUNK_SIZE));
      }
      const catResults = await Promise.all(
        catChunks.map((chunk) =>
          supabase
            .from('categories')
            .select('id, name, normalized_name, verified, usage_count')
            .in('id', chunk)
        )
      );
      for (const r of catResults) {
        if (r.error) {
          console.warn('categories table chunk failed', r.error);
          continue;
        }
        for (const c of (r.data || [])) {
          categoriesById[c.id] = c;
        }
      }
    }

    const buildRow = (linkRow, baseSource) => {
      const c = categoriesById[linkRow.category_id];
      if (!c) return null;
      return {
        book_id: linkRow.book_id,
        category_id: c.id,
        category_name: c.name,
        normalized_name: c.normalized_name,
        verified: c.verified,
        usage_count: c.usage_count,
        source: baseSource === 'verified'
          ? 'verified'
          : (c.verified ? 'verified' : 'user'),
      };
    };

    const merged = [
      ...globalLinks.map((r) => buildRow(r, 'verified')).filter(Boolean),
      ...userLinks.map((r) => buildRow(r, 'user')).filter(Boolean),
    ];
    categoriesByBookId = rollupCategories(merged);
  }

  // v0.15 phase 2.3: load canonical genres for all books in wishlist + library.
  // book_genres_view is globally readable (no user scoping). We chunk the same
  // allBookIds list — genres use the same 50-id chunking strategy as categories.
  let genresByBookId = {};
  if (allBookIds.length > 0) {
    const GENRE_CHUNK = 50;
    const genreChunks = [];
    for (let i = 0; i < allBookIds.length; i += GENRE_CHUNK) {
      genreChunks.push(allBookIds.slice(i, i + GENRE_CHUNK));
    }
    const genreResults = await Promise.all(
      genreChunks.map((chunk) =>
        supabase
          .from('book_genres_view')
          .select('book_id, genre_id, genre_name, normalized_name, genre_source, usage_count, genre_description, assigned_by_source, family_slug, family_name, family_sort')
          .in('book_id', chunk)
      )
    );
    const allGenreRows = [];
    for (const r of genreResults) {
      if (r.error) {
        console.warn('book_genres_view chunk failed', r.error);
        continue;
      }
      allGenreRows.push(...(r.data || []));
    }
    genresByBookId = rollupGenres(allGenreRows);
  }

  // Load full genre catalog (for PlanCreate select, genre browser, descriptions).
  // Sorted alphabetically by name.
  let genres = [];
  const { data: genreRows, error: genreErr } = await supabase
    .from('genres')
    .select('id, name, normalized_name, source, usage_count, description, family_id, genre_families ( slug, name, sort_order )')
    .order('name', { ascending: true });
  if (!genreErr && genreRows) {
    genres = genreRows.map((g) => ({
      id: g.id,
      name: g.name,
      normalizedName: g.normalized_name,
      source: g.source,
      usageCount: g.usage_count,
      description: g.description || null,
      // v0.67 — the family this genre is shelved under. PostgREST embeds it as
      // an object (or null when family_id is null), so flatten it here rather
      // than teaching every consumer the embed shape.
      familySlug: g.genre_families?.slug || null,
      familyName: g.genre_families?.name || null,
      familySort: g.genre_families?.sort_order ?? 999,
    }));
  }

  return {
    ...defaultState,
    onboarded: !!profile.preferences?.onboarded,
    profile: {
      ...defaultState.profile,
      ...(profile.preferences || {}),
      displayName: profile.display_name,
      username: profile.username || null,
      avatarUrl: profile.avatar_url,
      isDiscoverable: profile.is_discoverable ?? true,
      // v0.66: real columns now, not preferences keys. favoriteGenres prefers
      // the column and falls back to the blob, because the migration backfills
      // one from the other and a reader who has not saved since then still has
      // their genres only in preferences.
      bio: profile.bio || null,
      shelfVisibility: profile.shelf_visibility || 'followers',
      isCurator: !!profile.is_curator,
      favoriteGenres: (profile.favorite_genres?.length
        ? profile.favorite_genres
        : profile.preferences?.favoriteGenres) || [],
      emailNotifications: profile.email_notifications ?? true,
      // v0.45: dedicated column (not preferences) — stamped once by the backfill
      accomplishmentsBackfilledAt: profile.accomplishments_backfilled_at || null,
    },
    wishlist: dedupeBooks(wishlist),
    library: dedupeBooks(library),
    // v0.35.1: filter readNext against currentlyReading and library on load.
    // Stale entries can persist in preferences when startReading or markAsRead
    // failed to clean up readNext (e.g. the pre-fix authenticated startReading path).
    readNext: dedupeBooks(
      (profile.preferences?.readNext || []).filter((b) => {
        const k = bookKey(b);
        return !currentlyReading.some((cr) => bookKey(cr) === k)
            && !library.some((lb) => bookKey(lb) === k);
      })
    ),
    currentPlan,
    plans,
    lists,
    shelfSortMode: profile.preferences?.shelfSortMode || 'recent',
    oracleMode: profile.preferences?.oracleMode || 'wishlist',
    dashboardLayout: profile.preferences?.dashboardLayout || null,
    readingGoalCount: profile.preferences?.readingGoalCount || null,
    coachmarksSeen: profile.preferences?.coachmarksSeen || [],
    lastSeenVersion: profile.preferences?.lastSeenVersion || null,
    categoriesByBookId,
    genresByBookId,
    genres,
    currentlyReading: dedupeBooks(currentlyReading),
    editionsByBookId,
    memories,
    accomplishments,
    clubs,
  };
}

export async function savePreferences(userId, state) {
  // v0.71.2: supabase-js resolves with { error } instead of throwing, so the
  // .catch() at the call site never saw a refused write (RLS, a trigger, a
  // missing column). Throw it so it reaches the console.
  const { error } = await supabase
    .from('profiles')
    .update({
      preferences: {
        onboarded: state.onboarded,
        readingLevel: state.profile.readingLevel,
        goal: state.profile.goal,
        goodreadsImported: state.profile.goodreadsImported,
        // v0.38: onboarding personalization — feeds Oracle prompts + editable from Profile
        favoriteGenres: state.profile.favoriteGenres || [],
        currentMood: state.profile.currentMood || [],
        // v0.50: highest level the reader has accepted or dismissed a growth
        // nudge for — keeps the dashboard nudge from re-firing.
        levelNudgeDismissed: state.profile.levelNudgeDismissed || 0,
        // v0.51: chosen Reader Title (earned tier key, see titles.js)
        displayTitle: state.profile.displayTitle || null,
        readNext: state.readNext,
        shelfSortMode: state.shelfSortMode,
        oracleMode: state.oracleMode,
        dashboardLayout: state.dashboardLayout,
        // v0.66: which follows feed the dashboard widget draws from.
        feedScope: state.profile.feedScope || 'both',
        readingGoalCount: state.readingGoalCount,
        coachmarksSeen: state.coachmarksSeen || [],
        lastSeenVersion: state.lastSeenVersion,
      },
      // v0.66: the column, written alongside the blob it was promoted out of.
      // ReaderPrefsSection still edits state.profile.favoriteGenres and knows
      // nothing about the column — keeping the two in step here means one
      // place to delete when preferences.favoriteGenres is finally retired,
      // rather than an editor that has to remember.
      favorite_genres: state.profile.favoriteGenres || [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw error;
}
